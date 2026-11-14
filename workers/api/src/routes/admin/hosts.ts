import { and, asc, eq, ilike, or, sql } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { CloudflareAdapter } from "elysia/adapter/cloudflare-worker";
import { eventHosts, events, hosts, type Host } from "../../db/schema";
import type { ApiEnv } from "../../env";
import { ApiError } from "../../http/errors";
import type { ServicesFactory } from "../../services";
import { normalizeHandle } from "../../services/hosts";
import { hostEventCounts, hostNameSql, presentHost } from "../hosts";
import { adminTransaction } from "./common";

function presentAdminHost(host: Host, counts: { upcoming: number; past: number }) {
  return {
    ...presentHost(host, counts),
    display_name: host.displayName,
    profile_name: host.profileName,
    instagram_user_id: host.instagramUserId,
    created_at: host.createdAt.toISOString(),
    updated_at: host.updatedAt.toISOString(),
  };
}

export function createAdminHostRoutes(env: ApiEnv, servicesFactory: ServicesFactory) {
  return new Elysia({ name: "admin-hosts", adapter: CloudflareAdapter, prefix: "/admin/hosts" })
    .get(
      "",
      ({ request, query }) =>
        adminTransaction(env, request, servicesFactory, async (tx, _actor, services) => {
          const term = (query.q ?? "").trim().replace(/^@/, "");
          const pattern = `%${term}%`;
          const where = term
            ? or(
                ilike(hosts.handle, pattern),
                ilike(hosts.displayName, pattern),
                ilike(hosts.profileName, pattern),
              )
            : undefined;
          const counts = hostEventCounts(services.now());
          const rows = await tx
            .select({ host: hosts, upcoming: counts.upcoming, past: counts.past })
            .from(hosts)
            .leftJoin(eventHosts, eq(eventHosts.hostHandle, hosts.handle))
            .leftJoin(events, and(eq(events.id, eventHosts.eventId), eq(events.isArchived, false)))
            .where(where)
            .groupBy(hosts.handle)
            // Exact handle matches first, so the picker can confirm an existing Host.
            .orderBy(
              sql`${hosts.handle} = ${term.toLowerCase()} desc`,
              asc(sql`lower(${hostNameSql})`),
              asc(hosts.handle),
            )
            .offset(query.skip ?? 0)
            .limit(query.limit ?? 25);
          const [total] = await tx
            .select({ value: sql<number>`count(*)`.mapWith(Number) })
            .from(hosts)
            .where(where);
          return {
            hosts: rows.map((row) => presentAdminHost(row.host, row)),
            total: total!.value,
          };
        }),
      {
        query: t.Object(
          {
            q: t.Optional(t.String({ maxLength: 100 })),
            skip: t.Optional(t.Numeric({ minimum: 0, multipleOf: 1 })),
            limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100, multipleOf: 1 })),
          },
          { additionalProperties: true },
        ),
        detail: { tags: ["Admin Hosts"] },
      },
    )
    .put(
      "/:handle",
      ({ request, params, body }) =>
        adminTransaction(env, request, servicesFactory, async (tx, _actor, services) => {
          const handle = normalizeHandle(params.handle);
          if (!handle) throw new ApiError(404, "Host not found");
          const [host] = await tx
            .update(hosts)
            .set({ displayName: body.display_name?.trim() || null })
            .where(eq(hosts.handle, handle))
            .returning();
          if (!host) throw new ApiError(404, "Host not found");
          const [counts] = await tx
            .select(hostEventCounts(services.now()))
            .from(eventHosts)
            .innerJoin(events, and(eq(events.id, eventHosts.eventId), eq(events.isArchived, false)))
            .where(eq(eventHosts.hostHandle, handle));
          return presentAdminHost(host, counts ?? { upcoming: 0, past: 0 });
        }),
      {
        body: t.Object(
          { display_name: t.Nullable(t.String({ maxLength: 255 })) },
          { additionalProperties: false },
        ),
        detail: { tags: ["Admin Hosts"] },
      },
    );
}
