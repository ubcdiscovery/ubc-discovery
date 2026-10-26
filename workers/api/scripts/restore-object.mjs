// R2 inventory parsing and one-object S3 restore for restore-storage.mjs.
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  boundedBody,
  isSafeObjectKey,
  sha256,
} from "./storage-common.mjs";

const metadataFields = [
  ["content-type", "contentType", "ContentType", "--content-type"],
  ["cache-control", "cacheControl", "CacheControl", "--cache-control"],
  ["content-disposition", "contentDisposition", "ContentDisposition", "--content-disposition"],
  ["content-encoding", "contentEncoding", "ContentEncoding", "--content-encoding"],
  ["content-language", "contentLanguage", "ContentLanguage", "--content-language"],
  ["expires", "cacheExpiry", "Expires", "--expires"],
];

export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function metadata(value, format) {
  return Object.fromEntries(
    metadataFields.map(([header, r2, s3]) => {
      let raw = format === "headers" ? value.get(header) : value[format === "r2" ? r2 : s3];
      if (format === "s3" && header === "expires") raw = value.ExpiresString ?? raw;
      if (raw != null && typeof raw !== "string") throw new Error("Invalid HTTP metadata");
      if (header === "expires" && raw) {
        const date = new Date(raw);
        if (!Number.isFinite(date.getTime())) throw new Error("Invalid object expiry metadata");
        raw = date.toUTCString();
      }
      return [header, raw == null || raw === "" ? null : raw.trim()];
    }),
  );
}

export function sourceItem(item) {
  if (
    !item ||
    typeof item.key !== "string" ||
    !Number.isSafeInteger(item.size) ||
    item.size < 0 ||
    typeof item.etag !== "string" ||
    !item.etag ||
    /[\r\n"]/.test(item.etag) ||
    typeof item.last_modified !== "string" ||
    !Number.isFinite(Date.parse(item.last_modified))
  )
    throw new Error("Incomplete R2 object inventory");
  const custom = item.custom_metadata ?? {};
  if (!custom || typeof custom !== "object" || Array.isArray(custom))
    throw new Error("Invalid R2 custom metadata");
  return {
    key: item.key,
    size: item.size,
    etag: item.etag,
    lastModified: item.last_modified,
    httpMetadata: metadata(item.http_metadata ?? {}, "r2"),
    customMetadata: Object.fromEntries(
      Object.entries(custom).sort(([a], [b]) => a.localeCompare(b)),
    ),
    ssec: item.ssec ?? false,
  };
}

export function inventory(items) {
  return [...items].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

function assertRestorable(item) {
  if (!isSafeObjectKey(item.key)) throw new Error("Unsupported object key");
  if (!Number.isSafeInteger(item.size) || item.size < 1 || item.size > MAX_IMAGE_BYTES)
    throw new Error("Source exceeds supported image size");
  if (item.ssec || Object.keys(item.customMetadata).length)
    throw new Error("Encrypted/custom metadata source images require separate preservation");
  if (item.httpMetadata["content-encoding"])
    throw new Error("Encoded source images are unsupported");
  if (!IMAGE_TYPES.includes(item.httpMetadata["content-type"]))
    throw new Error("Unsupported source image MIME type");
}

async function readSource({ r2 }, item) {
  const response = await r2("GET", item.key, { headers: { "if-match": `"${item.etag}"` } });
  if (
    [...response.headers.keys()].some((name) => name.startsWith("x-amz-meta-")) ||
    response.headers.get("etag") !== `"${item.etag}"` ||
    !same(metadata(response.headers, "headers"), item.httpMetadata) ||
    Math.floor(Date.parse(response.headers.get("last-modified")) / 1000) !==
      Math.floor(Date.parse(item.lastModified) / 1000)
  ) {
    await response.body?.cancel();
    throw new Error("R2 source changed during restore");
  }
  const bytes = await boundedBody(response, MAX_IMAGE_BYTES);
  if (bytes.length !== item.size) throw new Error("R2 source size mismatch");
  return bytes;
}

function readTarget({ aws, owner }, targetFile, key, item) {
  if (!item || !Number.isSafeInteger(item.size) || item.size < 1 || item.size > MAX_IMAGE_BYTES)
    return null;
  const headers = aws([
    "s3api",
    "get-object",
    ...owner,
    "--key",
    key,
    "--if-match",
    item.etag,
    "--range",
    `bytes=0-${MAX_IMAGE_BYTES}`,
    targetFile,
  ]);
  return {
    headers,
    item: { etag: headers.ETag, size: headers.ContentLength, lastModified: headers.LastModified },
  };
}

async function targetMatches(targetResult, targetFile, item, sourceHash) {
  if (
    !targetResult ||
    targetResult.headers.ContentLength !== item.size ||
    Object.keys(targetResult.headers.Metadata ?? {}).length ||
    !same(metadata(targetResult.headers, "s3"), item.httpMetadata)
  )
    return false;
  if ((await stat(targetFile)).size > MAX_IMAGE_BYTES)
    throw new Error("S3 object exceeds supported size");
  return sha256(await readFile(targetFile)) === sourceHash;
}

async function uploadTarget({ aws, owner, temporary }, item, bytes) {
  const sourceFile = join(temporary, "source");
  await writeFile(sourceFile, bytes, { mode: 0o600 });
  const flags = metadataFields.flatMap(([header, , , flag]) =>
    item.httpMetadata[header] ? [flag, item.httpMetadata[header]] : [],
  );
  const written = aws([
    "s3api",
    "put-object",
    ...owner,
    "--key",
    item.key,
    "--body",
    sourceFile,
    ...flags,
  ]);
  if (!written.ETag) throw new Error("Invalid S3 upload response");
  return written.ETag;
}

/** Inspect, copy or verify one R2 image in the S3 rollback bucket. */
export async function restoreObject(context, item) {
  const { mode, report, temporary, targetItems } = context;
  assertRestorable(item);
  if (mode === "inspect") {
    report.objects[item.key] = { source: item, verified: false };
    return;
  }
  const bytes = await readSource(context, item);
  const sourceHash = sha256(bytes);
  const targetFile = join(temporary, "target");
  let targetResult = readTarget(context, targetFile, item.key, targetItems.get(item.key));
  let matches = await targetMatches(targetResult, targetFile, item, sourceHash);
  let copied = false;
  if (!matches && mode === "copy") {
    const etag = await uploadTarget(context, item, bytes);
    targetResult = readTarget(context, targetFile, item.key, { etag, size: item.size });
    matches = await targetMatches(targetResult, targetFile, item, sourceHash);
    copied = true;
  }
  if (!matches || !targetResult?.item.lastModified)
    throw new Error("S3 rollback bytes or HTTP metadata mismatch");
  report.objects[item.key] = {
    source: item,
    sha256: sourceHash,
    target: targetResult.item,
    copied,
    verified: true,
    httpMetadataVerified: true,
  };
  await context.checkpoint(report);
}
