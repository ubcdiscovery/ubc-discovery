import { describe, expect, it, vi } from 'vitest';
import { r2S3Transport } from '../scripts/r2-s3.mjs';

function fixture(fetcher) {
  const sleep = vi.fn(async () => {});
  const request = r2S3Transport({ account: 'a'.repeat(32), bucket: 'private-bucket',
    environment: { R2_ACCESS_KEY_ID: 'private-access', R2_SECRET_ACCESS_KEY: 'private-secret' }, fetcher, sleep });
  return { request, sleep };
}

describe('bounded safe R2 read retries', () => {
  it.each(['network', 'timeout'])('retries %s failures with fresh signals and retains conditional read headers', async kind => {
    const fetcher = vi.fn().mockRejectedValueOnce(kind === 'timeout'
      ? new DOMException('private signed URL timed out', 'TimeoutError') : new Error('private signed URL failed'))
      .mockResolvedValueOnce(new Response('verified bytes'));
    const { request, sleep } = fixture(fetcher);
    expect(await (await request('GET', 'images/file.webp', { headers: { 'if-match': '"source-etag"' } })).text()).toBe('verified bytes');
    expect(fetcher).toHaveBeenCalledTimes(2); expect(sleep.mock.calls).toEqual([[500]]);
    for (const [signed, options] of fetcher.mock.calls) {
      expect(signed.method).toBe('GET'); expect(signed.headers.get('if-match')).toBe('"source-etag"');
      expect(options.redirect).toBe('error'); expect(options.signal).toBeInstanceOf(AbortSignal);
    }
    expect(fetcher.mock.calls[0][1].signal).not.toBe(fetcher.mock.calls[1][1].signal);
  });
  it('cancels transient responses before backing off and retries at most three total attempts', async () => {
    const events = []; let attempt = 0;
    const fetcher = vi.fn(async () => {
      const index = ++attempt; events.push(`fetch-${index}`);
      return new Response(new ReadableStream({ cancel() { events.push(`cancel-${index}`); } }), { status: index === 1 ? 429 : 503 });
    });
    const { request, sleep } = fixture(fetcher);
    sleep.mockImplementation(async delay => { events.push(`wait-${delay}`); });
    await expect(request('GET', 'images/file.webp')).rejects.toThrow('R2 S3 request failed (HTTP 503); check object and permissions');
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(events).toEqual(['fetch-1', 'cancel-1', 'wait-500', 'fetch-2', 'cancel-2', 'wait-1000', 'fetch-3', 'cancel-3']);
  });
  it.each([500, 502, 504])('recovers from HTTP %s without returning the failed body', async status => {
    const canceled = vi.fn();
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(new ReadableStream({ cancel: canceled }), { status }))
      .mockResolvedValueOnce(new Response('good'));
    const { request } = fixture(fetcher);
    expect(await (await request('GET', 'images/file.webp')).text()).toBe('good');
    expect(canceled).toHaveBeenCalledTimes(1); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('sanitizes exhausted connectivity errors and enforces the three-attempt ceiling', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('private-secret and signed URL'));
    const { request, sleep } = fixture(fetcher);
    await expect(request('GET', 'images/file.webp')).rejects.toThrow('R2 S3 request failed; check credentials and connectivity');
    expect(fetcher).toHaveBeenCalledTimes(3); expect(sleep.mock.calls).toEqual([[500], [1000]]);
  });
  it.each([400, 401, 403, 404, 412])('does not retry permanent HTTP %s errors', async status => {
    const canceled = vi.fn();
    const fetcher = vi.fn(async () => new Response(new ReadableStream({ cancel: canceled }), { status }));
    const { request, sleep } = fixture(fetcher);
    await expect(request('GET', 'images/file.webp')).rejects.toThrow(`R2 S3 request failed (HTTP ${status})`);
    expect(fetcher).toHaveBeenCalledTimes(1); expect(canceled).toHaveBeenCalledTimes(1); expect(sleep).not.toHaveBeenCalled();
  });
  it.each(['PUT', 'DELETE'])('never retries %s after network or transient HTTP errors', async method => {
    for (const failure of ['network', 429, 503]) {
      const fetcher = vi.fn(async () => {
        if (failure === 'network') throw new Error('private-secret from provider');
        return new Response('private provider body', { status: failure });
      });
      const { request, sleep } = fixture(fetcher);
      await expect(request(method, 'images/file.webp', method === 'PUT' ? { body: Buffer.from('upload') } : {})).rejects.toThrow('R2 S3 request failed');
      expect(fetcher).toHaveBeenCalledTimes(1); expect(sleep).not.toHaveBeenCalled();
    }
  });
  it('does not expose cancellation errors or retry an authentication failure', async () => {
    const fetcher = vi.fn(async () => new Response(new ReadableStream({
      cancel() { throw new Error('private-secret during cancellation'); },
    }), { status: 403 }));
    const { request, sleep } = fixture(fetcher);
    await expect(request('GET', 'images/file.webp')).rejects.toThrow('R2 S3 request failed (HTTP 403); check object and permissions');
    expect(fetcher).toHaveBeenCalledTimes(1); expect(sleep).not.toHaveBeenCalled();
  });
});
