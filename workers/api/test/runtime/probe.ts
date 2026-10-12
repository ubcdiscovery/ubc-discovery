// Local-only runtime harness. Never deploy this test entry point.
import { sql } from 'drizzle-orm';
import { decodeJwt } from 'jose';
import type { ApiEnv } from '../../src/env';
import { withDatabase, withTransaction } from '../../src/db';
import { createFirebase } from '../../src/services/firebase';
import { R2Storage } from '../../src/services/storage';
import { hashSecret, verifySecret } from '../../src/http/auth';
import { localDayBounds } from '../../src/services/candidate-publication';

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
      await storage.putUploadedImage(key, new Request('http://localhost/upload', {
        method: 'PUT', headers: { 'content-type': 'image/webp' }, body: new Uint8Array([1, 2, 3]),
      }), 'image/webp', 512);
      r2 = await storage.objectExists(key) && (await storage.getObjectBytes(key)).length === 3;
    } finally { await storage.deleteObject(key); }
    const [start, end] = localDayBounds(new Date('2026-11-01T20:00:00Z'));
    const vancouver = start.toISOString() === '2026-11-01T07:00:00.000Z' && end.toISOString() === '2026-11-02T07:00:00.000Z';
    return Response.json({ database, r2, auth, vancouver, firebase: identity.uid === 'local-user' && customToken.uid === 'local-user' });
  },
} satisfies ExportedHandler<ApiEnv>;
