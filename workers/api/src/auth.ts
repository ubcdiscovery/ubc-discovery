import { betterAuth, type BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { emailOTP } from "better-auth/plugins";
import { sql } from "drizzle-orm";
import type { Db } from "./db";
import { schema } from "./db";
import { rateLimits } from "./db/schema";
import { type ApiEnv, integerSetting } from "./env";

export interface AuthDependencies {
  sendOtpEmail(toEmail: string, code: string): Promise<void>;
  now(): Date;
}

const SEND_OTP_PATH = "/email-otp/send-verification-otp";
const OTP_WINDOW_MS = 15 * 60_000;
const DAY_SECONDS = 24 * 60 * 60;

/**
 * Public URL of the API (`…/api`). The web Worker strips `/api` before the API sees
 * a request, so Better Auth is configured with the public path and requests are
 * rewritten back onto it in `authRequest`.
 */
export function apiPublicBase(env: ApiEnv): URL {
  if (!env.API_PUBLIC_BASE_URL) throw new Error("API_PUBLIC_BASE_URL is not configured");
  return new URL(env.API_PUBLIC_BASE_URL.replace(/\/+$/, ""));
}

/**
 * Rewrite a request for the `/auth` mount onto its public URL (`/api/auth/...`).
 * Elysia's compiled router strips the mount prefix and its dev-mode router does not,
 * so both `/auth/sign-out` and `/sign-out` arrive here.
 */
export function authRequest(env: ApiEnv, request: Request): Request {
  const url = new URL(request.url);
  const path = /^\/auth(\/|$)/.test(url.pathname) ? url.pathname : `/auth${url.pathname}`;
  url.pathname = `${apiPublicBase(env).pathname}${path}`;
  return new Request(url, request);
}

/**
 * Counts sign-in codes sent to one address in a fixed 15-minute window. Better Auth
 * limits by IP; campus networks share addresses, so the per-address limit is the one
 * that stops a mailbox from being flooded.
 */
async function withinEmailQuota(db: Db, email: string, now: Date, max: number) {
  const key = `email-otp:${email.trim().toLowerCase()}`;
  const nowMs = now.getTime();
  const windowStart = nowMs - OTP_WINDOW_MS;
  const [row] = await db
    .insert(rateLimits)
    .values({ key, count: 1, lastRequest: nowMs })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`CASE WHEN ${rateLimits.lastRequest} < ${windowStart} THEN 1 ELSE ${rateLimits.count} + 1 END`,
        lastRequest: sql`CASE WHEN ${rateLimits.lastRequest} < ${windowStart} THEN ${nowMs} ELSE ${rateLimits.lastRequest} END`,
      },
    })
    .returning({ count: rateLimits.count });
  return row!.count <= max;
}

export function authOptions(env: ApiEnv, db: Db, deps: AuthDependencies) {
  if (!env.BETTER_AUTH_SECRET) throw new Error("BETTER_AUTH_SECRET is not configured");
  const base = apiPublicBase(env);
  const expiryMinutes = integerSetting(env.OTP_EXPIRY_MINUTES, 10);
  const emailLimit = integerSetting(env.OTP_RATE_LIMIT_PER_15MIN, 3);
  // Better Auth swallows errors thrown while sending a code, so the code is handed
  // over here and delivered in the after hook, where a failure can reach the member.
  // Safe because each request builds its own instance (see createAuth).
  let pendingCode: { email: string; otp: string } | undefined;

  return {
    appName: "UBC Discovery",
    secret: env.BETTER_AUTH_SECRET,
    baseURL: base.origin,
    basePath: `${base.pathname}/auth`,
    database: drizzleAdapter(db, { provider: "pg", schema }),
    telemetry: { enabled: false },
    user: {
      modelName: "users",
      fields: { name: "preferredName" },
      additionalFields: {
        isAdmin: { type: "boolean", required: false, defaultValue: false, input: false },
        onboardingCompleted: {
          type: "boolean",
          required: false,
          defaultValue: false,
          input: false,
        },
      },
    },
    session: {
      modelName: "sessions",
      expiresIn: 60 * DAY_SECONDS,
      updateAge: DAY_SECONDS,
      // Members are re-read from `users` on every API request; the cache only saves
      // the session lookup. Revoked sessions stop working within this window.
      cookieCache: { enabled: true, maxAge: 5 * 60, strategy: "compact" },
    },
    account: {
      modelName: "accounts",
      encryptOAuthTokens: true,
      // Google confirms the address, so it links to an existing email-code member.
      accountLinking: { enabled: true, trustedProviders: ["google"] },
    },
    verification: { modelName: "verifications" },
    rateLimit: {
      enabled: true,
      storage: "database",
      modelName: "rateLimits",
      window: 60,
      max: 100,
      customRules: {
        // Per IP. Generous because campus networks put many members behind one address.
        [SEND_OTP_PATH]: { window: 15 * 60, max: 30 },
        "/sign-in/email-otp": { window: 15 * 60, max: 60 },
      },
    },
    advanced: {
      cookiePrefix: "ubcd",
      database: { generateId: "uuid" },
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
    },
    // Profile changes go through /users/me so they share its validation.
    disabledPaths: ["/update-user", "/delete-user", "/change-email"],
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID ?? "",
        clientSecret: env.GOOGLE_CLIENT_SECRET ?? "",
        prompt: "select_account",
        enabled: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== SEND_OTP_PATH) return;
        const email = (ctx.body as { email?: unknown } | undefined)?.email;
        if (typeof email !== "string") return;
        if (!(await withinEmailQuota(db, email, deps.now(), emailLimit))) {
          throw new APIError("TOO_MANY_REQUESTS", {
            code: "OTP_RATE_LIMITED",
            message: "Too many requests. Try again later.",
          });
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== SEND_OTP_PATH || !pendingCode) return;
        const { email, otp } = pendingCode;
        pendingCode = undefined;
        try {
          await deps.sendOtpEmail(email, otp);
        } catch {
          throw new APIError("INTERNAL_SERVER_ERROR", {
            code: "OTP_DELIVERY_FAILED",
            message: "Failed to send verification email.",
          });
        }
        // The sign-in screen counts down from the server's expiry.
        return ctx.json({ success: true, expires_in_seconds: expiryMinutes * 60 });
      }),
    },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: expiryMinutes * 60,
        allowedAttempts: integerSetting(env.OTP_MAX_ATTEMPTS, 5),
        async sendVerificationOTP({ email, otp, type }) {
          if (type === "sign-in") pendingCode = { email, otp };
        },
      }),
    ],
  } satisfies BetterAuthOptions;
}

/** Create within a request: the database client cannot outlive it. */
export function createAuth(env: ApiEnv, db: Db, deps: AuthDependencies) {
  return betterAuth(authOptions(env, db, deps));
}

export type Auth = ReturnType<typeof createAuth>;
export type AuthSession = NonNullable<Awaited<ReturnType<Auth["api"]["getSession"]>>>;
