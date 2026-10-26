import type {
  Env,
  ExtractionMessage,
  Extraction,
  EvidenceItem,
  EvidenceBatch,
  ResultStatus,
  HttpClient,
} from "./types";
import { deliveries, identity, validExtraction } from "./validation";
import { UpstreamError, matchesDispatchSecret, api } from "./http";

export type { Env, ExtractionMessage, Extraction, EvidenceItem, EvidenceBatch } from "./types";

export async function extract(
  env: Env,
  evidence: EvidenceBatch,
  items: EvidenceItem[],
  http: HttpClient = fetch,
): Promise<Extraction[]> {
  const content: Record<string, unknown>[] = [];
  for (const item of items) {
    content.push({
      type: "text",
      text: `candidate_id: ${item.candidate_id}\nsource_account: @${item.source_account}\nsource_type: ${item.source_type}\nreference_timestamp: ${item.reference_timestamp}\ncaption:\n${item.caption}`,
    });
    for (const image of item.images) {
      content.push({
        type: "image_url",
        image_url: { url: image.url, detail: evidence.image_detail },
      });
    }
  }
  const response = await http("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: evidence.model,
      reasoning_effort: evidence.reasoning_effort,
      messages: [
        { role: "system", content: evidence.system_prompt },
        { role: "user", content },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "candidate_extractions", strict: true, schema: evidence.schema },
      },
    }),
    signal: AbortSignal.timeout(Number(env.OPENAI_TIMEOUT_MS) || 60000),
  });
  if (!response.ok) throw new UpstreamError("OpenAI", response.status);
  const body = (await response.json()) as { choices: { message: { content?: string } }[] };
  const parsed = JSON.parse(body.choices[0]?.message.content ?? "{}") as {
    extractions?: Extraction[];
  };
  const results = parsed.extractions;
  if (
    !Array.isArray(results) ||
    results.length !== items.length ||
    results.some((result) => !validExtraction(result, evidence)) ||
    new Set(results.map((result) => result.candidate_id)).size !== items.length ||
    items.some((item) => !results.some((result) => result.candidate_id === item.candidate_id))
  ) {
    throw new Error("extractor returned the wrong candidate set");
  }
  return items.map((item) => results.find((result) => result.candidate_id === item.candidate_id)!);
}

async function failed(
  message: Message<ExtractionMessage>,
  env: Env,
  error: unknown,
  http: HttpClient,
): Promise<void> {
  const detail = error instanceof UpstreamError ? error.message : "Extraction processing failed";
  console.error(
    JSON.stringify({
      candidate_id: message.body.candidate_id,
      attempts: message.attempts,
      error: detail,
    }),
  );
  // Reporting failure is best effort here; the DLQ consumer repeats it durably.
  if (message.attempts >= Number(env.MAX_ATTEMPTS)) {
    try {
      await api(env, "/terminal", { ...message.body, error: detail }, http);
    } catch {
      console.error("Terminal reporting deferred to dead-letter consumer");
    }
  }
  message.retry({ delaySeconds: Math.min(60 * message.attempts, 600) });
}

