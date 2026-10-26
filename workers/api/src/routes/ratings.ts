import { and, count, desc, eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { CloudflareAdapter } from "elysia/adapter/cloudflare-worker";
import { type Db, withDatabase } from "../db";
import { eventRatings, events, users } from "../db/schema";
import type { ApiEnv } from "../env";
import { requireMember } from "../http/auth";
import { ApiError } from "../http/errors";
import { memberPagination, ratingSchema } from "../schemas/member";
import { createServices, type ServicesFactory } from "../services";

function presentRating(rating: typeof eventRatings.$inferSelect, userName: string) {
  return {
    id: rating.id,
    user_id: rating.userId,
    user_name: userName,
    event_id: rating.eventId,
    stars: rating.stars,
    strong_vibes: rating.strongVibes,
    note: rating.note,
    created_at: rating.createdAt.toISOString(),
  };
}

async function verifyEvent(db: Db, eventId: string, now: Date) {
  const [event] = await db
    .select({ eventEndDate: events.eventEndDate })
    .from(events)
    .where(and(eq(events.id, eventId), eq(events.isArchived, false)))
    .limit(1);
  if (!event) throw new ApiError(404, "Event with give id NOT found");
  if (!event.eventEndDate || event.eventEndDate > now)
    throw new ApiError(400, "Event can not be rated at this time");
}

export function createRatingRoutes(
  env: ApiEnv,
  servicesFactory: ServicesFactory = () => createServices(env),
) {
  return new Elysia({ name: "member-ratings", adapter: CloudflareAdapter, normalize: false })
    .get(
      "/ratings",
      async ({ request, query }) => {
        const services = servicesFactory();
        return withDatabase(env, async (db) => {
          const member = await requireMember(db, request, services.firebase);
          const where = and(eq(eventRatings.userId, member.id), eq(events.isArchived, false));
          const [total] = await db
            .select({ count: count() })
            .from(eventRatings)
            .innerJoin(events, eq(events.id, eventRatings.eventId))
            .where(where);
          const ratings = await db
            .select({ rating: eventRatings })
            .from(eventRatings)
            .innerJoin(events, eq(events.id, eventRatings.eventId))
            .where(where)
            .orderBy(desc(eventRatings.createdAt))
            .offset(query.skip ?? 0)
            .limit(query.limit ?? 20);
          return {
            ratings: ratings.map(({ rating }) => presentRating(rating, member.preferredName)),
            total: total!.count,
          };
        });
      },
      { query: memberPagination, detail: { tags: ["Ratings"] } },
    )
    .post(
      "/ratings/mine/:event_id",
      async ({ request, body, params }) => {
        const services = servicesFactory();
        return withDatabase(env, async (db) => {
          const member = await requireMember(db, request, services.firebase);
          await verifyEvent(db, params.event_id, services.now());
          const values = {
            stars: body.stars,
            strongVibes: body.strong_vibes ?? [],
            note: body.note ?? null,
          };
          const [rating] = await db
            .insert(eventRatings)
            .values({ userId: member.id, eventId: params.event_id, ...values })
            .onConflictDoUpdate({
              target: [eventRatings.userId, eventRatings.eventId],
              set: values,
            })
            .returning();
          return presentRating(rating!, member.preferredName);
        });
      },
      { body: ratingSchema, detail: { tags: ["Ratings"] } },
    )
    .get(
      "/ratings/mine/:event_id",
      async ({ request, params }) => {
        const services = servicesFactory();
        return withDatabase(env, async (db) => {
          const member = await requireMember(db, request, services.firebase);
          await verifyEvent(db, params.event_id, services.now());
          const [rating] = await db
            .select()
            .from(eventRatings)
            .where(
              and(eq(eventRatings.userId, member.id), eq(eventRatings.eventId, params.event_id)),
            )
            .limit(1);
          if (!rating) throw new ApiError(404, "Rating not found");
          return presentRating(rating, member.preferredName);
        });
      },
      { detail: { tags: ["Ratings"] } },
    )
    .get(
      "/ratings/:event_id",
      async ({ params }) => {
        const services = servicesFactory();
        return withDatabase(env, async (db) => {
          await verifyEvent(db, params.event_id, services.now());
          const ratings = await db
            .select({ rating: eventRatings, userName: users.preferredName })
            .from(eventRatings)
            .innerJoin(users, eq(users.id, eventRatings.userId))
            .where(eq(eventRatings.eventId, params.event_id))
            .orderBy(desc(eventRatings.createdAt));
          return ratings.map(({ rating, userName }) => presentRating(rating, userName));
        });
      },
      { detail: { tags: ["Ratings"] } },
    );
}
