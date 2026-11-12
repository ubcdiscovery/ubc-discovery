import { Elysia, t } from "elysia";
import { CloudflareAdapter } from "elysia/adapter/cloudflare-worker";
import { eq, inArray } from "drizzle-orm";
import { withDatabase } from "../../db";
import { eventListingCandidates as candidates } from "../../db/schema";
import type { ApiEnv } from "../../env";
import { requireApiCredential } from "../../http/auth";
import { ApiError } from "../../http/errors";
import { createServices, type ServicesFactory } from "../../services";
import { enqueueCandidates } from "../../services/extraction-queue";

/**
 * Explicit replay: advance each unfinished Candidate's generation, clear its terminal
 * error and send it to the extraction Queue. Deliveries of earlier generations become stale.
 */
export function createReplayRoutes(
  env: ApiEnv,
  servicesFactory: ServicesFactory = () => createServices(env),
) {
  return new Elysia({
    name: "queue-extraction-replay",
    adapter: CloudflareAdapter,
    prefix: "/extraction",
  }).post(
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
                    processingDispatchedAt: services.now(),
                  })
                  .where(eq(candidates.id, candidate.id));
                replayed.push({
                  candidate_id: candidate.id,
                  generation: candidate.processingGeneration + 1,
                });
              }
            // Send last: if it fails (503), the replay is rolled back and can simply be repeated.
            await enqueueCandidates(env, replayed);
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
  );
}
