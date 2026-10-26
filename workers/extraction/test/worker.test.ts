import { beforeAll, describe, expect, it } from "vite-plus/test";
import worker, { consume } from "../src/index";
import {
  useNodeTimingSafeEqual,
  first,
  second,
  environment,
  item,
  evidence,
  extraction,
  message,
  batch,
  json,
  ai,
  httpMock,
} from "./fixtures";

beforeAll(useNodeTimingSafeEqual);

describe("producer", () => {
  it("requires producer authentication and validates bounded candidate IDs", async () => {
    const env = environment();
    const unauthorized = await worker.fetch(
      new Request("https://worker/enqueue", { method: "POST" }),
      env,
    );
    expect(unauthorized.status).toBe(401);
    const invalid = await worker.fetch(
      new Request("https://worker/enqueue", {
        method: "POST",
        headers: { Authorization: "Bearer local-secret" },
        body: JSON.stringify({ candidates: [{ candidate_id: "invalid", generation: 1 }] }),
      }),
      env,
    );
    expect(invalid.status).toBe(400);
    expect(env.EXTRACTION_QUEUE.sendBatch).not.toHaveBeenCalled();
  });

  it("enqueues IDs only and deduplicates the producer request", async () => {
    const env = environment();
    const response = await worker.fetch(
      new Request("https://worker/enqueue", {
        method: "POST",
        headers: { Authorization: "Bearer local-secret" },
        body: JSON.stringify({
          candidates: [
            { candidate_id: first, generation: 1 },
            { candidate_id: first, generation: 1 },
            { candidate_id: second, generation: 1 },
          ],
        }),
      }),
      env,
    );
    expect(response.status).toBe(202);
    expect(env.EXTRACTION_QUEUE.sendBatch).toHaveBeenCalledWith([
      { body: { candidate_id: first, generation: 1 } },
      { body: { candidate_id: second, generation: 1 } },
    ]);
  });
});

