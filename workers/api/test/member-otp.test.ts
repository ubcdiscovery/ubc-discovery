import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { withDatabase } from "../src/db";
import { otpCodes } from "../src/db/schema";
import { isUbcEmail } from "../src/schemas/member";
import {
  MemberTestJson,
  testUrl,
  env,
  fixedNow,
  fixtureEmails,
  serviceMocks,
  app,
  request,
  member,
  otp,
  cleanupMemberFixtures,
} from "./member-fixture";

afterEach(cleanupMemberFixtures);

function ubcEmail() {
  const value = `${crypto.randomUUID()}@student.ubc.ca`;
  fixtureEmails.add(value);
  return value;
}

describe("UBC trust-badge domain boundary", () => {
  it("accepts only ubc.ca and its real subdomains", () => {
    for (const address of ["member@ubc.ca", "member@STUDENT.UBC.CA", "member@a.b.ubc.ca"])
      expect(isUbcEmail(address)).toBe(true);
    for (const address of ["member@example.com", "member@evilubc.ca", "member@ubc.ca.example.com"])
      expect(isUbcEmail(address)).toBe(false);
  });
});

describe.skipIf(!testUrl)("UBC confirmation codes against PostgreSQL", () => {
  const send = (session: string, address: string) =>
    request("/auth/ubc-verify/send", { method: "POST", session, body: { email: address } });
  const confirm = (session: string, address: string, code: string) =>
    request("/auth/ubc-verify/confirm", {
      method: "POST",
      session,
      body: { email: address, code },
    });

  it("rejects malformed email addresses before delivery", async () => {
    const existing = await member();
    const mocks = serviceMocks();
    const api = app(mocks);
    expect((await api.handle(send(existing.session, "not-an-email"))).status).toBe(422);
    expect((await api.handle(confirm(existing.session, "not-an-email", "123456"))).status).toBe(
      422,
    );
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("normalizes input, generates bounded secure codes, invalidates old codes and sends only after commit", async () => {
    const existing = await member();
    const address = ubcEmail();
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
    const response = await app(mocks).handle(send(existing.session, ` ${address.toUpperCase()} `));
    expect(response.status).toBe(200);
    expect(await response.json<MemberTestJson>()).toEqual({
      message: "Verification code sent to your UBC email.",
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
    const existing = await member();
    const address = ubcEmail();
    const configuration = { ...env, OTP_RATE_LIMIT_PER_15MIN: "1" };
    const mocks = serviceMocks(configuration);
    mocks.sendEmail.mockRejectedValue(new Error("private provider failure"));
    const api = app(mocks);
    const failed = await api.handle(send(existing.session, address));
    expect(failed.status).toBe(500);
    expect(await failed.json<MemberTestJson>()).toEqual({
      detail: { code: "OTP_DELIVERY_FAILED", message: "Failed to send verification email." },
    });
    const limited = await api.handle(send(existing.session, address));
    expect(limited.status).toBe(429);
    expect((await limited.json<MemberTestJson>()).detail.code).toBe("OTP_RATE_LIMITED");
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("serializes concurrent first-email sends so no rate-limit bypass or extra active codes remain", async () => {
    const existing = await member();
    const address = ubcEmail();
    const mocks = serviceMocks();
    const api = app(mocks);
    const responses = await Promise.all(
      Array.from({ length: 4 }, () => api.handle(send(existing.session, address))),
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
    const existing = await member();
    const address = ubcEmail();
    const code = await otp(address);
    const configuration = { ...env, OTP_MAX_ATTEMPTS: "2" };
    const api = app(serviceMocks(configuration));
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await api.handle(confirm(existing.session, address, "999999"));
      expect(response.status).toBe(400);
      expect((await response.json<MemberTestJson>()).detail.code).toBe("OTP_INVALID");
    }
    const terminal = await api.handle(confirm(existing.session, address, "123456"));
    expect((await terminal.json<MemberTestJson>()).detail.code).toBe("OTP_TOO_MANY_ATTEMPTS");
    await withDatabase(env, async (db) =>
      expect((await db.select().from(otpCodes).where(eq(otpCodes.id, code.id)))[0]).toMatchObject({
        attempts: 2,
        used: true,
      }),
    );
  });

  it("does not lose concurrent incorrect attempts", async () => {
    const existing = await member();
    const address = ubcEmail();
    const code = await otp(address);
    const api = app(serviceMocks());
    const results = await Promise.all(
      Array.from({ length: 4 }, () => api.handle(confirm(existing.session, address, "999999"))),
    );
    expect(results.map((value) => value.status)).toEqual([400, 400, 400, 400]);
    await withDatabase(env, async (db) =>
      expect((await db.select().from(otpCodes).where(eq(otpCodes.id, code.id)))[0]!.attempts).toBe(
        4,
      ),
    );
  });

  it("permits exactly one concurrent consumption of a valid code", async () => {
    const existing = await member();
    const address = ubcEmail();
    await otp(address);
    const api = app(serviceMocks());
    const results = await Promise.all(
      Array.from({ length: 2 }, () => api.handle(confirm(existing.session, address, "123456"))),
    );
    expect(results.map((value) => value.status).sort()).toEqual([200, 400]);
    const rejected = results.find((value) => value.status === 400)!;
    expect((await rejected.json<MemberTestJson>()).detail.code).toBe("OTP_EXPIRED");
  });

  it("rejects an expired code", async () => {
    const existing = await member();
    const address = ubcEmail();
    await otp(address, { expiresAt: fixedNow });
    const response = await app(serviceMocks()).handle(confirm(existing.session, address, "123456"));
    expect(response.status).toBe(400);
    expect((await response.json<MemberTestJson>()).detail.code).toBe("OTP_EXPIRED");
  });
});
