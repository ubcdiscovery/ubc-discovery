import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createApp } from "../src/app";
import { withDatabase } from "../src/db";
import { users } from "../src/db/schema";
import {
  testUrl,
  env,
  email,
  fixtureEmails,
  serviceMocks,
  app,
  request,
  member,
  cleanupMemberFixtures,
} from "./member-fixture";

afterEach(cleanupMemberFixtures);

const origin = { origin: "http://localhost" };

function sendCode(address: string) {
  return request("/auth/email-otp/send-verification-otp", {
    method: "POST",
    headers: origin,
    body: { email: address, type: "sign-in" },
  });
}

function signIn(address: string, otp: string) {
  return request("/auth/sign-in/email-otp", {
    method: "POST",
    headers: origin,
    body: { email: address, otp },
  });
}

/** The Cookie header a browser would send back after this response. */
function cookiesFrom(response: Response) {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0]!)
    .join("; ");
}

describe.skipIf(!testUrl)("Better Auth email-code sign-in", () => {
  it("signs a new person in without onboarding them, then onboarding completes the same row", async () => {
    const address = email("new");
    const mocks = serviceMocks();
    const api = app(mocks.factory);

    const sent = await api.handle(sendCode(address));
    expect(sent.status).toBe(200);
    expect(await sent.json()).toEqual({ success: true, expires_in_seconds: 600 });
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    const [recipient, code] = mocks.sendEmail.mock.calls[0]!;
    expect(recipient).toBe(address);
    expect(code).toMatch(/^\d{6}$/);

    const signedIn = await api.handle(signIn(address, code));
    expect(signedIn.status).toBe(200);
    const { user } = await signedIn.json<{ user: { id: string; email: string } }>();
    expect(user.email).toBe(address);
    const session = cookiesFrom(signedIn);
    expect(session).toContain("ubcd.session_token=");

    // Signed in but not onboarded: member routes keep their existing 404 contract.
    expect((await api.handle(request("/users/me", { session }))).status).toBe(404);
    const onboarded = await api.handle(
      request("/users/onboarding", {
        method: "POST",
        session,
        body: { preferred_name: "New Member" },
      }),
    );
    expect(onboarded.status).toBe(200);
    expect(await onboarded.json()).toMatchObject({ id: user.id, preferred_name: "New Member" });
    expect((await api.handle(request("/users/me", { session }))).status).toBe(200);
  });

  it("reaches Better Auth with an unread body when Elysia runs without compilation (dev)", async () => {
    const address = email("dev");
    const mocks = serviceMocks();
    const api = createApp({ ...env, CORS_ALLOWED_ORIGINS: "[]" }, mocks.factory, { aot: false });
    const sent = await api.handle(sendCode(address));
    expect(sent.status).toBe(200);
    const signedIn = await api.handle(signIn(address, mocks.sendEmail.mock.calls[0]![1]));
    expect(signedIn.status).toBe(200);
    // Static routes under /auth stay with the API rather than Better Auth's mount.
    expect(
      (
        await api.handle(
          request("/auth/ubc-verify/send", { method: "POST", body: { email: "x@ubc.ca" } }),
        )
      ).status,
    ).toBe(401);
  });

  it("signs an existing member into their existing row", async () => {
    const existing = await member();
    const mocks = serviceMocks();
    const api = app(mocks.factory);
    await api.handle(sendCode(existing.row.email.toUpperCase()));
    const code = mocks.sendEmail.mock.calls[0]![1];
    const signedIn = await api.handle(signIn(existing.row.email, code));
    expect(signedIn.status).toBe(200);
    expect((await signedIn.json<{ user: { id: string } }>()).user.id).toBe(existing.row.id);
    const me = await api.handle(request("/users/me", { session: cookiesFrom(signedIn) }));
    expect(await me.json()).toMatchObject({
      id: existing.row.id,
      preferred_name: "Fixture Member",
    });
  });

  it("never lets sign-in set capability fields", async () => {
    const address = email("forged");
    const mocks = serviceMocks();
    const api = app(mocks.factory);
    await api.handle(sendCode(address));
    const code = mocks.sendEmail.mock.calls[0]![1];
    const forged = await api.handle(
      request("/auth/sign-in/email-otp", {
        method: "POST",
        headers: origin,
        body: { email: address, otp: code, isAdmin: true, onboardingCompleted: true },
      }),
    );
    expect(forged.status).toBe(200);
    const [created] = await withDatabase(env, (db) =>
      db.select().from(users).where(eq(users.email, address)),
    );
    expect(created).toMatchObject({ isAdmin: false, onboardingCompleted: false });
  });

  it("reports failed delivery and limits codes per address", async () => {
    const address = email("limited");
    const configuration = { ...env, OTP_RATE_LIMIT_PER_15MIN: "1" };
    const mocks = serviceMocks(configuration);
    mocks.sendEmail.mockRejectedValue(new Error("private provider failure"));
    const api = app(mocks.factory, configuration);
    const failed = await api.handle(sendCode(address));
    expect(failed.status).toBe(500);
    expect(await failed.json()).toMatchObject({ code: "OTP_DELIVERY_FAILED" });
    const limited = await api.handle(sendCode(address));
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ code: "OTP_RATE_LIMITED" });
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("counts concurrent sends to one address against the same limit", async () => {
    const address = email("concurrent");
    const mocks = serviceMocks();
    const api = app(mocks.factory);
    const responses = await Promise.all(
      Array.from({ length: 4 }, () => api.handle(sendCode(address))),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([200, 200, 200, 429]);
    expect(mocks.sendEmail).toHaveBeenCalledTimes(3);
  });

  it("rejects wrong codes and stops accepting the right one after the allowed attempts", async () => {
    const address = email("attempts");
    const configuration = { ...env, OTP_MAX_ATTEMPTS: "2" };
    const mocks = serviceMocks(configuration);
    const api = app(mocks.factory, configuration);
    await api.handle(sendCode(address));
    const code = mocks.sendEmail.mock.calls[0]![1];
    const wrong = code === "000000" ? "111111" : "000000";
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await api.handle(signIn(address, wrong));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "INVALID_OTP" });
    }
    const locked = await api.handle(signIn(address, code));
    expect(locked.status).toBe(403);
    expect(await locked.json()).toMatchObject({ code: "TOO_MANY_ATTEMPTS" });
  });

  it("accepts a code once", async () => {
    const address = email("once");
    const mocks = serviceMocks();
    const api = app(mocks.factory);
    await api.handle(sendCode(address));
    const code = mocks.sendEmail.mock.calls[0]![1];
    expect((await api.handle(signIn(address, code))).status).toBe(200);
    expect((await api.handle(signIn(address, code))).status).toBe(400);
  });

  it("rejects malformed addresses without sending mail", async () => {
    const malformed = `not-an-email-${crypto.randomUUID()}`;
    fixtureEmails.add(malformed);
    const mocks = serviceMocks();
    const response = await app(mocks.factory).handle(sendCode(malformed));
    expect(response.status).toBe(400);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("ends the session on sign-out", async () => {
    const existing = await member();
    const api = app(serviceMocks().factory);
    const session = existing.identity.session;
    const signedOut = await api.handle(
      request("/auth/sign-out", { method: "POST", session, headers: origin, jsonHeader: true }),
    );
    expect(signedOut.status).toBe(200);
    expect((await api.handle(request("/users/me", { session }))).status).toBe(401);
  });
});

