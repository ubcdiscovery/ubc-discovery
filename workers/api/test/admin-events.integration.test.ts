import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { withDatabase } from "../src/db";
import { events, eventAuditLogs } from "../src/db/schema";
import { extractionFixture, json, testUrl } from "./extraction-fixture";
const fixture = extractionFixture();

describe.skipIf(!testUrl)("administrator event and candidate lifecycle against PostgreSQL", () => {
  beforeAll(fixture.setup);
  afterAll(fixture.teardown);
  it("creates canonical events with embeddings and audits; failed re-embedding retains the original vector", async () => {
    const response = await fixture.request(
      "/admin/events",
      "POST",
      {
        title: "Manual Event",
        location_name: " Nest ",
        event_date: "2030-05-01T20:00:00Z",
        vibes: ["career"],
      },
      "admin",
    );
    expect(response.status).toBe(200);
    const event = await json(response);
    expect(event).toMatchObject({
      title: "Manual Event",
      location_name: "Nest",
      source: "manual",
      source_label: "campus_community",
      is_archived: false,
    });
    expect(event.id).toMatch(/^[A-Za-z0-9_-]{8}$/);
    vi.mocked(fixture.services.embedEvent).mockResolvedValueOnce(null);
    const update = await fixture.request(
      `/admin/events/${event.id}`,
      "PUT",
      { title: "Revised Title", source_url: null },
      "admin",
    );
    expect(update.status).toBe(200);
    const saved = await withDatabase(
      fixture.env,
      async (db) =>
        (
          await db
            .select()
            .from(events)
            .where(eq(events.id, event.id as string))
        )[0]!,
    );
    expect(saved.embeddingVector).toEqual([1, ...Array<number>(1023).fill(0)]);
    const audit = await json(
      await fixture.request(`/admin/events/${event.id}/audit`, "GET", undefined, "admin"),
    );
    expect(audit.entries).toHaveLength(2);
    expect(audit.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "create", before: null }),
        expect.objectContaining({
          action: "update",
          before: expect.objectContaining({ title: "Manual Event" }),
          after: expect.objectContaining({ title: "Revised Title" }),
        }),
      ]),
    );
    const upload = await json(
      await fixture.request(
        `/admin/events/${event.id}/presigned-upload`,
        "POST",
        undefined,
        "admin",
      ),
    );
    expect(upload).toMatchObject({
      file_key: `event-pictures/${event.id}.webp`,
      max_file_size_bytes: 3 * 1024 * 1024,
    });
    for (let count = 0; count < 2; count++)
      expect(
        (await fixture.request(`/admin/events/${event.id}/archive`, "POST", undefined, "admin"))
          .status,
      ).toBe(200);
    expect(
      (await fixture.request(`/admin/events/${event.id}/restore`, "POST", undefined, "admin"))
        .status,
    ).toBe(200);
    expect(
      (await fixture.request(`/admin/events/${event.id}`, "DELETE", undefined, "admin")).status,
    ).toBe(204);
    const actions = await withDatabase(fixture.env, async (db) =>
      (
        await db
          .select()
          .from(eventAuditLogs)
          .where(eq(eventAuditLogs.eventId, event.id as string))
      ).map((row) => row.action),
    );
    expect(actions.sort()).toEqual(
      ["create", "update", "image_upload", "archive", "restore", "archive"].sort(),
    );
  });
  it("validates merged event date updates without mutating event or audit state", async () => {
    await withDatabase(fixture.env, (db) =>
      db
        .insert(events)
        .values({
          id: "dates001",
          title: "Date fixture",
          source: "manual",
          locationName: "Nest",
          eventDate: new Date("2030-01-02Z"),
          eventEndDate: new Date("2030-01-03Z"),
        })
        .returning(),
    );
    expect(
      (
        await fixture.request(
          "/admin/events/dates001",
          "PUT",
          { event_date: "2030-01-04T00:00:00Z" },
          "admin",
        )
      ).status,
    ).toBe(422);
    expect(
      (await fixture.request("/admin/events/dates001", "PUT", { location_name: "  " }, "admin"))
        .status,
    ).toBe(422);
    const audits = await withDatabase(fixture.env, (db) =>
      db.select().from(eventAuditLogs).where(eq(eventAuditLogs.eventId, "dates001")),
    );
    expect(audits).toHaveLength(0);
  });
  it("corrects pending candidates and approves idempotently with image copy and authoritative audit", async () => {
    await fixture.seedCandidate("review01", { imageKeys: ["candidates/review01/00.jpg"] });
    const correction = await fixture.request(
      "/admin/candidates/review01",
      "PUT",
      {
        is_event: true,
        title: " Review Event ",
        location_name: " Nest ",
        source_label: "ams_club",
        club_name: " Club ",
        event_date: "2030-03-01T20:00:00Z",
        vibes: ["arts"],
      },
      "admin",
    );
    expect(correction.status).toBe(200);
    expect(await json(correction)).toMatchObject({
      title: "Review Event",
      location_name: "Nest",
      club_name: "Club",
      image_urls: ["https://private.test/candidates/review01/00.jpg?signed=1"],
    });
    const responses = await Promise.all(
      Array.from({ length: 2 }, () =>
        fixture.request("/admin/candidates/review01/approve", "POST", undefined, "admin"),
      ),
    );
    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect((await fixture.candidate("review01")).status).toBe("approved");
    const rows = await withDatabase(fixture.env, (db) =>
      db.select().from(eventAuditLogs).where(eq(eventAuditLogs.eventId, "review01")),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actorType).toBe("member");
    expect(
      (await fixture.request("/admin/candidates/review01", "PUT", { title: "late edit" }, "admin"))
        .status,
    ).toBe(409);
  });
  it("preserves rejection/return-to-review semantics and forbids ingestion properties in corrections", async () => {
    await fixture.seedCandidate("reject01");
    expect(
      (
        await fixture.request(
          "/admin/candidates/reject01",
          "PUT",
          { source_type: "spoof" },
          "admin",
        )
      ).status,
    ).toBe(422);
    expect(
      (await fixture.request("/admin/candidates/reject01/reject", "POST", undefined, "admin"))
        .status,
    ).toBe(200);
    expect(
      (await fixture.request("/admin/candidates/reject01/reject", "POST", undefined, "admin"))
        .status,
    ).toBe(409);
    expect(
      (
        await fixture.request(
          "/admin/candidates/reject01/return-to-review",
          "POST",
          undefined,
          "admin",
        )
      ).status,
    ).toBe(200);
    expect(
      (await fixture.request("/admin/candidates/reject01/approve", "POST", undefined, "admin"))
        .status,
    ).toBe(422);
    expect((await fixture.candidate("reject01")).status).toBe("pending");
  });
  it("ignores extra API-key/event fields and query parameters while preserving UTC naive datetime parsing", async () => {
    expect(
      (
        await fixture.request(
          "/admin/api-keys",
          "POST",
          { label: "Unknown accepted", extra: "ignored" },
          "admin",
        )
      ).status,
    ).toBe(201);
    const created = await fixture.request(
      "/admin/events",
      "POST",
      {
        title: "Datetime parity",
        location_name: "Nest",
        event_date: "2030-02-01 12:30",
        extra: "ignored",
      },
      "admin",
    );
    expect(created.status).toBe(200);
    const event = await json(created);
    expect(event.event_date).toBe("2030-02-01T12:30:00.000Z");
    expect(event).not.toHaveProperty("extra");
    expect(
      (await fixture.request(`/admin/events/${event.id}`, "PUT", { extra: "ignored" }, "admin"))
        .status,
    ).toBe(200);
    expect(
      (await fixture.request("/admin/events?extra=ignored", "GET", undefined, "admin")).status,
    ).toBe(200);
    expect(
      (await fixture.request("/admin/candidates?extra=ignored", "GET", undefined, "admin")).status,
    ).toBe(200);
    for (const value of ["2030-02-30T12:00:00Z", "2030/02/01", "2030-02-01T24:00:00Z"]) {
      expect(
        (
          await fixture.request(
            "/admin/events",
            "POST",
            { title: "Invalid date", location_name: "Nest", event_date: value },
            "admin",
          )
        ).status,
      ).toBe(422);
    }
  });
});
