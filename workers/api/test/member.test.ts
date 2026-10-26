import { and, eq, inArray } from "drizzle-orm";
import { Elysia } from "elysia";
import { CloudflareAdapter } from "elysia/adapter/cloudflare-worker";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withDatabase } from "../src/db";
import { eventRatings, events, otpCodes, savedEvents, users } from "../src/db/schema";
import type { ApiEnv } from "../src/env";
import { ApiError, errorResponse } from "../src/http/errors";
import { createMemberRoutes } from "../src/routes/users";
import { isUbcEmail } from "../src/schemas/member";
import type { FirebaseIdentity } from "../src/services/firebase";
import type { ServicesFactory } from "../src/services";
import type { ObjectStorage } from "../src/services/storage";

interface MemberTestJson {
  id: string;
  file_key: string;
  stars: number;
  total: number;
  created_at: string;
  ubc_verified: boolean;
  detail: { code: string };
  saved_events: Array<{ event: { id: string; event_picture_url: string } }>;
}

const testUrl = process.env.TEST_DATABASE_URL;
if (testUrl && !["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(testUrl).hostname)) {
  throw new Error("Member integration tests require a disposable localhost database");
}
const env = {
  DATABASE_URL: testUrl,
  OTP_EXPIRY_MINUTES: "10",
  OTP_MAX_ATTEMPTS: "5",
  OTP_RATE_LIMIT_PER_15MIN: "3",
} as ApiEnv;
const fixedNow = new Date("2026-10-12T00:00:00Z");
const fixtureEmails = new Set<string>();
const fixtureUserIds = new Set<string>();
const fixtureEventIds = new Set<string>();
const identities = new Map<string, FirebaseIdentity>();

function email(prefix = "fixture") {
  const value = `${prefix}-${crypto.randomUUID()}@example.com`;
  fixtureEmails.add(value);
  return value;
}

function identity(address = email(), verified = true) {
  const uid = crypto.randomUUID();
  const value = { uid, email: address, name: "Fixture", email_verified: verified };
  identities.set(uid, value);
  return value;
}

function serviceMocks() {
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

function app(factory: ServicesFactory, configuration = env) {
  return new Elysia({ adapter: CloudflareAdapter, normalize: false })
    .onError(({ code, error }) => {
      if (code === "VALIDATION" || code === "PARSE")
        return Response.json({ detail: "Invalid request" }, { status: 422 });
      return errorResponse(error);
    })
    .use(createMemberRoutes(configuration, factory))
    .compile();
}

function request(
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

async function member(who = identity(), extra: Partial<typeof users.$inferInsert> = {}) {
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

async function otp(address: string, extra: Partial<typeof otpCodes.$inferInsert> = {}) {
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

async function event(extra: Partial<typeof events.$inferInsert> = {}) {
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

afterEach(async () => {
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
});

describe("UBC trust-badge domain boundary", () => {
  it("accepts only ubc.ca and its real subdomains", () => {
    for (const address of ["member@ubc.ca", "member@STUDENT.UBC.CA", "member@a.b.ubc.ca"])
      expect(isUbcEmail(address)).toBe(true);
    for (const address of ["member@example.com", "member@evilubc.ca", "member@ubc.ca.example.com"])
      expect(isUbcEmail(address)).toBe(false);
  });
});

describe.skipIf(!testUrl)("OTP persistence and concurrency against PostgreSQL", () => {
  it("rejects malformed email addresses before delivery or Firebase calls", async () => {
    const mocks = serviceMocks();
    const api = app(mocks.factory);
    const sent = await api.handle(
      request("/auth/otp/send", { method: "POST", body: { email: "not-an-email" } }),
    );
    const verified = await api.handle(
      request("/auth/otp/verify", {
        method: "POST",
        body: { email: "not-an-email", code: "123456" },
      }),
    );
    expect(sent.status).toBe(422);
    expect(verified.status).toBe(422);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.getOrCreateUser).not.toHaveBeenCalled();
  });

  it("normalizes input, generates bounded secure codes, invalidates old codes and sends only after commit", async () => {
    const address = email();
    const previous = await otp(address);
    const mocks = serviceMocks();
    mocks.sendEmail.mockImplementation(async (recipient, code) => {
      expect(recipient).toBe(address.toUpperCase());
      expect(code).toMatch(/^[1-9]\d{5}$/);
      await withDatabase(env, async (db) => {
        const [persisted] = await db
          .select()
          .from(otpCodes)
          .where(and(eq(otpCodes.email, address), eq(otpCodes.used, false)));
        expect(persisted!.code).toBe(code);
      });
    });
    const response = await app(mocks.factory).handle(
      request("/auth/otp/send", { method: "POST", body: { email: ` ${address.toUpperCase()} ` } }),
    );
    expect(response.status).toBe(200);
    expect(await response.json<MemberTestJson>()).toEqual({
      message: "If this email is valid, you'll receive a verification code.",
      expires_in_seconds: 600,
    });
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    await withDatabase(env, async (db) =>
      expect((await db.select().from(otpCodes).where(eq(otpCodes.id, previous.id)))[0]!.used).toBe(
        true,
      ),
    );
  });

  it("persists the failed delivery and enforces the rate limit", async () => {
    const address = email();
    const mocks = serviceMocks();
    mocks.sendEmail.mockRejectedValue(new Error("private provider failure"));
    const api = app(mocks.factory, { ...env, OTP_RATE_LIMIT_PER_15MIN: "1" });
    const failed = await api.handle(
      request("/auth/otp/send", { method: "POST", body: { email: address } }),
    );
    expect(failed.status).toBe(500);
    expect(await failed.json<MemberTestJson>()).toEqual({
      detail: { code: "OTP_DELIVERY_FAILED", message: "Failed to send verification email." },
    });
    const limited = await api.handle(
      request("/auth/otp/send", { method: "POST", body: { email: address } }),
    );
    expect(limited.status).toBe(429);
    expect((await limited.json<MemberTestJson>()).detail.code).toBe("OTP_RATE_LIMITED");
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("serializes concurrent first-email sends so no rate-limit bypass or extra active codes remain", async () => {
    const address = email();
    const mocks = serviceMocks();
    const api = app(mocks.factory);
    const responses = await Promise.all(
      Array.from({ length: 4 }, () =>
        api.handle(request("/auth/otp/send", { method: "POST", body: { email: address } })),
      ),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([200, 200, 200, 429]);
    expect(mocks.sendEmail).toHaveBeenCalledTimes(3);
    await withDatabase(env, async (db) => {
      const codes = await db.select().from(otpCodes).where(eq(otpCodes.email, address));
      expect(codes).toHaveLength(3);
      expect(codes.filter((code) => !code.used)).toHaveLength(1);
    });
  });

  it("commits wrong attempts and terminal used state before returning errors", async () => {
    const address = email();
    const code = await otp(address);
    const mocks = serviceMocks();
    const api = app(mocks.factory, { ...env, OTP_MAX_ATTEMPTS: "2" });
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await api.handle(
        request("/auth/otp/verify", { method: "POST", body: { email: address, code: "wrong" } }),
      );
      expect(response.status).toBe(400);
      expect((await response.json<MemberTestJson>()).detail.code).toBe("OTP_INVALID");
    }
    const terminal = await api.handle(
      request("/auth/otp/verify", { method: "POST", body: { email: address, code: "123456" } }),
    );
    expect((await terminal.json<MemberTestJson>()).detail.code).toBe("OTP_TOO_MANY_ATTEMPTS");
    await withDatabase(env, async (db) =>
      expect((await db.select().from(otpCodes).where(eq(otpCodes.id, code.id)))[0]).toMatchObject({
        attempts: 2,
        used: true,
      }),
    );
    expect(mocks.getOrCreateUser).not.toHaveBeenCalled();
  });

  it("does not lose concurrent incorrect attempts", async () => {
    const address = email();
    const code = await otp(address);
    const api = app(serviceMocks().factory);
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        api.handle(
          request("/auth/otp/verify", { method: "POST", body: { email: address, code: "wrong" } }),
        ),
      ),
    );
    expect(results.map((value) => value.status)).toEqual([400, 400, 400, 400]);
    await withDatabase(env, async (db) =>
      expect((await db.select().from(otpCodes).where(eq(otpCodes.id, code.id)))[0]!.attempts).toBe(
        4,
      ),
    );
  });

  it("permits exactly one concurrent consumption of a valid code", async () => {
    const address = email();
    await otp(address);
    const mocks = serviceMocks();
    const api = app(mocks.factory);
    const results = await Promise.all(
      Array.from({ length: 2 }, () =>
        api.handle(
          request("/auth/otp/verify", { method: "POST", body: { email: address, code: "123456" } }),
        ),
      ),
    );
    expect(results.map((value) => value.status).sort()).toEqual([200, 400]);
    expect(mocks.getOrCreateUser).toHaveBeenCalledTimes(1);
    const rejected = results.find((value) => value.status === 400)!;
    expect((await rejected.json<MemberTestJson>()).detail.code).toBe("OTP_EXPIRED");
  });

  it("does not restore a consumed code when Firebase fails", async () => {
    const address = email();
    const code = await otp(address);
    const mocks = serviceMocks();
    mocks.getOrCreateUser.mockRejectedValue(new Error("offline provider failure"));
    const response = await app(mocks.factory).handle(
      request("/auth/otp/verify", { method: "POST", body: { email: address, code: "123456" } }),
    );
    expect(response.status).toBe(500);
    await withDatabase(env, async (db) =>
      expect((await db.select().from(otpCodes).where(eq(otpCodes.id, code.id)))[0]!.used).toBe(
        true,
      ),
    );
  });

  it("recognizes an existing member by Firebase UID", async () => {
    const existing = await member();
    await otp(existing.identity.email);
    const response = await app(serviceMocks().factory).handle(
      request("/auth/otp/verify", {
        method: "POST",
        body: { email: existing.identity.email, code: "123456" },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json<MemberTestJson>()).toMatchObject({
      is_new_user: false,
      ubc_verified: false,
    });
  });

  it("rejects an expired or used code without calling Firebase", async () => {
    const address = email();
    await otp(address, { expiresAt: fixedNow });
    const mocks = serviceMocks();
    const response = await app(mocks.factory).handle(
      request("/auth/otp/verify", { method: "POST", body: { email: address, code: "123456" } }),
    );
    expect(response.status).toBe(400);
    expect((await response.json<MemberTestJson>()).detail.code).toBe("OTP_EXPIRED");
    expect(mocks.getOrCreateUser).not.toHaveBeenCalled();
  });
});

describe.skipIf(!testUrl)("member authentication, onboarding and profile contracts", () => {
  it("requires a verified Firebase identity and a completed profile", async () => {
    const api = app(serviceMocks().factory);
    expect((await api.handle(request("/users/me"))).status).toBe(401);
    expect(
      (await api.handle(request("/users/me", { authorization: "Api-Key fixture" }))).status,
    ).toBe(403);
    const unverified = identity(email(), false);
    expect((await api.handle(request("/users/me", { uid: unverified.uid }))).status).toBe(403);
    const newIdentity = identity();
    expect((await api.handle(request("/users/me", { uid: newIdentity.uid }))).status).toBe(404);
  });

  it("onboards non-UBC members, normalizes profile text, and forbids forged capability fields", async () => {
    const who = identity();
    const api = app(serviceMocks().factory);
    const forged = await api.handle(
      request("/users/onboarding", {
        method: "POST",
        uid: who.uid,
        body: { preferred_name: "New", is_admin: true },
      }),
    );
    expect(forged.status).toBe(422);
    const response = await api.handle(
      request("/users/onboarding", {
        method: "POST",
        uid: who.uid,
        body: {
          preferred_name: " New Member ",
          major: " Physics ",
          faculty_id: "science",
          academic_level: "year_2",
          interests: ["music"],
          bio: "Hello",
        },
      }),
    );
    expect(response.status).toBe(200);
    const value = await response.json<MemberTestJson>();
    fixtureUserIds.add(value.id);
    expect(value).toMatchObject({
      email: who.email,
      preferred_name: "New Member",
      major: "Physics",
      is_admin: false,
      ubc_verified: false,
      profile_picture_url: null,
    });
    expect(value).not.toHaveProperty("firebase_uid");
    expect(
      (
        await api.handle(
          request("/users/onboarding", {
            method: "POST",
            uid: who.uid,
            body: { preferred_name: "Duplicate" },
          }),
        )
      ).status,
    ).toBe(409);
  });

  it("accepts UBC sign-in without making UBC email a membership requirement", async () => {
    const address = `${crypto.randomUUID()}@student.ubc.ca`;
    fixtureEmails.add(address);
    const who = identity(address);
    const response = await app(serviceMocks().factory).handle(
      request("/users/onboarding", {
        method: "POST",
        uid: who.uid,
        body: { preferred_name: "UBC Member" },
      }),
    );
    const value = await response.json<MemberTestJson>();
    fixtureUserIds.add(value.id);
    expect(value.ubc_verified).toBe(true);
  });

  it("returns a conflict for another Firebase identity using an existing member email without changing that member", async () => {
    const existing = await member();
    const conflicting = identity(existing.identity.email);
    const response = await app(serviceMocks().factory).handle(
      request("/users/onboarding", {
        method: "POST",
        uid: conflicting.uid,
        body: { preferred_name: "Conflicting Member" },
      }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ detail: "User already exists" });
    await withDatabase(env, async (db) => {
      const matching = await db
        .select()
        .from(users)
        .where(eq(users.email, existing.identity.email));
      expect(matching).toHaveLength(1);
      expect(matching[0]).toMatchObject({
        id: existing.row.id,
        firebaseUid: existing.identity.uid,
        preferredName: "Fixture Member",
      });
      expect(
        await db.select().from(users).where(eq(users.firebaseUid, conflicting.uid)),
      ).toHaveLength(0);
    });
  });

  it("creates exactly one profile when onboarding requests race", async () => {
    const who = identity();
    const api = app(serviceMocks().factory);
    const responses = await Promise.all(
      Array.from({ length: 2 }, () =>
        api.handle(
          request("/users/onboarding", {
            method: "POST",
            uid: who.uid,
            body: { preferred_name: "Concurrent Member" },
          }),
        ),
      ),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const created = responses.find((response) => response.status === 200)!;
    fixtureUserIds.add((await created.json<MemberTestJson>()).id);
  });

  it.each([
    { preferred_name: "   " },
    { preferred_name: "Member", major: "  " },
    { preferred_name: "Member", faculty_id: "unknown" },
    { preferred_name: "Member", academic_level: "sixth_year" },
    { preferred_name: "Member", faculty: "Science" },
    { preferred_name: "x".repeat(256) },
  ])("rejects invalid onboarding fields %j", async (body) => {
    const who = identity();
    expect(
      (
        await app(serviceMocks().factory).handle(
          request("/users/onboarding", { method: "POST", uid: who.uid, body }),
        )
      ).status,
    ).toBe(422);
  });

  it("updates only supplied fields, clears optional context and keeps database admin capability", async () => {
    const existing = await member(identity(), {
      major: "Physics",
      academicLevel: "year_2",
      facultyId: "science",
      profilePictureKey: "profile-pictures/fixture",
      isAdmin: true,
    });
    const api = app(serviceMocks().factory);
    const updated = await api.handle(
      request("/users/me", {
        method: "PUT",
        uid: existing.identity.uid,
        body: { major: null, academic_level: null, faculty_id: null, preferred_name: " Updated " },
      }),
    );
    expect(updated.status).toBe(200);
    expect(await updated.json<MemberTestJson>()).toMatchObject({
      preferred_name: "Updated",
      major: null,
      academic_level: null,
      faculty_id: null,
      is_admin: true,
      profile_picture_url: "https://media.example.com/profile-pictures/fixture",
    });
    expect(
      (
        await api.handle(
          request("/users/me", {
            method: "PUT",
            uid: existing.identity.uid,
            body: { is_admin: false },
          }),
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await api.handle(
          request("/users/me", { method: "PUT", uid: existing.identity.uid, body: {} }),
        )
      ).status,
    ).toBe(200);
    expect((await api.handle(request("/users/me", { uid: existing.identity.uid }))).status).toBe(
      200,
    );
    const stats = await api.handle(request("/users/me/stats", { uid: existing.identity.uid }));
    expect(await stats.json<MemberTestJson>()).toEqual({ member_since: fixedNow.toISOString() });
  });

  it("preserves the bounded profile-upload response and stores its generated key", async () => {
    const existing = await member(identity(), { profilePictureKey: "profile-pictures/old" });
    const mocks = serviceMocks();
    const response = await app(mocks.factory).handle(
      request("/users/me/presigned-upload", { uid: existing.identity.uid }),
    );
    expect(response.status).toBe(200);
    const value = await response.json<MemberTestJson>();
    expect(value).toMatchObject({
      upload_url: "https://upload.example.com/",
      fields: { "Content-Type": "image/webp" },
      max_file_size_bytes: 512 * 1024,
    });
    expect(value.file_key).toMatch(/^profile-pictures\/[a-f0-9-]{36}$/);
    expect(mocks.storage.deleteObject).toHaveBeenCalledWith("profile-pictures/old");
    await withDatabase(env, async (db) =>
      expect(
        (await db.select().from(users).where(eq(users.id, existing.row.id)))[0]!.profilePictureKey,
      ).toBe(value.file_key),
    );
  });

  it("UBC confirmation consumes a code and sets only the optional badge", async () => {
    const existing = await member();
    const address = `${crypto.randomUUID()}@alumni.ubc.ca`;
    fixtureEmails.add(address);
    await otp(address);
    const api = app(serviceMocks().factory);
    const response = await api.handle(
      request("/auth/ubc-verify/confirm", {
        method: "POST",
        uid: existing.identity.uid,
        body: { email: address, code: "123456" },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json<MemberTestJson>()).toMatchObject({
      email: existing.identity.email,
      ubc_verified: true,
    });
    expect(
      (
        await api.handle(
          request("/auth/ubc-verify/send", {
            method: "POST",
            uid: existing.identity.uid,
            body: { email: address },
          }),
        )
      ).status,
    ).toBe(400);
  });

  it("rejects UBC lookalike domains without sending mail", async () => {
    const existing = await member();
    const mocks = serviceMocks();
    const response = await app(mocks.factory).handle(
      request("/auth/ubc-verify/send", {
        method: "POST",
        uid: existing.identity.uid,
        body: { email: "member@ubc.ca.example.com" },
      }),
    );
    expect(response.status).toBe(400);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });
});

describe.skipIf(!testUrl)("saved events and ratings visibility contracts", () => {
  it("accepts browser JSON headers on empty-body save/unsave requests while validating JSON-required mutations", async () => {
    const existing = await member();
    const target = await event();
    const api = app(serviceMocks().factory);
    const headers = { uid: existing.identity.uid, jsonHeader: true };
    const saved = await api.handle(
      request(`/saved-events/${target.id}`, { ...headers, method: "PUT" }),
    );
    expect(saved.status).toBe(201);
    expect(saved.headers.get("location")).toBe(`/saved-events/${target.id}`);
    expect(
      (await api.handle(request(`/saved-events/${target.id}`, { ...headers, method: "PUT" })))
        .status,
    ).toBe(200);
    const removed = await api.handle(
      request(`/saved-events/${target.id}`, { ...headers, method: "DELETE" }),
    );
    expect(removed.status).toBe(204);
    expect(await removed.text()).toBe("");
    expect(
      (await api.handle(request(`/ratings/mine/${target.id}`, { ...headers, method: "POST" })))
        .status,
    ).toBe(422);
    expect((await api.handle(request("/users/me", { ...headers, method: "PUT" }))).status).toBe(
      422,
    );
    await withDatabase(env, async (db) =>
      expect(
        await db.select().from(savedEvents).where(eq(savedEvents.eventId, target.id)),
      ).toHaveLength(0),
    );
  });

  it("saves idempotently with correct status/location and removes idempotently", async () => {
    const existing = await member();
    const target = await event();
    const api = app(serviceMocks().factory);
    const created = await api.handle(
      request(`/saved-events/${target.id}`, { method: "PUT", uid: existing.identity.uid }),
    );
    expect(created.status).toBe(201);
    expect(created.headers.get("location")).toBe(`/saved-events/${target.id}`);
    const first = await created.json<MemberTestJson>();
    const again = await api.handle(
      request(`/saved-events/${target.id}`, { method: "PUT", uid: existing.identity.uid }),
    );
    expect(again.status).toBe(200);
    expect(await again.json<MemberTestJson>()).toEqual(first);
    const list = await api.handle(
      request("/saved-events?limit=20&skip=0", { uid: existing.identity.uid }),
    );
    const value = await list.json<MemberTestJson>();
    expect(value.total).toBe(1);
    expect(value.saved_events[0]).toMatchObject({
      event: {
        id: target.id,
        event_picture_url: `https://media.example.com/event-pictures/${target.id}.webp`,
      },
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      const removed = await api.handle(
        request(`/saved-events/${target.id}`, { method: "DELETE", uid: existing.identity.uid }),
      );
      expect(removed.status).toBe(204);
      expect(await removed.text()).toBe("");
    }
  });

  it("hides archived saved events and ratings and scopes private lists to the member", async () => {
    const existing = await member();
    const other = await member();
    const target = await event({ isArchived: true });
    await withDatabase(env, async (db) => {
      await db.insert(savedEvents).values({ userId: existing.row.id, eventId: target.id });
      await db
        .insert(eventRatings)
        .values({ userId: existing.row.id, eventId: target.id, stars: 5 });
    });
    const api = app(serviceMocks().factory);
    const saved = await api.handle(request("/saved-events", { uid: existing.identity.uid }));
    expect(await saved.json<MemberTestJson>()).toEqual({ saved_events: [], total: 0 });
    const ratings = await api.handle(request("/ratings", { uid: existing.identity.uid }));
    expect(await ratings.json<MemberTestJson>()).toEqual({ ratings: [], total: 0 });
    expect(
      (
        await api.handle(
          request(`/saved-events/${target.id}`, { method: "PUT", uid: other.identity.uid }),
        )
      ).status,
    ).toBe(404);
    expect((await api.handle(request(`/ratings/${target.id}`))).status).toBe(404);
  });

  it("prevents rating unfinished events and preserves missing-event errors", async () => {
    const existing = await member();
    const target = await event({ eventEndDate: new Date(fixedNow.getTime() + 3600_000) });
    const api = app(serviceMocks().factory);
    const future = await api.handle(
      request(`/ratings/mine/${target.id}`, {
        method: "POST",
        uid: existing.identity.uid,
        body: { stars: 5 },
      }),
    );
    expect(future.status).toBe(400);
    expect(await future.json<MemberTestJson>()).toEqual({
      detail: "Event can not be rated at this time",
    });
    const missing = await api.handle(request("/ratings/nonexist"));
    expect(missing.status).toBe(404);
    expect(await missing.json<MemberTestJson>()).toEqual({
      detail: "Event with give id NOT found",
    });
  });

  it("atomically upserts ratings and exposes public reviews without authentication", async () => {
    const existing = await member();
    const target = await event();
    const api = app(serviceMocks().factory);
    const created = await api.handle(
      request(`/ratings/mine/${target.id}`, {
        method: "POST",
        uid: existing.identity.uid,
        body: { stars: 5, strong_vibes: ["social"], note: "Nice event" },
      }),
    );
    expect(created.status).toBe(200);
    const first = await created.json<MemberTestJson>();
    expect(first).toMatchObject({
      user_id: existing.row.id,
      user_name: "Fixture Member",
      event_id: target.id,
      stars: 5,
      strong_vibes: ["social"],
      note: "Nice event",
    });
    const updated = await api.handle(
      request(`/ratings/mine/${target.id}`, {
        method: "POST",
        uid: existing.identity.uid,
        body: { stars: 3 },
      }),
    );
    expect(await updated.json<MemberTestJson>()).toMatchObject({
      id: first.id,
      stars: 3,
      strong_vibes: [],
      note: null,
      created_at: first.created_at,
    });
    const mine = await api.handle(
      request(`/ratings/mine/${target.id}`, { uid: existing.identity.uid }),
    );
    expect((await mine.json<MemberTestJson>()).stars).toBe(3);
    const publicReviews = await api.handle(request(`/ratings/${target.id}`));
    expect(publicReviews.status).toBe(200);
    expect(await publicReviews.json<MemberTestJson>()).toHaveLength(1);
    const privateList = await api.handle(request("/ratings", { uid: existing.identity.uid }));
    expect((await privateList.json<MemberTestJson>()).total).toBe(1);
    const other = await member();
    expect(
      (await api.handle(request(`/ratings/mine/${target.id}`, { uid: other.identity.uid }))).status,
    ).toBe(404);
    expect(
      (
        await (
          await api.handle(request("/ratings", { uid: other.identity.uid }))
        ).json<MemberTestJson>()
      ).total,
    ).toBe(0);
  });

  it("keeps concurrent saves and ratings unique and isolates a different member", async () => {
    const existing = await member();
    const other = await member();
    const target = await event();
    const api = app(serviceMocks().factory);
    const saves = await Promise.all(
      Array.from({ length: 2 }, () =>
        api.handle(
          request(`/saved-events/${target.id}`, { method: "PUT", uid: existing.identity.uid }),
        ),
      ),
    );
    expect(saves.map((response) => response.status).sort()).toEqual([200, 201]);
    const ratings = await Promise.all(
      [3, 5].map((stars) =>
        api.handle(
          request(`/ratings/mine/${target.id}`, {
            method: "POST",
            uid: existing.identity.uid,
            body: { stars },
          }),
        ),
      ),
    );
    expect(ratings.every((response) => response.status === 200)).toBe(true);
    await withDatabase(env, async (db) => {
      expect(
        await db.select().from(savedEvents).where(eq(savedEvents.eventId, target.id)),
      ).toHaveLength(1);
      expect(
        await db.select().from(eventRatings).where(eq(eventRatings.eventId, target.id)),
      ).toHaveLength(1);
    });
    const otherSaved = await api.handle(request("/saved-events", { uid: other.identity.uid }));
    expect(await otherSaved.json()).toEqual({ saved_events: [], total: 0 });
    const unsave = await api.handle(
      request(`/saved-events/${target.id}`, { method: "DELETE", uid: other.identity.uid }),
    );
    expect(unsave.status).toBe(204);
    const ownSaved = await api.handle(request("/saved-events", { uid: existing.identity.uid }));
    expect((await ownSaved.json<MemberTestJson>()).total).toBe(1);
  });

  it("rejects invalid stars and out-of-range pagination", async () => {
    const existing = await member();
    const target = await event();
    const api = app(serviceMocks().factory);
    for (const stars of [0, 6, 2.5]) {
      expect(
        (
          await api.handle(
            request(`/ratings/mine/${target.id}`, {
              method: "POST",
              uid: existing.identity.uid,
              body: { stars },
            }),
          )
        ).status,
      ).toBe(422);
    }
    expect(
      (await api.handle(request("/saved-events?skip=-1", { uid: existing.identity.uid }))).status,
    ).toBe(422);
    expect(
      (await api.handle(request("/ratings?limit=101", { uid: existing.identity.uid }))).status,
    ).toBe(422);
    expect(
      (await api.handle(request("/saved-events?limit=0", { uid: existing.identity.uid }))).status,
    ).toBe(200);
  });
});
