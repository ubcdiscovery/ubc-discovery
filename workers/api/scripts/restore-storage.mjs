// Paused-write R2 -> S3 rollback copy. Never deletes either store's objects.
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rename, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { r2S3Transport } from './r2-s3.mjs';

const maxBytes = 5 * 1024 * 1024;
const metadataFields = [
  ['content-type', 'contentType', 'ContentType', '--content-type'],
  ['cache-control', 'cacheControl', 'CacheControl', '--cache-control'],
  ['content-disposition', 'contentDisposition', 'ContentDisposition', '--content-disposition'],
  ['content-encoding', 'contentEncoding', 'ContentEncoding', '--content-encoding'],
  ['content-language', 'contentLanguage', 'ContentLanguage', '--content-language'],
  ['expires', 'cacheExpiry', 'Expires', '--expires'],
];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function metadata(value, format) {
  return Object.fromEntries(metadataFields.map(([header, r2, s3]) => {
    let raw = format === 'headers' ? value.get(header) : value[format === 'r2' ? r2 : s3];
    if (format === 's3' && header === 'expires') raw = value.ExpiresString ?? raw;
    if (raw != null && typeof raw !== 'string') throw new Error('Invalid HTTP metadata');
    if (header === 'expires' && raw) {
      const date = new Date(raw);
      if (!Number.isFinite(date.getTime())) throw new Error('Invalid object expiry metadata');
      raw = date.toUTCString();
    }
    return [header, raw == null || raw === '' ? null : raw.trim()];
  }));
}
function safeKey(key) {
  if (typeof key !== 'string' || !key || Buffer.byteLength(key) > 1024 || key.startsWith('/') || key.includes('\\') ||
      /[\u0000-\u001f\u007f]/.test(key) || key.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Unsupported object key');
}
function sourceItem(item) {
  if (!item || typeof item.key !== 'string' || !Number.isSafeInteger(item.size) || item.size < 0 ||
      typeof item.etag !== 'string' || !item.etag || /[\r\n"]/.test(item.etag) ||
      typeof item.last_modified !== 'string' || !Number.isFinite(Date.parse(item.last_modified))) throw new Error('Incomplete R2 object inventory');
  const custom = item.custom_metadata ?? {};
  if (!custom || typeof custom !== 'object' || Array.isArray(custom)) throw new Error('Invalid R2 custom metadata');
  return { key: item.key, size: item.size, etag: item.etag, lastModified: item.last_modified,
    httpMetadata: metadata(item.http_metadata ?? {}, 'r2'),
    customMetadata: Object.fromEntries(Object.entries(custom).sort(([a], [b]) => a.localeCompare(b))), ssec: item.ssec ?? false };
}
function inventory(items) { return [...items].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0); }
async function boundedBody(response, limit) {
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit)) {
    await response.body?.cancel(); throw new Error('Cloudflare response exceeds supported size');
  }
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks = [];
  let size = 0;
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

