import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { withDatabase } from "../src/db";
import { events, eventAuditLogs } from "../src/db/schema";
import { extractionFixture, extraction, json, testUrl } from "./extraction-fixture";
const fixture = extractionFixture();

describe.skipIf(!testUrl)("candidate publication and recovery PostgreSQL parity", () => {
  beforeAll(fixture.setup);
  afterAll(fixture.teardown);
  it("persists and publishes oldest first so same-club/day duplicates remain in human review", async () => {
    await fixture.seedCandidate("batch001", {
      createdAt: new Date("2029-12-30Z"),
      captureReadyAt: fixture.services.now(),
    });
    await fixture.seedCandidate("batch002", {
      createdAt: new Date("2029-12-31Z"),
      captureReadyAt: fixture.services.now(),
    });
    const response = await fixture.request("/extraction/results", "POST", {
      model: "test-model",
      results: [
        {
          candidate_id: "batch002",
          generation: 1,
          extraction: extraction("batch002", " Batch Club "),
        },
        {
          candidate_id: "batch001",
          generation: 1,
          extraction: extraction("batch001", "batch club"),
        },
      ],
    });
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({
      results: [
        { candidate_id: "batch001", status: "completed" },
        { candidate_id: "batch002", status: "completed" },
      ],
    });
    expect((await fixture.candidate("batch001")).status).toBe("approved");
    expect((await fixture.candidate("batch002")).status).toBe("pending");
    const repeat = await fixture.request("/extraction/results", "POST", {
      model: "other-model",
      results: [{ candidate_id: "batch001", generation: 1, extraction: extraction("batch001") }],
    });
    expect(await json(repeat)).toEqual({
      results: [{ candidate_id: "batch001", status: "completed" }],
    });
    expect((await fixture.candidate("batch001")).extractionModel).toBe("test-model");
  });
  it("serializes concurrent same-club publication and never publishes two matching drafts", async () => {
    await fixture.seedCandidate("race0001", { captureReadyAt: fixture.services.now() });
    await fixture.seedCandidate("race0002", { captureReadyAt: fixture.services.now() });
    const responses = await Promise.all(
      ["race0001", "race0002"].map((id) =>
        fixture.request("/extraction/results", "POST", {
          model: "test-model",
          results: [{ candidate_id: id, generation: 1, extraction: extraction(id, "Race Club") }],
        }),
      ),
    );
    expect(responses.every((response) => response.status === 200)).toBe(true);
    const published = await withDatabase(fixture.env, (db) =>
      db.select().from(events).where(eq(events.clubName, "Race Club")),
    );
    expect(published.length).toBeLessThanOrEqual(1);
    expect((await fixture.candidate("race0001")).processingCompletedAt).not.toBeNull();
    expect((await fixture.candidate("race0002")).processingCompletedAt).not.toBeNull();
  });
  it("rolls back failed publication while retaining extraction for retry without another AI result", async () => {
    await fixture.seedCandidate("retry001", {
      captureReadyAt: fixture.services.now(),
      imageKeys: ["candidates/retry001/00.jpg"],
    });
    vi.mocked(fixture.storage.copyObject).mockRejectedValueOnce(new Error("storage outage"));
    const response = await fixture.request("/extraction/results", "POST", {
      model: "test-model",
      results: [
        {
          candidate_id: "retry001",
          generation: 1,
          extraction: extraction("retry001", "Retry Club"),
        },
      ],
    });
    expect(await json(response)).toEqual({
      results: [{ candidate_id: "retry001", status: "retry" }],
    });
    const candidate = await fixture.candidate("retry001");
    expect(candidate.extractedAt).not.toBeNull();
    expect(candidate.processingCompletedAt).toBeNull();
    expect(candidate.status).toBe("pending");
    await withDatabase(fixture.env, async (db) => {
      expect(await db.select().from(events).where(eq(events.id, "retry001"))).toHaveLength(0);
      expect(
        await db.select().from(eventAuditLogs).where(eq(eventAuditLogs.eventId, "retry001")),
      ).toHaveLength(0);
    });
    const retry = await fixture.request("/extraction/results", "POST", {
      model: "test-model",
      results: [{ candidate_id: "retry001", generation: 1 }],
    });
    expect(await json(retry)).toEqual({
      results: [{ candidate_id: "retry001", status: "completed" }],
    });
    expect((await fixture.candidate("retry001")).status).toBe("approved");
  });
  it("withholds invalid event publication at a savepoint but completes processing", async () => {
    await fixture.seedCandidate("invalid1", { captureReadyAt: fixture.services.now() });
    const response = await fixture.request("/extraction/results", "POST", {
      model: "test-model",
      results: [
        {
          candidate_id: "invalid1",
          generation: 1,
          extraction: { ...extraction("invalid1", "Invalid Club"), location_name: "   " },
        },
      ],
    });
    expect(await json(response)).toEqual({
      results: [{ candidate_id: "invalid1", status: "completed" }],
    });
    expect((await fixture.candidate("invalid1")).status).toBe("pending");
  });
  it("marks overdue delivery terminal after25h and fences every old-generation operation after explicit replay", async () => {
    await fixture.seedCandidate("replay01", {
      captureReadyAt: fixture.services.now(),
      processingDispatchedAt: new Date(fixture.services.now().getTime() - 26 * 3600_000),
    });
    await fixture.request("/extraction/recovery");
    expect((await fixture.candidate("replay01")).processingError).toBe(
      "Queue delivery exceeded completion window; explicit replay required",
    );
    expect(
      await json(
        await fixture.request("/extraction/replay", "POST", { candidate_ids: ["replay01"] }),
      ),
    ).toEqual({ candidates: [{ candidate_id: "replay01", generation: 2 }] });
    expect(
      await json(
        await fixture.request("/extraction/terminal", "POST", {
          candidate_id: "replay01",
          generation: 1,
          error: "late DLQ",
        }),
      ),
    ).toEqual({ candidate_id: "replay01", status: "stale" });
    expect(
      await json(
        await fixture.request("/extraction/results", "POST", {
          model: "test-model",
          results: [
            { candidate_id: "replay01", generation: 1, extraction: extraction("replay01") },
          ],
        }),
      ),
    ).toEqual({ results: [{ candidate_id: "replay01", status: "stale" }] });
    await fixture.request("/extraction/dispatched", "POST", {
      candidates: [{ candidate_id: "replay01", generation: 1 }],
    });
    const evidence = await json(
      await fixture.request("/extraction/evidence", "POST", {
        candidates: [{ candidate_id: "replay01", generation: 1 }],
      }),
    );
    expect(evidence.items).toEqual([expect.objectContaining({ state: "stale" })]);
    const candidate = await fixture.candidate("replay01");
    expect(candidate.processingError).toBeNull();
    expect(candidate.extractedAt).toBeNull();
    expect(candidate.processingDispatchedAt).toBeNull();
  });
  it("ignores extraction extras without echoing them and accepts unknown recovery query parameters", async () => {
    const evidence = await json(
      await fixture.request("/extraction/evidence", "POST", {
        extra: "ignored",
        candidates: [{ candidate_id: "missing1", generation: 1, extra: "ignored" }],
      }),
    );
    expect(evidence.items).toEqual([{ candidate_id: "missing1", generation: 1, state: "missing" }]);
    const dispatched = await json(
      await fixture.request("/extraction/dispatched", "POST", {
        candidates: [{ candidate_id: "missing1", generation: 1, extra: "ignored" }],
        extra: "ignored",
      }),
    );
    expect(dispatched).toEqual({ candidates: [{ candidate_id: "missing1", generation: 1 }] });
    expect((await fixture.request("/extraction/recovery?extra=ignored")).status).toBe(200);
    await fixture.seedCandidate("extras01");
    const result = await fixture.request("/extraction/results", "POST", {
      model: "test-model",
      extra: "ignored",
      results: [
        {
          candidate_id: "extras01",
          generation: 1,
          extra: "ignored",
          extraction: { candidate_id: "extras01", is_event: false, extra: "ignored" },
        },
      ],
    });
    expect(result.status).toBe(200);
    expect((await fixture.candidate("extras01")).extractedOriginal).not.toHaveProperty("extra");
  });
});
