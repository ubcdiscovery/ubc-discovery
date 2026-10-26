import type { ApiEnv } from "../env";
import { awsRequest, readBoundedBytes, type Fetcher } from "./aws";

export const EVENT_EMBEDDING_DIMENSIONS = 1024;
export const TITAN_EMBED_MODEL_ID = "amazon.titan-embed-text-v2:0";

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

export async function embedText(
  env: ApiEnv,
  text: string,
  fetcher: Fetcher = fetch,
): Promise<number[] | null> {
  try {
    const response = await awsRequest(
      env,
      "bedrock",
      `https://bedrock-runtime.${env.AWS_REGION || "us-west-2"}.amazonaws.com/model/${encodeURIComponent(TITAN_EMBED_MODEL_ID)}/invoke`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        // Omit normalize, exactly as the Python caller does: Titan defaults to true.
        body: JSON.stringify({ inputText: text, dimensions: EVENT_EMBEDDING_DIMENSIONS }),
      },
      fetcher,
    );
    if (!response.ok) {
      await response.body?.cancel();
      return null;
    }
    const body: unknown = JSON.parse(
      new TextDecoder().decode(await readBoundedBytes(response.body, 256 * 1024)),
    );
    if (
      typeof body !== "object" ||
      body === null ||
      !("embedding" in body) ||
      !isValidEmbedding(body.embedding)
    )
      return null;
    return body.embedding;
  } catch {
    // Embeddings are best-effort in the existing API. Avoid logging event text or credentials.
    return null;
  }
}

export async function generateEventEmbedding(
  env: ApiEnv,
  event: EmbeddingEvent,
  fetcher: Fetcher = fetch,
): Promise<number[] | null> {
  return embedText(env, generateEventText(event), fetcher);
}
