// R2's management object endpoint adds download transport headers. Storage
// verification must use the signed S3 endpoint's genuine object metadata.
import { AwsClient } from 'aws4fetch';

export function r2S3Transport({ account, bucket, environment, fetcher = fetch,
  sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)) }) {
  if (!/^[a-f0-9]{32}$/.test(account ?? '') || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket ?? '') ||
      !environment.R2_ACCESS_KEY_ID || !environment.R2_SECRET_ACCESS_KEY) throw new Error('Explicit R2 account, bucket and scoped S3 credentials are required');
  const client = new AwsClient({ accessKeyId: environment.R2_ACCESS_KEY_ID, secretAccessKey: environment.R2_SECRET_ACCESS_KEY,
    region: 'auto', service: 's3' });
  return async function request(method, key, { headers = {}, body } = {}) {
    if (typeof key !== 'string' || !key || Buffer.byteLength(key) > 1024 || key.startsWith('/') || key.includes('\\') ||
      // oxlint-disable-next-line no-control-regex -- rejects control characters in object keys
      /[\u0000-\u001f\u007f]/.test(key) || key.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Unsupported R2 object key');
    const path = key.split('/').map(part => encodeURIComponent(part).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)).join('/');
    // Retry only safe reads, within the caller's existing bounded transfer task.
    // Writes may have succeeded before a connectivity failure and are never retried.
    const attempts = method === 'GET' ? 3 : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      let signed;
      try { signed = await client.sign(`https://${account}.r2.cloudflarestorage.com/${bucket}/${path}`, { method, headers, body }); }
      catch { throw new Error('R2 S3 request failed; check credentials and connectivity'); }
      let response;
      try { response = await fetcher(signed, { redirect: 'error', signal: AbortSignal.timeout(30_000) }); }
      catch {
        if (attempt + 1 === attempts) throw new Error('R2 S3 request failed; check credentials and connectivity');
        await sleep(500 * 2 ** attempt);
        continue;
      }
      if (response.ok) return response;
      // Release every failed response before another request. Never expose a
      // provider body or a cancellation error containing request credentials.
      try { await response.body?.cancel(); } catch { /* already released */ }
      if (attempt + 1 < attempts && (response.status === 429 || response.status >= 500 && response.status <= 599)) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
      throw new Error(`R2 S3 request failed (HTTP ${response.status}); check object and permissions`);
    }
  };
}
