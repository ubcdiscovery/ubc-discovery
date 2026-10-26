// Explicit, resumable S3 -> R2 copy. Never deletes source or destination objects.
import { execFile, execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs, promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { r2S3Transport } from "./r2-s3.mjs";

const maxBytes = 5 * 1024 * 1024;
const execFileAsync = promisify(execFile);
const metadataProperties = {
  ContentType: ["--content-type", "content-type"],
  CacheControl: ["--cache-control", "cache-control"],
  ContentDisposition: ["--content-disposition", "content-disposition"],
  ContentEncoding: ["--content-encoding", "content-encoding"],
  ContentLanguage: ["--content-language", "content-language"],
  Expires: ["--expires", "expires"],
};
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
function canonicalMetadata(value) {
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
async function boundedBody(response, limit) {
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) {
    await response.body?.cancel();
    throw new Error("Cloudflare response exceeds supported size");
  }
  const reader = response.body?.getReader();
  const chunks = [];
  let size = 0;
  if (!reader) return Buffer.alloc(0);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new Error("Cloudflare response exceeds supported size");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}

// Hash object reads incrementally so four tasks do not retain four additional
// destination image buffers. Each source image remains bounded to five MiB.
async function boundedDigest(response, limit) {
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit)) {
    await response.body?.cancel();
    throw new Error("Cloudflare response exceeds supported size");
  }
  const digest = createHash("sha256");
  const reader = response.body?.getReader();
  let size = 0;
  if (reader)
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) {
          await reader.cancel();
          throw new Error("Cloudflare response exceeds supported size");
        }
        digest.update(value);
      }
    } finally {
      reader.releaseLock();
    }
  return { size, sha256: digest.digest("hex") };
}

