import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrateStorage } from '../scripts/migrate-storage.mjs';

const account = 'a'.repeat(32);
const bytes = Buffer.from([1, 2, 3]);
const key = 'event-pictures/a +?#%.webp';
const modified = '2026-10-12T00:00:00+00:00';
const temporary = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function fixture(overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'migration-test-'));
  temporary.push(directory);
  const manifest = join(directory, 'manifest.json');
  const item = { Key: key, Size: bytes.length, ETag: '"s3-etag"', LastModified: modified };
  const metadata = { ETag: item.ETag, ContentLength: item.Size, LastModified: modified, ContentType: 'image/webp',
    CacheControl: 'public, max-age=60', ContentDisposition: 'inline', ContentLanguage: 'en', Expires: '2026-11-01T00:00:00+00:00', ...overrides.metadata };
  let lists = 0;
  const execute = vi.fn((program, args, options) => {
    if (program === 'aws') {
      if (args[0] === 'sts') return JSON.stringify({ Account: '123456789012' });
      if (args[1] === 'list-objects-v2') return JSON.stringify({ Contents: [lists++ ? { ...item, ...overrides.finalItem } : item, { Key: 'folder/', Size: 0 }] });
      if (args[1] === 'get-object') { expect(args[args.indexOf('--if-match') + 1]).toBe(item.ETag); writeFileSync(args[args.indexOf('--output') - 1], bytes); return JSON.stringify(metadata); }
      throw new Error('Unexpected AWS mock call');
    }
    if (args.includes('auth')) return JSON.stringify({ type: 'oauth', token: 'mock-secret-token' });
    expect(args).toContain('put');
    expect(args).toContain('--remote');
    expect(options.env.CLOUDFLARE_ACCOUNT_ID).toBe(account);
    expect(options.env.CLOUDFLARE_API_TOKEN).toBe('mock-secret-token');
    return '';
  });
  const headers = { 'content-type': metadata.ContentType, 'cache-control': metadata.CacheControl,
    'content-disposition': metadata.ContentDisposition, 'content-language': metadata.ContentLanguage,
    expires: 'Sun, 01 Nov 2026 00:00:00 GMT', ...overrides.headers };
  const fetcher = vi.fn(async (url, options) => {
    expect(options.headers.Authorization).toBe('Bearer mock-secret-token');
    expect(options.redirect).toBe('error');
    if (url === `https://api.cloudflare.com/client/v4/accounts/${account}`) {
      return Response.json({ success: true, result: { id: overrides.accountId ?? account } });
    }
    expect(url).toBe(`https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/target-bucket/objects/event-pictures/a%20%2B%3F%23%25.webp`);
    return overrides.response?.() ?? new Response(overrides.bytes ?? bytes, { status: overrides.status ?? 200, headers });
  });
  const log = vi.fn();
  return { manifest, item, metadata, execute, fetcher, log,
    options: { source: 'source-bucket', target: 'target-bucket', manifest, mode: 'verify', 'cf-account': account },
    deps: { execute, fetcher, log, environment: { CLOUDFLARE_ACCOUNT_ID: 'b'.repeat(32) } } };
}

