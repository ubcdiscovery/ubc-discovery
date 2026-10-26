import { vi } from "vite-plus/test";
import {
  type Env,
  type EvidenceBatch,
  type EvidenceItem,
  type Extraction,
  type ExtractionMessage,
} from "../src/index";

// Node lacks Workers' Web Crypto extension. Use Node's constant-time primitive
// in fixture tests; the producer is also exercised in workerd below.
export async function useNodeTimingSafeEqual() {
  const { timingSafeEqual } =
    await vi.importActual<Pick<SubtleCrypto, "timingSafeEqual">>("node:crypto");
  Object.defineProperty(crypto.subtle, "timingSafeEqual", {
    configurable: true,
    value: (left: ArrayBuffer, right: ArrayBuffer) =>
      timingSafeEqual(new Uint8Array(left), new Uint8Array(right)),
  });
}

export const first = "cand0001";
export const second = "cand0002";

export function environment(): Env {
  return {
    EXTRACTION_QUEUE: {
      sendBatch: vi.fn().mockResolvedValue(undefined),
    } as unknown as Queue<ExtractionMessage>,
    DISCOVERY_API_URL: "http://localhost:8000",
    DISCOVERY_API_KEY: "local-scoped-key",
    EXTRACTION_DISPATCH_SECRET: "local-secret",
    OPENAI_API_KEY: "fake-test-key",
    MAX_ATTEMPTS: "5",
    OPENAI_TIMEOUT_MS: "60000",
  };
}

export function item(
  id: string,
  state: EvidenceItem["state"] = "ready",
  generation = 1,
): EvidenceItem {
  return {
    candidate_id: id,
    generation,
    state,
    caption: "Club event",
    source_account: "club",
    source_type: "instagram",
    reference_timestamp: "2026-10-11T12:00:00Z",
    created_at: "2026-10-11T12:00:00Z",
    images: [{ url: "https://s3.example/signed-image" }],
  };
}

export function evidence(items: EvidenceItem[]): EvidenceBatch {
  return {
    model: "fixture-model",
    system_prompt: "fixture prompt",
    schema: {
      type: "object",
      properties: {
        extractions: {
          items: { properties: { vibes: { items: { enum: ["social", "academic"] } } } },
        },
      },
    },
    reasoning_effort: "low",
    image_detail: "high",
    items,
  };
}

export function extraction(id: string): Extraction {
  return {
    candidate_id: id,
    is_event: true,
    title: "Club event",
    event_date: "2026-10-15T19:00:00-07:00",
    event_end_date: null,
    location_name: "UBC",
    club_name: "Club",
    vibes: ["social"],
  };
}

export function message(id: string, attempts = 1, generation = 1) {
  return {
    id: `message-${id}`,
    body: { candidate_id: id, generation },
    attempts,
    timestamp: new Date(),
    ack: vi.fn(),
    retry: vi.fn(),
  };
}

export function batch(
  messages: ReturnType<typeof message>[],
  queue = "ubc-discovery-extraction",
): MessageBatch<ExtractionMessage> {
  return {
    queue,
    messages,
    ackAll: vi.fn(),
    retryAll: vi.fn(),
  } as unknown as MessageBatch<ExtractionMessage>;
}

export function json(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}
export function ai(results: Extraction[]): Response {
  return json({ choices: [{ message: { content: JSON.stringify({ extractions: results }) } }] });
}
export function httpMock() {
  return vi.fn<typeof fetch>();
}
