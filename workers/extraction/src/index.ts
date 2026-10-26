// Wrangler generates binding, variable and secret names; specialize message bodies.
export interface Env extends Omit<CloudflareBindings, "EXTRACTION_QUEUE"> {
  EXTRACTION_QUEUE: Queue<ExtractionMessage>;
}

export interface ExtractionMessage {
  candidate_id: string;
  generation: number;
}

export interface Extraction {
  candidate_id: string;
  is_event: boolean;
  title: string | null;
  event_date: string | null;
  event_end_date: string | null;
  location_name: string | null;
  club_name: string | null;
  vibes: string[];
}

export interface EvidenceItem {
  candidate_id: string;
  generation: number;
  state: "ready" | "waiting" | "extracted" | "completed" | "terminal" | "missing" | "stale";
  caption: string;
  source_account: string;
  source_type: string;
  reference_timestamp: string;
  created_at: string;
  images: { url: string }[];
}

export interface EvidenceBatch {
  model: string;
  system_prompt: string;
  schema: Record<string, unknown>;
  reasoning_effort: string;
  image_detail: string;
  items: EvidenceItem[];
}

type ResultStatus = {
  candidate_id: string;
  status: "completed" | "retry" | "terminal" | "missing" | "stale";
  error?: string;
};
type HttpClient = typeof fetch;

// Log statuses and candidate IDs only. Upstream bodies may contain captions or secrets.
class UpstreamError extends Error {
  constructor(
    service: string,
    readonly status: number,
  ) {
    super(`${service} HTTP ${status}`);
  }
}

async function matchesDispatchSecret(provided: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  return crypto.subtle.timingSafeEqual(providedHash, expectedHash);
}

function deliveries(value: unknown): ExtractionMessage[] {
  if (!value || typeof value !== "object" || !("candidates" in value)) {
    throw new Error("candidates required");
  }
  const candidates = value.candidates;
  if (
    !Array.isArray(candidates) ||
    candidates.length < 1 ||
    candidates.length > 10 ||
    candidates.some(
      (item) =>
        !item ||
        typeof item !== "object" ||
        typeof item.candidate_id !== "string" ||
        !/^[A-Za-z0-9_-]{8}$/.test(item.candidate_id) ||
        !Number.isSafeInteger(item.generation) ||
        item.generation < 1,
    )
  ) {
    throw new Error("expected 1–10 candidate IDs with generation");
  }
  return [
    ...new Map(
      candidates.map((item) => [
        identity(item),
        { candidate_id: item.candidate_id, generation: item.generation },
      ]),
    ).values(),
  ];
}

function identity(item: ExtractionMessage): string {
  return `${item.candidate_id}:${item.generation}`;
}

function validDatetime(value: string): boolean {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const [, year, month, day, hour, minute, second] = match;
  const y = Number(year),
    m = Number(month),
    d = Number(day);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return (
    y >= 1 &&
    m >= 1 &&
    m <= 12 &&
    d >= 1 &&
    d <= days[m - 1] &&
    Number(hour) < 24 &&
    Number(minute) < 60 &&
    Number(second ?? 0) < 60
  );
}

function validExtraction(value: unknown, evidence: EvidenceBatch): value is Extraction {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  const keys = [
    "candidate_id",
    "is_event",
    "title",
    "event_date",
    "event_end_date",
    "location_name",
    "club_name",
    "vibes",
  ];
  if (
    Object.keys(result).length !== keys.length ||
    keys.some((key) => !(key in result)) ||
    typeof result.candidate_id !== "string" ||
    typeof result.is_event !== "boolean"
  )
    return false;
  for (const [key, limit] of [
    ["title", 500],
    ["location_name", 255],
    ["club_name", 255],
  ] as const) {
    const field = result[key];
    if (field !== null && (typeof field !== "string" || Array.from(field).length > limit))
      return false;
  }
  for (const key of ["event_date", "event_end_date"] as const) {
    const field = result[key];
    if (field !== null && (typeof field !== "string" || !validDatetime(field))) return false;
  }
  // The API supplies its authoritative taxonomy; the Worker does not copy it.
  const schema = evidence.schema as {
    properties?: {
      extractions?: { items?: { properties?: { vibes?: { items?: { enum?: unknown[] } } } } };
    };
  };
  const allowed = schema.properties?.extractions?.items?.properties?.vibes?.items?.enum;
  return (
    Array.isArray(allowed) &&
    Array.isArray(result.vibes) &&
    result.vibes.every((vibe) => typeof vibe === "string" && allowed.includes(vibe))
  );
}

async function api<T>(
  env: Env,
  path: string,
  body?: unknown,
  http: HttpClient = fetch,
): Promise<T> {
  const response = await http(`${env.DISCOVERY_API_URL.replace(/\/+$/, "")}/extraction${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Api-Key ${env.DISCOVERY_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new UpstreamError("Discovery API", response.status);
  return (await response.json()) as T;
}

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
