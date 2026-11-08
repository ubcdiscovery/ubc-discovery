import { eq, inArray, like } from "drizzle-orm";
import { Elysia } from "elysia";
import { CloudflareAdapter } from "elysia/adapter/cloudflare-worker";
import { vi } from "vite-plus/test";
import { withDatabase } from "../src/db";
import { events, rateLimits, users, verifications } from "../src/db/schema";
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
const octet = () => Math.floor(Math.random() * 254) + 1;
/** Each test file is its own client, so Better Auth's per-IP counters never collide. */
const clientIp = `10.${octet()}.${octet()}.${octet()}`;
export const fixedNow = new Date("2026-10-12T00:00:00Z");
export const fixtureEmails = new Set<string>();
export const fixtureUserIds = new Set<string>();
export const fixtureEventIds = new Set<string>();

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

export async function signedUpUser(
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
  return { factory, sendEmail, storage, configuration };
}

export function app({ factory, configuration }: ReturnType<typeof serviceMocks>) {
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
      "cf-connecting-ip": clientIp,
      ...(options.session ? { cookie: options.session } : {}),
      ...options.headers,
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
}

export async function member(extra: Partial<typeof users.$inferInsert> = {}) {
  const who = await signedUpUser(email(), true, {
    preferredName: "Fixture Member",
    createdAt: fixedNow,
    onboardingCompleted: true,
    ...extra,
  });
  const [row] = await withDatabase(env, (db) =>
    db.select().from(users).where(eq(users.id, who.id)),
  );
  return { row: row!, session: who.session };
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
    await db.delete(rateLimits).where(like(rateLimits.key, `${clientIp}|%`));
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
