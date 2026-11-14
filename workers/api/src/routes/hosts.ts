import { and, asc, desc, eq, gte, ilike, lt, or, sql } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { CloudflareAdapter } from "elysia/adapter/cloudflare-worker";
import { withDatabase } from "../db";
import { eventHosts, events, hosts, type Host } from "../db/schema";
import type { ApiEnv } from "../env";
import { ApiError } from "../http/errors";
import { presentEvents } from "../presenters/events";
import { createServices, type ServicesFactory } from "../services";
import { hostName, normalizeHandle } from "../services/hosts";
import { eventColumns } from "./events";

/** SQL twin of `hostName`, for ordering. */
export const hostNameSql = sql<string>`coalesce(nullif(trim(${hosts.displayName}), ''), nullif(trim(${hosts.profileName}), ''), ${hosts.handle})`;

export function hostEventCounts(now: Date) {
  return {
    upcoming: sql<number>`count(*) filter (where ${events.eventDate} >= ${now})`.mapWith(Number),
    past: sql<number>`count(*) filter (where ${events.eventDate} < ${now})`.mapWith(Number),
  };
}

export function presentHost(host: Host, counts: { upcoming: number; past: number }) {
  return {
    handle: host.handle,
    name: hostName(host),
    instagram_url: `https://www.instagram.com/${host.handle}/`,
    upcoming_event_count: counts.upcoming,
    past_event_count: counts.past,
  };
}

const listQuery = t.Object(
  {
    q: t.Optional(t.String({ maxLength: 100 })),
    skip: t.Optional(t.Numeric({ minimum: 0, multipleOf: 1, default: 0 })),
    limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100, multipleOf: 1, default: 50 })),
  },
  { additionalProperties: true },
);

export function createHostRoutes(
  env: ApiEnv,
  servicesFactory: ServicesFactory = () => createServices(env),
) {
  return new Elysia({ name: "discovery-hosts", adapter: CloudflareAdapter, prefix: "/hosts" })
    .get(
      "",
      async ({ query }) => {
        const services = servicesFactory();
        const counts = hostEventCounts(services.now());
        const term = (query.q ?? "").trim().replace(/^@/, "");
        const pattern = `%${term}%`;
        const where = term
          ? or(
              ilike(hosts.handle, pattern),
              ilike(hosts.displayName, pattern),
              ilike(hosts.profileName, pattern),
            )
          : undefined;
        return withDatabase(env, async (db) => {
          // Only Hosts with a live Event Listing are browsable.
          const listed = db
            .select({ host: hosts, ...counts })
            .from(hosts)
            .innerJoin(eventHosts, eq(eventHosts.hostHandle, hosts.handle))
            .innerJoin(events, and(eq(events.id, eventHosts.eventId), eq(events.isArchived, false)))
            .where(where)
            .groupBy(hosts.handle);
          const rows = await listed
            .orderBy(desc(counts.upcoming), asc(sql`lower(${hostNameSql})`), asc(hosts.handle))
            .offset(query.skip ?? 0)
            .limit(query.limit ?? 50);
          const [total] = await db
            .select({ value: sql<number>`count(distinct ${hosts.handle})`.mapWith(Number) })
            .from(hosts)
            .innerJoin(eventHosts, eq(eventHosts.hostHandle, hosts.handle))
            .innerJoin(events, and(eq(events.id, eventHosts.eventId), eq(events.isArchived, false)))
            .where(where);
          return {
            hosts: rows.map((row) => presentHost(row.host, row)),
            total: total!.value,
          };
        });
      },
      { query: listQuery, detail: { tags: ["Hosts"] } },
    )
    .get(
      "/:handle",
      async ({ params }) => {
        const services = servicesFactory();
        const handle = normalizeHandle(params.handle);
        if (!handle) throw new ApiError(404, "Host not found");
        return withDatabase(env, async (db) => {
          const [host] = await db.select().from(hosts).where(eq(hosts.handle, handle));
          if (!host) throw new ApiError(404, "Host not found");
          const [counts] = await db
            .select(hostEventCounts(services.now()))
            .from(eventHosts)
            .innerJoin(events, and(eq(events.id, eventHosts.eventId), eq(events.isArchived, false)))
            .where(eq(eventHosts.hostHandle, handle));
          return presentHost(host, counts ?? { upcoming: 0, past: 0 });
        });
      },
      { detail: { tags: ["Hosts"] } },
    )
    .get(
      "/:handle/events",
      async ({ params, query }) => {
        const services = servicesFactory();
        const handle = normalizeHandle(params.handle);
        if (!handle) throw new ApiError(404, "Host not found");
        const past = query.when === "past";
        const now = services.now();
        return withDatabase(env, async (db) => {
          const [host] = await db
            .select({ handle: hosts.handle })
            .from(hosts)
            .where(eq(hosts.handle, handle));
          if (!host) throw new ApiError(404, "Host not found");
          const where = and(
            eq(eventHosts.hostHandle, handle),
            eq(events.isArchived, false),
            past ? lt(events.eventDate, now) : gte(events.eventDate, now),
          );
          const rows = await db
            .select(eventColumns)
            .from(events)
            .innerJoin(eventHosts, eq(eventHosts.eventId, events.id))
            .where(where)
            // Soonest upcoming first; most recent past first.
            .orderBy(
              past ? desc(events.eventDate) : asc(events.eventDate),
              asc(events.createdAt),
              asc(events.id),
            )
            .offset(query.skip ?? 0)
            .limit(query.limit ?? 20);
          const [total] = await db
            .select({ value: sql<number>`count(*)`.mapWith(Number) })
            .from(events)
            .innerJoin(eventHosts, eq(eventHosts.eventId, events.id))
            .where(where);
          return {
            events: await presentEvents(db, rows, services.storage),
            total: total!.value,
          };
        });
      },
      {
        query: t.Object(
          {
            when: t.Optional(t.Union([t.Literal("upcoming"), t.Literal("past")])),
            skip: t.Optional(t.Numeric({ minimum: 0, multipleOf: 1, default: 0 })),
            limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100, multipleOf: 1, default: 20 })),
          },
          { additionalProperties: true },
        ),
        detail: { tags: ["Hosts"] },
      },
    );
}
