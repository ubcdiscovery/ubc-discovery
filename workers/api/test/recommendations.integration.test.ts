import { Elysia } from 'elysia';
import { CloudflareAdapter } from 'elysia/adapter/cloudflare-worker';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ApiEnv } from '../src/env';
import { withDatabase } from '../src/db';
import { events, savedEvents, users } from '../src/db/schema';
import { ApiError, errorResponse } from '../src/http/errors';
import { createRecommendationRoutes } from '../src/routes/recommendations';
import type { RequestServices } from '../src/services';
import { personalizedEvents, roundScore, similarEvents } from '../src/services/recommender';

interface Body { events: { id: string; [key: string]: unknown }[]; scores: number[]; source: string; event_id: string }

const testUrl = process.env.TEST_DATABASE_URL;
if (testUrl && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(testUrl).hostname)) throw new Error('Disposable localhost database required');
const schemaName = `recommendations_${crypto.randomUUID().replaceAll('-', '')}`;
const url = new URL(testUrl ?? 'postgres://localhost/unused');
url.searchParams.set('options', `-c search_path=${schemaName},public`);
const env = { DATABASE_URL: url.toString() } as ApiEnv;
const services = {
  now: () => new Date('2030-01-01T00:00:00Z'),
  firebase: { verifyIdToken: async () => ({ uid: schemaName, email_verified: true }) },
  storage: { publicUrl: (key: string) => `https://images.example/${key}` },
} as unknown as RequestServices;
const app = new Elysia({ adapter: CloudflareAdapter }).onError(({ code, error }) => {
  if (code === 'VALIDATION') return errorResponse(new ApiError(422, 'Invalid request'));
  return errorResponse(error);
}).use(createRecommendationRoutes(env, () => services)).compile();
const request = (path: string, authenticated = false) => app.handle(new Request(`http://localhost${path}`, { headers: authenticated ? { authorization: 'Bearer fixture' } : {} }));
const vector = (first = 1, second = 0) => [first, second, ...Array<number>(1022).fill(0)];

describe('Python-compatible score presentation', () => {
  it('preserves exact binary rounding and ties to even', () => {
    expect([0.28125, 0.28135, 0.00125, -0.28125, 0.00005, 1.23445].map(roundScore)).toEqual([0.2812, 0.2813, 0.0013, -0.2812, 0.0001, 1.2345]);
  });
});