export async function migrateStorage(
  options,
  {
    execute = execFileSync,
    executeAsync,
    fetcher = fetch,
    environment = process.env,
    log = console.log,
  } = {},
) {
  const { source, target, manifest, mode = "inspect", "cf-account": cfAccount } = options;
  const concurrency = Number(options.concurrency ?? 1);
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 4)
    throw new Error("--concurrency must be an integer from 1 to 4");
  if (!source || !target || !manifest || !["inspect", "copy", "verify"].includes(mode)) {
    throw new Error(
      "Usage: --source S3_BUCKET --target R2_BUCKET --manifest /private/path/manifest.json --mode inspect|copy|verify [--cf-account ACCOUNT_ID]",
    );
  }
  if ((mode !== "inspect" || cfAccount !== undefined) && !/^[a-f0-9]{32}$/.test(cfAccount ?? "")) {
    throw new Error(
      "--cf-account must be an explicit 32-character lowercase hex account ID for copy/verify",
    );
  }
  const wranglerEnvironment = {
    ...environment,
    WRANGLER_SEND_METRICS: "false",
    CLOUDFLARE_ACCOUNT_ID: cfAccount,
  };
  if (environment.CF_API_TOKEN) wranglerEnvironment.CLOUDFLARE_API_TOKEN = environment.CF_API_TOKEN;
  let token;
  let r2;
  // Existing synchronous test executors remain usable. Real object downloads
  // use asynchronous subprocesses within the same bounded worker pool.
  const sourceExecute =
    executeAsync ??
    (execute === execFileSync ? execFileAsync : async (...args) => ({ stdout: execute(...args) }));
  function command(program, args, commandOptions) {
    // Never propagate captured credentials or CLI stderr in subprocess exceptions.
    try {
      return execute(program, args, commandOptions);
    } catch {
      throw new Error(
        `${program === "aws" ? "AWS" : "Wrangler"} command failed; check authentication and permissions`,
      );
    }
  }
  function aws(args) {
    const output = command("aws", [...args, "--output", "json", "--no-cli-pager"], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    try {
      return output.trim() ? JSON.parse(output) : {};
    } catch {
      throw new Error("Invalid AWS CLI response");
    }
  }
  async function awsSource(args) {
    let output;
    try {
      ({ stdout: output } = await sourceExecute(
        "aws",
        [...args, "--output", "json", "--no-cli-pager"],
        {
          encoding: "utf8",
          maxBuffer: 16 * 1024 * 1024,
        },
      ));
    } catch {
      throw new Error("AWS command failed; check authentication and permissions");
    }
    try {
      return output.trim() ? JSON.parse(output) : {};
    } catch {
      throw new Error("Invalid AWS CLI response");
    }
  }
  function wrangler(args) {
    return command(process.execPath, ["node_modules/wrangler/bin/wrangler.js", ...args], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      env: wranglerEnvironment,
    });
  }
  async function cloudflareGet(path) {
    let response;
    try {
      response = await fetcher(`https://api.cloudflare.com/client/v4${path}`, {
        headers: { Authorization: `Bearer ${token}` },
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
  let previous;
  try {
    previous = JSON.parse(await readFile(manifest, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (
    previous &&
    (previous.source !== source ||
      previous.target !== target ||
      (previous.cfAccount && previous.cfAccount !== cfAccount))
  )
    throw new Error("Manifest belongs to a different account or bucket pair");
  let checkpointQueue = Promise.resolve();
  function writeCheckpoint(report) {
    // Capture the snapshot before queuing I/O. All writers then use one ordered
    // queue; no overlapping temporary-file writes or stale snapshot renames.
    const snapshot = JSON.stringify(report, null, 2) + "\n";
    const operation = checkpointQueue.then(async () => {
      const temporaryManifest = `${manifest}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporaryManifest, snapshot, { mode: 0o600, flag: "wx" });
        await rename(temporaryManifest, manifest);
      } finally {
        await rm(temporaryManifest, { force: true });
      }
    });
    checkpointQueue = operation.catch(() => {});
    return operation;
  }
  // A failed auth/account/inventory request must not leave a previous cutover gate valid.
  if (previous)
    await writeCheckpoint({
      ...previous,
      mode,
      verifiedAt: null,
      allVerified: false,
      sourceStable: false,
    });
  const temporary = await mkdtemp(join(tmpdir(), "ubc-storage-copy-"));
  try {
    if (mode !== "inspect") {
      let auth;
      try {
        auth = JSON.parse(wrangler(["auth", "token", "--json"]));
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
      token = auth.token;
      wranglerEnvironment.CLOUDFLARE_API_TOKEN = token;
      const account = JSON.parse(
        (await boundedBody(await cloudflareGet(`/accounts/${cfAccount}`), 64 * 1024)).toString(
          "utf8",
        ),
      );
      if (!account.success || account.result?.id !== cfAccount)
        throw new Error("Cloudflare account identity mismatch");
      const bucket = JSON.parse(
        (
          await boundedBody(
            await cloudflareGet(`/accounts/${cfAccount}/r2/buckets/${encodeURIComponent(target)}`),
            64 * 1024,
          )
        ).toString("utf8"),
      );
      if (!bucket.success || bucket.result?.name !== target)
        throw new Error("R2 target bucket identity mismatch");
      r2 = r2S3Transport({ account: cfAccount, bucket: target, environment, fetcher });
    }
    const identity = aws(["sts", "get-caller-identity"]);
    if (!/^\d{12}$/.test(identity.Account ?? "")) throw new Error("Invalid AWS account identity");
    const sourceOwner = ["--bucket", source, "--expected-bucket-owner", identity.Account];
    aws(["s3api", "head-bucket", ...sourceOwner]);
    const sourceListing = aws(["s3api", "list-objects-v2", ...sourceOwner]).Contents ?? [];
    // S3 console folders are zero-byte marker objects, not application images.
    const folderMarkers = sourceListing.filter((item) => item.Size === 0 && item.Key.endsWith("/"));
    const listing = sourceListing.filter((item) => !(item.Size === 0 && item.Key.endsWith("/")));
    if (previous && previous.awsAccount !== identity.Account)
      throw new Error("Manifest belongs to a different account or bucket pair");
    const report = {
      source,
      target,
      cfAccount,
      mode,
      concurrency,
      verifiedAt: null,
      verificationVersion: 3,
      allVerified: false,
      sourceStable: false,
      awsAccount: identity.Account,
      generatedAt: new Date().toISOString(),
      objects: Object.create(null),
      sourceCount: sourceListing.length,
      imageCount: listing.length,
      ignoredFolderMarkers: folderMarkers.map((item) => item.Key),
      sourceBytes: listing.reduce((sum, object) => sum + object.Size, 0),
    };
    const checkpoint = () => writeCheckpoint(report);
    // Invalidate an old cutover gate before any attempted verification can fail.
    await checkpoint();
    async function processItem(item, index) {
      const sourceFile = join(temporary, `source-${index}`);
      try {
        if (!Number.isSafeInteger(item.Size) || item.Size < 1 || item.Size > maxBytes) {
          throw new Error(`Source exceeds the supported image size: ${item.Key}`);
        }
        const old = previous?.objects?.[item.Key];
        const unchanged =
          old?.etag === item.ETag &&
          old.size === item.Size &&
          old.lastModified === item.LastModified;
        if (mode === "inspect") {
          report.objects[item.Key] = unchanged
            ? old
            : {
                etag: item.ETag,
                size: item.Size,
                lastModified: item.LastModified,
                verified: false,
              };
          return;
        }
        if (
          mode === "copy" &&
          previous?.cfAccount === cfAccount &&
          previous.verificationVersion === 3 &&
          unchanged &&
          old.verified &&
          old.httpMetadataVerified
        ) {
          const target = await r2("GET", item.Key);
          const matchesMetadata =
            ![...target.headers.keys()].some((name) => name.startsWith("x-amz-meta-")) &&
            JSON.stringify(canonicalMetadata(target.headers)) === JSON.stringify(old.httpMetadata);
          const current = await boundedDigest(target, maxBytes);
          if (matchesMetadata && current.size === item.Size && current.sha256 === old.sha256) {
            report.objects[item.Key] = old;
            return;
          }
        }
        const metadata = await awsSource([
          "s3api",
          "get-object",
          ...sourceOwner,
          "--key",
          item.Key,
          "--if-match",
          item.ETag,
          "--range",
          `bytes=0-${maxBytes}`,
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
          throw new Error(
            `Encoded source images are unsupported by the media runtime: ${item.Key}`,
          );
        if (item.Key.split("/").some((part) => part === "." || part === ".."))
          throw new Error(`Unsupported object key: ${item.Key}`);
        if (Object.keys(metadata.Metadata ?? {}).length)
          throw new Error(`Custom metadata requires a separate preservation path: ${item.Key}`);
        if (!["image/jpeg", "image/png", "image/webp"].includes(metadata.ContentType))
          throw new Error(`Unsupported source image MIME type: ${item.Key}`);
        if ((await stat(sourceFile)).size > maxBytes)
          throw new Error(`Source exceeds the supported image size: ${item.Key}`);
        let sourceBytes = await readFile(sourceFile);
        if (sourceBytes.length !== item.Size)
          throw new Error(`Source byte count mismatch: ${item.Key}`);
        const sourceHash = sha256(sourceBytes);
        const httpMetadata = canonicalMetadata(metadata);
        if (mode === "copy") {
          const headers = Object.fromEntries(
            Object.entries(httpMetadata).filter(([, value]) => value !== null),
          );
          const uploaded = await r2("PUT", item.Key, { body: sourceBytes, headers });
          await uploaded.body?.cancel();
        }
        sourceBytes = undefined;
        // Management REST adds download headers; the S3 endpoint supplies the
        // actual stored HTTP metadata rather than cache-control:no-store wrappers.
        const response = await r2("GET", item.Key);
        if (
          [...response.headers.keys()].some((name) => name.startsWith("x-amz-meta-")) ||
          JSON.stringify(canonicalMetadata(response.headers)) !== JSON.stringify(httpMetadata)
        ) {
          await response.body?.cancel();
          throw new Error(`R2 HTTP metadata mismatch: ${item.Key}`);
        }
        const targetDigest = await boundedDigest(response, maxBytes);
        if (targetDigest.size !== item.Size || targetDigest.sha256 !== sourceHash)
          throw new Error(`R2 content mismatch: ${item.Key}`);
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
        // Signal failure before asynchronous temp-file cleanup, so another
        // finishing worker cannot claim a new object during that cleanup.
        firstFailure ??= error;
        throw error;
      } finally {
        await rm(sourceFile, { force: true });
      }
    }
    let nextIndex = 0;
    let firstFailure;
    async function worker() {
      while (!firstFailure && nextIndex < listing.length) {
        const index = nextIndex++;
        try {
          await processItem(listing[index], index);
        } catch (error) {
          firstFailure ??= error;
        }
      }
    }
    // At most four object tasks exist. Stop assigning after the first failure,
    // but settle all active fetches/checkpoints before cleanup or rejection.
    const workers = await Promise.allSettled(
      Array.from({ length: Math.min(concurrency, listing.length) }, () => worker()),
    );
    await checkpointQueue;
    firstFailure ??= workers.find((result) => result.status === "rejected")?.reason;
    if (firstFailure) throw firstFailure;
    // Include LastModified: metadata-only S3 replacement can preserve size and ETag.
    const finalListing = aws(["s3api", "list-objects-v2", ...sourceOwner]).Contents ?? [];
    const inventory = (objects) =>
      objects
        .map((object) => [object.Key, object.ETag, object.Size, object.LastModified])
        .sort((a, b) => a[0].localeCompare(b[0]));
    report.sourceStable =
      JSON.stringify(inventory(sourceListing)) === JSON.stringify(inventory(finalListing));
    report.allVerified =
      report.sourceStable &&
      listing.every(
        (item) =>
          report.objects[item.Key]?.verified && report.objects[item.Key]?.httpMetadataVerified,
      );
    if (mode === "verify" && report.allVerified) report.verifiedAt = new Date().toISOString();
    await checkpoint();
    log(
      JSON.stringify({
        mode,
        cfAccount,
        sourceCount: report.sourceCount,
        imageCount: report.imageCount,
        ignoredFolderMarkers: folderMarkers.length,
        sourceBytes: report.sourceBytes,
        sourceStable: report.sourceStable,
        allVerified: report.allVerified,
      }),
    );
    if (!report.sourceStable || (mode === "verify" && !report.allVerified))
      throw new Error("Source changed or verification incomplete; repeat after writes are paused");
    return report;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({
    options: {
      source: { type: "string" },
      target: { type: "string" },
      manifest: { type: "string" },
      "cf-account": { type: "string" },
      mode: { type: "string", default: "inspect" },
      concurrency: { type: "string", default: "1" },
    },
  });
  try {
    await migrateStorage(values);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
