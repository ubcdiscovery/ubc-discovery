import { beforeAll, describe, expect, it, vi } from "vitest";
import { decodeJwt, exportPKCS8, generateKeyPair, jwtVerify, SignJWT, type JWTPayload } from "jose";
import type { ApiEnv } from "../src/env";
import { createFirebase } from "../src/services/firebase";

const project = "offline-project";
const fixedDate = new Date("2026-10-12T00:00:00Z");
const seconds = fixedDate.getTime() / 1000;
const env = { FIREBASE_PROJECT_ID: project } as ApiEnv;
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let accountEnv: ApiEnv;

beforeAll(async () => {
  keys = await generateKeyPair("RS256", { extractable: true });
  accountEnv = {
    FIREBASE_PROJECT_ID: project,
    FIREBASE_CREDENTIALS_JSON: JSON.stringify({
      project_id: project,
      client_email: "offline@offline-project.iam.gserviceaccount.com",
      private_key: await exportPKCS8(keys.privateKey),
      private_key_id: "service-key",
    }),
  } as ApiEnv;
});

async function idToken(overrides: JWTPayload = {}, omit: string[] = []) {
  const payload: JWTPayload = {
    iss: `https://securetoken.google.com/${project}`,
    aud: project,
    sub: "member-uid",
    iat: seconds - 30,
    exp: seconds + 3600,
    auth_time: seconds - 60,
    email: "student@example.com",
    name: "Student",
    email_verified: true,
    ...overrides,
  };
  for (const field of omit) delete payload[field];
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .sign(keys.privateKey);
}

function verifier() {
  return createFirebase(env, {
    now: () => fixedDate,
    idTokenKeyResolver: async () => keys.publicKey,
  });
}

describe("Firebase ID token trust boundary", () => {
  it("accepts a signed Firebase ID token and preserves identity fields", async () => {
    expect(await verifier().verifyIdToken(await idToken())).toEqual({
      uid: "member-uid",
      email: "student@example.com",
      name: "Student",
      email_verified: true,
    });
  });

  it.each([
    ["issuer", { iss: "https://securetoken.google.com/another-project" }],
    ["audience", { aud: "another-project" }],
    ["audience array", { aud: [project] }],
    ["empty subject", { sub: "" }],
    ["overlong subject", { sub: "x".repeat(129) }],
    ["future issued time", { iat: seconds + 30 }],
    ["future authentication time", { auth_time: seconds + 30 }],
    ["malformed authentication time", { auth_time: "yesterday" }],
  ])("rejects invalid %s", async (_name, claims) => {
    await expect(verifier().verifyIdToken(await idToken(claims))).rejects.toMatchObject({
      status: 401,
      detail: "Invalid or expired token",
    });
  });

  it.each(["exp", "iat", "auth_time", "sub", "iss", "aud"])("rejects missing %s", async (claim) => {
    await expect(verifier().verifyIdToken(await idToken({}, [claim]))).rejects.toMatchObject({
      status: 401,
    });
  });

  it("returns the established expiry error", async () => {
    await expect(
      verifier().verifyIdToken(await idToken({ exp: seconds - 1 })),
    ).rejects.toMatchObject({
      status: 401,
      detail: "Token expired",
    });
  });

  it("rejects a tampered signature", async () => {
    const otherKeys = await generateKeyPair("RS256");
    const token = await new SignJWT(decodeJwt(await idToken()))
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .sign(otherKeys.privateKey);
    await expect(verifier().verifyIdToken(token)).rejects.toMatchObject({ status: 401 });
  });

  it("rejects HS256 algorithm confusion", async () => {
    const token = await new SignJWT(decodeJwt(await idToken()))
      .setProtectedHeader({ alg: "HS256", kid: "test-key" })
      .sign(new Uint8Array(32));
    await expect(verifier().verifyIdToken(token)).rejects.toMatchObject({ status: 401 });
  });

  it("does not coerce an unverified or malformed verification flag", async () => {
    expect(
      (await verifier().verifyIdToken(await idToken({ email_verified: false }))).email_verified,
    ).toBe(false);
    expect(
      (await verifier().verifyIdToken(await idToken({ email_verified: "true" }))).email_verified,
    ).toBe(false);
  });

  it("rejects missing kid even with an injected key resolver", async () => {
    const token = await new SignJWT(decodeJwt(await idToken()))
      .setProtectedHeader({ alg: "RS256" })
      .sign(keys.privateKey);
    await expect(verifier().verifyIdToken(token)).rejects.toMatchObject({ status: 401 });
  });

  it("fails closed on production certificate fetch failures without exposing provider data", async () => {
    const service = createFirebase(env, {
      now: () => fixedDate,
      fetch: vi.fn(async () => new Response("private error", { status: 503 })),
    });
    await expect(service.verifyIdToken(await idToken())).rejects.toMatchObject({
      status: 401,
      detail: "Token verification failed",
    });
  });

  it("requires explicit project configuration", async () => {
    await expect(createFirebase({} as ApiEnv).verifyIdToken("invalid")).rejects.toMatchObject({
      status: 503,
    });
  });
});

