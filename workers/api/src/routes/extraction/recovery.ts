import { Elysia, t } from "elysia";
import { CloudflareAdapter } from "elysia/adapter/cloudflare-worker";
import { and, eq, inArray, isNull, isNotNull, lt, lte, or } from "drizzle-orm";
import { withDatabase } from "../../db";
import { eventListingCandidates as candidates } from "../../db/schema";
import { integerSetting, type ApiEnv } from "../../env";
import { requireApiCredential } from "../../http/auth";
import { ApiError } from "../../http/errors";
import { deliveriesSchema } from "../../schemas/candidates";
import { createServices, type ServicesFactory } from "../../services";
import { uniqueDeliveries } from "./candidates";

/** Recovery, replay and dispatch bookkeeping for the extraction queue. */
export function createRecoveryRoutes(
  env: ApiEnv,
  servicesFactory: ServicesFactory = () => createServices(env),
) {
  return new Elysia({
    name: "queue-extraction-recovery",
    adapter: CloudflareAdapter,
    prefix: "/extraction",
  })
    .get(
      "/recovery",
      async ({ request, query }) => {
        const services = servicesFactory();
        return withDatabase(
          env,
          async (db) =>
            db.transaction(async (tx) => {
              await requireApiCredential(tx, request, "candidates:extract", services.now());
              const limit = query.limit ?? 10;
              const cutoff = new Date(
                services.now().getTime() -
                  integerSetting(env.EXTRACTION_DELIVERY_TIMEOUT_SECONDS, 90_000) * 1000,
              );
              const expired = await tx
                .select()
                .from(candidates)
                .where(
                  and(
                    eq(candidates.status, "pending"),
                    isNull(candidates.processingCompletedAt),
                    isNull(candidates.processingError),
                    lt(candidates.processingDispatchedAt, cutoff),
                  ),
                )
                .orderBy(candidates.processingDispatchedAt, candidates.id)
                .limit(limit)
                .for("update", { skipLocked: true });
              if (expired.length)
                await tx
                  .update(candidates)
                  .set({
                    processingError:
                      "Queue delivery exceeded completion window; explicit replay required",
                  })
                  .where(
                    inArray(
                      candidates.id,
                      expired.map((item) => item.id),
                    ),
                  );
              const waitingCutoff = new Date(
                services.now().getTime() -
                  integerSetting(env.EXTRACTION_IMAGE_WAIT_SECONDS, 300) * 1000,
              );
              const rows = await tx
                .select()
                .from(candidates)
                .where(
                  and(
                    eq(candidates.status, "pending"),
                    isNull(candidates.processingCompletedAt),
                    isNull(candidates.processingError),
                    isNull(candidates.processingDispatchedAt),
                    or(
                      isNotNull(candidates.captureReadyAt),
                      lte(candidates.createdAt, waitingCutoff),
                    ),
                  ),
                )
                .orderBy(candidates.createdAt, candidates.id)
                .limit(limit)
                .for("update", { skipLocked: true });
              return {
                candidates: rows.map((item) => ({
                  candidate_id: item.id,
                  generation: item.processingGeneration,
                })),
              };
            }),
          { direct: true },
        );
      },
      {
        query: t.Object(
          {
            limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100, multipleOf: 1, default: 10 })),
          },
          { additionalProperties: true },
        ),
        detail: { tags: ["Queue Extraction"] },
      },
    )
    .post(
      "/replay",
      async ({ request, body }) => {
        if (new Set(body.candidate_ids).size !== body.candidate_ids.length)
          throw new ApiError(422, "candidate_ids must be unique");
        const services = servicesFactory();
        return withDatabase(
          env,
          async (db) =>
            db.transaction(async (tx) => {
              await requireApiCredential(tx, request, "candidates:extract", services.now());
              const rows = await tx
                .select()
                .from(candidates)
                .where(inArray(candidates.id, body.candidate_ids))
                .orderBy(candidates.id)
                .for("update");
              const replayed = [];
              for (const candidate of rows)
                if (!candidate.processingCompletedAt && candidate.status === "pending") {
                  await tx
                    .update(candidates)
                    .set({
                      processingGeneration: candidate.processingGeneration + 1,
                      processingError: null,
                      processingDispatchedAt: null,
                    })
                    .where(eq(candidates.id, candidate.id));
                  replayed.push({
                    candidate_id: candidate.id,
                    generation: candidate.processingGeneration + 1,
                  });
                }
              return { candidates: replayed };
            }),
          { direct: true },
        );
      },
      {
        body: t.Object(
          { candidate_ids: t.Array(t.String(), { minItems: 1, maxItems: 10 }) },
          { additionalProperties: true },
        ),
        detail: { tags: ["Queue Extraction"] },
      },
    )
    .post(
      "/dispatched",
      async ({ request, body }) => {
        uniqueDeliveries(body.candidates);
        const services = servicesFactory();
        return withDatabase(
          env,
          async (db) =>
            db.transaction(async (tx) => {
              await requireApiCredential(tx, request, "candidates:extract", services.now());
              for (const delivery of body.candidates)
                await tx
                  .update(candidates)
                  .set({ processingDispatchedAt: services.now() })
                  .where(
                    and(
                      eq(candidates.id, delivery.candidate_id),
                      eq(candidates.processingGeneration, delivery.generation),
                      isNull(candidates.processingCompletedAt),
                      isNull(candidates.processingError),
                      isNull(candidates.processingDispatchedAt),
                    ),
                  );
              return {
                candidates: body.candidates.map((item) => ({
                  candidate_id: item.candidate_id,
                  generation: item.generation,
                })),
              };
            }),
          { direct: true },
        );
      },
      { body: deliveriesSchema, detail: { tags: ["Queue Extraction"] } },
    );
}
