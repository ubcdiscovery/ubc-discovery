// Explicit, resumable S3 -> R2 copy. Never deletes source or destination objects.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

const maxBytes = 5 * 1024 * 1024;
const metadataProperties = { ContentType: ['--content-type', 'content-type'], CacheControl: ['--cache-control', 'cache-control'],
  ContentDisposition: ['--content-disposition', 'content-disposition'], ContentEncoding: ['--content-encoding', 'content-encoding'],
  ContentLanguage: ['--content-language', 'content-language'], Expires: ['--expires', 'expires'] };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function canonicalMetadata(value) {
  return Object.fromEntries(Object.entries(metadataProperties).map(([property, [, header]]) => {
    const raw = value instanceof Headers ? value.get(header) : value[property];
    if (property === 'Expires' && raw) {
      const date = new Date(raw);
      if (!Number.isFinite(date.getTime())) throw new Error('Invalid object Expires metadata');
      return [header, date.toUTCString()];
    }
    return [header, raw == null || raw === '' ? null : String(raw).trim()];
  }));
}
async function boundedBody(response, limit) {
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) {
    await response.body?.cancel();
    throw new Error('Cloudflare response exceeds supported size');
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
      if (size > limit) { await reader.cancel(); throw new Error('Cloudflare response exceeds supported size'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, size);
}

export async function migrateStorage(options, { execute = execFileSync, fetcher = fetch, environment = process.env, log = console.log } = {}) {
  const { source, target, manifest, mode = 'inspect', 'cf-account': cfAccount } = options;
  if (!source || !target || !manifest || !['inspect', 'copy', 'verify'].includes(mode)) {
    throw new Error('Usage: --source S3_BUCKET --target R2_BUCKET --manifest /private/path/manifest.json --mode inspect|copy|verify [--cf-account ACCOUNT_ID]');
  }
  if ((mode !== 'inspect' || cfAccount !== undefined) && !/^[a-f0-9]{32}$/.test(cfAccount ?? '')) {
    throw new Error('--cf-account must be an explicit 32-character lowercase hex account ID for copy/verify');
  }
  const wranglerEnvironment = { ...environment, WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_ACCOUNT_ID: cfAccount };
  if (environment.CF_API_TOKEN) wranglerEnvironment.CLOUDFLARE_API_TOKEN = environment.CF_API_TOKEN;
  let token;
  function command(program, args, commandOptions) {
    // Never propagate captured credentials or CLI stderr in subprocess exceptions.
    try { return execute(program, args, commandOptions); }
    catch { throw new Error(`${program === 'aws' ? 'AWS' : 'Wrangler'} command failed; check authentication and permissions`); }
  }
  function aws(args) {
    return JSON.parse(command('aws', [...args, '--output', 'json', '--no-cli-pager'], {
      encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    }));
  }
  function wrangler(args) {
    return command(process.execPath, ['node_modules/wrangler/bin/wrangler.js', ...args], {
      encoding: 'utf8', maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], env: wranglerEnvironment,
    });
  }
  async function cloudflareGet(path) {
    let response;
    try { response = await fetcher(`https://api.cloudflare.com/client/v4${path}`, {
      headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(30_000),
    }); } catch { throw new Error('Cloudflare read failed; check connectivity and authentication'); }
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new Error(`Cloudflare read failed (HTTP ${response.status}); check account, object and permissions`);
    }
    return response;
  }
  let previous;
  try { previous = JSON.parse(await readFile(manifest, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (previous && (previous.source !== source || previous.target !== target ||
    (previous.cfAccount && previous.cfAccount !== cfAccount))) throw new Error('Manifest belongs to a different account or bucket pair');
  async function writeCheckpoint(report) {
    await writeFile(`${manifest}.tmp`, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    await rename(`${manifest}.tmp`, manifest);
  }
  // A failed auth/account/inventory request must not leave a previous cutover gate valid.
  if (previous) await writeCheckpoint({ ...previous, mode, verifiedAt: null, allVerified: false, sourceStable: false });
  const temporary = await mkdtemp(join(tmpdir(), 'ubc-storage-copy-'));
  try {
    if (mode !== 'inspect') {
      let auth;
      try { auth = JSON.parse(wrangler(['auth', 'token', '--json'])); }
      catch { throw new Error('Cannot retrieve Wrangler bearer token; use wrangler login or CLOUDFLARE_API_TOKEN'); }
      if (!['oauth', 'api_token'].includes(auth.type) || typeof auth.token !== 'string' || !auth.token.trim()) {
        throw new Error('A Cloudflare OAuth/API bearer token is required; API key/email authentication is unsupported');
      }
      token = auth.token;
      wranglerEnvironment.CLOUDFLARE_API_TOKEN = token;
      const account = JSON.parse((await boundedBody(await cloudflareGet(`/accounts/${cfAccount}`), 64 * 1024)).toString('utf8'));
      if (!account.success || account.result?.id !== cfAccount) throw new Error('Cloudflare account identity mismatch');
    }
    const identity = aws(['sts', 'get-caller-identity']);
    const sourceListing = aws(['s3api', 'list-objects-v2', '--bucket', source]).Contents ?? [];
    // S3 console folders are zero-byte marker objects, not application images.
    const folderMarkers = sourceListing.filter(item => item.Size === 0 && item.Key.endsWith('/'));
    const listing = sourceListing.filter(item => !(item.Size === 0 && item.Key.endsWith('/')));
    if (previous && previous.awsAccount !== identity.Account) throw new Error('Manifest belongs to a different account or bucket pair');
    const report = { source, target, cfAccount, mode, verifiedAt: null, verificationVersion: 2, allVerified: false, sourceStable: false,
      awsAccount: identity.Account, generatedAt: new Date().toISOString(), objects: Object.create(null), sourceCount: sourceListing.length,
      imageCount: listing.length, ignoredFolderMarkers: folderMarkers.map(item => item.Key), sourceBytes: listing.reduce((sum, object) => sum + object.Size, 0) };
    const checkpoint = () => writeCheckpoint(report);
    // Invalidate an old cutover gate before any attempted verification can fail.
    await checkpoint();
    // Sequential copy bounds memory and CLI processes. Final verify always re-reads both stores.
    for (const item of listing) {
      if (!Number.isSafeInteger(item.Size) || item.Size < 1 || item.Size > maxBytes) {
        throw new Error(`Source exceeds the supported image size: ${item.Key}`);
      }
      const old = previous?.objects?.[item.Key];
      const unchanged = old?.etag === item.ETag && old.size === item.Size && old.lastModified === item.LastModified;
      if (mode === 'inspect' || (mode === 'copy' && previous?.cfAccount === cfAccount && unchanged && old.verified && old.httpMetadataVerified)) {
        report.objects[item.Key] = unchanged ? old : { etag: item.ETag, size: item.Size, lastModified: item.LastModified, verified: false };
        continue;
      }
      const sourceFile = join(temporary, 'source');
      const metadata = aws(['s3api', 'get-object', '--bucket', source, '--key', item.Key, '--if-match', item.ETag, sourceFile]);
      if (metadata.ETag !== item.ETag || metadata.ContentLength !== item.Size || metadata.LastModified !== item.LastModified) {
        throw new Error(`Source changed during copy: ${item.Key}; refresh inventory and retry`);
      }
      if (metadata.ContentEncoding) throw new Error(`Encoded source images are unsupported by the media runtime: ${item.Key}`);
      if (item.Key.split('/').some(part => part === '.' || part === '..')) throw new Error(`Unsupported object key: ${item.Key}`);
      if (Object.keys(metadata.Metadata ?? {}).length) throw new Error(`Custom metadata requires a separate preservation path: ${item.Key}`);
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(metadata.ContentType)) throw new Error(`Unsupported source image MIME type: ${item.Key}`);
      const sourceBytes = await readFile(sourceFile);
      if (sourceBytes.length !== item.Size) throw new Error(`Source byte count mismatch: ${item.Key}`);
      const sourceHash = sha256(sourceBytes);
      const httpMetadata = canonicalMetadata(metadata);
      const metadataFlags = [];
      for (const [property, [flag]] of Object.entries(metadataProperties)) {
        if (metadata[property]) metadataFlags.push(flag, String(metadata[property]));
      }
      if (mode === 'copy') wrangler(['r2', 'object', 'put', `${target}/${item.Key}`, '--file', sourceFile, ...metadataFlags, '--remote']);
      // REST returns HTTP metadata; Wrangler object get returns only bytes. Literal key slashes are required.
      const objectPath = item.Key.split('/').map(encodeURIComponent).join('/');
      const response = await cloudflareGet(`/accounts/${cfAccount}/r2/buckets/${encodeURIComponent(target)}/objects/${objectPath}`);
      if (JSON.stringify(canonicalMetadata(response.headers)) !== JSON.stringify(httpMetadata)) {
        await response.body?.cancel();
        throw new Error(`R2 HTTP metadata mismatch: ${item.Key}`);
      }
      const targetBytes = await boundedBody(response, maxBytes);
      if (targetBytes.length !== item.Size || sha256(targetBytes) !== sourceHash) throw new Error(`R2 content mismatch: ${item.Key}`);
      report.objects[item.Key] = { etag: item.ETag, size: item.Size, sha256: sourceHash, contentType: metadata.ContentType,
        lastModified: item.LastModified, httpMetadata, httpMetadataVerified: true, verified: true };
      await checkpoint();
    }
    // Include LastModified: metadata-only S3 replacement can preserve size and ETag.
    const finalListing = aws(['s3api', 'list-objects-v2', '--bucket', source]).Contents ?? [];
    const inventory = objects => objects.map(object => [object.Key, object.ETag, object.Size, object.LastModified]).sort((a, b) => a[0].localeCompare(b[0]));
    report.sourceStable = JSON.stringify(inventory(sourceListing)) === JSON.stringify(inventory(finalListing));
    report.allVerified = report.sourceStable && listing.every(item => report.objects[item.Key]?.verified && report.objects[item.Key]?.httpMetadataVerified);
    if (mode === 'verify' && report.allVerified) report.verifiedAt = new Date().toISOString();
    await checkpoint();
    log(JSON.stringify({ mode, cfAccount, sourceCount: report.sourceCount, imageCount: report.imageCount,
      ignoredFolderMarkers: folderMarkers.length, sourceBytes: report.sourceBytes, sourceStable: report.sourceStable, allVerified: report.allVerified }));
    if (!report.sourceStable || (mode === 'verify' && !report.allVerified)) throw new Error('Source changed or verification incomplete; repeat after writes are paused');
    return report;
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: {
    source: { type: 'string' }, target: { type: 'string' }, manifest: { type: 'string' },
    'cf-account': { type: 'string' }, mode: { type: 'string', default: 'inspect' },
  } });
  try { await migrateStorage(values); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
