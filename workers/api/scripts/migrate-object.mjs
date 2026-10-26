// Copy or verify one S3 image in R2 for migrate-storage.mjs.
import { readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { IMAGE_TYPES, MAX_IMAGE_BYTES, boundedDigest, sha256 } from "./storage-common.mjs";

const metadataProperties = {
  ContentType: ["--content-type", "content-type"],
  CacheControl: ["--cache-control", "cache-control"],
  ContentDisposition: ["--content-disposition", "content-disposition"],
  ContentEncoding: ["--content-encoding", "content-encoding"],
  ContentLanguage: ["--content-language", "content-language"],
  Expires: ["--expires", "expires"],
};

export function canonicalMetadata(value) {
  return Object.fromEntries(
    Object.entries(metadataProperties).map(([property, [, header]]) => {
      const raw = value instanceof Headers ? value.get(header) : value[property];
      if (property === "Expires" && raw) {
        const date = new Date(raw);
        if (!Number.isFinite(date.getTime())) throw new Error("Invalid object Expires metadata");
        return [header, date.toUTCString()];
      }
      return [header, raw == null || raw === "" ? null : String(raw).trim()];
    }),
  );
}

const hasCustomMetadata = (headers) =>
  [...headers.keys()].some((name) => name.startsWith("x-amz-meta-"));

// Reuse a previously verified copy when the source is unchanged and R2 still matches it.
async function verifiedCopyIsCurrent({ r2 }, item, old) {
  const target = await r2("GET", item.Key);
  const matchesMetadata =
    !hasCustomMetadata(target.headers) &&
    JSON.stringify(canonicalMetadata(target.headers)) === JSON.stringify(old.httpMetadata);
  const current = await boundedDigest(target, MAX_IMAGE_BYTES);
  return matchesMetadata && current.size === item.Size && current.sha256 === old.sha256;
}

async function downloadSource({ awsSource, sourceOwner }, item, sourceFile) {
  const metadata = await awsSource([
    "s3api",
    "get-object",
    ...sourceOwner,
    "--key",
    item.Key,
    "--if-match",
    item.ETag,
    "--range",
    `bytes=0-${MAX_IMAGE_BYTES}`,
    sourceFile,
  ]);
  if (
    metadata.ETag !== item.ETag ||
    metadata.ContentLength !== item.Size ||
    metadata.LastModified !== item.LastModified
  ) {
    throw new Error(`Source changed during copy: ${item.Key}; refresh inventory and retry`);
  }
  if (metadata.ContentEncoding)
    throw new Error(`Encoded source images are unsupported by the media runtime: ${item.Key}`);
  if (item.Key.split("/").some((part) => part === "." || part === ".."))
    throw new Error(`Unsupported object key: ${item.Key}`);
  if (Object.keys(metadata.Metadata ?? {}).length)
    throw new Error(`Custom metadata requires a separate preservation path: ${item.Key}`);
  if (!IMAGE_TYPES.includes(metadata.ContentType))
    throw new Error(`Unsupported source image MIME type: ${item.Key}`);
  if ((await stat(sourceFile)).size > MAX_IMAGE_BYTES)
    throw new Error(`Source exceeds the supported image size: ${item.Key}`);
  return metadata;
}

// Management REST adds download headers; the S3 endpoint supplies the actual
// stored HTTP metadata rather than cache-control:no-store wrappers.
async function verifyTarget({ r2 }, item, httpMetadata, sourceHash) {
  const response = await r2("GET", item.Key);
  if (
    hasCustomMetadata(response.headers) ||
    JSON.stringify(canonicalMetadata(response.headers)) !== JSON.stringify(httpMetadata)
  ) {
    await response.body?.cancel();
    throw new Error(`R2 HTTP metadata mismatch: ${item.Key}`);
  }
  const targetDigest = await boundedDigest(response, MAX_IMAGE_BYTES);
  if (targetDigest.size !== item.Size || targetDigest.sha256 !== sourceHash)
    throw new Error(`R2 content mismatch: ${item.Key}`);
}

/**
 * Inspect, copy or verify one listed S3 object. `fail` is signalled before
 * temporary-file cleanup so no other worker claims a new object meanwhile.
 */
export async function migrateObject(context, item, index, fail) {
  const { mode, previous, cfAccount, report, temporary, checkpoint } = context;
  const sourceFile = join(temporary, `source-${index}`);
  try {
    if (!Number.isSafeInteger(item.Size) || item.Size < 1 || item.Size > MAX_IMAGE_BYTES) {
      throw new Error(`Source exceeds the supported image size: ${item.Key}`);
    }
    const old = previous?.objects?.[item.Key];
    const unchanged =
      old?.etag === item.ETag && old.size === item.Size && old.lastModified === item.LastModified;
    if (mode === "inspect") {
      report.objects[item.Key] = unchanged
        ? old
        : { etag: item.ETag, size: item.Size, lastModified: item.LastModified, verified: false };
      return;
    }
    if (
      mode === "copy" &&
      previous?.cfAccount === cfAccount &&
      previous.verificationVersion === 3 &&
      unchanged &&
      old.verified &&
      old.httpMetadataVerified &&
      (await verifiedCopyIsCurrent(context, item, old))
    ) {
      report.objects[item.Key] = old;
      return;
    }
    const metadata = await downloadSource(context, item, sourceFile);
    let sourceBytes = await readFile(sourceFile);
    if (sourceBytes.length !== item.Size)
      throw new Error(`Source byte count mismatch: ${item.Key}`);
    const sourceHash = sha256(sourceBytes);
    const httpMetadata = canonicalMetadata(metadata);
    if (mode === "copy") {
      const headers = Object.fromEntries(
        Object.entries(httpMetadata).filter(([, value]) => value !== null),
      );
      const uploaded = await context.r2("PUT", item.Key, { body: sourceBytes, headers });
      await uploaded.body?.cancel();
    }
    sourceBytes = undefined;
    await verifyTarget(context, item, httpMetadata, sourceHash);
    report.objects[item.Key] = {
      etag: item.ETag,
      size: item.Size,
      sha256: sourceHash,
      contentType: metadata.ContentType,
      lastModified: item.LastModified,
      httpMetadata,
      httpMetadataVerified: true,
      verified: true,
    };
    await checkpoint();
  } catch (error) {
    fail(error);
    throw error;
  } finally {
    await rm(sourceFile, { force: true });
  }
}
