// Paused-write R2 -> S3 rollback copy. Never deletes either store's objects.
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { r2S3Transport } from "./r2-s3.mjs";
import { inventory, restoreObject, same, sourceItem } from "./restore-object.mjs";
import {
  checkpointWriter,
  cloudflareClient,
  parseCliJson,
  runCommand,
  wranglerBearerToken,
} from "./storage-common.mjs";

async function readManifest(manifest) {
  try {
    return JSON.parse(await readFile(manifest, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    // The message stays free of the private manifest path.
    throw new Error("Cannot read rollback manifest", { cause: error });
  }
}

async function listR2Objects(cloudflare, sourcePath) {
  const objects = [];
  const seenKeys = new Set();
  const seenCursors = new Set();
  let cursor;
  do {
    const query = new URLSearchParams({ per_page: "1000" });
    if (cursor) query.set("cursor", cursor);
    const page = await cloudflare.json(`${sourcePath}/objects?${query}`, 16 * 1024 * 1024);
    if (
      !page.success ||
      !Array.isArray(page.result) ||
      typeof page.result_info?.is_truncated !== "boolean"
    )
      throw new Error("Invalid R2 object listing");
    for (const raw of page.result) {
      const item = sourceItem(raw);
      if (seenKeys.has(item.key)) throw new Error("Duplicate R2 object inventory key");
      seenKeys.add(item.key);
      objects.push(item);
    }
    if (page.result_info?.is_truncated === true) {
      cursor = page.result_info.cursor;
      if (typeof cursor !== "string" || !cursor || seenCursors.has(cursor))
        throw new Error("Invalid R2 pagination cursor");
      seenCursors.add(cursor);
    } else cursor = undefined;
  } while (cursor);
  return inventory(objects);
}

export async function restoreStorage(
  options,
  { execute = execFileSync, fetcher = fetch, environment = process.env, log = console.log } = {},
) {
  const {
    source,
    target,
    manifest,
    mode = "inspect",
    "cf-account": cfAccount,
    "aws-account": awsAccount,
    "aws-region": awsRegion,
  } = options;
  if (
    !source ||
    !target ||
    !manifest ||
    !["inspect", "copy", "verify"].includes(mode) ||
    !/^[a-f0-9]{32}$/.test(cfAccount ?? "") ||
    !/^\d{12}$/.test(awsAccount ?? "") ||
    !/^[a-z]{2}(?:-[a-z]+){1,3}-\d$/.test(awsRegion ?? "") ||
    !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(source) ||
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(target)
  ) {
    throw new Error(
      "Usage: --source R2_BUCKET --target S3_BUCKET --manifest /private/path/manifest.json --mode inspect|copy|verify --cf-account ACCOUNT_ID --aws-account ACCOUNT_ID --aws-region REGION",
    );
  }
  const identity = { direction: "r2-to-s3", source, target, cfAccount, awsAccount, awsRegion };
  const previous = await readManifest(manifest);
  if (previous && Object.entries(identity).some(([key, value]) => previous[key] !== value))
    throw new Error("Manifest belongs to a different direction, account, region or bucket pair");
  const checkpoints = checkpointWriter(manifest);
  const checkpoint = (report) => checkpoints.write(report);
  // Revoke any old verification gate before authentication or inventory reads.
  if (previous)
    await checkpoint({
      ...previous,
      mode,
      verifiedAt: null,
      allVerified: false,
      sourceStable: false,
      targetStable: false,
    });
  const cliEnv = {
    ...environment,
    WRANGLER_SEND_METRICS: "false",
    CLOUDFLARE_ACCOUNT_ID: cfAccount,
  };
  if (environment.CF_API_TOKEN) cliEnv.CLOUDFLARE_API_TOKEN = environment.CF_API_TOKEN;
  const command = (program, args) =>
    runCommand(execute, program, args, {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      env: cliEnv,
    });
  function aws(args) {
    const service = args[0] === "sts" ? "sts" : "s3";
    return parseCliJson(
      command("aws", [
        ...args,
        "--region",
        awsRegion,
        "--endpoint-url",
        `https://${service}.${awsRegion}.amazonaws.com`,
        "--output",
        "json",
        "--no-cli-pager",
      ]),
    );
  }
  let token;
  const cloudflare = cloudflareClient(fetcher, () => token);
  const sourcePath = `/accounts/${cfAccount}/r2/buckets/${encodeURIComponent(source)}`;
  const owner = ["--bucket", target, "--expected-bucket-owner", awsAccount];
  function targetInventory() {
    const contents = aws(["s3api", "list-objects-v2", ...owner]).Contents ?? [];
    if (!Array.isArray(contents)) throw new Error("Invalid S3 inventory");
    return new Map(
      contents.map((item) => [
        item.Key,
        { etag: item.ETag, size: item.Size, lastModified: item.LastModified },
      ]),
    );
  }
  const temporary = await mkdtemp(join(tmpdir(), "ubc-storage-restore-"));
  try {
    token = wranglerBearerToken((args) =>
      command(process.execPath, ["node_modules/wrangler/bin/wrangler.js", ...args]),
    );
    const account = await cloudflare.json(`/accounts/${cfAccount}`);
    if (!account.success || account.result?.id !== cfAccount)
      throw new Error("Cloudflare account identity mismatch");
    const bucket = await cloudflare.json(sourcePath);
    if (!bucket.success || bucket.result?.name !== source || !bucket.result.creation_date)
      throw new Error("R2 source bucket identity mismatch");
    const r2 =
      mode === "inspect"
        ? undefined
        : r2S3Transport({ account: cfAccount, bucket: source, environment, fetcher });
    const sourceCreatedAt = bucket.result.creation_date;
    if (previous?.sourceCreatedAt && previous.sourceCreatedAt !== sourceCreatedAt)
      throw new Error("R2 source bucket was recreated");
    if (aws(["sts", "get-caller-identity"]).Account !== awsAccount)
      throw new Error("AWS account identity mismatch");
    aws(["s3api", "head-bucket", ...owner]);
    const listing = await listR2Objects(cloudflare, sourcePath);
    const folders = listing.filter((item) => item.size === 0 && item.key.endsWith("/"));
    const images = listing.filter((item) => !folders.includes(item));
    const report = {
      ...identity,
      sourceCreatedAt,
      mode,
      verificationVersion: 1,
      verifiedAt: null,
      allVerified: false,
      sourceStable: false,
      targetStable: false,
      generatedAt: new Date().toISOString(),
      sourceCount: listing.length,
      imageCount: images.length,
      sourceBytes: images.reduce((sum, item) => sum + item.size, 0),
      ignoredFolderMarkers: folders.map((item) => item.key),
      objects: Object.create(null),
    };
    await checkpoint(report);
    const targetItems = mode === "inspect" ? new Map() : targetInventory();
    const context = { mode, r2, aws, owner, temporary, report, targetItems, checkpoint };
    for (const item of images) await restoreObject(context, item);
    report.sourceStable = same(listing, await listR2Objects(cloudflare, sourcePath));
    const finalTargets = mode === "inspect" ? new Map() : targetInventory();
    report.targetStable =
      mode !== "inspect" &&
      images.every((item) => same(report.objects[item.key]?.target, finalTargets.get(item.key)));
    report.allVerified =
      mode !== "inspect" &&
      report.sourceStable &&
      report.targetStable &&
      images.every((item) => report.objects[item.key]?.verified);
    if (mode === "verify" && report.allVerified) report.verifiedAt = new Date().toISOString();
    await checkpoint(report);
    log(
      JSON.stringify({
        mode,
        cfAccount,
        awsAccount,
        sourceCount: report.sourceCount,
        imageCount: report.imageCount,
        sourceBytes: report.sourceBytes,
        sourceStable: report.sourceStable,
        targetStable: report.targetStable,
        allVerified: report.allVerified,
      }),
    );
    if (!report.sourceStable || (mode !== "inspect" && !report.allVerified))
      throw new Error(
        "Source/target changed or rollback verification incomplete; repeat with writes paused",
      );
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
      mode: { type: "string", default: "inspect" },
      "cf-account": { type: "string" },
      "aws-account": { type: "string" },
      "aws-region": { type: "string" },
    },
  });
  try {
    await restoreStorage(values);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
