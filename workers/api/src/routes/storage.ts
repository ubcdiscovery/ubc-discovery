import { Elysia } from 'elysia';
import { CloudflareAdapter } from 'elysia/adapter/cloudflare-worker';
import type { ApiEnv } from '../env';
import { ApiError } from '../http/errors';
import { MAX_IMAGE_BYTES, validateStorageKey } from '../services/storage';
import { verifyStorageCapability } from '../services/storage-capabilities';

function requireR2(env: ApiEnv) {
  if (env.STORAGE_PROVIDER !== 'r2' || !env.R2_BUCKET) throw new ApiError(404, 'Not Found');
  return env.R2_BUCKET;
}

async function imageResponse(env: ApiEnv, key: string, isPublic: boolean): Promise<Response> {
  const bucket = requireR2(env);
  validateStorageKey(key);
  const object = await bucket.get(key);
  if (!object) throw new ApiError(404, 'Object not found');
  if (object.size > MAX_IMAGE_BYTES) {
    await object.body.cancel();
    throw new ApiError(413, 'File exceeds the allowed size');
  }
  const contentType = object.httpMetadata?.contentType;
  if (!contentType || !['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) {
    await object.body.cancel();
    throw new ApiError(415, 'Invalid image content type');
  }
  return new Response(object.body, { headers: {
    'content-type': contentType, 'content-length': String(object.size),
    'x-content-type-options': 'nosniff', etag: object.httpEtag,
    'cache-control': isPublic ? 'public, max-age=60' : 'private, no-store',
    'referrer-policy': 'no-referrer',
  } });
}

export function createStorageRoutes(env: ApiEnv) {
  return new Elysia({ name: 'r2-media', adapter: CloudflareAdapter, prefix: '/media' })
    .get('/private', async ({ request }) => {
      requireR2(env);
      const capability = await verifyStorageCapability(env, new URL(request.url).searchParams.get('token') ?? '', 'download');
      return imageResponse(env, capability.key, false);
    }, { detail: { hide: true } })
    .get('/public/*', async ({ params }) => {
      requireR2(env);
      let key: string;
      try { key = decodeURIComponent(params['*']); }
      catch { throw new ApiError(400, 'Invalid storage key'); }
      if (!/^(event-pictures|event-images|profile-pictures)\/[^/]/.test(key)) throw new ApiError(404, 'Not Found');
      return imageResponse(env, key, true);
    }, { detail: { hide: true } });
}