export async function consume(
  batch: MessageBatch<ExtractionMessage>,
  env: Env,
  http: HttpClient = fetch,
): Promise<void> {
  if (batch.queue.endsWith("-dlq")) {
    for (const message of batch.messages) {
      try {
        await api(env, "/terminal", { ...message.body, error: "Queue retries exhausted" }, http);
        message.ack();
      } catch {
        message.retry({ delaySeconds: 600 });
      }
    }
    return;
  }

  let evidence: EvidenceBatch;
  try {
    evidence = await api(
      env,
      "/evidence",
      {
        candidates: [
          ...new Map(
            batch.messages.map((message) => [identity(message.body), message.body]),
          ).values(),
        ],
      },
      http,
    );
  } catch (error) {
    for (const message of batch.messages) await failed(message, env, error, http);
    return;
  }
  const messages = new Map<string, Message<ExtractionMessage>[]>();
  for (const message of batch.messages) {
    const list = messages.get(identity(message.body)) ?? [];
    list.push(message);
    messages.set(identity(message.body), list);
  }
  const ready: EvidenceItem[] = [];
  const results: (ExtractionMessage & { extraction: Extraction | null })[] = [];
  const seen = new Set<string>();
  for (const item of evidence.items) {
    seen.add(identity(item));
    const delivery = messages.get(identity(item)) ?? [];
    if (["completed", "terminal", "missing", "stale"].includes(item.state)) {
      for (const message of delivery) message.ack();
    } else if (item.state === "waiting") {
      for (const message of delivery) message.retry({ delaySeconds: 15 });
    } else if (item.state === "extracted") {
      results.push({
        candidate_id: item.candidate_id,
        generation: item.generation,
        extraction: null,
      });
    } else {
      ready.push(item);
    }
  }
  for (const [id, delivery] of messages) {
    if (!seen.has(id))
      for (const message of delivery)
        await failed(message, env, new Error("Missing evidence"), http);
  }
  // Match the current packed-call fallback: only failed items are redelivered.
  if (ready.length) {
    try {
      for (const result of await extract(env, evidence, ready, http)) {
        const item = ready.find((item) => item.candidate_id === result.candidate_id)!;
        results.push({
          candidate_id: result.candidate_id,
          generation: item.generation,
          extraction: result,
        });
      }
    } catch (error) {
      // Rate limits/auth failures affect the entire batch; avoid ten more paid calls.
      // A bad image or oversized packed request (400/413) can affect just one
      // candidate. Isolate those; shared auth/rate/server failures use backoff.
      if (error instanceof UpstreamError && ![400, 413].includes(error.status)) {
        for (const item of ready)
          for (const message of messages.get(identity(item)) ?? [])
            await failed(message, env, error, http);
      } else {
        for (const item of ready) {
          try {
            results.push({
              candidate_id: item.candidate_id,
              generation: item.generation,
              extraction: (await extract(env, evidence, [item], http))[0],
            });
          } catch (individualError) {
            for (const message of messages.get(identity(item)) ?? [])
              await failed(message, env, individualError, http);
          }
        }
      }
    }
  }
  if (!results.length) return;
  try {
    const saved = await api<{ results: ResultStatus[] }>(
      env,
      "/results",
      { model: evidence.model, results },
      http,
    );
    for (const result of results) {
      const status = saved.results.find((item) => item.candidate_id === result.candidate_id);
      for (const message of messages.get(identity(result)) ?? []) {
        if (status && ["completed", "terminal", "missing", "stale"].includes(status.status))
          message.ack();
        else
          await failed(message, env, new Error("Result persistence or publication failed"), http);
      }
    }
  } catch (error) {
    for (const result of results)
      for (const message of messages.get(identity(result)) ?? [])
        await failed(message, env, error, http);
  }
}

export async function recover(env: Env, http: HttpClient = fetch): Promise<void> {
  const recovery = await api<{ candidates: ExtractionMessage[] }>(
    env,
    "/recovery?limit=10",
    undefined,
    http,
  );
  if (recovery.candidates.length) {
    await env.EXTRACTION_QUEUE.sendBatch(recovery.candidates.map((body) => ({ body })));
    await api(env, "/dispatched", { candidates: recovery.candidates }, http);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/health" && request.method === "GET") return Response.json({ status: "ok" });
    if (path !== "/enqueue" || request.method !== "POST")
      return new Response("Not found", { status: 404 });
    if (
      !env.EXTRACTION_DISPATCH_SECRET ||
      !(await matchesDispatchSecret(
        request.headers.get("Authorization") ?? "",
        `Bearer ${env.EXTRACTION_DISPATCH_SECRET}`,
      ))
    ) {
      return new Response("Unauthorized", { status: 401 });
    }
    let candidates: ExtractionMessage[];
    try {
      candidates = deliveries(await request.json());
    } catch {
      return new Response("Expected 1–10 candidate IDs with generation", { status: 400 });
    }
    await env.EXTRACTION_QUEUE.sendBatch(candidates.map((body) => ({ body })));
    return Response.json({ enqueued: candidates.length }, { status: 202 });
  },
  async queue(batch: MessageBatch<ExtractionMessage>, env: Env): Promise<void> {
    await consume(batch, env);
  },
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    await recover(env);
  },
} satisfies ExportedHandler<Env, ExtractionMessage>;
