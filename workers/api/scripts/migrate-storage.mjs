// Explicit, resumable S3 -> R2 copy. Never deletes source or destination objects.
import { execFile, execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs, promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { migrateObject } from "./migrate-object.mjs";
import { r2S3Transport } from "./r2-s3.mjs";
import {
  checkpointWriter,
  cloudflareClient,
  parseCliJson,
  runBounded,
  runCommand,
  wranglerBearerToken,
} from "./storage-common.mjs";

const execFileAsync = promisify(execFile);
const cliOptions = { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 };

// Include LastModified: metadata-only S3 replacement can preserve size and ETag.
const listingInventory = (objects) =>
  JSON.stringify(
    objects
      .map((object) => [object.Key, object.ETag, object.Size, object.LastModified])
      .sort((a, b) => a[0].localeCompare(b[0])),
  );

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
  const cloudflare = cloudflareClient(fetcher, () => token);
  // Existing synchronous test executors remain usable. Real object downloads
  // use asynchronous subprocesses within the same bounded worker pool.
  const sourceExecute =
    executeAsync ??
    (execute === execFileSync ? execFileAsync : async (...args) => ({ stdout: execute(...args) }));
  const aws = (args) =>
    parseCliJson(
      runCommand(execute, "aws", [...args, "--output", "json", "--no-cli-pager"], cliOptions),
    );
  async function awsSource(args) {
    let output;
    try {
      ({ stdout: output } = await sourceExecute(
        "aws",
        [...args, "--output", "json", "--no-cli-pager"],
        cliOptions,
      ));
    } catch {
      throw new Error("AWS command failed; check authentication and permissions");
    }
    return parseCliJson(output);
  }
  const wrangler = (args) =>
    runCommand(execute, process.execPath, ["node_modules/wrangler/bin/wrangler.js", ...args], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      env: wranglerEnvironment,
    });
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
  const checkpoints = checkpointWriter(manifest);
  // A failed auth/account/inventory request must not leave a previous cutover gate valid.
  if (previous)
    await checkpoints.write({
      ...previous,
      mode,
      verifiedAt: null,
      allVerified: false,
      sourceStable: false,
    });
  const temporary = await mkdtemp(join(tmpdir(), "ubc-storage-copy-"));
  try {
    let r2;
    if (mode !== "inspect") {
      token = wranglerBearerToken(wrangler);
      wranglerEnvironment.CLOUDFLARE_API_TOKEN = token;
      const account = await cloudflare.json(`/accounts/${cfAccount}`, 64 * 1024);
      if (!account.success || account.result?.id !== cfAccount)
        throw new Error("Cloudflare account identity mismatch");
      const bucket = await cloudflare.json(
        `/accounts/${cfAccount}/r2/buckets/${encodeURIComponent(target)}`,
        64 * 1024,
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
    const isFolderMarker = (item) => item.Size === 0 && item.Key.endsWith("/");
    const folderMarkers = sourceListing.filter(isFolderMarker);
    const listing = sourceListing.filter((item) => !isFolderMarker(item));
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
    const checkpoint = () => checkpoints.write(report);
    // Invalidate an old cutover gate before any attempted verification can fail.
    await checkpoint();
    const context = {
      mode,
      previous,
      cfAccount,
      r2,
      awsSource,
      sourceOwner,
      report,
      temporary,
      checkpoint,
    };
    // Stop assigning after the first failure, but settle all active fetches and
    // checkpoints before cleanup or rejection.
    const failure = await runBounded(listing.length, concurrency, (index, fail) =>
      migrateObject(context, listing[index], index, fail),
    );
    await checkpoints.settled();
    if (failure) throw failure;
    const finalListing = aws(["s3api", "list-objects-v2", ...sourceOwner]).Contents ?? [];
    report.sourceStable = listingInventory(sourceListing) === listingInventory(finalListing);
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
