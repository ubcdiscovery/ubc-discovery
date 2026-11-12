import { describe, expect, it, vi } from "vite-plus/test";
import type { DbTransaction } from "../src/db";
import type { ApiEnv } from "../src/env";
import { ApiError } from "../src/http/errors";
import { dispatchCandidates } from "../src/services/extraction-queue";

const delivery = { candidate_id: "cand0001", generation: 1 };
const now = new Date("2030-01-01T12:00:00Z");

function transaction() {
  const set = vi.fn(() => ({ where: vi.fn(async () => {}) }));
  return { tx: { update: vi.fn(() => ({ set })) } as unknown as DbTransaction, set };
}

describe("extraction Queue dispatch", () => {
  it("records the dispatch time and sends each delivery as one message body", async () => {
    const { tx, set } = transaction();
    const sendBatch = vi.fn(async () => {});
    await dispatchCandidates(tx, { EXTRACTION_QUEUE: { sendBatch } } as unknown as ApiEnv, now, [
      delivery,
    ]);
    expect(set).toHaveBeenCalledExactlyOnceWith({ processingDispatchedAt: now });
    expect(sendBatch).toHaveBeenCalledExactlyOnceWith([{ body: delivery }]);
  });
  it("fails with 503 when the binding is missing or the send fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = { sendBatch: vi.fn(async () => Promise.reject(new Error("down"))) };
    for (const env of [{}, { EXTRACTION_QUEUE: failing }])
      await expect(
        dispatchCandidates(transaction().tx, env as unknown as ApiEnv, now, [delivery]),
      ).rejects.toEqual(new ApiError(503, "Extraction queue unavailable; retry the request"));
  });
  it("records and sends nothing for an empty list", async () => {
    const { tx } = transaction();
    await dispatchCandidates(tx, {} as ApiEnv, now, []);
    expect(tx.update).not.toHaveBeenCalled();
  });
});
