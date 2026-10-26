import { AwsClient } from "aws4fetch";
import type { ApiEnv } from "../env";
import { ApiError } from "../http/errors";

export type Fetcher = typeof fetch;
export type AwsService = "ses" | "bedrock" | "s3";

export function awsCredentials(env: ApiEnv) {
  if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
    throw new ApiError(503, "AWS credentials are not configured");
  }
  return {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    sessionToken: env.AWS_SESSION_TOKEN,
    region: env.AWS_REGION || "us-west-2",
  };
}

export function createAwsClient(env: ApiEnv, service: AwsService) {
  // No implicit retries: SES sends and model invocations are not idempotent.
  return new AwsClient({ ...awsCredentials(env), service, retries: 0 });
}

export async function awsRequest(
  env: ApiEnv,
  service: AwsService,
  url: string,
  init: RequestInit = {},
  fetcher: Fetcher = fetch,
): Promise<Response> {
  const signed = await createAwsClient(env, service).sign(url, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(30_000),
  });
  return fetcher(signed);
}

export async function readBoundedBytes(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new ApiError(500, "Invalid object size limit");
  }
  if (!stream) return new Uint8Array(0);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new ApiError(413, "File exceeds the allowed size");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export async function hmacSha256(key: Uint8Array, value: string) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(value)),
  );
}

export async function signPostPolicy(env: ApiEnv, date: string, policy: string) {
  const credentials = awsCredentials(env);
  const dateKey = await hmacSha256(
    new TextEncoder().encode(`AWS4${credentials.secretAccessKey}`),
    date,
  );
  const regionKey = await hmacSha256(dateKey, credentials.region);
  const serviceKey = await hmacSha256(regionKey, "s3");
  const signingKey = await hmacSha256(serviceKey, "aws4_request");
  const signature = await hmacSha256(signingKey, policy);
  return Array.from(signature, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
