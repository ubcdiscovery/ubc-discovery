import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { withDatabase } from "../src/db";
import { apiCredentials, events } from "../src/db/schema";
import { extractionFixture, json, testUrl } from "./extraction-fixture";
const fixture = extractionFixture();

describe.skipIf(!testUrl)("administrator credential lifecycle against PostgreSQL", () => {
  beforeAll(fixture.setup);
  afterAll(fixture.teardown);
  it("accepts browser JSON headers with empty admin POST/DELETE bodies and keeps schema/auth validation", async () => {
    await withDatabase(fixture.env, (db) =>
      db.insert(events).values({
        id: "bodyfree",
        title: "Empty-body header fixture",
        source: "manual",
        locationName: "Nest",
        eventDate: new Date("2030-05-01T20:00:00Z"),
      }),
    );
    const upload = await fixture.request(
      "/admin/events/bodyfree/presigned-upload",
      "POST",
      undefined,
      "admin",
      true,
    );
    expect(upload.status).toBe(200);
    expect(await json(upload)).toMatchObject({ file_key: "event-pictures/bodyfree.webp" });
    for (const action of ["archive", "restore"]) {
      expect(
        (
          await fixture.request(
            `/admin/events/bodyfree/${action}`,
            "POST",
            undefined,
            "admin",
            true,
          )
        ).status,
      ).toBe(200);
    }
    expect(
      (await fixture.request("/admin/events/bodyfree", "DELETE", undefined, "admin", true)).status,
    ).toBe(204);
    expect((await fixture.request("/admin/events", "POST", undefined, "admin", true)).status).toBe(
      422,
    );
    expect(
      (await fixture.request("/admin/events/bodyfree/restore", "POST", undefined, "member", true))
        .status,
    ).toBe(403);
  });

  it("creates bounded credentials, reveals the token once, and audits idempotent revocation", async () => {
    const response = await fixture.request(
      "/admin/api-keys",
      "POST",
      {
        label: " Shared Worker ",
        scopes: ["candidates:extract", "candidates:extract"],
        expires_at: "2031-01-01T00:00:00Z",
      },
      "admin",
    );
    expect(response.status).toBe(201);
    const created = await json(response);
    expect(created).toMatchObject({
      label: "Shared Worker",
      scopes: ["candidates:extract"],
      status: "active",
    });
    expect(created.raw_token).toMatch(/^ubc_live_[a-f0-9-]{36}\.[A-Za-z0-9_-]{43}$/);
    expect(created).not.toHaveProperty("secret_hash");
    const listed = await json(await fixture.request("/admin/api-keys", "GET", undefined, "admin"));
    expect(JSON.stringify(listed)).not.toContain(created.raw_token as string);
    expect(JSON.stringify(listed)).not.toContain("secret_hash");
    for (let count = 0; count < 2; count++)
      expect(
        (await fixture.request(`/admin/api-keys/${created.id}/revoke`, "POST", undefined, "admin"))
          .status,
      ).toBe(200);
    const audit = await json(
      await fixture.request(`/admin/api-keys/${created.id}/audit`, "GET", undefined, "admin"),
    );
    expect(audit.entries).toHaveLength(2);
    expect(audit.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "create",
          details: { label: "Shared Worker", scopes: ["candidates:extract"] },
        }),
        expect.objectContaining({ action: "revoke" }),
      ]),
    );
    // Revoked state must be stored independently of the client-visible response.
    expect(
      await withDatabase(
        fixture.env,
        async (db) =>
          (
            await db
              .select()
              .from(apiCredentials)
              .where(eq(apiCredentials.id, created.id as string))
          )[0]!.revokedAt,
      ),
    ).not.toBeNull();
  });
  it("rejects invalid credential UUIDs, non-admin readers and timezone-free expirations", async () => {
    expect(
      (await fixture.request("/admin/api-keys/not-a-uuid/revoke", "POST", undefined, "admin"))
        .status,
    ).toBe(422);
    expect((await fixture.request("/admin/api-keys", "GET", undefined, "ingest")).status).toBe(403);
    expect(
      (
        await fixture.request(
          "/admin/api-keys",
          "POST",
          { label: "expiry", expires_at: "2031-01-01T00:00:00" },
          "admin",
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await fixture.request(
          "/admin/api-keys",
          "POST",
          { label: "expiry", expires_at: "2020-01-01T00:00:00Z" },
          "admin",
        )
      ).status,
    ).toBe(422);
  });
});
