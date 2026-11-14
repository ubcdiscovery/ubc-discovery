import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { withDatabase } from "../src/db";
import { eventHosts, events, eventAuditLogs } from "../src/db/schema";
import { extractionFixture, extraction, json, testUrl } from "./extraction-fixture";
const fixture = extractionFixture();

describe.skipIf(!testUrl)("candidate publication and recovery PostgreSQL parity", () => {
  beforeAll(fixture.setup);
  afterAll(fixture.teardown);
  it("persists and publishes oldest first so same-host/day duplicates remain in human review", async () => {
    await fixture.seedCandidate(
      "batch001",
      {
        createdAt: new Date("2029-12-30Z"),
        captureReadyAt: fixture.services.now(),
      },
      ["batchclub"],
    );
    await fixture.seedCandidate(
      "batch002",
      {
        createdAt: new Date("2029-12-31Z"),
        captureReadyAt: fixture.services.now(),
      },
      ["batchclub", "partnerclub"],
    );
    const response = await fixture.request("/extraction/results", "POST", {
      model: "test-model",
      results: [
        {
          candidate_id: "batch002",
          generation: 1,
          extraction: extraction("batch002"),
        },
        {
          candidate_id: "batch001",
          generation: 1,
          extraction: extraction("batch001"),
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
  it("holds reposts for human review", async () => {
    await fixture.seedCandidate("repost01", { captureReadyAt: fixture.services.now() }, [
      "sharingclub",
    ]);
    const response = await fixture.request("/extraction/results", "POST", {
      model: "test-model",
      results: [
        { candidate_id: "repost01", generation: 1, extraction: extraction("repost01", true) },
      ],
    });
    expect(await json(response)).toEqual({
      results: [{ candidate_id: "repost01", status: "completed" }],
    });
    const candidate = await fixture.candidate("repost01");
    expect(candidate.isRepost).toBe(true);
    expect(candidate.status).toBe("pending");
  });
  it("serializes concurrent same-host publication and never publishes two matching drafts", async () => {
    await fixture.seedCandidate("race0001", { captureReadyAt: fixture.services.now() }, [
      "raceclub",
    ]);
    await fixture.seedCandidate("race0002", { captureReadyAt: fixture.services.now() }, [
      "raceclub",
    ]);
    const responses = await Promise.all(
      ["race0001", "race0002"].map((id) =>
        fixture.request("/extraction/results", "POST", {
          model: "test-model",
          results: [{ candidate_id: id, generation: 1, extraction: extraction(id) }],
        }),
      ),
    );
    expect(responses.every((response) => response.status === 200)).toBe(true);
    const published = await withDatabase(fixture.env, (db) =>
      db
        .select({ id: eventHosts.eventId })
        .from(eventHosts)
        .where(eq(eventHosts.hostHandle, "raceclub")),
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
          extraction: extraction("retry001"),
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
          extraction: { ...extraction("invalid1"), location_name: "   " },
        },
      ],
    });
    expect(await json(response)).toEqual({
      results: [{ candidate_id: "invalid1", status: "completed" }],
    });
    expect((await fixture.candidate("invalid1")).status).toBe("pending");
  });
  it("rolls back a replay whose Queue send fails", async () => {
    await fixture.seedCandidate("replay02", {
      captureReadyAt: fixture.services.now(),
      processingError: "exhausted",
    });
    fixture.queue.sendBatch.mockRejectedValueOnce(new Error("queue unavailable"));
    const failed = await fixture.request("/extraction/replay", "POST", {
      candidate_ids: ["replay02"],
    });
    expect(failed.status).toBe(503);
    expect(await fixture.candidate("replay02")).toMatchObject({
      processingGeneration: 1,
      processingError: "exhausted",
      processingDispatchedAt: null,
    });
  });
  it("sends an explicit replay to the Queue and fences every old-generation operation", async () => {
    await fixture.seedCandidate("replay01", {
      captureReadyAt: fixture.services.now(),
      processingDispatchedAt: new Date(fixture.services.now().getTime() - 26 * 3600_000),
      processingError: "exhausted",
    });
    fixture.queue.sendBatch.mockClear();
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
    expect(fixture.queue.sendBatch).toHaveBeenCalledExactlyOnceWith([
      { body: { candidate_id: "replay01", generation: 2 } },
    ]);
    const evidence = await json(
      await fixture.request("/extraction/evidence", "POST", {
        candidates: [{ candidate_id: "replay01", generation: 1 }],
      }),
    );
    expect(evidence.items).toEqual([expect.objectContaining({ state: "stale" })]);
    const candidate = await fixture.candidate("replay01");
    expect(candidate.processingError).toBeNull();
    expect(candidate.extractedAt).toBeNull();
    expect(candidate.processingDispatchedAt).toEqual(fixture.services.now());
  });
  it("ignores extraction extras without echoing them", async () => {
    const evidence = await json(
      await fixture.request("/extraction/evidence", "POST", {
        extra: "ignored",
        candidates: [{ candidate_id: "missing1", generation: 1, extra: "ignored" }],
      }),
    );
    expect(evidence.items).toEqual([{ candidate_id: "missing1", generation: 1, state: "missing" }]);
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
