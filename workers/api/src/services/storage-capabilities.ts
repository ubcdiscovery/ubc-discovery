import { SignJWT, jwtVerify } from 'jose';
import type { ApiEnv } from '../env';
import { ApiError } from '../http/errors';

const audience = 'ubc-discovery-storage';
export interface StorageCapability {
  operation: 'upload' | 'download';
  key: string;
  contentType?: string;
  maxBytes?: number;
}

function signingKey(env: ApiEnv) {
  const bytes = new TextEncoder().encode(env.UPLOAD_SIGNING_SECRET ?? '');
  if (bytes.length < 32) throw new ApiError(503, 'Storage signing is not configured');
  return bytes;
}

export function storageApiBase(env: ApiEnv): string {
  try {
    const url = new URL(env.API_PUBLIC_BASE_URL ?? '');
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash) throw new Error();
    return url.toString().replace(/\/+$/, '');
  } catch { throw new ApiError(503, 'Storage API URL is not configured'); }
}

export async function signStorageCapability(env: ApiEnv, value: StorageCapability, expiresIn: number, now = new Date()): Promise<string> {
  if (!Number.isSafeInteger(expiresIn) || expiresIn < 1 || expiresIn > 3600) throw new ApiError(400, 'Invalid storage expiry');
  return new SignJWT({ ...value }).setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setAudience(audience).setIssuer(storageApiBase(env)).setIssuedAt(Math.floor(now.getTime() / 1000))
    .setExpirationTime(Math.floor(now.getTime() / 1000) + expiresIn).sign(signingKey(env));
}

export async function verifyStorageCapability(env: ApiEnv, token: string, operation: StorageCapability['operation'], now = new Date()): Promise<StorageCapability> {
  // Configuration errors remain distinguishable from a bad bearer capability.
  const key = signingKey(env);
  const issuer = storageApiBase(env);
  try {
    if (!token || token.length > 8192) throw new Error();
    const { payload } = await jwtVerify(token, key, {
      algorithms: ['HS256'], issuer, audience, requiredClaims: ['exp', 'iat'], currentDate: now,
    });
    if (payload.operation !== operation || typeof payload.key !== 'string' ||
        typeof payload.iat !== 'number' || payload.iat > Math.floor(now.getTime() / 1000) ||
        typeof payload.exp !== 'number' || payload.exp - payload.iat > 3600) throw new Error();
    if (operation === 'upload' && (typeof payload.contentType !== 'string' || typeof payload.maxBytes !== 'number' ||
      !Number.isSafeInteger(payload.maxBytes) || payload.maxBytes < 1 || payload.maxBytes > 5 * 1024 * 1024)) throw new Error();
    return { operation, key: payload.key,
      ...(typeof payload.contentType === 'string' ? { contentType: payload.contentType } : {}),
      ...(typeof payload.maxBytes === 'number' ? { maxBytes: payload.maxBytes } : {}),
    };
  } catch { throw new ApiError(403, 'Invalid or expired storage URL'); }
}
