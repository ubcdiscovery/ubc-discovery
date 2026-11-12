import type { Env, HttpClient } from "./types";

// Log statuses and candidate IDs only. Upstream bodies may contain captions or secrets.
export class UpstreamError extends Error {
  constructor(
    service: string,
    readonly status: number,
  ) {
    super(`${service} HTTP ${status}`);
  }
}

export async function api<T>(
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
