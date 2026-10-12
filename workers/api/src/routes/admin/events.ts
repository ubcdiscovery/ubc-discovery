import { Elysia, t } from 'elysia';
import { presentUpload } from '../../presenters/storage';
import { CloudflareAdapter } from 'elysia/adapter/cloudflare-worker';
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { events, eventAuditLogs as audits, type Event } from '../../db/schema';
import { integerSetting, type ApiEnv } from '../../env';
import { ApiError } from '../../http/errors';
import { presentAdminEvent, eventImageKey } from '../../presenters/events';
import { createEventSchema, updateEventSchema, parseDate, checkEndDate, type EventUpdate } from '../../schemas/events';
import type { ServicesFactory } from '../../services';
import { createCanonicalEvent, addEventAudit, eventSnapshot, embeddingFor } from '../../services/event-administration';
import { adminTransaction } from './common';
export function createAdminEventRoutes(env: ApiEnv, servicesFactory: ServicesFactory) {
 const routes = new Elysia({ name: 'admin-events', adapter: CloudflareAdapter, prefix: '/admin/events' })
 .get('', ({ request, query }) => adminTransaction(env, request, servicesFactory, async (tx, _actor, services) => {
  const conditions = [];
  const term = (query.q ?? '').trim();
  if (term) { const pattern = `%${term}%`; conditions.push(or(ilike(events.title, pattern), ilike(events.description, pattern), ilike(events.locationName, pattern), ilike(events.clubName, pattern))); }
  if (query.status === 'active') conditions.push(eq(events.isArchived, false));
  if (query.status === 'archived') conditions.push(eq(events.isArchived, true));
  const rows = await tx.select().from(events).where(and(...conditions)).orderBy(desc(events.eventDate), desc(events.createdAt)).offset(query.skip ?? 0).limit(query.limit ?? 25);
  const [total] = await tx.select({ value: sql<number>`count(*)`.mapWith(Number) }).from(events).where(and(...conditions));
  return { events: rows.map(event => presentAdminEvent(event, services.storage)), total: total!.value };
 }), { query: t.Object({ q: t.Optional(t.String()), skip: t.Optional(t.Numeric({ minimum: 0, multipleOf: 1 })), limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100, multipleOf: 1 })),
  status: t.Optional(t.Union([t.Literal('all'), t.Literal('active'), t.Literal('archived')])) }, { additionalProperties: true }), detail: { tags: ['Admin Events'] } })
 .get('/:event_id/audit', ({ request, params }) => adminTransaction(env, request, servicesFactory, async tx => {
  const [event] = await tx.select({ id: events.id }).from(events).where(eq(events.id, params.event_id));
  if (!event) throw new ApiError(404, 'Event not found');
  const rows = await tx.select().from(audits).where(eq(audits.eventId, event.id)).orderBy(audits.createdAt, audits.id);
  return { entries: rows.map(item => ({ id: item.id, event_id: item.eventId, actor_type: item.actorType, actor_id: item.actorId, action: item.action,
   before: item.before, after: item.after, created_at: item.createdAt.toISOString() })) };
 }), { detail: { tags: ['Admin Events'] } })
 .get('/:event_id', ({ request, params }) => adminTransaction(env, request, servicesFactory, async (tx, _actor, services) => {
  const [event] = await tx.select().from(events).where(eq(events.id, params.event_id));
  if (!event) throw new ApiError(404, 'Event not found');
  return presentAdminEvent(event, services.storage);
 }), { detail: { tags: ['Admin Events'] } })
 .post('', ({ request, body }) => adminTransaction(env, request, servicesFactory, async (tx, actor, services) => {
  return presentAdminEvent(await createCanonicalEvent(tx, body, actor, services), services.storage);
 }, true), { body: createEventSchema, detail: { tags: ['Admin Events'] } })
 .put('/:event_id', ({ request, params, body }) => adminTransaction(env, request, servicesFactory, async (tx, actor, services) => {
  const [event] = await tx.select().from(events).where(eq(events.id, params.event_id)).for('update');
  if (!event) throw new ApiError(404, 'Event not found');
  const before = eventSnapshot(event);
  const changes = eventChanges(body);
  checkEndDate(changes.eventDate ?? event.eventDate, changes.eventEndDate === undefined ? event.eventEndDate : changes.eventEndDate);
  const updated = { ...event, ...changes };
  const embeddingFields = ['title', 'description', 'clubName', 'vibes', 'locationName', 'eventDate', 'eventEndDate'] as const;
  const embeddingChanged = embeddingFields.some(field => field in changes && JSON.stringify(event[field]) !== JSON.stringify(updated[field]));
  if (embeddingChanged) {
   const embedding = await embeddingFor(updated, services);
   if (embedding) changes.embeddingVector = embedding;
  }
  if (Object.keys(changes).length) {
   const [saved] = await tx.update(events).set(changes).where(eq(events.id, event.id)).returning();
   await addEventAudit(tx, saved!, actor, 'update', before, eventSnapshot(saved!), services.now());
   return presentAdminEvent(saved!, services.storage);
  }
  return presentAdminEvent(event, services.storage);
 }), { body: updateEventSchema, detail: { tags: ['Admin Events'] } })
 .post('/:event_id/presigned-upload', ({ request, params }) => adminTransaction(env, request, servicesFactory, async (tx, actor, services) => {
  const [event] = await tx.select().from(events).where(eq(events.id, params.event_id));
  if (!event) throw new ApiError(404, 'Event not found');
  const maxBytes = integerSetting(env.EVENT_IMAGE_MAX_BYTES, 3 * 1024 * 1024);
  const upload = await services.storage.generatePresignedUpload({ fileKey: eventImageKey(event.id), contentType: 'image/webp', maxFileSizeBytes: maxBytes });
  await addEventAudit(tx, event, actor, 'image_upload', null, { event_picture_key: upload.file_key }, services.now());
  return presentUpload(upload, maxBytes);
 }), { parse: 'none', detail: { tags: ['Admin Events'] } });
 for (const [path, archived] of [['archive', true], ['restore', false]] as const) {
  routes.post(`/:event_id/${path}`, ({ request, params }) => adminTransaction(env, request, servicesFactory, async (tx, actor, services) => {
   const [event] = await tx.select().from(events).where(eq(events.id, params.event_id)).for('update');
   if (!event) throw new ApiError(404, 'Event not found');
   if (event.isArchived === archived) return presentAdminEvent(event, services.storage);
   const [saved] = await tx.update(events).set({ isArchived: archived, archivedAt: archived ? services.now() : null, archivedBy: archived ? actor.actorId : null }).where(eq(events.id, event.id)).returning();
   await addEventAudit(tx, saved!, actor, archived ? 'archive' : 'restore', eventSnapshot(event), eventSnapshot(saved!), services.now());
   return presentAdminEvent(saved!, services.storage);
  }), { parse: 'none', detail: { tags: ['Admin Events'] } });
 }
 routes.delete('/:event_id', ({ request, params }) => adminTransaction(env, request, servicesFactory, async (tx, actor, services) => {
  const [event] = await tx.select().from(events).where(eq(events.id, params.event_id)).for('update');
  if (!event) throw new ApiError(404, 'Event not found');
  if (!event.isArchived) {
   const [saved] = await tx.update(events).set({ isArchived: true, archivedAt: services.now(), archivedBy: actor.actorId }).where(eq(events.id, event.id)).returning();
   await addEventAudit(tx, saved!, actor, 'archive', eventSnapshot(event), eventSnapshot(saved!), services.now());
  }
  return new Response(null, { status: 204 });
 }), { parse: 'none', detail: { tags: ['Admin Events'] } });
 return routes;
}
function eventChanges(body: EventUpdate): Partial<Event> {
 const changes: Partial<Event> = {};
 if (body.title !== undefined) changes.title = body.title;
 if (body.description !== undefined) changes.description = body.description;
 if (body.source !== undefined) changes.source = body.source;
 if (body.source_label !== undefined) changes.sourceLabel = body.source_label;
 if (body.source_url !== undefined) changes.sourceUrl = body.source_url;
 if (body.club_name !== undefined) changes.clubName = body.club_name;
 if (body.vibes !== undefined) changes.vibes = body.vibes;
 if (body.location_name !== undefined) {
  const value = body.location_name.trim();
  if (!value) throw new ApiError(422, 'location_name must contain location text');
  changes.locationName = value;
 }
 if (body.event_date !== undefined) {
  const date = parseDate(body.event_date);
  if (!date) throw new ApiError(422, 'event_date must not be null');
  changes.eventDate = date;
 }
 if (body.event_end_date !== undefined) changes.eventEndDate = parseDate(body.event_end_date);
 return changes;
}
