import { betterAuth, type BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { emailOTP } from "better-auth/plugins";
import { sql } from "drizzle-orm";
import type { Db, DbTransaction } from "./db";
import { schema } from "./db";
import { rateLimits } from "./db/schema";
import { type ApiEnv, integerSetting } from "./env";

export interface AuthDependencies {
  sendOtpEmail(toEmail: string, code: string): Promise<void>;
  now(): Date;
}

const SEND_OTP_PATH = "/email-otp/send-verification-otp";
const SIGN_IN_OTP_PATH = "/sign-in/email-otp";
const OTP_WINDOW_SECONDS = 15 * 60;
const DAY_SECONDS = 24 * 60 * 60;
const CAMPUS_NETWORK_SENDS_PER_IP = 30;
const CAMPUS_NETWORK_SIGN_INS_PER_IP = 60;

/** What the API answers when it sends a sign-in code. */
export type SignInCodeSent = { success: true; expires_in_seconds: number };

/**
 * Better Auth catches and only logs errors thrown while sending a code, so a failed
 * send is recorded against its request for the after hook to report.
 */
const failedSends = new WeakSet<Request>();

export function apiPublicBase(env: ApiEnv): URL {
  if (!env.API_PUBLIC_BASE_URL) throw new Error("API_PUBLIC_BASE_URL is not configured");
  return new URL(env.API_PUBLIC_BASE_URL.replace(/\/+$/, ""));
}

/**
 * Elysia's compiled router strips the mount prefix and its dev-mode router does not,
 * so both `/auth/sign-out` and `/sign-out` arrive here.
 */
export function authRequest(env: ApiEnv, request: Request): Request {
  const url = new URL(request.url);
  const path = /^\/auth(\/|$)/.test(url.pathname) ? url.pathname : `/auth${url.pathname}`;
  url.pathname = `${apiPublicBase(env).pathname}${path}`;
  return new Request(url, request);
}

async function withinEmailQuota(db: Db | DbTransaction, email: string, now: Date, max: number) {
  const key = `email-otp:${email.trim().toLowerCase()}`;
  const nowMs = now.getTime();
  const windowStart = nowMs - OTP_WINDOW_SECONDS * 1000;
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

export function authOptions(env: ApiEnv, db: Db | DbTransaction, deps: AuthDependencies) {
  if (!env.BETTER_AUTH_SECRET) throw new Error("BETTER_AUTH_SECRET is not configured");
  const base = apiPublicBase(env);
  const expiryMinutes = integerSetting(env.OTP_EXPIRY_MINUTES, 10);
  const emailLimit = integerSetting(env.OTP_RATE_LIMIT_PER_15MIN, 3);

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
      cookieCache: { enabled: true, maxAge: 5 * 60, strategy: "compact" },
    },
    account: {
      modelName: "accounts",
      encryptOAuthTokens: true,
      accountLinking: { enabled: true },
    },
    verification: { modelName: "verifications" },
    rateLimit: {
      enabled: true,
      storage: "database",
      modelName: "rateLimits",
      window: 60,
      max: 100,
      customRules: {
        [SEND_OTP_PATH]: { window: OTP_WINDOW_SECONDS, max: CAMPUS_NETWORK_SENDS_PER_IP },
        [SIGN_IN_OTP_PATH]: { window: OTP_WINDOW_SECONDS, max: CAMPUS_NETWORK_SIGN_INS_PER_IP },
      },
    },
    advanced: {
      cookiePrefix: "ubcd",
      database: { generateId: "uuid" },
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
    },
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
        if (ctx.path !== SEND_OTP_PATH || ctx.context.returned instanceof Error) return;
        if (ctx.request && failedSends.has(ctx.request)) {
          throw new APIError("INTERNAL_SERVER_ERROR", {
            code: "OTP_DELIVERY_FAILED",
            message: "Failed to send verification email.",
          });
        }
        return ctx.json({
          success: true,
          expires_in_seconds: expiryMinutes * 60,
        } satisfies SignInCodeSent);
      }),
    },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: expiryMinutes * 60,
        allowedAttempts: integerSetting(env.OTP_MAX_ATTEMPTS, 5),
        storeOTP: "hashed",
        async sendVerificationOTP({ email, otp, type }, ctx) {
          if (type !== "sign-in") return;
          await deps.sendOtpEmail(email, otp).catch((error: unknown) => {
            if (ctx?.request) failedSends.add(ctx.request);
            throw error;
          });
        },
      }),
    ],
  } satisfies BetterAuthOptions;
}

export function createAuth(env: ApiEnv, db: Db | DbTransaction, deps: AuthDependencies) {
  return betterAuth(authOptions(env, db, deps));
}

export type Auth = ReturnType<typeof createAuth>;
export type AuthSession = NonNullable<Awaited<ReturnType<Auth["api"]["getSession"]>>>;
