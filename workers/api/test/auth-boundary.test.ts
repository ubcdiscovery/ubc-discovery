import { describe, expect, it } from "vitest";
import { hashSecret, parseApiToken, requireIdentity, verifySecret } from "../src/http/auth";
import type { FirebaseService } from "../src/services/firebase";

describe("existing authentication boundaries", () => {
  it("matches existing SHA256 credential digests", async () => {
    const hash = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
    expect(await hashSecret("abc")).toBe(hash);
    expect(await verifySecret("abc", hash)).toBe(true);
    expect(await verifySecret("wrong", hash)).toBe(false);
    expect(await verifySecret("abc", "bad")).toBe(false);
  });
  it("parses existing tokens without accepting ambiguous separators or whitespace", () => {
    const id = "00000000-0000-0000-0000-000000000001";
    expect(parseApiToken(`ubc_live_${id}.secret`)).toEqual({ credentialId: id, secret: "secret" });
    for (const token of [
      `ubc_live_${id}.`,
      `ubc_live_${id}.two.parts`,
      `ubc_live_${id}. secret`,
      "ubc_live_bad.secret",
    ])
      expect(parseApiToken(token)).toBeNull();
  });
  it("never allows an API key or unverified identity to act as a member", async () => {
    const firebase: FirebaseService = {
      verifyIdToken: async () => ({
        uid: "fixture",
        email: "fixture@example.test",
        name: "Fixture",
        email_verified: false,
      }),
      getOrCreateUser: async () => "fixture",
      createCustomToken: async () => "fixture",
    };
    await expect(requireIdentity(new Request("http://localhost/"), firebase)).rejects.toMatchObject(
      { status: 401 },
    );
    await expect(
      requireIdentity(
        new Request("http://localhost/", { headers: { authorization: "Api-Key abc" } }),
        firebase,
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      requireIdentity(
        new Request("http://localhost/", { headers: { authorization: "Bearer fixture" } }),
        firebase,
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
});