describe("Firebase custom tokens and administrator HTTP adapter", () => {
  it("signs custom tokens with the service-account identity and documented audience", async () => {
    const token = await createFirebase(accountEnv, { now: () => fixedDate }).createCustomToken(
      "member-uid",
    );
    const { payload, protectedHeader } = await jwtVerify(token, keys.publicKey, {
      algorithms: ["RS256"],
      currentDate: fixedDate,
      audience:
        "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit",
      issuer: "offline@offline-project.iam.gserviceaccount.com",
    });
    expect(protectedHeader.alg).toBe("RS256");
    expect(payload).toMatchObject({
      uid: "member-uid",
      sub: "offline@offline-project.iam.gserviceaccount.com",
      iat: seconds,
      exp: seconds + 3600,
    });
    await expect(verifier().verifyIdToken(token)).rejects.toMatchObject({ status: 401 });
  });

  it("uses OAuth and marks an existing email user verified", async () => {
    const calls: Array<{ url: string; body: unknown; headers: Headers }> = [];
    const mockFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      if (url === "https://oauth2.googleapis.com/token") {
        const form = new URLSearchParams(String(init?.body));
        expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
        const { payload } = await jwtVerify(form.get("assertion")!, keys.publicKey, {
          audience: url,
          issuer: "offline@offline-project.iam.gserviceaccount.com",
          currentDate: fixedDate,
        });
        expect(payload.scope).toBe("https://www.googleapis.com/auth/identitytoolkit");
        return Response.json({ access_token: "offline-access-token", expires_in: 3600 });
      }
      calls.push({ url, body: JSON.parse(String(init?.body)), headers });
      return Response.json(
        url.endsWith(":lookup")
          ? { users: [{ localId: "existing-uid" }] }
          : { localId: "existing-uid" },
      );
    });
    const service = createFirebase(accountEnv, { now: () => fixedDate, fetch: mockFetch });
    expect(await service.getOrCreateUser("  Student@Example.COM ")).toBe("existing-uid");
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(calls.map((call) => ({ url: call.url, body: call.body }))).toEqual([
      {
        url: `https://identitytoolkit.googleapis.com/v1/projects/${project}/accounts:lookup`,
        body: { email: ["student@example.com"] },
      },
      {
        url: `https://identitytoolkit.googleapis.com/v1/projects/${project}/accounts:update`,
        body: { localId: "existing-uid", emailVerified: true },
      },
    ]);
    expect(
      calls.every((call) => call.headers.get("authorization") === "Bearer offline-access-token"),
    ).toBe(true);
  });

  it("creates only when lookup succeeds with no matching user", async () => {
    const bodies: unknown[] = [];
    const mockFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/token")) return Response.json({ access_token: "offline-token" });
      if (url.endsWith(":lookup")) return Response.json({});
      expect(url).toBe(`https://identitytoolkit.googleapis.com/v1/projects/${project}/accounts`);
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json({ localId: "new-uid" });
    });
    expect(
      await createFirebase(accountEnv, { now: () => fixedDate, fetch: mockFetch }).getOrCreateUser(
        "new@example.com",
      ),
    ).toBe("new-uid");
    expect(bodies).toEqual([{ email: "new@example.com", emailVerified: true }]);
  });

  it("does not create a user after a lookup authorization failure", async () => {
    const mockFetch = vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith("/token")
        ? Response.json({ access_token: "offline-token" })
        : Response.json({ error: { message: "PRIVATE_PROVIDER_DETAILS" } }, { status: 403 }),
    );
    await expect(
      createFirebase(accountEnv, { now: () => fixedDate, fetch: mockFetch }).getOrCreateUser(
        "new@example.com",
      ),
    ).rejects.toMatchObject({ status: 502, detail: "Firebase authentication service unavailable" });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("falls back to the service-account project ID", async () => {
    const service = createFirebase(
      { ...accountEnv, FIREBASE_PROJECT_ID: undefined },
      {
        now: () => fixedDate,
        idTokenKeyResolver: async () => keys.publicKey,
      },
    );
    expect((await service.verifyIdToken(await idToken())).uid).toBe("member-uid");
  });
});
