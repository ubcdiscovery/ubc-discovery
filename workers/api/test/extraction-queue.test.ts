import { describe, expect, it, vi } from "vite-plus/test";
import type { ApiEnv } from "../src/env";
import { ApiError } from "../src/http/errors";
import { enqueueCandidates } from "../src/services/extraction-queue";

const delivery = { candidate_id: "cand0001", generation: 1 };

describe("extraction Queue producer", () => {
  it("sends each delivery as one message body", async () => {
    const sendBatch = vi.fn(async () => {});
    await enqueueCandidates({ EXTRACTION_QUEUE: { sendBatch } } as unknown as ApiEnv, [delivery]);
    expect(sendBatch).toHaveBeenCalledExactlyOnceWith([{ body: delivery }]);
  });
  it("fails with 503 when the binding is missing or the send fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = { sendBatch: vi.fn(async () => Promise.reject(new Error("down"))) };
    for (const env of [{}, { EXTRACTION_QUEUE: failing }])
      await expect(enqueueCandidates(env as unknown as ApiEnv, [delivery])).rejects.toEqual(
        new ApiError(503, "Extraction queue unavailable; retry the request"),
      );
  });
  it("sends nothing for an empty list", async () => {
    await expect(enqueueCandidates({} as ApiEnv, [])).resolves.toBeUndefined();
  });
});
