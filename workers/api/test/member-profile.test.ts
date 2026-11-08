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
  it("requires a verified session and a completed profile", async () => {
    const api = app(serviceMocks().factory);
    expect((await api.handle(request("/users/me"))).status).toBe(401);
    expect(
      (
        await api.handle(
          request("/users/me", { headers: { authorization: "Bearer forged-id-token" } }),
        )
      ).status,
    ).toBe(401);
    const unverified = await identity(email(), false);
    expect((await api.handle(request("/users/me", { session: unverified.session }))).status).toBe(
      403,
    );
    const newIdentity = await identity();
    expect((await api.handle(request("/users/me", { session: newIdentity.session }))).status).toBe(
      404,
    );
  });

  it("onboards non-UBC members, normalizes profile text, and forbids forged capability fields", async () => {
    const who = await identity();
    const api = app(serviceMocks().factory);
    const forged = await api.handle(
      request("/users/onboarding", {
        method: "POST",
        session: who.session,
        body: { preferred_name: "New", is_admin: true },
      }),
    );
    expect(forged.status).toBe(422);
    const response = await api.handle(
      request("/users/onboarding", {
        method: "POST",
        session: who.session,
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
            session: who.session,
            body: { preferred_name: "Duplicate" },
          }),
        )
      ).status,
    ).toBe(409);
  });

  it("accepts UBC sign-in without making UBC email a membership requirement", async () => {
    const address = `${crypto.randomUUID()}@student.ubc.ca`;
    fixtureEmails.add(address);
    const who = await identity(address);
    const response = await app(serviceMocks().factory).handle(
      request("/users/onboarding", {
        method: "POST",
        session: who.session,
        body: { preferred_name: "UBC Member" },
      }),
    );
    const value = await response.json<MemberTestJson>();
    fixtureUserIds.add(value.id);
    expect(value.ubc_verified).toBe(true);
  });

  it("creates exactly one profile when onboarding requests race", async () => {
    const who = await identity();
    const api = app(serviceMocks().factory);
    const responses = await Promise.all(
      Array.from({ length: 2 }, () =>
        api.handle(
          request("/users/onboarding", {
            method: "POST",
            session: who.session,
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
    const who = await identity();
    expect(
      (
        await app(serviceMocks().factory).handle(
          request("/users/onboarding", { method: "POST", session: who.session, body }),
        )
      ).status,
    ).toBe(422);
  });

  it("updates only supplied fields, clears optional context and keeps database admin capability", async () => {
    const existing = await member({
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
        session: existing.identity.session,
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
            session: existing.identity.session,
            body: { is_admin: false },
          }),
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await api.handle(
          request("/users/me", { method: "PUT", session: existing.identity.session, body: {} }),
        )
      ).status,
    ).toBe(200);
    expect(
      (await api.handle(request("/users/me", { session: existing.identity.session }))).status,
    ).toBe(200);
    const stats = await api.handle(
      request("/users/me/stats", { session: existing.identity.session }),
    );
    expect(await stats.json<MemberTestJson>()).toEqual({ member_since: fixedNow.toISOString() });
  });

  it("preserves the bounded profile-upload response and stores its generated key", async () => {
    const existing = await member({ profilePictureKey: "profile-pictures/old" });
    const mocks = serviceMocks();
    const response = await app(mocks.factory).handle(
      request("/users/me/presigned-upload", { session: existing.identity.session }),
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
        session: existing.identity.session,
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
            session: existing.identity.session,
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
        session: existing.identity.session,
        body: { email: "member@ubc.ca.example.com" },
      }),
    );
    expect(response.status).toBe(400);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });
});
