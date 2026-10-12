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
      expect(args[args.indexOf('--expected-bucket-owner') + 1]).toBe('123456789012');
      if (args[1] === 'head-bucket') return '{}';
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
  const fetcher = vi.fn(async (input, options) => {
    if (input instanceof Request) {
      expect(input.url).toBe(`https://${account}.r2.cloudflarestorage.com/target-bucket/event-pictures/a%20%2B%3F%23%25.webp`);
      expect(input.headers.get('authorization')).toContain('Credential=r2-test-access/');
      expect(input.headers.get('authorization')).not.toContain('mock-secret-token');
      expect(options.redirect).toBe('error');
      if (input.method === 'PUT') return new Response(null);
      return overrides.response?.() ?? new Response(overrides.bytes ?? bytes, { status: overrides.status ?? 200, headers });
    }
    expect(options.headers.Authorization).toBe('Bearer mock-secret-token');
    expect(options.redirect).toBe('error');
    if (input === `https://api.cloudflare.com/client/v4/accounts/${account}`) {
      return Response.json({ success: true, result: { id: overrides.accountId ?? account } });
    }
    expect(input).toBe(`https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/target-bucket`);
    return Response.json({ success: true, result: { name: 'target-bucket' } });
  });
  const log = vi.fn();
  return { manifest, item, metadata, execute, fetcher, log,
    options: { source: 'source-bucket', target: 'target-bucket', manifest, mode: 'verify', 'cf-account': account },
    deps: { execute, fetcher, log, environment: { CLOUDFLARE_ACCOUNT_ID: 'b'.repeat(32), R2_ACCESS_KEY_ID: 'r2-test-access', R2_SECRET_ACCESS_KEY: 'r2-test-secret' } } };
}