describe("queue consumption", () => {
  it("packs candidates in one AI request and acknowledges only saved results", async () => {
    const a = message(first),
      b = message(second),
      http = httpMock();
    http
      .mockResolvedValueOnce(json(evidence([item(first), item(second)])))
      .mockResolvedValueOnce(ai([extraction(first), extraction(second)]))
      .mockResolvedValueOnce(
        json({
          results: [
            { candidate_id: first, status: "completed" },
            { candidate_id: second, status: "retry" },
          ],
        }),
      );
    await consume(batch([a, b]), environment(), http);
    expect(http).toHaveBeenCalledTimes(3);
    const openai = JSON.parse(http.mock.calls[1][1]!.body as string);
    expect(
      openai.messages[1].content.filter((part: { type: string }) => part.type === "text"),
    ).toHaveLength(2);
    expect(
      openai.messages[1].content.filter((part: { type: string }) => part.type === "image_url")[0]
        .image_url.url,
    ).toBe("https://s3.example/signed-image");
    expect(a.ack).toHaveBeenCalledOnce();
    expect(b.retry).toHaveBeenCalledWith({ delaySeconds: 60 });
  });

  it("uses the persisted extraction on retry and deduplicates deliveries", async () => {
    const a = message(first),
      duplicate = message(first),
      http = httpMock();
    http
      .mockResolvedValueOnce(json(evidence([item(first, "extracted")])))
      .mockResolvedValueOnce(json({ results: [{ candidate_id: first, status: "completed" }] }));
    await consume(batch([a, duplicate]), environment(), http);
    expect(http).toHaveBeenCalledTimes(2);
    expect(JSON.parse(http.mock.calls[1][1]!.body as string).results).toEqual([
      { candidate_id: first, generation: 1, extraction: null },
    ]);
    expect(a.ack).toHaveBeenCalledOnce();
    expect(duplicate.ack).toHaveBeenCalledOnce();
  });

  it("does no AI work for completed, terminal, missing, or waiting captures", async () => {
    const complete = message(first),
      waiting = message(second),
      http = httpMock();
    http.mockResolvedValueOnce(json(evidence([item(first, "completed"), item(second, "waiting")])));
    await consume(batch([complete, waiting]), environment(), http);
    expect(http).toHaveBeenCalledOnce();
    expect(complete.ack).toHaveBeenCalledOnce();
    expect(waiting.retry).toHaveBeenCalledWith({ delaySeconds: 15 });
  });

  it("falls back to single calls after a malformed packed result", async () => {
    const a = message(first),
      b = message(second),
      http = httpMock();
    http
      .mockResolvedValueOnce(json(evidence([item(first), item(second)])))
      .mockResolvedValueOnce(ai([extraction(first)]))
      .mockResolvedValueOnce(ai([extraction(first)]))
      .mockResolvedValueOnce(ai([extraction(second)]))
      .mockResolvedValueOnce(
        json({
          results: [
            { candidate_id: first, status: "completed" },
            { candidate_id: second, status: "completed" },
          ],
        }),
      );
    await consume(batch([a, b]), environment(), http);
    expect(http).toHaveBeenCalledTimes(5);
    expect(a.ack).toHaveBeenCalledOnce();
    expect(b.ack).toHaveBeenCalledOnce();
  });

  it.each([401, 403, 429, 500, 503])(
    "backs off the batch for shared HTTP %s failures",
    async (status) => {
      const a = message(first),
        b = message(second),
        http = httpMock();
      http
        .mockResolvedValueOnce(json(evidence([item(first), item(second)])))
        .mockResolvedValueOnce(json({}, status));
      await consume(batch([a, b]), environment(), http);
      expect(http).toHaveBeenCalledTimes(2);
      expect(a.retry).toHaveBeenCalledOnce();
      expect(b.retry).toHaveBeenCalledOnce();
    },
  );

  it("isolates a candidate-specific HTTP 400 so healthy candidates persist", async () => {
    const a = message(first),
      b = message(second),
      http = httpMock();
    http
      .mockResolvedValueOnce(json(evidence([item(first), item(second)])))
      .mockResolvedValueOnce(json({ error: { code: "invalid_image" } }, 400))
      .mockResolvedValueOnce(ai([extraction(first)]))
      .mockResolvedValueOnce(json({ error: { code: "invalid_image" } }, 400))
      .mockResolvedValueOnce(json({ results: [{ candidate_id: first, status: "completed" }] }));
    await consume(batch([a, b]), environment(), http);
    expect(http).toHaveBeenCalledTimes(5);
    expect(JSON.parse(http.mock.calls[4][1]!.body as string).results).toEqual([
      { candidate_id: first, generation: 1, extraction: extraction(first) },
    ]);
    expect(a.ack).toHaveBeenCalledOnce();
    expect(a.retry).not.toHaveBeenCalled();
    expect(b.retry).toHaveBeenCalledOnce();
  });

  it("acks an old generation while processing a replay of the same candidate", async () => {
    const old = message(first),
      replay = message(first, 1, 2),
      http = httpMock();
    http
      .mockResolvedValueOnce(json(evidence([item(first, "stale"), item(first, "ready", 2)])))
      .mockResolvedValueOnce(ai([extraction(first)]))
      .mockResolvedValueOnce(json({ results: [{ candidate_id: first, status: "completed" }] }));
    await consume(batch([old, replay]), environment(), http);
    expect(JSON.parse(http.mock.calls[0][1]!.body as string).candidates).toEqual([
      { candidate_id: first, generation: 1 },
      { candidate_id: first, generation: 2 },
    ]);
    expect(JSON.parse(http.mock.calls[2][1]!.body as string).results[0].generation).toBe(2);
    expect(old.ack).toHaveBeenCalledOnce();
    expect(replay.ack).toHaveBeenCalledOnce();
    expect(old.retry).not.toHaveBeenCalled();
  });

  it("isolates malformed fields so valid candidates can persist", async () => {
    const a = message(first),
      b = message(second),
      http = httpMock();
    const invalid = { ...extraction(second), event_date: "2026-02-30T19:00:00-07:00" };
    http
      .mockResolvedValueOnce(json(evidence([item(first), item(second)])))
      .mockResolvedValueOnce(ai([extraction(first), invalid]))
      .mockResolvedValueOnce(ai([extraction(first)]))
      .mockResolvedValueOnce(ai([invalid]))
      .mockResolvedValueOnce(json({ results: [{ candidate_id: first, status: "completed" }] }));
    await consume(batch([a, b]), environment(), http);
    const saved = JSON.parse(http.mock.calls[4][1]!.body as string);
    expect(saved.results.map((value: { candidate_id: string }) => value.candidate_id)).toEqual([
      first,
    ]);
    expect(a.ack).toHaveBeenCalledOnce();
    expect(b.retry).toHaveBeenCalledOnce();
  });

  it("retries a lost save response, then resumes without paying for extraction twice", async () => {
    const a = message(first),
      http = httpMock();
    http
      .mockResolvedValueOnce(json(evidence([item(first)])))
      .mockResolvedValueOnce(ai([extraction(first)]))
      .mockRejectedValueOnce(new Error("response lost"));
    await consume(batch([a]), environment(), http);
    expect(a.retry).toHaveBeenCalledOnce();
    const retry = message(first, 2);
    http
      .mockResolvedValueOnce(json(evidence([item(first, "extracted")])))
      .mockResolvedValueOnce(json({ results: [{ candidate_id: first, status: "completed" }] }));
    await consume(batch([retry]), environment(), http);
    expect(http.mock.calls.filter(([url]) => String(url).includes("api.openai.com"))).toHaveLength(
      1,
    );
    expect(retry.ack).toHaveBeenCalledOnce();
  });

  it("marks exhausted processing terminal before allowing Cloudflare to dead-letter", async () => {
    const a = message(first, 5),
      http = httpMock();
    http.mockResolvedValueOnce(json({}, 503)).mockResolvedValueOnce(json({ status: "terminal" }));
    await consume(batch([a]), environment(), http);
    expect(String(http.mock.calls[1][0])).toContain("/terminal");
    expect(a.retry).toHaveBeenCalledOnce();
    expect(a.ack).not.toHaveBeenCalled();
  });

  it("durably records dead-letter failure without invoking AI", async () => {
    const a = message(first),
      http = httpMock();
    http.mockResolvedValueOnce(json({ status: "terminal" }));
    await consume(batch([a], "ubc-discovery-extraction-dlq"), environment(), http);
    expect(http).toHaveBeenCalledOnce();
    expect(String(http.mock.calls[0][0])).toContain("/terminal");
    expect(JSON.parse(http.mock.calls[0][1]!.body as string).generation).toBe(1);
    expect(a.ack).toHaveBeenCalledOnce();
  });

  it("leaves the DLQ message pending if terminal reporting fails", async () => {
    const a = message(first),
      http = httpMock();
    http.mockRejectedValueOnce(new Error("API unavailable"));
    await consume(batch([a], "ubc-discovery-extraction-dlq"), environment(), http);
    expect(a.ack).not.toHaveBeenCalled();
    expect(a.retry).toHaveBeenCalledWith({ delaySeconds: 600 });
  });
});
