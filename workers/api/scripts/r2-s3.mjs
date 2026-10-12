// R2's management object endpoint adds download transport headers. Storage
// verification must use the signed S3 endpoint's genuine object metadata.
import { AwsClient } from 'aws4fetch';

export function r2S3Transport({ account, bucket, environment, fetcher = fetch }) {
  if (!/^[a-f0-9]{32}$/.test(account ?? '') || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket ?? '') ||
      !environment.R2_ACCESS_KEY_ID || !environment.R2_SECRET_ACCESS_KEY) throw new Error('Explicit R2 account, bucket and scoped S3 credentials are required');
  const client = new AwsClient({ accessKeyId: environment.R2_ACCESS_KEY_ID, secretAccessKey: environment.R2_SECRET_ACCESS_KEY,
    region: 'auto', service: 's3' });
  return async function request(method, key, { headers = {}, body } = {}) {
    if (typeof key !== 'string' || !key || Buffer.byteLength(key) > 1024 || key.startsWith('/') || key.includes('\\') ||
      /[\u0000-\u001f\u007f]/.test(key) || key.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Unsupported R2 object key');
    const path = key.split('/').map(part => encodeURIComponent(part).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)).join('/');
    let response;
    try {
      const signed = await client.sign(`https://${account}.r2.cloudflarestorage.com/${bucket}/${path}`, { method, headers, body });
      response = await fetcher(signed, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
    } catch { throw new Error('R2 S3 request failed; check credentials and connectivity'); }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`R2 S3 request failed (HTTP ${response.status}); check object and permissions`); }
    return response;
  };
}
