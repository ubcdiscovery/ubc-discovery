import { and, count, desc, eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { CloudflareAdapter } from "elysia/adapter/cloudflare-worker";
import { withDatabase } from "../db";
import { events, savedEvents } from "../db/schema";
import type { ApiEnv } from "../env";
import { requireMember } from "../http/auth";
import { ApiError } from "../http/errors";
import { presentEvent } from "../presenters/events";
import { memberPagination } from "../schemas/member";
import { createServices, type ServicesFactory } from "../services";

export function createSavedEventRoutes(
  env: ApiEnv,
  servicesFactory: ServicesFactory = () => createServices(env),
) {
  return new Elysia({ name: "member-saved-events", adapter: CloudflareAdapter, normalize: false })
    .get(
      "/saved-events",
      async ({ request, query }) => {
        const services = servicesFactory();
        return withDatabase(env, async (db) => {
          const member = await requireMember(db, request, services.firebase);
          const where = and(eq(savedEvents.userId, member.id), eq(events.isArchived, false));
          const [total] = await db
            .select({ count: count() })
            .from(savedEvents)
            .innerJoin(events, eq(events.id, savedEvents.eventId))
            .where(where);
          const rows = await db
            .select({ savedAt: savedEvents.savedAt, event: events })
            .from(savedEvents)
            .innerJoin(events, eq(events.id, savedEvents.eventId))
            .where(where)
            .orderBy(desc(savedEvents.savedAt))
            .offset(query.skip ?? 0)
            .limit(query.limit ?? 20);
          return {
            saved_events: rows.map((row) => ({
              saved_at: row.savedAt.toISOString(),
              event: presentEvent(row.event, services.storage),
            })),
            total: total!.count,
          };
        });
      },
      { query: memberPagination, detail: { tags: ["Saved Events"] } },
    )
    .put(
      "/saved-events/:event_id",
      async ({ request, params, set }) => {
        const services = servicesFactory();
        return withDatabase(env, async (db) => {
          const member = await requireMember(db, request, services.firebase);
          const [event] = await db
            .select({ id: events.id })
            .from(events)
            .where(and(eq(events.id, params.event_id), eq(events.isArchived, false)))
            .limit(1);
          if (!event) throw new ApiError(404, "Event not found");
          const [saved] = await db
            .insert(savedEvents)
            .values({ userId: member.id, eventId: params.event_id })
            .onConflictDoNothing({ target: [savedEvents.userId, savedEvents.eventId] })
            .returning();
          if (saved) {
            set.status = 201;
            set.headers.Location = `/saved-events/${params.event_id}`;
            return { event_id: saved.eventId, saved_at: saved.savedAt.toISOString() };
          }
          const [existing] = await db
            .select()
            .from(savedEvents)
            .where(and(eq(savedEvents.userId, member.id), eq(savedEvents.eventId, params.event_id)))
            .limit(1);
          if (!existing) throw new ApiError(409, "Saved event changed. Try again.");
          set.status = 200;
          return { event_id: existing.eventId, saved_at: existing.savedAt.toISOString() };
        });
      },
      { parse: "none", detail: { tags: ["Saved Events"] } },
    )
    .delete(
      "/saved-events/:event_id",
      async ({ request, params }) => {
        const services = servicesFactory();
        await withDatabase(env, async (db) => {
          const member = await requireMember(db, request, services.firebase);
          await db
            .delete(savedEvents)
            .where(
              and(eq(savedEvents.userId, member.id), eq(savedEvents.eventId, params.event_id)),
            );
        });
        return new Response(null, { status: 204 });
      },
      { parse: "none", detail: { tags: ["Saved Events"] } },
    );
}
