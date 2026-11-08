import { describe, expect, it } from "vite-plus/test";
import type { Auth } from "../src/auth";
import type { Db } from "../src/db";
import { hashSecret, parseApiToken, requireSignedIn, verifySecret } from "../src/http/auth";

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
  it("never treats a request without a session, or a cross-site one, as a member", async () => {
    const db = {} as Db;
    const auth = (session: unknown) => ({
      auth: () => ({ api: { getSession: async () => session } }) as unknown as Auth,
    });
    await expect(
      requireSignedIn(
        db,
        new Request("http://localhost/", { headers: { authorization: "Api-Key abc" } }),
        auth(null),
      ),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      requireSignedIn(
        db,
        new Request("http://localhost/", { headers: { "sec-fetch-site": "cross-site" } }),
        auth({ user: { id: "fixture" } }),
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      requireSignedIn(
        db,
        new Request("http://localhost/", { headers: { "sec-fetch-site": "same-site" } }),
        auth({ user: { id: "fixture" } }),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
});
