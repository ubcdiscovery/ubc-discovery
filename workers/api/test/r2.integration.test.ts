import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/app';
import { withDatabase } from '../src/db';
import { apiCredentials, eventListingCandidates } from '../src/db/schema';
import { R2Storage } from '../src/services/storage';
import type { PresignedUpload } from '../src/services/storage';
import { extractionFixture, testUrl } from './extraction-fixture';

interface UploadResponse extends Omit<PresignedUpload, 'url'> { upload_url: string; max_file_size_bytes: number }
interface IngestResponse { candidate: { id: string }; uploads: UploadResponse[] }

describe.skipIf(!testUrl)('complete API R2 contract against PostgreSQL', () => {
  const fixture = extractionFixture();
  const objects = new Map<string, { bytes: Uint8Array<ArrayBuffer>; httpMetadata?: R2HTTPMetadata }>();
  const unused = () => { throw new Error('Unexpected R2 operation'); };
  const bucket: R2Bucket = {
    put: async (key, value, options) => {
      if (!(value instanceof Uint8Array)) throw new Error('Expected bounded uploaded bytes');
      objects.set(key, { bytes: new Uint8Array(value), httpMetadata: options?.httpMetadata as R2HTTPMetadata });
      return { key } as R2Object;
    },
    get: (async (key: string) => {
      const object = objects.get(key);
      return object ? { size: object.bytes.length, body: new Response(object.bytes).body!,
        httpMetadata: object.httpMetadata, httpEtag: '"fixture"' } as R2ObjectBody : null;
    }) as R2Bucket['get'],
    head: async key => objects.has(key) ? { key } as R2Object : null,
    delete: async keys => { for (const key of typeof keys === 'string' ? [keys] : keys) objects.delete(key); },
    list: unused, createMultipartUpload: unused, resumeMultipartUpload: unused,
  };
  Object.assign(fixture.env, { STORAGE_PROVIDER: 'r2', API_PUBLIC_BASE_URL: 'https://api.example.test',
    R2_ACCOUNT_ID: 'a'.repeat(32), R2_BUCKET_NAME: 'private-test-images', R2_ACCESS_KEY_ID: 'test-access-id', R2_SECRET_ACCESS_KEY: 'synthetic-secret',
    UPLOAD_SIGNING_SECRET: 'isolated-integration-only-32-byte-key', R2_BUCKET: bucket, CORS_ALLOWED_ORIGINS: '["https://web.example.test"]' });
  fixture.services.storage = new R2Storage(fixture.env);
  const app = createApp(fixture.env, () => fixture.services);
  beforeAll(() => fixture.setup());
  afterAll(() => fixture.teardown());

  async function upload(target: UploadResponse, contentType: string) {
    expect(target.method).toBe('PUT');
    expect(target.headers).toEqual({ 'content-type': contentType });
    expect(target.fields).toEqual({});
    const signed = new URL(target.upload_url);
    expect(signed.hostname).toBe(`${'a'.repeat(32)}.r2.cloudflarestorage.com`);
    expect(signed.searchParams.get('X-Amz-SignedHeaders')).toBe('content-length;content-type;host');
    // Model the object now arriving from R2's direct S3 endpoint. Signature
    // enforcement is covered separately by the live R2/browser proof.
    objects.set(target.file_key, { bytes: new Uint8Array([1, 2, 3]), httpMetadata: { contentType } });
  }
  function request(path: string, method = 'GET', body?: unknown, authorization = 'Bearer admin') {
    return app.handle(new Request(`https://api.example.test${path}`, { method,
      headers: { authorization, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(path === '/ingestion/event-candidates' ? { 'x-image-file-sizes': '[3]' } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }));
  }

  it('propagates raw upload metadata for profile and administrator event images', async () => {
    const profileTarget = await (await request('/users/me/presigned-upload?file_size_bytes=3')).json() as UploadResponse;
    expect(profileTarget.max_file_size_bytes).toBe(512 * 1024);
    await upload(profileTarget, 'image/webp');
    const profile = await (await request('/users/me')).json() as { profile_picture_url: string };
    expect((await app.handle(new Request(profile.profile_picture_url))).status).toBe(200);

    const created = await request('/admin/events', 'POST', { title: 'R2 fixture', location_name: 'UBC', event_date: '2030-03-01T12:00:00Z' });
    expect(created.status).toBe(200);
    const event = await created.json() as { id: string };
    const eventTarget = await (await request(`/admin/events/${event.id}/presigned-upload?file_size_bytes=3`, 'POST')).json() as UploadResponse;
    expect(eventTarget.max_file_size_bytes).toBe(3 * 1024 * 1024);
    await upload(eventTarget, 'image/webp');
    expect((await app.handle(new Request(fixture.services.storage.publicUrl(eventTarget.file_key)))).status).toBe(200);
  });

  it('keeps ingested evidence private while producing usable extractor URLs', async () => {
    const credentials = await withDatabase(fixture.env, db => db.select().from(apiCredentials));
    const ingester = credentials.find(item => item.label === 'fixture ingester')!;
    const extractor = credentials.find(item => item.label === 'fixture extractor')!;
    const result = await request('/ingestion/event-candidates', 'POST', {
      source_type: 'instagram', external_source_id: 'r2-fixture', source_account: 'test', image_content_types: ['image/png'],
    }, `Api-Key ubc_live_${ingester.id}.fixture-secret`);
    expect(result.status).toBe(201);
    const ingestion = await result.json() as IngestResponse;
    expect(ingestion.uploads).toHaveLength(1);
    await upload(ingestion.uploads[0]!, 'image/png');
    expect((await app.handle(new Request(`https://api.example.test/media/public/${ingestion.uploads[0]!.file_key}`))).status).toBe(404);
    await withDatabase(fixture.env, db => db.update(eventListingCandidates).set({ captureReadyAt: fixture.services.now() }).where(eq(eventListingCandidates.id, ingestion.candidate.id)));
    const evidence = await request('/extraction/evidence', 'POST', { candidates: [{ candidate_id: ingestion.candidate.id, generation: 1 }] }, `Api-Key ubc_live_${extractor.id}.fixture-secret`);
    expect(evidence.status).toBe(200);
    const body = await evidence.json() as { items: Array<{ images: Array<{ url: string }> }> };
    const download = await app.handle(new Request(body.items[0]!.images[0]!.url));
    expect(download.status).toBe(200);
    expect(download.headers.get('cache-control')).toBe('private, no-store');
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });
});
