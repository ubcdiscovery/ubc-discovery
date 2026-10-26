import { Elysia, t } from "elysia";
import { CloudflareAdapter } from "elysia/adapter/cloudflare-worker";
import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import {
  events,
  eventListingCandidates as candidates,
  type EventListingCandidate,
  type EventVibe,
} from "../../db/schema";
import type { ApiEnv } from "../../env";
import { ApiError } from "../../http/errors";
import { presentAdminCandidate, presentCandidateDetail } from "../../presenters/candidates";
import { correctCandidateSchema, type CandidateCorrection } from "../../schemas/candidates";
import { checkEndDate, parseDate } from "../../schemas/events";
import type { ServicesFactory } from "../../services";
import { publishCandidate } from "../../services/candidate-publication";
import { postgresErrorCode } from "../../services/event-administration";
import { adminTransaction } from "./common";
export function createAdminCandidateRoutes(env: ApiEnv, servicesFactory: ServicesFactory) {
  const routes = new Elysia({
    name: "admin-candidates",
    adapter: CloudflareAdapter,
    prefix: "/admin/candidates",
  })
    .get(
      "",
      ({ request, query }) =>
        adminTransaction(env, request, servicesFactory, async (tx, _actor, services) => {
          const conditions = [];
          const q = (query.q ?? "").trim();
          if (q) {
            const pattern = `%${q}%`;
            conditions.push(
              or(
                ilike(candidates.description, pattern),
                ilike(candidates.sourceAccount, pattern),
                ilike(candidates.sourceType, pattern),
                ilike(candidates.externalSourceId, pattern),
              ),
            );
          }
          if (query.status) conditions.push(eq(candidates.status, query.status));
          const source = query.source_type?.trim();
          if (source) conditions.push(eq(candidates.sourceType, source));
          const rows = await tx
            .select()
            .from(candidates)
            .where(and(...conditions))
            .orderBy(desc(candidates.createdAt), desc(candidates.id))
            .offset(query.skip ?? 0)
            .limit(query.limit ?? 25);
          const [total] = await tx
            .select({ value: sql<number>`count(*)`.mapWith(Number) })
            .from(candidates)
            .where(and(...conditions));
          return {
            candidates: await Promise.all(
              rows.map((item) => presentAdminCandidate(item, services.storage)),
            ),
            total: total!.value,
          };
        }),
      {
        query: t.Object(
          {
            q: t.Optional(t.String()),
            status: t.Optional(
              t.Union([t.Literal("pending"), t.Literal("approved"), t.Literal("rejected")]),
            ),
            source_type: t.Optional(t.String({ maxLength: 50 })),
            skip: t.Optional(t.Numeric({ minimum: 0, multipleOf: 1 })),
            limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100, multipleOf: 1 })),
          },
          { additionalProperties: true },
        ),
        detail: { tags: ["Admin Candidates"] },
      },
    )
    .get(
      "/:candidate_id",
      ({ request, params }) =>
        adminTransaction(env, request, servicesFactory, async (tx, _actor, services) => {
          const [candidate] = await tx
            .select()
            .from(candidates)
            .where(eq(candidates.id, params.candidate_id));
          if (!candidate) throw new ApiError(404, "Candidate not found");
          return presentCandidateDetail(candidate, tx, services.storage);
        }),
      { detail: { tags: ["Admin Candidates"] } },
    )
    .put(
      "/:candidate_id",
      ({ request, params, body }) =>
        adminTransaction(env, request, servicesFactory, async (tx, _actor, services) => {
          const [candidate] = await tx
            .select()
            .from(candidates)
            .where(eq(candidates.id, params.candidate_id))
            .for("update");
          if (!candidate) throw new ApiError(404, "Candidate not found");
          requirePending(candidate, "corrected");
          const changes = candidateChanges(body);
          checkEndDate(
            changes.eventDate === undefined ? candidate.eventDate : changes.eventDate,
            changes.eventEndDate === undefined ? candidate.eventEndDate : changes.eventEndDate,
            "event_end_date must be on or after event_date",
          );
          const [saved] = Object.keys(changes).length
            ? await tx
                .update(candidates)
                .set(changes)
                .where(eq(candidates.id, candidate.id))
                .returning()
            : [candidate];
          return presentCandidateDetail(saved!, tx, services.storage);
        }),
      { body: correctCandidateSchema, detail: { tags: ["Admin Candidates"] } },
    )
    .post(
      "/:candidate_id/approve",
      ({ request, params }) =>
        adminTransaction(
          env,
          request,
          servicesFactory,
          async (tx, actor, services) => {
            const [candidate] = await tx
              .select()
              .from(candidates)
              .where(eq(candidates.id, params.candidate_id))
              .for("update");
            if (!candidate) throw new ApiError(404, "Candidate not found");
            const [event] = await tx
              .select({ id: events.id })
              .from(events)
              .where(eq(events.id, candidate.id));
            if (candidate.status === "approved") {
              if (!event)
                throw new ApiError(409, "Approved Candidate has no matching Event Listing");
              return presentCandidateDetail(candidate, tx, services.storage);
            }
            requirePending(candidate, "approved");
            if (candidate.isEvent !== true)
              throw new ApiError(422, "Candidate must be classified as an event");
            if (event) throw new ApiError(409, "An Event Listing already uses this Candidate id");
            try {
              await publishCandidate(tx, candidate, actor, services);
            } catch (error) {
              if (postgresErrorCode(error) === "23505")
                throw new ApiError(409, "An Event Listing already uses this Candidate id");
              throw error;
            }
            const [saved] = await tx
              .select()
              .from(candidates)
              .where(eq(candidates.id, candidate.id));
            return presentCandidateDetail(saved!, tx, services.storage);
          },
          true,
        ),
      { parse: "none", detail: { tags: ["Admin Candidates"] } },
    );
  for (const [path, target] of [
    ["reject", "rejected"],
    ["return-to-review", "pending"],
  ] as const) {
    routes.post(
      `/:candidate_id/${path}`,
      ({ request, params }) =>
        adminTransaction(env, request, servicesFactory, async (tx, _actor, services) => {
          const [candidate] = await tx
            .select()
            .from(candidates)
            .where(eq(candidates.id, params.candidate_id))
            .for("update");
          if (!candidate) throw new ApiError(404, "Candidate not found");
          if (target === "rejected") requirePending(candidate, "rejected");
          else if (candidate.status !== "rejected")
            throw new ApiError(409, "Only rejected Candidates can return to review");
          const [saved] = await tx
            .update(candidates)
            .set({ status: target })
            .where(eq(candidates.id, candidate.id))
            .returning();
          return presentCandidateDetail(saved!, tx, services.storage);
        }),
      { parse: "none", detail: { tags: ["Admin Candidates"] } },
    );
  }
  return routes;
}
function requirePending(candidate: EventListingCandidate, action: string) {
  if (candidate.status !== "pending")
    throw new ApiError(409, `Only pending Candidates can be ${action}`);
}
function candidateChanges(body: CandidateCorrection) {
  const changes: Omit<Partial<typeof candidates.$inferInsert>, "vibes"> & {
    vibes?: EventVibe[] | SQL;
  } = {};
  if (body.is_event !== undefined) changes.isEvent = body.is_event;
  for (const [source, destination] of [
    ["title", "title"],
    ["location_name", "locationName"],
    ["club_name", "clubName"],
  ] as const) {
    if (body[source] !== undefined) changes[destination] = body[source]?.trim() || null;
  }
  if (body.event_date !== undefined) changes.eventDate = parseDate(body.event_date);
  if (body.event_end_date !== undefined) changes.eventEndDate = parseDate(body.event_end_date);
  if (body.source_label !== undefined) changes.sourceLabel = body.source_label;
  if (body.vibes !== undefined)
    changes.vibes = body.vibes === null ? sql`'null'::json` : body.vibes;
  return changes;
}
