import { Elysia, t } from "elysia";
import { presentUpload } from "../../presenters/storage";
import { CloudflareAdapter } from "elysia/adapter/cloudflare-worker";
import { and, desc, eq, exists, ilike, or, sql } from "drizzle-orm";
import { events, eventAuditLogs as audits } from "../../db/schema";
import { integerSetting, type ApiEnv } from "../../env";
import { ApiError } from "../../http/errors";
import { presentAdminEvent, eventImageKey, withHosts } from "../../presenters/events";
import { hostMatch, hostsForEvent } from "../../services/hosts";
import { createEventSchema, updateEventSchema } from "../../schemas/events";
import { uploadFileSize } from "../../schemas/upload-size";
import type { ServicesFactory } from "../../services";
import {
  createCanonicalEvent,
  addEventAudit,
  eventSnapshot,
  updateCanonicalEvent,
} from "../../services/event-administration";
import { adminTransaction } from "./common";
export function createAdminEventRoutes(env: ApiEnv, servicesFactory: ServicesFactory) {
  const routes = new Elysia({
    name: "admin-events",
    adapter: CloudflareAdapter,
    prefix: "/admin/events",
  })
    .get(
      "",
      ({ request, query }) =>
        adminTransaction(env, request, servicesFactory, async (tx, _actor, services) => {
          const conditions = [];
          const term = (query.q ?? "").trim();
          if (term) {
            const pattern = `%${term}%`;
            conditions.push(
              or(
                ilike(events.title, pattern),
                ilike(events.description, pattern),
                ilike(events.locationName, pattern),
                exists(hostMatch(pattern)),
              ),
            );
          }
          if (query.status === "active") conditions.push(eq(events.isArchived, false));
          if (query.status === "archived") conditions.push(eq(events.isArchived, true));
          const rows = await tx
            .select()
            .from(events)
            .where(and(...conditions))
            .orderBy(desc(events.eventDate), desc(events.createdAt))
            .offset(query.skip ?? 0)
            .limit(query.limit ?? 25);
          const [total] = await tx
            .select({ value: sql<number>`count(*)`.mapWith(Number) })
            .from(events)
            .where(and(...conditions));
          return {
            events: (await withHosts(tx, rows)).map(([event, hosts]) =>
              presentAdminEvent(event, hosts, services.storage),
            ),
            total: total!.value,
          };
        }),
      {
        query: t.Object(
          {
            q: t.Optional(t.String()),
            skip: t.Optional(t.Numeric({ minimum: 0, multipleOf: 1 })),
            limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100, multipleOf: 1 })),
            status: t.Optional(
              t.Union([t.Literal("all"), t.Literal("active"), t.Literal("archived")]),
            ),
          },
          { additionalProperties: true },
        ),
        detail: { tags: ["Admin Events"] },
      },
    )
    .get(
      "/:event_id/audit",
      ({ request, params }) =>
        adminTransaction(env, request, servicesFactory, async (tx) => {
          const [event] = await tx
            .select({ id: events.id })
            .from(events)
            .where(eq(events.id, params.event_id));
          if (!event) throw new ApiError(404, "Event not found");
          const rows = await tx
            .select()
            .from(audits)
            .where(eq(audits.eventId, event.id))
            .orderBy(audits.createdAt, audits.id);
          return {
            entries: rows.map((item) => ({
              id: item.id,
              event_id: item.eventId,
              actor_type: item.actorType,
              actor_id: item.actorId,
              action: item.action,
              before: item.before,
              after: item.after,
              created_at: item.createdAt.toISOString(),
            })),
          };
        }),
      { detail: { tags: ["Admin Events"] } },
    )
    .get(
      "/:event_id",
      ({ request, params }) =>
        adminTransaction(env, request, servicesFactory, async (tx, _actor, services) => {
          const [event] = await tx.select().from(events).where(eq(events.id, params.event_id));
          if (!event) throw new ApiError(404, "Event not found");
          return presentAdminEvent(event, await hostsForEvent(tx, event.id), services.storage);
        }),
      { detail: { tags: ["Admin Events"] } },
    )
    .post(
      "",
      ({ request, body }) =>
        adminTransaction(
          env,
          request,
          servicesFactory,
          async (tx, actor, services) => {
            const created = await createCanonicalEvent(tx, body, actor, services);
            return presentAdminEvent(created.event, created.hosts, services.storage);
          },
          true,
        ),
      { body: createEventSchema, detail: { tags: ["Admin Events"] } },
    )
    .put(
      "/:event_id",
      ({ request, params, body }) =>
        adminTransaction(env, request, servicesFactory, async (tx, actor, services) => {
          const [event] = await tx
            .select()
            .from(events)
            .where(eq(events.id, params.event_id))
            .for("update");
          if (!event) throw new ApiError(404, "Event not found");
          return presentAdminEvent(
            ...(await updateCanonicalEvent(tx, event, body, actor, services)),
            services.storage,
          );
        }),
      { body: updateEventSchema, detail: { tags: ["Admin Events"] } },
    )
    .post(
      "/:event_id/presigned-upload",
      ({ request, params }) =>
        adminTransaction(env, request, servicesFactory, async (tx, actor, services) => {
          const [event] = await tx.select().from(events).where(eq(events.id, params.event_id));
          if (!event) throw new ApiError(404, "Event not found");
          const maxBytes = integerSetting(env.EVENT_IMAGE_MAX_BYTES, 3 * 1024 * 1024);
          const fileSizeBytes = uploadFileSize(request, maxBytes, env.STORAGE_PROVIDER === "r2");
          const upload = await services.storage.generatePresignedUpload({
            fileKey: eventImageKey(event.id),
            contentType: "image/webp",
            maxFileSizeBytes: maxBytes,
            fileSizeBytes,
          });
          await addEventAudit(
            tx,
            event,
            actor,
            "image_upload",
            null,
            { event_picture_key: upload.file_key },
            services.now(),
          );
          return presentUpload(upload, maxBytes);
        }),
      { parse: "none", detail: { tags: ["Admin Events"] } },
    );
  for (const [path, archived] of [
    ["archive", true],
    ["restore", false],
  ] as const) {
    routes.post(
      `/:event_id/${path}`,
      ({ request, params }) =>
        adminTransaction(env, request, servicesFactory, async (tx, actor, services) => {
          const [event] = await tx
            .select()
            .from(events)
            .where(eq(events.id, params.event_id))
            .for("update");
          if (!event) throw new ApiError(404, "Event not found");
          const hosts = await hostsForEvent(tx, event.id);
          if (event.isArchived === archived)
            return presentAdminEvent(event, hosts, services.storage);
          const [saved] = await tx
            .update(events)
            .set({
              isArchived: archived,
              archivedAt: archived ? services.now() : null,
              archivedBy: archived ? actor.actorId : null,
            })
            .where(eq(events.id, event.id))
            .returning();
          await addEventAudit(
            tx,
            saved!,
            actor,
            archived ? "archive" : "restore",
            eventSnapshot(event, hosts),
            eventSnapshot(saved!, hosts),
            services.now(),
          );
          return presentAdminEvent(saved!, hosts, services.storage);
        }),
      { parse: "none", detail: { tags: ["Admin Events"] } },
    );
  }
  routes.delete(
    "/:event_id",
    ({ request, params }) =>
      adminTransaction(env, request, servicesFactory, async (tx, actor, services) => {
        const [event] = await tx
          .select()
          .from(events)
          .where(eq(events.id, params.event_id))
          .for("update");
        if (!event) throw new ApiError(404, "Event not found");
        if (!event.isArchived) {
          const hosts = await hostsForEvent(tx, event.id);
          const [saved] = await tx
            .update(events)
            .set({ isArchived: true, archivedAt: services.now(), archivedBy: actor.actorId })
            .where(eq(events.id, event.id))
            .returning();
          await addEventAudit(
            tx,
            saved!,
            actor,
            "archive",
            eventSnapshot(event, hosts),
            eventSnapshot(saved!, hosts),
            services.now(),
          );
        }
        return new Response(null, { status: 204 });
      }),
    { parse: "none", detail: { tags: ["Admin Events"] } },
  );
  return routes;
}