export async function restoreStorage(options, { execute = execFileSync, fetcher = fetch, environment = process.env, log = console.log } = {}) {
  const { source, target, manifest, mode = 'inspect', 'cf-account': cfAccount, 'aws-account': awsAccount, 'aws-region': awsRegion } = options;
  if (!source || !target || !manifest || !['inspect', 'copy', 'verify'].includes(mode) ||
      !/^[a-f0-9]{32}$/.test(cfAccount ?? '') || !/^\d{12}$/.test(awsAccount ?? '') || !/^[a-z]{2}(?:-[a-z]+){1,3}-\d$/.test(awsRegion ?? '') ||
      !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(source) || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(target)) {
    throw new Error('Usage: --source R2_BUCKET --target S3_BUCKET --manifest /private/path/manifest.json --mode inspect|copy|verify --cf-account ACCOUNT_ID --aws-account ACCOUNT_ID --aws-region REGION');
  }
  const identity = { direction: 'r2-to-s3', source, target, cfAccount, awsAccount, awsRegion };
  let previous;
  try { previous = JSON.parse(await readFile(manifest, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('Cannot read rollback manifest'); }
  if (previous && Object.entries(identity).some(([key, value]) => previous[key] !== value)) throw new Error('Manifest belongs to a different direction, account, region or bucket pair');
  async function checkpoint(report) {
    const temporaryManifest = `${manifest}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryManifest, JSON.stringify(report, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
      await rename(temporaryManifest, manifest);
    } finally { await rm(temporaryManifest, { force: true }); }
  }
  // Revoke any old verification gate before authentication or inventory reads.
  if (previous) await checkpoint({ ...previous, mode, verifiedAt: null, allVerified: false, sourceStable: false, targetStable: false });
  const cliEnv = { ...environment, WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_ACCOUNT_ID: cfAccount };
  if (environment.CF_API_TOKEN) cliEnv.CLOUDFLARE_API_TOKEN = environment.CF_API_TOKEN;
  function command(program, args) {
    try { return execute(program, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], env: cliEnv }); }
    catch { throw new Error(`${program === 'aws' ? 'AWS' : 'Wrangler'} command failed; check authentication and permissions`); }
  }
  function aws(args) {
    const service = args[0] === 'sts' ? 'sts' : 's3';
    const text = command('aws', [...args, '--region', awsRegion, '--endpoint-url', `https://${service}.${awsRegion}.amazonaws.com`, '--output', 'json', '--no-cli-pager']);
    try { return text.trim() ? JSON.parse(text) : {}; } catch { throw new Error('Invalid AWS CLI response'); }
  }
  let token;
  async function cfGet(path) {
    let response;
    try { response = await fetcher(`https://api.cloudflare.com/client/v4${path}`, {
      headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(30_000),
    }); } catch { throw new Error('Cloudflare read failed; check connectivity and authentication'); }
    if (response.status !== 200) { await response.body?.cancel(); throw new Error(`Cloudflare read failed (HTTP ${response.status}); check account, object and permissions`); }
    return response;
  }
  async function cfJson(path, limit = 1024 * 1024) {
    try { return JSON.parse((await boundedBody(await cfGet(path), limit)).toString('utf8')); }
    catch (error) { if (error.message.startsWith('Cloudflare')) throw error; throw new Error('Invalid Cloudflare API response'); }
  }
  const sourcePath = `/accounts/${cfAccount}/r2/buckets/${encodeURIComponent(source)}`;
  async function sourceInventory() {
    const objects = [];
    const seenKeys = new Set();
    const seenCursors = new Set();
    let cursor;
    do {
      const query = new URLSearchParams({ per_page: '1000' });
      if (cursor) query.set('cursor', cursor);
      const page = await cfJson(`${sourcePath}/objects?${query}`, 16 * 1024 * 1024);
      if (!page.success || !Array.isArray(page.result) || typeof page.result_info?.is_truncated !== 'boolean') throw new Error('Invalid R2 object listing');
      for (const raw of page.result) {
        const item = sourceItem(raw);
        if (seenKeys.has(item.key)) throw new Error('Duplicate R2 object inventory key');
        seenKeys.add(item.key); objects.push(item);
      }
      if (page.result_info?.is_truncated === true) {
        cursor = page.result_info.cursor;
        if (typeof cursor !== 'string' || !cursor || seenCursors.has(cursor)) throw new Error('Invalid R2 pagination cursor');
        seenCursors.add(cursor);
      } else cursor = undefined;
    } while (cursor);
    return inventory(objects);
  }
  const owner = ['--bucket', target, '--expected-bucket-owner', awsAccount];
  function targetInventory() {
    const contents = aws(['s3api', 'list-objects-v2', ...owner]).Contents ?? [];
    if (!Array.isArray(contents)) throw new Error('Invalid S3 inventory');
    return new Map(contents.map(item => [item.Key, { etag: item.ETag, size: item.Size, lastModified: item.LastModified }]));
  }
  const temporary = await mkdtemp(join(tmpdir(), 'ubc-storage-restore-'));
  try {
    let auth;
    try { auth = JSON.parse(command(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'auth', 'token', '--json'])); }
    catch { throw new Error('Cannot retrieve Wrangler bearer token; use wrangler login or CLOUDFLARE_API_TOKEN'); }
    if (!['oauth', 'api_token'].includes(auth.type) || typeof auth.token !== 'string' || !auth.token.trim()) throw new Error('A Cloudflare OAuth/API bearer token is required');
    token = auth.token;
    const account = await cfJson(`/accounts/${cfAccount}`);
    if (!account.success || account.result?.id !== cfAccount) throw new Error('Cloudflare account identity mismatch');
    const bucket = await cfJson(sourcePath);
    if (!bucket.success || bucket.result?.name !== source || !bucket.result.creation_date) throw new Error('R2 source bucket identity mismatch');
    const r2 = mode === 'inspect' ? undefined : r2S3Transport({ account: cfAccount, bucket: source, environment, fetcher });
    const sourceCreatedAt = bucket.result.creation_date;
    if (previous?.sourceCreatedAt && previous.sourceCreatedAt !== sourceCreatedAt) throw new Error('R2 source bucket was recreated');
    if (aws(['sts', 'get-caller-identity']).Account !== awsAccount) throw new Error('AWS account identity mismatch');
    aws(['s3api', 'head-bucket', ...owner]);
    const listing = await sourceInventory();
    const folders = listing.filter(item => item.size === 0 && item.key.endsWith('/'));
    const images = listing.filter(item => !folders.includes(item));
    const report = { ...identity, sourceCreatedAt, mode, verificationVersion: 1, verifiedAt: null, allVerified: false,
      sourceStable: false, targetStable: false, generatedAt: new Date().toISOString(), sourceCount: listing.length,
      imageCount: images.length, sourceBytes: images.reduce((sum, item) => sum + item.size, 0), ignoredFolderMarkers: folders.map(item => item.key), objects: Object.create(null) };
    await checkpoint(report);
    const targetItems = mode === 'inspect' ? new Map() : targetInventory();
    const targetFile = join(temporary, 'target');
    function readTarget(key, item) {
      if (!item || !Number.isSafeInteger(item.size) || item.size < 1 || item.size > maxBytes) return null;
      const headers = aws(['s3api', 'get-object', ...owner, '--key', key, '--if-match', item.etag, '--range', `bytes=0-${maxBytes}`, targetFile]);
      return { headers, item: { etag: headers.ETag, size: headers.ContentLength, lastModified: headers.LastModified } };
    }
    for (const item of images) {
      safeKey(item.key);
      if (!Number.isSafeInteger(item.size) || item.size < 1 || item.size > maxBytes) throw new Error('Source exceeds supported image size');
      if (item.ssec || Object.keys(item.customMetadata).length) throw new Error('Encrypted/custom metadata source images require separate preservation');
      if (item.httpMetadata['content-encoding']) throw new Error('Encoded source images are unsupported');
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(item.httpMetadata['content-type'])) throw new Error('Unsupported source image MIME type');
      if (mode === 'inspect') { report.objects[item.key] = { source: item, verified: false }; continue; }
      const sourceResponse = await r2('GET', item.key, { headers: { 'if-match': `"${item.etag}"` } });
      if ([...sourceResponse.headers.keys()].some(name => name.startsWith('x-amz-meta-')) || sourceResponse.headers.get('etag') !== `"${item.etag}"` || !same(metadata(sourceResponse.headers, 'headers'), item.httpMetadata) ||
          Math.floor(Date.parse(sourceResponse.headers.get('last-modified')) / 1000) !== Math.floor(Date.parse(item.lastModified) / 1000)) {
        await sourceResponse.body?.cancel(); throw new Error('R2 source changed during restore');
      }
      const bytes = await boundedBody(sourceResponse, maxBytes);
      if (bytes.length !== item.size) throw new Error('R2 source size mismatch');
      const sourceHash = hash(bytes);
      let targetResult = readTarget(item.key, targetItems.get(item.key));
      async function targetMatches() {
        if (!targetResult || targetResult.headers.ContentLength !== item.size || Object.keys(targetResult.headers.Metadata ?? {}).length ||
            !same(metadata(targetResult.headers, 's3'), item.httpMetadata)) return false;
        if ((await stat(targetFile)).size > maxBytes) throw new Error('S3 object exceeds supported size');
        return hash(await readFile(targetFile)) === sourceHash;
      }
      let matches = await targetMatches();
      let copied = false;
      if (!matches && mode === 'copy') {
        const sourceFile = join(temporary, 'source');
        await writeFile(sourceFile, bytes, { mode: 0o600 });
        const flags = metadataFields.flatMap(([header, , , flag]) => item.httpMetadata[header] ? [flag, item.httpMetadata[header]] : []);
        const written = aws(['s3api', 'put-object', ...owner, '--key', item.key, '--body', sourceFile, ...flags]);
        if (!written.ETag) throw new Error('Invalid S3 upload response');
        targetResult = readTarget(item.key, { etag: written.ETag, size: item.size });
        matches = await targetMatches(); copied = true;
      }
      if (!matches || !targetResult?.item.lastModified) throw new Error('S3 rollback bytes or HTTP metadata mismatch');
      report.objects[item.key] = { source: item, sha256: sourceHash, target: targetResult.item, copied, verified: true, httpMetadataVerified: true };
      await checkpoint(report);
    }
    report.sourceStable = same(listing, await sourceInventory());
    const finalTargets = mode === 'inspect' ? new Map() : targetInventory();
    report.targetStable = mode !== 'inspect' && images.every(item => same(report.objects[item.key]?.target, finalTargets.get(item.key)));
    report.allVerified = mode !== 'inspect' && report.sourceStable && report.targetStable && images.every(item => report.objects[item.key]?.verified);
    if (mode === 'verify' && report.allVerified) report.verifiedAt = new Date().toISOString();
    await checkpoint(report);
    log(JSON.stringify({ mode, cfAccount, awsAccount, sourceCount: report.sourceCount, imageCount: report.imageCount, sourceBytes: report.sourceBytes,
      sourceStable: report.sourceStable, targetStable: report.targetStable, allVerified: report.allVerified }));
    if (!report.sourceStable || (mode !== 'inspect' && !report.allVerified)) throw new Error('Source/target changed or rollback verification incomplete; repeat with writes paused');
    return report;
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { source: { type: 'string' }, target: { type: 'string' }, manifest: { type: 'string' },
    mode: { type: 'string', default: 'inspect' }, 'cf-account': { type: 'string' }, 'aws-account': { type: 'string' }, 'aws-region': { type: 'string' } } });
  try { await restoreStorage(values); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
