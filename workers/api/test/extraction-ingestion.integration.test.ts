import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { withDatabase } from "../src/db";
import { eventListingCandidateIngestionAudits, candidateExtractionJobs } from "../src/db/schema";
import { localDayBounds, vancouverDay } from "../src/services/candidate-publication";
import { extractionFixture, extraction, json, testUrl } from "./extraction-fixture";
const fixture = extractionFixture();

describe("Vancouver publication calendar", () => {
  it("uses Vancouver dates and computes both daylight-saving boundaries", () => {
    expect(vancouverDay(new Date("2030-01-02T02:00:00Z"))).toBe("2030-01-01");
    const [springStart, springEnd] = localDayBounds(new Date("2026-03-08T20:00:00Z"));
    expect(springStart.toISOString()).toBe("2026-03-08T08:00:00.000Z");
    expect(springEnd.toISOString()).toBe("2026-03-09T07:00:00.000Z");
    const [fallStart, fallEnd] = localDayBounds(new Date("2025-11-02T20:00:00Z"));
    expect(fallEnd.getTime() - fallStart.getTime()).toBe(25 * 3600_000);
    const [permanentStart, permanentEnd] = localDayBounds(new Date("2026-11-01T20:00:00Z"));
    expect(permanentEnd.getTime() - permanentStart.getTime()).toBe(24 * 3600_000);
  });
});

describe.skipIf(!testUrl)("queue extraction and ingestion PostgreSQL parity", () => {
  beforeAll(fixture.setup);
  afterAll(fixture.teardown);
  it("restricts ingestion and extraction to their own scopes and denies member tokens", async () => {
    expect((await fixture.request("/extraction/recovery", "GET", undefined, "ingest")).status).toBe(
      403,
    );
    expect((await fixture.request("/extraction/recovery", "GET", undefined, "member")).status).toBe(
      403,
    );
    expect((await fixture.request("/extraction/recovery", "GET", undefined, "none")).status).toBe(
      401,
    );
    expect((await fixture.request("/admin/candidates", "GET", undefined, "member")).status).toBe(
      403,
    );
  });
  it("deduplicates concurrent source ingestion, preserves receipts, and never creates PG extraction jobs", async () => {
    const body = {
      source_type: " instagram ",
      external_source_id: " duplicate-source ",
      source_account: " club ",
      description: " caption ",
      image_content_types: ["image/jpeg"],
    };
    const responses = await Promise.all(
      Array.from({ length: 4 }, () =>
        fixture.request("/ingestion/event-candidates", "POST", body, "ingest"),
      ),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([200, 200, 200, 201]);
    const bodies = await Promise.all(responses.map(json));
    const ids = bodies.map((body) => (body.candidate as { id: string }).id);
    expect(new Set(ids).size).toBe(1);
    await withDatabase(fixture.env, async (db) => {
      const audits = await db.select().from(eventListingCandidateIngestionAudits);
      expect(audits.length).toBe(4);
      expect(audits.filter((item) => item.outcome === "created")).toHaveLength(1);
      expect(await db.select().from(candidateExtractionJobs)).toHaveLength(0);
    });
    const conflict = await fixture.request(
      "/ingestion/event-candidates",
      "POST",
      { ...body, image_content_types: ["image/png"] },
      "ingest",
    );
    expect(conflict.status).toBe(409);
    expect(await json(conflict)).toEqual({
      detail: "Candidate image content types conflict with existing capture",
    });
  });
  it("returns explicit capture waiting until images exist or the capture times out", async () => {
    await fixture.seedCandidate("wait0001", {
      createdAt: fixture.services.now(),
      imageKeys: ["candidates/wait0001/00.jpg"],
    });
    vi.mocked(fixture.storage.objectExists).mockResolvedValueOnce(false);
    expect(
      (
        await fixture.request(
          "/ingestion/event-candidates/wait0001/capture-ready",
          "POST",
          undefined,
          "ingest",
        )
      ).status,
    ).toBe(409);
    const evidence = await json(
      await fixture.request("/extraction/evidence", "POST", {
        candidates: [{ candidate_id: "wait0001", generation: 1 }],
      }),
    );
    expect(evidence.items).toEqual([expect.objectContaining({ state: "waiting", generation: 1 })]);
    const ready = await json(
      await fixture.request(
        "/ingestion/event-candidates/wait0001/capture-ready",
        "POST",
        undefined,
        "ingest",
      ),
    );
    expect(ready).toEqual({ candidate_id: "wait0001", status: "ready", dispatched: false });
  });
  it("rejects duplicate generations, mismatched extraction IDs, and naive timestamps before changing rows", async () => {
    expect(
      (
        await fixture.request("/extraction/evidence", "POST", {
          candidates: [
            { candidate_id: "wait0001", generation: 1 },
            { candidate_id: "wait0001", generation: 1 },
          ],
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await fixture.request("/extraction/results", "POST", {
          model: "test-model",
          results: [
            { candidate_id: "wait0001", generation: 1, extraction: extraction("otherid1") },
          ],
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await fixture.request("/extraction/results", "POST", {
          model: "test-model",
          results: [
            {
              candidate_id: "wait0001",
              generation: 1,
              extraction: { ...extraction("wait0001"), event_date: "2030-02-01T20:00:00" },
            },
          ],
        })
      ).status,
    ).toBe(422);
    expect((await fixture.candidate("wait0001")).extractedAt).toBeNull();
  });
});
