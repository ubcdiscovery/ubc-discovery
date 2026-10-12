import { and, desc, eq, getTableColumns, gte, ilike, lt, or, sql } from 'drizzle-orm';
import { Elysia, t } from 'elysia';
import { CloudflareAdapter } from 'elysia/adapter/cloudflare-worker';
import { withDatabase } from '../db';
import { eventRatings, events } from '../db/schema';
import type { ApiEnv } from '../env';
import { ApiError } from '../http/errors';
import { presentEvent, presentPastEvent } from '../presenters/events';
import { createServices, type ServicesFactory } from '../services';

const { embeddingVector: _vector, ...eventColumns } = getTableColumns(events);
export { eventColumns };
const pagination = t.Object({
  skip: t.Optional(t.Numeric({ minimum: 0, multipleOf: 1, default: 0 })),
  limit: t.Optional(t.Numeric({ maximum: 100, multipleOf: 1, default: 20 })),
}, { additionalProperties: true });

function pageLimit(value: number | undefined, fallback: number): number {
  const limit = value ?? fallback;
  // Python's upper-bound-only validator lets negative LIMIT reach PostgreSQL,
  // which fails. Drizzle would silently omit it and return unbounded rows.
  if (limit < 0) throw new Error('Negative pagination limit');
  return limit;
}

export function createEventRoutes(env: ApiEnv, servicesFactory: ServicesFactory = () => createServices(env)) {
  return new Elysia({ name: 'discovery-events', adapter: CloudflareAdapter, prefix: '/events' })
    .get('', async ({ query }) => {
      const services = servicesFactory();
      return withDatabase(env, async db => {
        const rows = await db.select(eventColumns).from(events)
          .where(and(gte(events.eventDate, services.now()), eq(events.isArchived, false)))
          .orderBy(desc(events.eventDate), desc(events.createdAt)).offset(query.skip ?? 0).limit(pageLimit(query.limit, 20));
        return { events: rows.map(event => presentEvent(event, services.storage)) };
      });
    }, { query: pagination, detail: { tags: ['Events'] } })
    .get('/past', async ({ query }) => {
      const services = servicesFactory();
      return withDatabase(env, async db => {
        const rows = await db.select({ ...eventColumns,
          average: sql<number | null>`avg(${eventRatings.stars})::double precision`,
          count: sql<number>`count(${eventRatings.stars})`.mapWith(Number),
        }).from(events).leftJoin(eventRatings, eq(events.id, eventRatings.eventId))
          .where(and(lt(events.eventDate, services.now()), eq(events.isArchived, false)))
          .groupBy(events.id).orderBy(desc(events.eventDate), desc(events.createdAt))
          .offset(query.skip ?? 0).limit(pageLimit(query.limit, 20));
        return { events: rows.map(event => presentPastEvent(event, event.average, event.count, services.storage)) };
      });
    }, { query: pagination, detail: { tags: ['Events'] } })
    .get('/search', async ({ query }) => {
      const services = servicesFactory();
      const term = (query.q ?? '').trim();
      if (term.length < 2) return { events: [] };
      return withDatabase(env, async db => {
        const pattern = `%${term}%`;
        const rows = await db.select(eventColumns).from(events)
          .where(and(gte(events.eventDate, services.now()), eq(events.isArchived, false), or(
            ilike(events.title, pattern), ilike(events.description, pattern), ilike(events.locationName, pattern), ilike(events.clubName, pattern),
          )))
          .orderBy(events.eventDate).limit(pageLimit(query.limit, 10));
        return { events: rows.map(event => presentEvent(event, services.storage)) };
      });
    }, { query: t.Object({ q: t.Optional(t.String({ default: '' })), limit: t.Optional(t.Numeric({ maximum: 50, multipleOf: 1, default: 10 })) }, { additionalProperties: true }), detail: { tags: ['Events'] } })
    .get('/:event_id', async ({ params }) => {
      const services = servicesFactory();
      return withDatabase(env, async db => {
        const [event] = await db.select(eventColumns).from(events).where(and(eq(events.id, params.event_id), eq(events.isArchived, false))).limit(1);
        if (!event) throw new ApiError(404, 'Event not found');
        return presentEvent(event, services.storage);
      });
    }, { detail: { tags: ['Events'] } });
}
