// Local-only runtime harness. Never deploy this test entry point.
import { sql } from 'drizzle-orm';
import { env as cloudflareEnv } from 'cloudflare:workers';
import { decodeJwt } from 'jose';
import { AwsV4Signer } from 'aws4fetch';
import type { ApiEnv } from '../../src/env';
import { withDatabase, withTransaction } from '../../src/db';
import { createFirebase } from '../../src/services/firebase';
import { R2Storage } from '../../src/services/storage';
import { hashSecret, verifySecret } from '../../src/http/auth';
import { localDayBounds } from '../../src/services/candidate-publication';
import { createApp } from '../../src/app';

const storageEnv: ApiEnv = {
  ...cloudflareEnv, STORAGE_PROVIDER: 'r2', API_PUBLIC_BASE_URL: 'http://localhost',
  UPLOAD_SIGNING_SECRET: 'local-runtime-capability-secret-at-least-32-bytes',
  CORS_ALLOWED_ORIGINS: '["http://web.localhost"]',
  R2_ACCOUNT_ID: 'a'.repeat(32), R2_BUCKET_NAME: 'local-runtime-test',
  R2_ACCESS_KEY_ID: 'synthetic-access-key', R2_SECRET_ACCESS_KEY: 'synthetic-secret-key',
};
// Elysia's Workers adapter compiles at module initialization, as in src/index.ts.
const app = createApp(storageEnv);

export default {
  async fetch(request: Request, env: ApiEnv): Promise<Response> {
    if (request.method === 'GET') return Response.json({ ready: true });
    if (!env.DATABASE_URL || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(env.DATABASE_URL).hostname)) {
      return new Response('Disposable localhost database required', { status: 403 });
    }
    const fixture = await request.json<{ certificate: string; privateKey: string; token: string }>();
    const firebase = createFirebase({
      ...env, FIREBASE_PROJECT_ID: 'runtime-test', FIREBASE_CREDENTIALS_JSON: JSON.stringify({
        project_id: 'runtime-test', client_email: 'local@runtime-test.iam.gserviceaccount.com', private_key: fixture.privateKey,
      }),
    }, { fetch: async () => Response.json({ 'runtime-key': fixture.certificate }, { headers: { 'cache-control': 'max-age=60' } }) });
    // Exercises the production X509 importer, rather than injecting a CryptoKey.
    const identity = await firebase.verifyIdToken(fixture.token);
    const customToken = decodeJwt(await firebase.createCustomToken(identity.uid));
    const hash = await hashSecret('runtime-test-secret');
    const auth = await verifySecret('runtime-test-secret', hash) && !await verifySecret('wrong', hash);
    const database = await withDatabase(env, db => withTransaction(db, async tx => {
      const result = await tx.execute<{ answer: number; dimensions: number }>(sql`
        SELECT 42::integer AS answer, vector_dims(${JSON.stringify([1, ...Array(1023).fill(0)])}::vector) AS dimensions
      `);
      return result.rows[0]?.answer === 42 && result.rows[0]?.dimensions === 1024;
    }));
    const storage = new R2Storage(env);
    const key = `runtime-test/${crypto.randomUUID()}.webp`;
    let r2 = false;
    try {
      await env.R2_BUCKET.put(key, new Uint8Array([1, 2, 3]), { httpMetadata: { contentType: 'image/webp' } });
      r2 = await storage.objectExists(key) && (await storage.getObjectBytes(key)).length === 3;
    } finally { await storage.deleteObject(key); }
    // Exercise signing and read routes through the production adapter in workerd.
    // Direct PUT enforcement is validated separately against real staging R2.
    const capabilityStorage = new R2Storage(storageEnv);
    const candidateKey = `candidates/runtime-${crypto.randomUUID()}/00.webp`;
    const publicKey = `event-pictures/runtime-${crypto.randomUUID()}.webp`;
    const payload = new Uint8Array([1, 2, 3]);
    let capabilities = false;
    try {
      const upload = await capabilityStorage.generatePresignedUpload({
        fileKey: candidateKey, contentType: 'image/webp', maxFileSizeBytes: 512, fileSizeBytes: payload.length,
      });
      const signedUrl = new URL(upload.url);
      const signature = signedUrl.searchParams.get('X-Amz-Signature');
      const unsignedUrl = new URL(signedUrl);
      unsignedUrl.searchParams.delete('X-Amz-Signature');
      const expectedSignature = await new AwsV4Signer({ method: 'PUT', url: unsignedUrl.toString(),
        accessKeyId: storageEnv.R2_ACCESS_KEY_ID!, secretAccessKey: storageEnv.R2_SECRET_ACCESS_KEY!,
        region: 'auto', service: 's3', signQuery: true, allHeaders: true,
        datetime: signedUrl.searchParams.get('X-Amz-Date')!,
        headers: { 'content-type': 'image/webp', 'content-length': String(payload.length) },
      }).signature();
      await storageEnv.R2_BUCKET.put(candidateKey, payload, { httpMetadata: { contentType: 'image/webp' } });
      await storageEnv.R2_BUCKET.put(publicKey, payload, { httpMetadata: { contentType: 'image/webp' } });
      const download = await app.fetch(new Request(await capabilityStorage.generatePresignedDownloadUrl(candidateKey)));
      const downloaded = new Uint8Array(await download.arrayBuffer());
      const deniedPublic = await app.fetch(new Request(`http://localhost/media/public/${candidateKey}`));
      const deniedToken = await app.fetch(new Request('http://localhost/media/private?token=invalid-capability'));
      const wrongOperation = await app.fetch(new Request(`http://localhost/media/private${new URL(upload.url).search}`));
      const removedUpload = await app.fetch(new Request('http://localhost/media/upload', { method: 'PUT', body: payload }));
      const publicResponse = await app.fetch(new Request(capabilityStorage.publicUrl(publicKey)));
      const publicBytes = new Uint8Array(await publicResponse.arrayBuffer());
      capabilities = signature === expectedSignature
        && signedUrl.searchParams.get('X-Amz-SignedHeaders') === 'content-length;content-type;host'
        && upload.method === 'PUT' && !Object.hasOwn(upload.headers!, 'content-length') && download.status === 200
        && download.headers.get('cache-control') === 'private, no-store'
        && download.headers.get('content-type') === 'image/webp'
        && JSON.stringify([...downloaded]) === JSON.stringify([...payload])
        && deniedPublic.status === 404 && deniedToken.status === 403 && wrongOperation.status === 403
        && removedUpload.status === 404 && publicResponse.status === 200
        && publicResponse.headers.get('cache-control') === 'public, max-age=60'
        && publicResponse.headers.get('x-content-type-options') === 'nosniff'
        && JSON.stringify([...publicBytes]) === JSON.stringify([...payload]);
    } finally {
      await capabilityStorage.deleteObject(candidateKey);
      await capabilityStorage.deleteObject(publicKey);
    }
    const [start, end] = localDayBounds(new Date('2026-11-01T20:00:00Z'));
    const vancouver = start.toISOString() === '2026-11-01T07:00:00.000Z' && end.toISOString() === '2026-11-02T07:00:00.000Z';
    return Response.json({ database, r2, capabilities, auth, vancouver, firebase: identity.uid === 'local-user' && customToken.uid === 'local-user' });
  },
} satisfies ExportedHandler<ApiEnv>;
