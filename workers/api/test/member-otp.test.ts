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
  email,
  serviceMocks,
  app,
  request,
  member,
  otp,
  cleanupMemberFixtures,
} from "./member-fixture";

afterEach(cleanupMemberFixtures);

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
