// Helpers shared by the S3 <-> R2 storage copy scripts.
import { createHash, randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** True when the value contains a C0 control character or DEL. */
export function hasControlCharacter(value) {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

export function isSafeObjectKey(key) {
  return (
    typeof key === "string" &&
    Boolean(key) &&
    Buffer.byteLength(key) <= 1024 &&
    !key.startsWith("/") &&
    !key.includes("\\") &&
    !hasControlCharacter(key) &&
    key.split("/").every((part) => part && part !== "." && part !== "..")
  );
}

function declaredTooLarge(response, limit) {
  const declared = response.headers.get("content-length");
  return declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit);
}

// Read a response body without buffering more than the limit; onChunk sees each chunk.
async function readBounded(response, limit, onChunk) {
  if (declaredTooLarge(response, limit)) {
    await response.body?.cancel();
    throw new Error("Cloudflare response exceeds supported size");
  }
  const reader = response.body?.getReader();
  let size = 0;
  if (!reader) return size;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new Error("Cloudflare response exceeds supported size");
      }
      onChunk(value);
    }
  } finally {
    reader.releaseLock();
  }
  return size;
}

export async function boundedBody(response, limit) {
  const chunks = [];
  const size = await readBounded(response, limit, (chunk) => chunks.push(chunk));
  return Buffer.concat(chunks, size);
}

// Hash object reads incrementally so concurrent tasks do not retain additional
// destination image buffers.
export async function boundedDigest(response, limit) {
  const digest = createHash("sha256");
  const size = await readBounded(response, limit, (chunk) => digest.update(chunk));
  return { size, sha256: digest.digest("hex") };
}

/** Run a CLI without propagating captured credentials or stderr in its exceptions. */
export function runCommand(execute, program, args, options) {
  try {
    return execute(program, args, options);
  } catch {
    throw new Error(
      `${program === "aws" ? "AWS" : "Wrangler"} command failed; check authentication and permissions`,
    );
  }
}

export function parseCliJson(output) {
  try {
    return output.trim() ? JSON.parse(output) : {};
  } catch {
    throw new Error("Invalid AWS CLI response");
  }
}

export function wranglerBearerToken(runWrangler) {
  let auth;
  try {
    auth = JSON.parse(runWrangler(["auth", "token", "--json"]));
  } catch {
    throw new Error(
      "Cannot retrieve Wrangler bearer token; use wrangler login or CLOUDFLARE_API_TOKEN",
    );
  }
  if (
    !["oauth", "api_token"].includes(auth.type) ||
    typeof auth.token !== "string" ||
    !auth.token.trim()
  ) {
    throw new Error(
      "A Cloudflare OAuth/API bearer token is required; API key/email authentication is unsupported",
    );
  }
  return auth.token;
}

/** Cloudflare REST reads. Errors never include provider response bodies. */
export function cloudflareClient(fetcher, getToken) {
  async function get(path) {
    let response;
    try {
      response = await fetcher(`https://api.cloudflare.com/client/v4${path}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new Error("Cloudflare read failed; check connectivity and authentication");
    }
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new Error(
        `Cloudflare read failed (HTTP ${response.status}); check account, object and permissions`,
      );
    }
    return response;
  }
  async function json(path, limit = 1024 * 1024) {
    const body = await boundedBody(await get(path), limit);
    try {
      return JSON.parse(body.toString("utf8"));
    } catch {
      throw new Error("Invalid Cloudflare API response");
    }
  }
  return { get, json };
}

/**
 * Atomic manifest checkpoints. Each write snapshots the report before queuing,
 * and writes run in order, so no stale snapshot can replace a newer one.
 */
export function checkpointWriter(manifest) {
  let queue = Promise.resolve();
  function write(report) {
    const snapshot = JSON.stringify(report, null, 2) + "\n";
    const operation = queue.then(async () => {
      const temporaryManifest = `${manifest}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporaryManifest, snapshot, { mode: 0o600, flag: "wx" });
        await rename(temporaryManifest, manifest);
      } finally {
        await rm(temporaryManifest, { force: true });
      }
    });
    queue = operation.catch(() => {});
    return operation;
  }
  return { write, settled: () => queue };
}

/**
 * Run task(index, fail) for 0..total-1 on at most `concurrency` workers. Stops
 * assigning after the first failure, settles active tasks, and returns that failure.
 */
export async function runBounded(total, concurrency, task) {
  let nextIndex = 0;
  let firstFailure;
  const fail = (error) => {
    firstFailure ??= error;
  };
  async function worker() {
    while (!firstFailure && nextIndex < total) {
      const index = nextIndex++;
      try {
        await task(index, fail);
      } catch (error) {
        fail(error);
      }
    }
  }
  const workers = await Promise.allSettled(
    Array.from({ length: Math.min(concurrency, total) }, () => worker()),
  );
  return firstFailure ?? workers.find((result) => result.status === "rejected")?.reason;
}