describe('storage migration cutover verification', () => {
  it('checks account, hashes, full HTTP metadata, literal key slashes, and skips folder markers without writes', async () => {
    const f = await fixture();
    const report = await migrateStorage(f.options, f.deps);
    expect(report).toMatchObject({ cfAccount: account, sourceStable: true, allVerified: true, imageCount: 1, sourceCount: 2, verificationVersion: 2, mode: 'verify' });
    expect(report.verifiedAt).toMatch(/^202[0-9]-/);
    expect(report.objects[key]).toMatchObject({ verified: true, httpMetadataVerified: true, lastModified: modified,
      httpMetadata: { 'content-type': 'image/webp', 'content-encoding': null, expires: 'Sun, 01 Nov 2026 00:00:00 GMT' } });
    expect(f.execute.mock.calls.filter(([program]) => program !== 'aws')).toHaveLength(1);
    expect(JSON.stringify(report) + JSON.stringify(f.log.mock.calls)).not.toContain('mock-secret-token');
  });
  it('pins the same account and bearer token for copies, preserving HTTP metadata flags', async () => {
    const f = await fixture();
    const report = await migrateStorage({ ...f.options, mode: 'copy' }, f.deps);
    expect(report.verifiedAt).toBeNull();
    const [, args] = f.execute.mock.calls.find(([, args]) => args.includes('put'));
    expect(args).toEqual(expect.arrayContaining(['--content-type', 'image/webp', '--cache-control', 'public, max-age=60', '--expires', f.metadata.Expires]));
  });
  it.each(['content-type', 'cache-control', 'content-disposition', 'content-language', 'expires', 'content-encoding'])('rejects target %s changes even with identical bytes', async header => {
    const f = await fixture({ headers: { [header]: header === 'expires' ? 'Mon, 02 Nov 2026 00:00:00 GMT' : 'wrong' } });
    await expect(migrateStorage(f.options, f.deps)).rejects.toThrow('HTTP metadata mismatch');
    expect(JSON.parse(await readFile(f.manifest, 'utf8')).allVerified).toBe(false);
  });
  it('rejects byte corruption', async () => {
    const f = await fixture({ bytes: Buffer.from([1, 2, 4]) });
    await expect(migrateStorage(f.options, f.deps)).rejects.toThrow('content mismatch');
  });
  it('rejects encoded S3 images before writing to R2', async () => {
    const f = await fixture({ metadata: { ContentEncoding: 'gzip' } });
    await expect(migrateStorage({ ...f.options, mode: 'copy' }, f.deps)).rejects.toThrow('Encoded source images');
    expect(f.execute.mock.calls.some(([, args]) => args.includes('put'))).toBe(false);
  });
  it('requires an explicit account before authentication or copying', async () => {
    const f = await fixture();
    await expect(migrateStorage({ ...f.options, 'cf-account': undefined }, f.deps)).rejects.toThrow('--cf-account');
    expect(f.execute).not.toHaveBeenCalled();
    expect(f.fetcher).not.toHaveBeenCalled();
  });
  it('fails account identity mismatch before source or destination writes', async () => {
    const f = await fixture({ accountId: 'b'.repeat(32) });
    await expect(migrateStorage({ ...f.options, mode: 'copy' }, f.deps)).rejects.toThrow('identity mismatch');
    expect(f.execute.mock.calls.some(([program]) => program === 'aws')).toBe(false);
  });
  it('rejects manifests pinned to another account', async () => {
    const f = await fixture();
    await writeFile(f.manifest, JSON.stringify({ source: 'source-bucket', target: 'target-bucket', awsAccount: '123456789012', cfAccount: 'b'.repeat(32) }));
    await expect(migrateStorage(f.options, f.deps)).rejects.toThrow('different account');
  });
  it('detects metadata-only source modifications in final inventory', async () => {
    const f = await fixture({ finalItem: { LastModified: '2026-10-12T00:01:00+00:00' } });
    await expect(migrateStorage(f.options, f.deps)).rejects.toThrow('Source changed');
    expect(JSON.parse(await readFile(f.manifest, 'utf8')).allVerified).toBe(false);
  });
  it('re-copies metadata-only updates instead of resuming on matching ETag/size', async () => {
    const f = await fixture();
    await writeFile(f.manifest, JSON.stringify({ source: 'source-bucket', target: 'target-bucket', awsAccount: '123456789012', cfAccount: account,
      objects: { [key]: { verified: true, httpMetadataVerified: true, etag: f.item.ETag, size: bytes.length, lastModified: '2026-10-11T00:00:00+00:00' } } }));
    await migrateStorage({ ...f.options, mode: 'copy' }, f.deps);
    expect(f.execute.mock.calls.some(([, args]) => args.includes('put'))).toBe(true);
  });
  it('always re-reads targets on final verify even with a verified copy checkpoint', async () => {
    const f = await fixture();
    await migrateStorage({ ...f.options, mode: 'copy' }, f.deps);
    f.fetcher.mockClear();
    await migrateStorage(f.options, f.deps);
    expect(f.fetcher).toHaveBeenCalledTimes(2);
  });
  it.each(['declared', 'streamed'])('bounds %s object bodies to five MiB', async kind => {
    const f = await fixture({ response: () => new Response(kind === 'streamed' ? Buffer.alloc(5 * 1024 * 1024 + 1) : bytes,
      { headers: { 'content-type': 'image/webp', 'cache-control': 'public, max-age=60', 'content-disposition': 'inline', 'content-language': 'en',
        expires: 'Sun, 01 Nov 2026 00:00:00 GMT', ...(kind === 'declared' ? { 'content-length': String(5 * 1024 * 1024 + 1) } : {}) } }) });
    await expect(migrateStorage(f.options, f.deps)).rejects.toThrow('exceeds supported size');
  });
  it('does not expose subprocess credentials on authentication failures', async () => {
    const f = await fixture();
    await writeFile(f.manifest, JSON.stringify({ source: 'source-bucket', target: 'target-bucket', awsAccount: '123456789012', cfAccount: account, allVerified: true }));
    f.execute.mockImplementation(() => { throw new Error('captured mock-secret-token'); });
    await expect(migrateStorage(f.options, f.deps)).rejects.toThrow('Cannot retrieve Wrangler bearer token');
    expect(JSON.parse(await readFile(f.manifest, 'utf8')).allVerified).toBe(false);
  });
});
