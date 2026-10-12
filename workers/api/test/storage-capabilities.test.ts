import { describe, expect, it, vi } from 'vitest';
import { Elysia } from 'elysia';
import { CloudflareAdapter } from 'elysia/adapter/cloudflare-worker';
import type { ApiEnv } from '../src/env';
import { errorResponse } from '../src/http/errors';
import { createStorageRoutes } from '../src/routes/storage';
import { R2Storage } from '../src/services/storage';
import { signStorageCapability, verifyStorageCapability } from '../src/services/storage-capabilities';

const fixedDate = new Date('2026-10-11T12:00:00Z');
const env = { API_PUBLIC_BASE_URL: 'https://api.example.test', UPLOAD_SIGNING_SECRET: 'local-test-only-32-byte-secret-key', STORAGE_PROVIDER: 'r2' } as ApiEnv;

describe('storage capability trust boundary', () => {
  it('binds the operation, object, MIME, size, issuer and expiry', async () => {
    const token = await signStorageCapability(env, { operation: 'upload', key: 'candidates/one.webp', contentType: 'image/webp', maxBytes: 512 }, 300, fixedDate);
    expect(await verifyStorageCapability(env, token, 'upload', fixedDate)).toEqual({ operation: 'upload', key: 'candidates/one.webp', contentType: 'image/webp', maxBytes: 512 });
    await expect(verifyStorageCapability(env, token, 'download', fixedDate)).rejects.toMatchObject({ status: 403 });
    await expect(verifyStorageCapability(env, token, 'upload', new Date(fixedDate.getTime() + 300_000))).rejects.toMatchObject({ status: 403 });
    await expect(verifyStorageCapability(env, token, 'upload', new Date(fixedDate.getTime() - 1000))).rejects.toMatchObject({ status: 403 });
    await expect(verifyStorageCapability({ ...env, API_PUBLIC_BASE_URL: 'https://another.example.test' }, token, 'upload', fixedDate)).rejects.toMatchObject({ status: 403 });
    await expect(verifyStorageCapability({ ...env, UPLOAD_SIGNING_SECRET: 'a-different-local-32-byte-secret-key' }, token, 'upload', fixedDate)).rejects.toMatchObject({ status: 403 });
    const parts = token.split('.');
    parts[1] = btoa(JSON.stringify({ operation: 'upload', key: 'other.webp' })).replace(/=+$/, '');
    await expect(verifyStorageCapability(env, parts.join('.'), 'upload', fixedDate)).rejects.toMatchObject({ status: 403 });
  });
  it('requires a strong configured key and HTTPS outside localhost', async () => {
    await expect(signStorageCapability({ ...env, UPLOAD_SIGNING_SECRET: 'weak' }, { operation: 'download', key: 'x' }, 60)).rejects.toMatchObject({ status: 503 });
    await expect(signStorageCapability({ ...env, API_PUBLIC_BASE_URL: 'http://api.example.test' }, { operation: 'download', key: 'x' }, 60)).rejects.toMatchObject({ status: 503 });
    await expect(signStorageCapability(env, { operation: 'download', key: 'x' }, 3601)).rejects.toMatchObject({ status: 400 });
  });
});

function fixture() {
  const objects = new Map<string, { bytes: Uint8Array<ArrayBuffer>; metadata?: R2HTTPMetadata }>();
  const put = vi.fn(async (key: string, value: unknown, options?: R2PutOptions) => {
    objects.set(key, { bytes: value as Uint8Array<ArrayBuffer>, metadata: options?.httpMetadata as R2HTTPMetadata });
    return { key } as R2Object;
  });
  const get = vi.fn(async (key: string) => {
    const object = objects.get(key);
    if (!object) return null;
    return { key, size: object.bytes.length, body: new Response(object.bytes).body!,
      httpMetadata: object.metadata, httpEtag: '"test-etag"' } as R2ObjectBody;
  });
  const unused = () => { throw new Error('Unexpected R2 operation'); };
  const bucket: R2Bucket = { put: put as R2Bucket['put'], get: get as R2Bucket['get'], head: unused,
    createMultipartUpload: unused, resumeMultipartUpload: unused, delete: unused, list: unused };
  const configured = { ...env, R2_BUCKET: bucket };
  const app = new Elysia({ adapter: CloudflareAdapter }).onError(({ error }) => errorResponse(error)).use(createStorageRoutes(configured)).compile();
  return { configured, objects, put, get, app, storage: new R2Storage(configured) };
}

describe('private R2 bucket HTTP contract', () => {
  it('uploads raw bytes only to the authorized key and exposes only public image prefixes', async () => {
    const { app, storage, objects, get } = fixture();
    const upload = await storage.generatePresignedUpload({ fileKey: 'candidates/private.webp', contentType: 'image/webp', maxFileSizeBytes: 512 });
    expect(upload.method).toBe('PUT');
    const result = await app.handle(new Request(upload.url, { method: 'PUT', headers: upload.headers, body: new Uint8Array([1, 2, 3]) }));
    expect(result.status).toBe(204);
    expect(objects.get('candidates/private.webp')?.bytes).toEqual(new Uint8Array([1, 2, 3]));
    const url = await storage.generatePresignedDownloadUrl('candidates/private.webp');
    const download = await app.handle(new Request(url));
    expect(download.status).toBe(200);
    expect(download.headers.get('cache-control')).toBe('private, no-store');
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    const reads = get.mock.calls.length;
    expect((await app.handle(new Request('https://api.example.test/media/public/candidates/private.webp'))).status).toBe(404);
    expect(get.mock.calls.length).toBe(reads);
    objects.set('event-pictures/hello world.webp', { bytes: new Uint8Array([4]), metadata: { contentType: 'image/webp' } });
    const publicDownload = await app.handle(new Request(storage.publicUrl('event-pictures/hello world.webp')));
    expect(publicDownload.status).toBe(200);
    expect(publicDownload.headers.get('x-content-type-options')).toBe('nosniff');
  });
  it('rejects invalid URLs, wrong MIME and oversized bodies without touching R2', async () => {
    const { app, storage, put, get } = fixture();
    expect((await app.handle(new Request('https://api.example.test/media/upload?token=bad', { method: 'PUT', body: 'bad' }))).status).toBe(403);
    expect((await app.handle(new Request('https://api.example.test/media/private'))).status).toBe(403);
    const upload = await storage.generatePresignedUpload({ fileKey: 'image.webp', contentType: 'image/webp', maxFileSizeBytes: 2 });
    expect((await app.handle(new Request(upload.url, { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body: new Uint8Array([1]) }))).status).toBe(400);
    expect((await app.handle(new Request(upload.url, { method: 'PUT', headers: upload.headers, body: new Uint8Array([1, 2, 3]) }))).status).toBe(413);
    expect(put).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });
  it('keeps media routes disabled while S3 is selected', async () => {
    const app = new Elysia({ adapter: CloudflareAdapter }).onError(({ error }) => errorResponse(error)).use(createStorageRoutes({ ...env, STORAGE_PROVIDER: 's3' })).compile();
    expect((await app.handle(new Request('https://api.example.test/media/upload', { method: 'PUT' }))).status).toBe(404);
  });
});
