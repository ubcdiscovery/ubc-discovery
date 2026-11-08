import { eq, inArray, notLike } from "drizzle-orm";
import { Elysia } from "elysia";
import { CloudflareAdapter } from "elysia/adapter/cloudflare-worker";
import { vi } from "vite-plus/test";
import { withDatabase } from "../src/db";
import { events, otpCodes, rateLimits, users, verifications } from "../src/db/schema";
import type { ApiEnv } from "../src/env";
import { errorResponse } from "../src/http/errors";
import { createMemberRoutes } from "../src/routes/users";
import type { ServicesFactory } from "../src/services";
import type { ObjectStorage } from "../src/services/storage";
import { authTestEnv, realAuth, sessionCookie } from "./auth-fixture";

export interface MemberTestJson {
  id: string;
  file_key: string;
  stars: number;
  total: number;
  created_at: string;
  ubc_verified: boolean;
  detail: { code: string };
  saved_events: Array<{ event: { id: string; event_picture_url: string } }>;
}

export const testUrl = process.env.TEST_DATABASE_URL;
if (testUrl && !["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(testUrl).hostname)) {
  throw new Error("Member integration tests require a disposable localhost database");
}
export const env = {
  ...authTestEnv,
  DATABASE_URL: testUrl,
  OTP_EXPIRY_MINUTES: "10",
  OTP_MAX_ATTEMPTS: "5",
  OTP_RATE_LIMIT_PER_15MIN: "3",
} as ApiEnv;
export const fixedNow = new Date("2026-10-12T00:00:00Z");
export const fixtureEmails = new Set<string>();
export const fixtureUserIds = new Set<string>();
export const fixtureEventIds = new Set<string>();

/** A signed-in person: their `users` row and the Cookie header of a real session. */
export interface Identity {
  id: string;
  email: string;
  session: string;
}

export function email(prefix = "fixture") {
  const value = `${prefix}-${crypto.randomUUID()}@example.com`;
  fixtureEmails.add(value);
  return value;
}

/** Signed in through Better Auth, but not yet onboarded (what sign-in creates). */
export async function identity(
  address = email(),
  verified = true,
  extra: Partial<typeof users.$inferInsert> = {},
): Promise<Identity> {
  fixtureEmails.add(address);
  const [row] = await withDatabase(env, (db) =>
    db
      .insert(users)
      .values({
        email: address.toLowerCase(),
        emailVerified: verified,
        preferredName: "",
        ...extra,
      })
      .returning(),
  );
  fixtureUserIds.add(row!.id);
  return { id: row!.id, email: row!.email, session: await sessionCookie(env, row!.id) };
}

/** Pass the same configuration as `app` when a test overrides settings. */
export function serviceMocks(configuration = env) {
  const sendEmail = vi.fn(async (_email: string, _code: string) => {});
  const storage: ObjectStorage = {
    publicUrl: (key) => `https://media.example.com/${key}`,
    objectExists: async () => true,
    getObjectBytes: async () => new Uint8Array(),
    deleteObject: vi.fn(async () => {}),
    copyObject: async () => {},
    generatePresignedDownloadUrl: async (key) => `https://download.example.com/${key}`,
    generatePresignedUpload: vi.fn(async (options) => ({
      url: "https://upload.example.com/",
      fields: { "Content-Type": options.contentType },
      file_key: options.fileKey,
    })),
  };
  const factory: ServicesFactory = () => {
    const deps = { sendOtpEmail: sendEmail, now: () => fixedNow };
    return {
      ...deps,
      auth: realAuth(configuration, deps),
      storage,
      embedEvent: async () => null,
    };
  };
  return { factory, sendEmail, storage };
}

export function app(factory: ServicesFactory, configuration = env) {
  return new Elysia({ adapter: CloudflareAdapter, normalize: false })
    .onError(({ code, error }) => {
      if (code === "VALIDATION" || code === "PARSE")
        return Response.json({ detail: "Invalid request" }, { status: 422 });
      return errorResponse(error);
    })
    .use(createMemberRoutes(configuration, factory))
    .compile();
}

export function request(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    /** Cookie header of a signed-in session. */
    session?: string;
    headers?: Record<string, string>;
    jsonHeader?: boolean;
  } = {},
) {
  return new Request(`http://localhost${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.body === undefined && !options.jsonHeader
        ? {}
        : { "content-type": "application/json" }),
      ...(options.session ? { cookie: options.session } : {}),
      ...options.headers,
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
}

/** An onboarded member with a signed-in session. */
export async function member(extra: Partial<typeof users.$inferInsert> = {}) {
  const who = await identity(email(), true, {
    preferredName: "Fixture Member",
    createdAt: fixedNow,
    onboardingCompleted: true,
    ...extra,
  });
  const [row] = await withDatabase(env, (db) =>
    db.select().from(users).where(eq(users.id, who.id)),
  );
  return { row: row!, identity: who };
}

export async function otp(address: string, extra: Partial<typeof otpCodes.$inferInsert> = {}) {
  fixtureEmails.add(address);
  return withDatabase(env, async (db) => {
    const [row] = await db
      .insert(otpCodes)
      .values({
        email: address.toLowerCase(),
        code: "123456",
        expiresAt: new Date(fixedNow.getTime() + 600_000),
        createdAt: fixedNow,
        ...extra,
      })
      .returning();
    return row!;
  });
}

export async function event(extra: Partial<typeof events.$inferInsert> = {}) {
  return withDatabase(env, async (db) => {
    const [row] = await db
      .insert(events)
      .values({
        title: "Fixture event",
        source: "fixture",
        locationName: "UBC",
        eventDate: new Date(fixedNow.getTime() - 7200_000),
        eventEndDate: new Date(fixedNow.getTime() - 3600_000),
        ...extra,
      })
      .returning();
    fixtureEventIds.add(row!.id);
    return row!;
  });
}

export async function cleanupMemberFixtures() {
  if (!testUrl) return;
  await withDatabase(env, async (db) => {
    // Better Auth's per-IP counters would otherwise carry over between runs. Address
    // counters stay: other test files run concurrently and rely on theirs.
    await db.delete(rateLimits).where(notLike(rateLimits.key, "email-otp:%"));
    if (fixtureEmails.size)
      await db.delete(otpCodes).where(
        inArray(
          otpCodes.email,
          [...fixtureEmails].map((value) => value.toLowerCase()),
        ),
      );
    if (fixtureEmails.size) {
      const addresses = [...fixtureEmails].map((value) => value.toLowerCase());
      await db.delete(rateLimits).where(
        inArray(
          rateLimits.key,
          addresses.map((value) => `email-otp:${value}`),
        ),
      );
      await db.delete(verifications).where(
        inArray(
          verifications.identifier,
          addresses.map((value) => `sign-in-otp-${value}`),
        ),
      );
      // Members created by sign-in during a test.
      for (const row of await db
        .select({ id: users.id })
        .from(users)
        .where(inArray(users.email, addresses)))
        fixtureUserIds.add(row.id);
    }
    if (fixtureUserIds.size) await db.delete(users).where(inArray(users.id, [...fixtureUserIds]));
    if (fixtureEventIds.size)
      await db.delete(events).where(inArray(events.id, [...fixtureEventIds]));
  });
  fixtureEmails.clear();
  fixtureUserIds.clear();
  fixtureEventIds.clear();
}
