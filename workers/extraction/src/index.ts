import type {
  Env,
  ExtractionMessage,
  Extraction,
  EvidenceItem,
  EvidenceBatch,
  ResultStatus,
  HttpClient,
} from "./types";
import { identity, validExtraction } from "./validation";
import { UpstreamError, api } from "./http";

export type { Env, ExtractionMessage, Extraction, EvidenceItem, EvidenceBatch } from "./types";

const MAX_OUTPUT_TOKENS = 4096;

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
    for (const image of item.images)
      content.push({ type: "image_url", image_url: { url: await inlineImage(image.url, http) } });
  }
  const response = await runModel(env, {
    messages: [
      { role: "system", content: evidence.system_prompt },
      { role: "user", content },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "candidate_extractions", strict: true, schema: evidence.schema },
    },
    max_tokens: MAX_OUTPUT_TOKENS,
    chat_template_kwargs: { enable_thinking: false },
  });
  const output = response.choices?.[0]?.message?.content;
  const parsed = (typeof output === "string" ? JSON.parse(output || "{}") : (output ?? {})) as {
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

interface ChatCompletion {
  choices?: { message?: { content?: unknown } }[];
}

async function runModel(env: Env, inputs: Record<string, unknown>): Promise<ChatCompletion> {
  const run = env.AI.run.bind(env.AI) as (model: string, inputs: unknown) => Promise<unknown>;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return (await Promise.race([
      run(env.EXTRACTION_MODEL, inputs),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new UpstreamError("Workers AI", 504, "timeout")),
          Number(env.EXTRACTION_TIMEOUT_MS) || 120000,
        );
      }),
    ])) as ChatCompletion;
  } catch (error) {
    if (error instanceof UpstreamError) throw error;
    // Workers AI errors carry a numeric code (for example 3040 capacity, 4006 daily limit).
    const code = /\b(\d{4})\b/.exec(error instanceof Error ? error.message : "")?.[1];
    throw new UpstreamError("Workers AI", Number(code ?? 500), "error");
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function inlineImage(url: string, http: HttpClient): Promise<string> {
  const response = await http(url, { signal: AbortSignal.timeout(30000) });
  const type = response.headers.get("Content-Type")?.split(";")[0].trim() ?? "";
  if (!response.ok || !type.startsWith("image/")) {
    await response.body?.cancel();
    throw new Error("Candidate image download failed");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return `data:${type};base64,${btoa(binary)}`;
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
      // Workers AI failures (capacity, daily limit, timeout) affect the entire batch, so
      // they back off instead of making one more call per candidate. A bad image or a
      // malformed packed result can affect just one candidate, so isolate those.
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
      { model: env.EXTRACTION_MODEL, results },
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

export default {
  fetch(request: Request): Response {
    const path = new URL(request.url).pathname;
    if (path === "/health" && request.method === "GET") return Response.json({ status: "ok" });
    return new Response("Not found", { status: 404 });
  },
  async queue(batch: MessageBatch<ExtractionMessage>, env: Env): Promise<void> {
    await consume(batch, env);
  },
} satisfies ExportedHandler<Env, ExtractionMessage>;
