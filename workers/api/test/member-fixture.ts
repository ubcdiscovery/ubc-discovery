import { inArray } from "drizzle-orm";
import { Elysia } from "elysia";
import { CloudflareAdapter } from "elysia/adapter/cloudflare-worker";
import { vi } from "vite-plus/test";
import { withDatabase } from "../src/db";
import { events, otpCodes, users } from "../src/db/schema";
import type { ApiEnv } from "../src/env";
import { ApiError, errorResponse } from "../src/http/errors";
import { createMemberRoutes } from "../src/routes/users";
import type { FirebaseIdentity } from "../src/services/firebase";
import type { ServicesFactory } from "../src/services";
import type { ObjectStorage } from "../src/services/storage";

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
  DATABASE_URL: testUrl,
  OTP_EXPIRY_MINUTES: "10",
  OTP_MAX_ATTEMPTS: "5",
  OTP_RATE_LIMIT_PER_15MIN: "3",
} as ApiEnv;
export const fixedNow = new Date("2026-10-12T00:00:00Z");
export const fixtureEmails = new Set<string>();
export const fixtureUserIds = new Set<string>();
export const fixtureEventIds = new Set<string>();
export const identities = new Map<string, FirebaseIdentity>();

export function email(prefix = "fixture") {
  const value = `${prefix}-${crypto.randomUUID()}@example.com`;
  fixtureEmails.add(value);
  return value;
}

export function identity(address = email(), verified = true) {
  const uid = crypto.randomUUID();
  const value = { uid, email: address, name: "Fixture", email_verified: verified };
  identities.set(uid, value);
  return value;
}

export function serviceMocks() {
  const sendEmail = vi.fn(async (_email: string, _code: string) => {});
  const getOrCreateUser = vi.fn(async (address: string) => {
    const existing = [...identities.values()].find((value) => value.email === address);
    return existing?.uid ?? `otp-${address}`;
  });
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
  const factory: ServicesFactory = () => ({
    firebase: {
      verifyIdToken: async (token) => {
        const result = identities.get(token);
        if (!result) throw new ApiError(401, "Invalid or expired token");
        return result;
      },
      getOrCreateUser,
      createCustomToken: async (uid) => `offline-custom-token-${uid}`,
    },
    storage,
    sendOtpEmail: sendEmail,
    embedEvent: async () => null,
    now: () => fixedNow,
  });
  return { factory, sendEmail, getOrCreateUser, storage };
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
    uid?: string;
    authorization?: string;
    jsonHeader?: boolean;
  } = {},
) {
  return new Request(`http://localhost${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.body === undefined && !options.jsonHeader
        ? {}
        : { "content-type": "application/json" }),
      ...(options.uid ? { authorization: `Bearer ${options.uid}` } : {}),
      ...(options.authorization ? { authorization: options.authorization } : {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
}

export async function member(who = identity(), extra: Partial<typeof users.$inferInsert> = {}) {
  return withDatabase(env, async (db) => {
    const [row] = await db
      .insert(users)
      .values({
        firebaseUid: who.uid,
        email: who.email,
        preferredName: "Fixture Member",
        createdAt: fixedNow,
        onboardingCompleted: true,
        ...extra,
      })
      .returning();
    fixtureUserIds.add(row!.id);
    return { row: row!, identity: who };
  });
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
    if (fixtureEmails.size)
      await db.delete(otpCodes).where(
        inArray(
          otpCodes.email,
          [...fixtureEmails].map((value) => value.toLowerCase()),
        ),
      );
    if (fixtureUserIds.size) await db.delete(users).where(inArray(users.id, [...fixtureUserIds]));
    if (fixtureEventIds.size)
      await db.delete(events).where(inArray(events.id, [...fixtureEventIds]));
  });
  fixtureEmails.clear();
  fixtureUserIds.clear();
  fixtureEventIds.clear();
  identities.clear();
}
