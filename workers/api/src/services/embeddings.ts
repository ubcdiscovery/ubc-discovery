// Type-only imports keep this module loadable by Node scripts (scripts/reembed-events.mjs).
import type { ApiEnv } from "../env";

export const EVENT_EMBEDDING_DIMENSIONS = 1024;
/**
 * The model behind every stored event vector the recommender compares. Vectors
 * from different models are not comparable: changing this means re-embedding
 * every event with scripts/reembed-events.mjs.
 */
export const EMBEDDING_MODEL_ID = "@cf/qwen/qwen3-embedding-0.6b";

export interface EmbeddingEvent {
  title: string;
  description?: string | null;
  club_name?: string | null;
  location_name: string;
}

export function isValidEmbedding(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === EVENT_EMBEDDING_DIMENSIONS &&
    value.every((component: unknown) => typeof component === "number" && Number.isFinite(component))
  );
}

export function generateEventText(event: EmbeddingEvent): string {
  const parts = [event.title];
  if (event.description) parts.push(event.description);
  if (event.club_name) parts.push(`Hosted by ${event.club_name}`);
  parts.push(`Location: ${event.location_name}`);
  return parts.join(". ");
}

/**
 * Workers AI input for embedding event texts. Events are compared with other
 * events (never with a search query), so they are embedded as documents with
 * no query instruction.
 */
export function embeddingRequest(texts: string[]) {
  return { documents: texts };
}

/** Vectors from a Workers AI result, or null unless every one is valid. */
export function embeddingsFromResult(result: unknown, count: number): number[][] | null {
  if (typeof result !== "object" || result === null || !("data" in result)) return null;
  const { data } = result;
  if (!Array.isArray(data) || data.length !== count || !data.every(isValidEmbedding)) return null;
  return data;
}

export async function embedText(env: ApiEnv, text: string): Promise<number[] | null> {
  if (!env.AI) return null;
  try {
    const result: unknown = await env.AI.run(EMBEDDING_MODEL_ID, embeddingRequest([text]));
    return embeddingsFromResult(result, 1)?.[0] ?? null;
  } catch {
    // Embeddings are best-effort: an event without one is left out of similarity
    // ranking until scripts/reembed-events.mjs fills it. Avoid logging event text.
    return null;
  }
}

export async function generateEventEmbedding(
  env: ApiEnv,
  event: EmbeddingEvent,
): Promise<number[] | null> {
  return embedText(env, generateEventText(event));
}
