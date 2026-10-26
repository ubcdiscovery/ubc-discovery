import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { CloudflareAdapter } from "elysia/adapter/cloudflare-worker";
import { withDatabase } from "../db";
import { events, savedEvents } from "../db/schema";
import type { ApiEnv } from "../env";
import { requireMember } from "../http/auth";
import { ApiError } from "../http/errors";
import { presentEvent } from "../presenters/events";
import { createServices, type ServicesFactory } from "../services";
import {
  averageSavedEmbedding,
  personalizedEvents,
  roundScore,
  similarEvents,
  VIBE_WEIGHT_DEFAULT,
} from "../services/recommender";
import { eventColumns } from "./events";

export function createRecommendationRoutes(
  env: ApiEnv,
  servicesFactory: ServicesFactory = () => createServices(env),
) {
  return new Elysia({
    name: "discovery-recommendations",
    adapter: CloudflareAdapter,
    prefix: "/recommendations",
  })
    .get(
      "/events/:event_id/similar",
      async ({ params, query }) => {
        const services = servicesFactory();
        return withDatabase(env, async (db) => {
          const [source] = await db
            .select()
            .from(events)
            .where(and(eq(events.id, params.event_id), eq(events.isArchived, false)))
            .limit(1);
          if (!source) throw new ApiError(404, "Event not found");
          const ranked = await similarEvents(db, source, {
            topN: query.n ?? 5,
            vibeWeight: query.vibe_weight ?? VIBE_WEIGHT_DEFAULT,
          });
          return {
            event_id: params.event_id,
            events: ranked.map(([event]) => presentEvent(event, services.storage)),
            scores: ranked.map(([, score]) => roundScore(score)),
          };
        });
      },
      {
        query: t.Object(
          {
            n: t.Optional(t.Numeric({ minimum: 1, maximum: 20, multipleOf: 1, default: 5 })),
            vibe_weight: t.Optional(
              t.Numeric({ minimum: 0, maximum: 1, default: VIBE_WEIGHT_DEFAULT }),
            ),
          },
          { additionalProperties: true },
        ),
        detail: { tags: ["Recommendations"] },
      },
    )
    .get(
      "/events/for-you",
      async ({ request, query }) => {
        const services = servicesFactory();
        return withDatabase(env, async (db) => {
          const user = await requireMember(db, request, services.firebase);
          const saves = await db
            .select()
            .from(savedEvents)
            .where(eq(savedEvents.userId, user.id))
            .orderBy(desc(savedEvents.savedAt), savedEvents.eventId)
            .limit(100);
          if (saves.length > 0) {
            const savedEventIds = saves.map((save) => save.eventId);
            const vibeRows = await db
              .select({ vibes: events.vibes })
              .from(events)
              .where(and(inArray(events.id, savedEventIds), eq(events.isArchived, false)));
            const taste = await averageSavedEmbedding(db, savedEventIds);
            const counts = new Map<string, number>();
            for (const row of vibeRows)
              for (const vibe of row.vibes ?? []) counts.set(vibe, (counts.get(vibe) ?? 0) + 1);
            const topSavedVibes = [...counts]
              .sort((a, b) => b[1] - a[1])
              .slice(0, 3)
              .map(([vibe]) => vibe);
            const vibes = [...new Set([...(user.interests ?? []), ...topSavedVibes])];
            if (taste !== null) {
              const ranked = await personalizedEvents(db, {
                embedding: taste,
                savedEventIds,
                vibes,
                topN: query.n ?? 10,
              });
              if (ranked.length > 0)
                return {
                  events: ranked.map(([event]) => presentEvent(event, services.storage)),
                  scores: ranked.map(([, score]) => roundScore(score)),
                  source: "saved_events",
                };
            }
          }
          const recent = await db
            .select(eventColumns)
            .from(events)
            .where(eq(events.isArchived, false))
            .orderBy(sql`${events.eventDate} DESC NULLS LAST`, desc(events.createdAt))
            .limit(query.n ?? 10);
          return {
            events: recent.map((event) => presentEvent(event, services.storage)),
            scores: recent.map(() => 0),
            source: "recent",
          };
        });
      },
      {
        query: t.Object(
          { n: t.Optional(t.Numeric({ minimum: 1, maximum: 50, multipleOf: 1, default: 10 })) },
          { additionalProperties: true },
        ),
        detail: { tags: ["Recommendations"] },
      },
    );
}
