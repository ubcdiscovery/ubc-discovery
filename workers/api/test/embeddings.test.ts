import { describe, expect, it, vi } from 'vitest';
import type { ApiEnv } from '../src/env';
import { embedText, generateEventText, isValidEmbedding } from '../src/services/embeddings';

const env = { AWS_ACCESS_KEY_ID: 'example', AWS_SECRET_ACCESS_KEY: 'example', AWS_REGION: 'us-west-2' } as ApiEnv;

describe('Titan embeddings', () => {
  it('preserves event text ordering and skips empty description/organizer', () => {
    expect(generateEventText({ title: 'Concert', description: 'Music', club_name: 'AMS', location_name: 'Nest' })).toBe('Concert. Music. Hosted by AMS. Location: Nest');
    expect(generateEventText({ title: 'Concert', description: '', club_name: null, location_name: 'Nest' })).toBe('Concert. Location: Nest');
  });
  it('invokes the same model and dimensions, preserving normalization defaults', async () => {
    const embedding = Array.from({ length: 1024 }, (_, index) => index / 1024);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ embedding }));
    expect(await embedText(env, 'Example event', fetcher)).toEqual(embedding);
    const request = fetcher.mock.calls[0]![0] as Request;
    expect(request.url).toBe('https://bedrock-runtime.us-west-2.amazonaws.com/model/amazon.titan-embed-text-v2%3A0/invoke');
    expect(request.headers.get('authorization')).toContain('/bedrock/aws4_request');
    expect(await request.json()).toEqual({ inputText: 'Example event', dimensions: 1024 });
  });
  it('rejects wrong dimensions, booleans, non-finite values, and malformed model responses', async () => {
    expect(isValidEmbedding(Array(1023).fill(0))).toBe(false);
    expect(isValidEmbedding([...Array(1023).fill(0), true])).toBe(false);
    expect(isValidEmbedding([...Array(1023).fill(0), Infinity])).toBe(false);
    expect(await embedText(env, 'text', vi.fn<typeof fetch>().mockResolvedValue(Response.json({ embedding: [] })))).toBeNull();
    expect(await embedText(env, 'text', vi.fn<typeof fetch>().mockResolvedValue(new Response('invalid JSON')))).toBeNull();
  });
  it('keeps failures best-effort and does not retry an invocation', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('network failure'));
    expect(await embedText(env, 'text', fetcher)).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