describe.skipIf(!testUrl)('recommendation API against PostgreSQL', () => {
  beforeAll(async () => {
    await withDatabase({ DATABASE_URL: testUrl } as ApiEnv, async db => {
      await db.execute(sql`CREATE SCHEMA ${sql.identifier(schemaName)}`);
      for (const table of ['users', 'events', 'saved_events']) await db.execute(sql`CREATE TABLE ${sql.identifier(schemaName)}.${sql.identifier(table)} (LIKE public.${sql.identifier(table)} INCLUDING ALL)`);
    });
    await withDatabase(env, async db => {
      await db.insert(users).values({ firebaseUid: schemaName, email: `${schemaName}@example.test`, preferredName: 'Fixture', interests: ['social'] });
      await db.insert(events).values([
        { id: 'source01', title: 'Source', source: 'manual', locationName: 'UBC', eventDate: new Date('2028-01-01Z'), vibes: ['social'], embeddingVector: vector() },
        { id: 'aligned1', title: 'Aligned', source: 'manual', locationName: 'UBC', eventDate: new Date('2030-02-01Z'), vibes: ['social'], embeddingVector: vector() },
        { id: 'orthog01', title: 'Orthogonal', source: 'manual', locationName: 'UBC', eventDate: new Date('2030-03-01Z'), vibes: ['academic'], embeddingVector: vector(0, 1) },
        { id: 'novector', title: 'Vibe only', source: 'manual', locationName: 'UBC', eventDate: new Date('2030-04-01Z'), vibes: ['social'] },
        { id: 'zero0001', title: 'Zero vector', source: 'manual', locationName: 'UBC', eventDate: new Date('2030-05-01Z'), vibes: ['social'], embeddingVector: vector(0, 0) },
        { id: 'archived', title: 'Archived', source: 'manual', locationName: 'UBC', eventDate: new Date('2040-01-01Z'), vibes: ['social'], embeddingVector: vector(), isArchived: true },
      ]);
    });
  });
  afterAll(async () => {
    await withDatabase({ DATABASE_URL: testUrl } as ApiEnv, db => db.execute(sql`DROP SCHEMA IF EXISTS ${sql.identifier(schemaName)} CASCADE`));
  });

  it('ranks vector candidates with hybrid cosine/Jaccard scores and handles zero norms', async () => {
    const response = await request('/recommendations/events/source01/similar?n=3');
    expect(response.status).toBe(200);
    const body = await response.json() as Body;
    expect(body.event_id).toBe('source01');
    expect(body.events.map((event: { id: string }) => event.id)).toEqual(['aligned1', 'zero0001', 'orthog01']);
    expect(body.scores).toEqual([1, 0.5, 0]);
    expect(body.events[0]).not.toHaveProperty('embeddingVector');
  });

  it('uses positive vibe overlap when the source has no embedding and ignores vibe_weight then', async () => {
    const body = await (await request('/recommendations/events/novector/similar?vibe_weight=0')).json() as Body;
    expect(body.events.map((event: { id: string }) => event.id)).toEqual(['aligned1', 'source01', 'zero0001']);
    expect(body.scores).toEqual([1, 1, 1]);
  });

  it('requires member authentication and falls back to recent events even without future dates', async () => {
    expect((await request('/recommendations/events/for-you')).status).toBe(401);
    const body = await (await request('/recommendations/events/for-you?n=5', true)).json() as Body;
    expect(body.source).toBe('recent');
    expect(body.events.map((event: { id: string }) => event.id)).toEqual(['zero0001', 'novector', 'orthog01', 'aligned1', 'source01']);
    expect(body.scores).toEqual([0, 0, 0, 0, 0]);
  });

  it('averages saved vectors in PostgreSQL, excludes saves and keeps the saved-events source', async () => {
    await withDatabase(env, async db => {
      const [member] = await db.select().from(users);
      await db.insert(savedEvents).values({ userId: member!.id, eventId: 'source01' });
    });
    const body = await (await request('/recommendations/events/for-you?n=3', true)).json() as Body;
    expect(body.source).toBe('saved_events');
    expect(body.events.map((event: { id: string }) => event.id)).toEqual(['aligned1', 'zero0001', 'orthog01']);
    expect(body.scores).toEqual([1, 0.5, 0]);
  });

  it('materializes the recent-200 boundary before filtering missing vectors', async () => {
    await withDatabase(env, async db => {
      const fixture = Array.from({ length: 200 }, (_, index) => ({ id: `b${String(index).padStart(7, '0')}`, title: 'Boundary fixture', source: 'manual', locationName: 'UBC', eventDate: new Date('2099-01-01Z') }));
      await db.insert(events).values(fixture);
      try {
        expect(await personalizedEvents(db, { embedding: vector(), savedEventIds: [], vibes: ['social'], topN: 5 })).toEqual([]);
      } finally {
        await db.execute(sql`DELETE FROM events WHERE id LIKE 'b%'`);
      }
    });
  });

  it('preserves the cosine shortlist boundary before hybrid vibe ranking', async () => {
    await withDatabase(env, async db => {
      const fixture = Array.from({ length: 100 }, (_, index) => ({
        id: `a${String(index).padStart(7, '0')}`, title: 'Shortlist fixture', source: 'manual', locationName: 'UBC',
        eventDate: new Date('2030-01-01Z'), embeddingVector: vector(), vibes: ['academic'] as const,
      }));
      await db.insert(events).values(fixture.map(event => ({ ...event, vibes: [...event.vibes] })));
      try {
        const source = (await db.select().from(events)).find(event => event.id === 'source01')!;
        const ranked = await similarEvents(db, source, { topN: 1, vibeWeight: 1 });
        // Perfect-vector ties use IDs to select 100 rows. The later ID aligned1
        // has a perfect vibe score but must never enter hybrid ranking.
        expect(ranked.map(([event]) => event.id)).toEqual(['a0000000']);
        expect(ranked.map(([, score]) => score)).toEqual([0]);
      } finally {
        await db.execute(sql`DELETE FROM events WHERE id ~ '^a[0-9]{7}$'`);
      }
    });
  });

  it('validates ranking parameters and hides archived sources', async () => {
    expect((await request('/recommendations/events/archived/similar')).status).toBe(404);
    for (const query of ['n=0', 'n=21', 'n=1.5', 'vibe_weight=1.1', 'vibe_weight=-0.1']) expect((await request(`/recommendations/events/source01/similar?${query}`)).status).toBe(422);
  });
});
