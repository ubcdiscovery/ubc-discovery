import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { withDatabase } from "../src/db";
import { users } from "../src/db/schema";
import {
  MemberTestJson,
  testUrl,
  env,
  fixedNow,
  fixtureEmails,
  fixtureUserIds,
  email,
  identity,
  serviceMocks,
  app,
  request,
  member,
  otp,
  cleanupMemberFixtures,
} from "./member-fixture";

afterEach(cleanupMemberFixtures);

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
