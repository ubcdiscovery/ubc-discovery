import { beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { recover } from "../src/index";
import { useNodeTimingSafeEqual, first, second, environment, json, httpMock } from "./fixtures";

beforeAll(useNodeTimingSafeEqual);

describe("recovery", () => {
  it("dispatches the backend's bounded eligible IDs", async () => {
    const env = environment(),
      http = httpMock();
    http
      .mockResolvedValueOnce(
        json({
          candidates: [
            { candidate_id: first, generation: 1 },
            { candidate_id: second, generation: 1 },
          ],
        }),
      )
      .mockResolvedValueOnce(json({ dispatched: true }));
    await recover(env, http);
    expect(String(http.mock.calls[0][0])).toContain("/recovery?limit=10");
    expect(env.EXTRACTION_QUEUE.sendBatch).toHaveBeenCalledWith([
      { body: { candidate_id: first, generation: 1 } },
      { body: { candidate_id: second, generation: 1 } },
    ]);
    expect(String(http.mock.calls[1][0])).toContain("/dispatched");
  });

  it("does not mark failed Queue sends as accepted", async () => {
    const env = environment(),
      http = httpMock();
    http.mockResolvedValueOnce(json({ candidates: [{ candidate_id: first, generation: 1 }] }));
    vi.mocked(env.EXTRACTION_QUEUE.sendBatch).mockRejectedValueOnce(new Error("queue unavailable"));
    await expect(recover(env, http)).rejects.toThrow("queue unavailable");
    expect(http).toHaveBeenCalledOnce();
  });
});
