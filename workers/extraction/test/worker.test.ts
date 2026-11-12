import { describe, expect, it } from "vite-plus/test";
import worker, { consume } from "../src/index";
import {
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
  aiRun,
  httpMock,
} from "./fixtures";

interface ModelInput {
  messages: { content: { type: string; text?: string; image_url?: { url: string } }[] }[];
  chat_template_kwargs: { enable_thinking: boolean };
}
const input = (call: unknown[]) => call[1] as ModelInput;
const parts = (call: unknown[], type: string) =>
  input(call).messages[1].content.filter((part) => part.type === type);

describe("HTTP", () => {
  it("serves only the health check", async () => {
    expect(await (await worker.fetch(new Request("https://worker/health"))).json()).toEqual({
      status: "ok",
    });
    for (const request of [
      new Request("https://worker/enqueue", { method: "POST" }),
      new Request("https://worker/health", { method: "POST" }),
    ])
      expect(worker.fetch(request).status).toBe(404);
  });
});

describe("queue consumption", () => {
  it("packs candidates in one Workers AI call and acknowledges only saved results", async () => {
    const a = message(first),
      b = message(second),
      env = environment(),
      http = httpMock();
    aiRun(env).mockResolvedValueOnce(ai([extraction(first), extraction(second)]));
    http.mockResolvedValueOnce(json(evidence([item(first), item(second)]))).mockResolvedValueOnce(
      json({
        results: [
          { candidate_id: first, status: "completed" },
          { candidate_id: second, status: "retry" },
        ],
      }),
    );
    await consume(batch([a, b]), env, http);
    expect(http).toHaveBeenCalledTimes(2);
    expect(aiRun(env)).toHaveBeenCalledOnce();
    const call = aiRun(env).mock.calls[0];
    expect(call[0]).toBe("@cf/test/model");
    expect(parts(call, "text")).toHaveLength(2);
    expect(input(call).chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(JSON.parse(http.mock.calls[1][1]!.body as string).model).toBe("@cf/test/model");
    expect(a.ack).toHaveBeenCalledOnce();
    expect(b.retry).toHaveBeenCalledWith({ delaySeconds: 60 });
  });

  it("downloads each candidate image and sends it inline", async () => {
    const a = message(first),
      env = environment(),
      http = httpMock();
    const image = { ...item(first), images: [{ url: "https://media.example/signed-image" }] };
    aiRun(env).mockResolvedValueOnce(ai([extraction(first)]));
    http
      .mockResolvedValueOnce(json(evidence([image])))
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "image/png" } }),
      )
      .mockResolvedValueOnce(json({ results: [{ candidate_id: first, status: "completed" }] }));
    await consume(batch([a]), env, http);
    expect(String(http.mock.calls[1][0])).toBe("https://media.example/signed-image");
    expect(parts(aiRun(env).mock.calls[0], "image_url")[0].image_url!.url).toBe(
      "data:image/png;base64,AQID",
    );
    expect(a.ack).toHaveBeenCalledOnce();
  });

  it("uses the persisted extraction on retry and deduplicates deliveries", async () => {
    const a = message(first),
      duplicate = message(first),
      env = environment(),
      http = httpMock();
    http
      .mockResolvedValueOnce(json(evidence([item(first, "extracted")])))
      .mockResolvedValueOnce(json({ results: [{ candidate_id: first, status: "completed" }] }));
    await consume(batch([a, duplicate]), env, http);
    expect(http).toHaveBeenCalledTimes(2);
    expect(aiRun(env)).not.toHaveBeenCalled();
    expect(JSON.parse(http.mock.calls[1][1]!.body as string).results).toEqual([
      { candidate_id: first, generation: 1, extraction: null },
    ]);
    expect(a.ack).toHaveBeenCalledOnce();
    expect(duplicate.ack).toHaveBeenCalledOnce();
  });

  it("does no AI work for completed, terminal, missing, or waiting captures", async () => {
    const complete = message(first),
      waiting = message(second),
      env = environment(),
      http = httpMock();
    http.mockResolvedValueOnce(json(evidence([item(first, "completed"), item(second, "waiting")])));
    await consume(batch([complete, waiting]), env, http);
    expect(http).toHaveBeenCalledOnce();
    expect(aiRun(env)).not.toHaveBeenCalled();
    expect(complete.ack).toHaveBeenCalledOnce();
    expect(waiting.retry).toHaveBeenCalledWith({ delaySeconds: 15 });
  });

  it("falls back to single calls after a malformed packed result", async () => {
    const a = message(first),
      b = message(second),
      env = environment(),
      http = httpMock();
    aiRun(env)
      .mockResolvedValueOnce(ai([extraction(first)]))
      .mockResolvedValueOnce(ai([extraction(first)]))
      .mockResolvedValueOnce(ai([extraction(second)]));
    http.mockResolvedValueOnce(json(evidence([item(first), item(second)]))).mockResolvedValueOnce(
      json({
        results: [
          { candidate_id: first, status: "completed" },
          { candidate_id: second, status: "completed" },
        ],
      }),
    );
    await consume(batch([a, b]), env, http);
    expect(aiRun(env)).toHaveBeenCalledTimes(3);
    expect(a.ack).toHaveBeenCalledOnce();
    expect(b.ack).toHaveBeenCalledOnce();
  });

  it.each([
    "AiError: 3040: Capacity temporarily exceeded",
    "AiError: 4006: you have used up your daily free allocation of 10,000 neurons",
    "network connection lost",
  ])("backs off the whole batch when Workers AI fails: %s", async (failure) => {
    const a = message(first),
      b = message(second),
      env = environment(),
      http = httpMock();
    aiRun(env).mockRejectedValueOnce(new Error(failure));
    http.mockResolvedValueOnce(json(evidence([item(first), item(second)])));
    await consume(batch([a, b]), env, http);
    expect(aiRun(env)).toHaveBeenCalledOnce();
    expect(a.retry).toHaveBeenCalledOnce();
    expect(b.retry).toHaveBeenCalledOnce();
  });

  it("backs off the whole batch when Workers AI times out", async () => {
    const a = message(first),
      env = { ...environment(), EXTRACTION_TIMEOUT_MS: "5" },
      http = httpMock();
    aiRun(env).mockReturnValueOnce(new Promise(() => {}));
    http.mockResolvedValueOnce(json(evidence([item(first)])));
    await consume(batch([a]), env, http);
    expect(aiRun(env)).toHaveBeenCalledOnce();
    expect(a.retry).toHaveBeenCalledOnce();
  });

  it("isolates a candidate whose image cannot be downloaded so healthy candidates persist", async () => {
    const a = message(first),
      b = message(second),
      env = environment(),
      http = httpMock();
    const broken = { ...item(second), images: [{ url: "https://media.example/missing" }] };
    aiRun(env).mockResolvedValueOnce(ai([extraction(first)]));
    http
      .mockResolvedValueOnce(json(evidence([item(first), broken])))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(json({ results: [{ candidate_id: first, status: "completed" }] }));
    await consume(batch([a, b]), env, http);
    expect(aiRun(env)).toHaveBeenCalledOnce();
    expect(JSON.parse(http.mock.calls[3][1]!.body as string).results).toEqual([
      { candidate_id: first, generation: 1, extraction: extraction(first) },
    ]);
    expect(a.ack).toHaveBeenCalledOnce();
    expect(b.retry).toHaveBeenCalledOnce();
  });

  it("acks an old generation while processing a replay of the same candidate", async () => {
    const old = message(first),
      replay = message(first, 1, 2),
      env = environment(),
      http = httpMock();
    aiRun(env).mockResolvedValueOnce(ai([extraction(first)]));
    http
      .mockResolvedValueOnce(json(evidence([item(first, "stale"), item(first, "ready", 2)])))
      .mockResolvedValueOnce(json({ results: [{ candidate_id: first, status: "completed" }] }));
    await consume(batch([old, replay]), env, http);
    expect(JSON.parse(http.mock.calls[0][1]!.body as string).candidates).toEqual([
      { candidate_id: first, generation: 1 },
      { candidate_id: first, generation: 2 },
    ]);
    expect(JSON.parse(http.mock.calls[1][1]!.body as string).results[0].generation).toBe(2);
    expect(old.ack).toHaveBeenCalledOnce();
    expect(replay.ack).toHaveBeenCalledOnce();
    expect(old.retry).not.toHaveBeenCalled();
  });

  it("isolates malformed fields so valid candidates can persist", async () => {
    const a = message(first),
      b = message(second),
      env = environment(),
      http = httpMock();
    const invalid = { ...extraction(second), event_date: "2026-02-30T19:00:00-07:00" };
    aiRun(env)
      .mockResolvedValueOnce(ai([extraction(first), invalid]))
      .mockResolvedValueOnce(ai([extraction(first)]))
      .mockResolvedValueOnce(ai([invalid]));
    http
      .mockResolvedValueOnce(json(evidence([item(first), item(second)])))
      .mockResolvedValueOnce(json({ results: [{ candidate_id: first, status: "completed" }] }));
    await consume(batch([a, b]), env, http);
    const saved = JSON.parse(http.mock.calls[1][1]!.body as string);
    expect(saved.results.map((value: { candidate_id: string }) => value.candidate_id)).toEqual([
      first,
    ]);
    expect(a.ack).toHaveBeenCalledOnce();
    expect(b.retry).toHaveBeenCalledOnce();
  });

  it("retries a lost save response, then resumes without extracting twice", async () => {
    const a = message(first),
      env = environment(),
      http = httpMock();
    aiRun(env).mockResolvedValueOnce(ai([extraction(first)]));
    http
      .mockResolvedValueOnce(json(evidence([item(first)])))
      .mockRejectedValueOnce(new Error("response lost"));
    await consume(batch([a]), env, http);
    expect(a.retry).toHaveBeenCalledOnce();
    const retry = message(first, 2);
    http
      .mockResolvedValueOnce(json(evidence([item(first, "extracted")])))
      .mockResolvedValueOnce(json({ results: [{ candidate_id: first, status: "completed" }] }));
    await consume(batch([retry]), env, http);
    expect(aiRun(env)).toHaveBeenCalledOnce();
    expect(retry.ack).toHaveBeenCalledOnce();
  });
});