describe('storage migration cutover verification', () => {
  it('checks account, hashes, full HTTP metadata, literal key slashes, and skips folder markers without writes', async () => {
    const f = await fixture();
    const report = await migrateStorage(f.options, f.deps);
    expect(report).toMatchObject({ cfAccount: account, sourceStable: true, allVerified: true, imageCount: 1, sourceCount: 2, verificationVersion: 3, mode: 'verify' });
    expect(report.verifiedAt).toMatch(/^202[0-9]-/);
    expect(report.objects[key]).toMatchObject({ verified: true, httpMetadataVerified: true, lastModified: modified,
      httpMetadata: { 'content-type': 'image/webp', 'content-encoding': null, expires: 'Sun, 01 Nov 2026 00:00:00 GMT' } });
    expect(f.execute.mock.calls.filter(([program]) => program !== 'aws')).toHaveLength(1);
    expect(JSON.stringify(report) + JSON.stringify(f.log.mock.calls)).not.toContain('mock-secret-token');
  });
  it('signs direct R2 PUT with separate scoped credentials and preserves stored HTTP metadata', async () => {
    const f = await fixture();
    const report = await migrateStorage({ ...f.options, mode: 'copy' }, f.deps);
    expect(report.verifiedAt).toBeNull();
    const [request] = f.fetcher.mock.calls.find(([input]) => input instanceof Request && input.method === 'PUT');
    expect(request.headers.get('content-type')).toBe('image/webp');
    expect(request.headers.get('cache-control')).toBe('public, max-age=60');
    expect(request.headers.get('expires')).toBe('Sun, 01 Nov 2026 00:00:00 GMT');
    expect(Buffer.from(await request.arrayBuffer())).toEqual(bytes);
    expect(f.execute.mock.calls.filter(([program]) => program !== 'aws')).toHaveLength(1);
  });
  it('never uses management GET download wrappers as stored metadata', async () => {
    const f = await fixture({ metadata: { CacheControl: undefined, ContentDisposition: undefined }, headers: { 'cache-control': undefined, 'content-disposition': undefined } });
    // Explicitly remove absent HTTP fields instead of serializing "undefined".
    f.fetcher.mockImplementation(async input => {
      if (input instanceof Request) return new Response(bytes, { headers: { 'content-type': 'image/webp', 'content-language': 'en', expires: 'Sun, 01 Nov 2026 00:00:00 GMT' } });
      if (input.endsWith(`/accounts/${account}`)) return Response.json({ success: true, result: { id: account } });
      if (input.endsWith('/buckets/target-bucket')) return Response.json({ success: true, result: { name: 'target-bucket' } });
      throw new Error('Management GET would inject cache-control:no-store and attachment disposition');
    });
    expect((await migrateStorage(f.options, f.deps)).allVerified).toBe(true);
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
    expect(f.fetcher.mock.calls.some(([input]) => input instanceof Request && input.method === 'PUT')).toBe(false);
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
    expect(f.fetcher.mock.calls.some(([input]) => input instanceof Request && input.method === 'PUT')).toBe(true);
  });
  it('always re-reads targets on final verify even with a verified copy checkpoint', async () => {
    const f = await fixture();
    await migrateStorage({ ...f.options, mode: 'copy' }, f.deps);
    f.fetcher.mockClear();
    await migrateStorage(f.options, f.deps);
    expect(f.fetcher).toHaveBeenCalledTimes(3);
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
  it('requires dedicated R2 credentials instead of falling back to AWS or management credentials', async () => {
    const f = await fixture(); delete f.deps.environment.R2_SECRET_ACCESS_KEY;
    await expect(migrateStorage({ ...f.options, mode: 'copy' }, f.deps)).rejects.toThrow('scoped S3 credentials');
    expect(f.fetcher.mock.calls.some(([input]) => input instanceof Request)).toBe(false);
  });
  it('rejects extra target custom metadata rather than claiming an exact preservation', async () => {
    const f = await fixture({ headers: { 'x-amz-meta-private': 'unexpected' } });
    await expect(migrateStorage(f.options, f.deps)).rejects.toThrow('HTTP metadata mismatch');
  });
  it('rechecks corruption on resumed version-three copies and repairs it', async () => {
    const f = await fixture(); await migrateStorage({ ...f.options, mode: 'copy' }, f.deps);
    const report = JSON.parse(await readFile(f.manifest, 'utf8')); expect(report.verificationVersion).toBe(3);
    let gets = 0; const original = f.fetcher;
    f.deps.fetcher = async (input, options) => {
      if (input instanceof Request && input.method === 'GET' && gets++ === 0) return new Response(Buffer.from([9, 8, 7]), { headers: {
        'content-type': 'image/webp', 'cache-control': 'public, max-age=60', 'content-disposition': 'inline', 'content-language': 'en', expires: 'Sun, 01 Nov 2026 00:00:00 GMT',
      } });
      return original(input, options);
    };
    f.fetcher.mockClear(); await migrateStorage({ ...f.options, mode: 'copy' }, f.deps);
    expect(f.fetcher.mock.calls.some(([input]) => input instanceof Request && input.method === 'PUT')).toBe(true);
  });

});

async function concurrentFixture(count, control) {
  const f = await fixture();
  const items = Array.from({ length: count }, (_, index) => ({ Key: `event-pictures/${index}.webp`, Size: 3, ETag: `"source-${index}"`, LastModified: modified }));
  const originalExecute = f.execute;
  const sourceFiles = new Map();
  f.deps.execute = vi.fn((program, args, options) => {
    if (program === 'aws' && args[1] === 'list-objects-v2') return JSON.stringify({ Contents: items });
    if (program === 'aws' && args[1] === 'get-object') {
      const index = Number(args[args.indexOf('--key') + 1].match(/\/(\d+)\.webp$/)[1]);
      const path = args[args.indexOf('--output') - 1]; sourceFiles.set(index, path);
      expect(args[args.indexOf('--range') + 1]).toBe('bytes=0-5242880');
      writeFileSync(path, Buffer.from([index, 2, 3]));
      return JSON.stringify({ ...f.metadata, ETag: items[index].ETag });
    }
    return originalExecute(program, args, options);
  });
  const originalFetch = f.fetcher;
  let active = 0, peak = 0;
  const started = [];
  f.deps.fetcher = async (input, options) => {
    if (!(input instanceof Request)) return originalFetch(input, options);
    const index = Number(new URL(input.url).pathname.match(/\/(\d+)\.webp$/)[1]);
    if (input.method === 'PUT') return new Response(null);
    started.push(index); active++; peak = Math.max(peak, active);
    try {
      if (control) await control(index);
      else await new Promise(resolve => setTimeout(resolve, 8 - index % 5));
      // The concurrent task's source file must remain intact until its own
      // request completes, even when another object finishes first.
      expect(await readFile(sourceFiles.get(index))).toEqual(Buffer.from([index, 2, 3]));
      return new Response(Buffer.from([index, 2, 3]), { headers: {
        'content-type': 'image/webp', 'cache-control': 'public, max-age=60', 'content-disposition': 'inline', 'content-language': 'en', expires: 'Sun, 01 Nov 2026 00:00:00 GMT',
      } });
    } finally { active--; }
  };
  return { ...f, items, sourceFiles, started, peak: () => peak };
}

describe('bounded migration concurrency', () => {
  it.each([0, 5, 1.5, 'invalid'])('rejects unsafe concurrency %s before any provider calls', async concurrency => {
    const f = await fixture(); await expect(migrateStorage({ ...f.options, concurrency }, f.deps)).rejects.toThrow('--concurrency');
    expect(f.execute).not.toHaveBeenCalled(); expect(f.fetcher).not.toHaveBeenCalled();
  });
  it('preserves sequential behavior by default', async () => {
    const f = await concurrentFixture(5); const report = await migrateStorage(f.options, f.deps);
    expect(f.peak()).toBe(1); expect(report.concurrency).toBe(1); expect(Object.keys(report.objects)).toHaveLength(5);
  });
  it('limits the pool to four with distinct temp files and complete atomic checkpoints despite out-of-order completion', async () => {
    const f = await concurrentFixture(11); const report = await migrateStorage({ ...f.options, concurrency: '4' }, f.deps);
    expect(f.peak()).toBe(4); expect(new Set(f.sourceFiles.values()).size).toBe(11);
    expect(Object.keys(report.objects)).toHaveLength(11);
    const persisted = JSON.parse(await readFile(f.manifest, 'utf8'));
    expect(persisted).toEqual(report); expect(persisted.allVerified).toBe(true); expect(persisted.verifiedAt).not.toBeNull();
    for (const item of f.items) expect(persisted.objects[item.Key]).toMatchObject({ verified: true, etag: item.ETag });
  });
  it('stops assigning on failure and waits for every in-flight task before cleanup or rejecting', async () => {
    const controls = new Map(); let waveReady;
    const ready = new Promise(resolve => { waveReady = resolve; });
    const f = await concurrentFixture(8, index => new Promise((resolve, reject) => {
      controls.set(index, { resolve, reject }); if (controls.size === 2) waveReady();
    }));
    let settled = false;
    const completion = migrateStorage({ ...f.options, concurrency: 2 }, f.deps).then(
      report => { settled = true; return { report }; }, error => { settled = true; return { error }; },
    );
    await ready; controls.get(0).reject(new Error('private error from failed R2 request'));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(settled).toBe(false); expect(f.started).toEqual([0, 1]);
    expect(await readFile(f.sourceFiles.get(1))).toEqual(Buffer.from([1, 2, 3]));
    controls.get(1).resolve();
    const result = await completion;
    expect(result.error.message).toBe('R2 S3 request failed; check credentials and connectivity');
    expect(f.started).toEqual([0, 1]);
    await expect(readFile(f.sourceFiles.get(1))).rejects.toMatchObject({ code: 'ENOENT' });
    const manifest = JSON.parse(await readFile(f.manifest, 'utf8'));
    expect(manifest.allVerified).toBe(false); expect(manifest.verifiedAt).toBeNull();
    expect(manifest.objects[f.items[1].Key].verified).toBe(true);
    expect(f.deps.execute.mock.calls.filter(([, args]) => args[1] === 'list-objects-v2')).toHaveLength(1);
  });
});