describe.skipIf(!testUrl)("Better Auth Google sign-in", () => {
  it("redirects to Google with the registered callback URL", async () => {
    const response = await app(serviceMocks().factory).handle(
      request("/auth/sign-in/social", {
        method: "POST",
        headers: origin,
        body: { provider: "google", callbackURL: "/" },
      }),
    );
    expect(response.status).toBe(200);
    const { url } = await response.json<{ url: string }>();
    const target = new URL(url);
    expect(target.origin).toBe("https://accounts.google.com");
    expect(target.searchParams.get("redirect_uri")).toBe(
      "http://localhost/api/auth/callback/google",
    );
    expect(target.searchParams.get("prompt")).toBe("select_account");
    expect(target.searchParams.get("scope")?.split(" ")).toEqual(
      expect.arrayContaining(["openid", "email", "profile"]),
    );
  });
});

describe.skipIf(!testUrl)("member session boundary", () => {
  it("requires a session and rejects cross-site requests that carry one", async () => {
    const existing = await member();
    const api = app(serviceMocks().factory);
    expect((await api.handle(request("/users/me"))).status).toBe(401);
    expect(
      (await api.handle(request("/users/me", { headers: { authorization: "Api-Key fixture" } })))
        .status,
    ).toBe(401);
    expect(
      (
        await api.handle(
          request("/users/me", {
            session: existing.identity.session,
            headers: { "sec-fetch-site": "cross-site" },
          }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await api.handle(
          request("/users/me", {
            session: existing.identity.session,
            headers: { "sec-fetch-site": "same-origin" },
          }),
        )
      ).status,
    ).toBe(200);
  });
});
