import { Elysia } from "elysia";
import { CloudflareAdapter } from "elysia/adapter/cloudflare-worker";
import { eq } from "drizzle-orm";
import { withDatabase } from "../../db";
import { eventListingCandidates as candidates } from "../../db/schema";
import { integerSetting, type ApiEnv } from "../../env";
import { requireApiCredential } from "../../http/auth";
import { ApiError } from "../../http/errors";
import { candidateIngestionSchema } from "../../schemas/candidates";
import { candidateImageFileSizes } from "../../schemas/upload-size";
import { createServices, type ServicesFactory } from "../../services";
import { ingestCandidate } from "../../services/candidate-ingestion";
import { captureTimedOut, enqueueCandidates } from "../../services/extraction-queue";

export function createIngestionRoutes(
  env: ApiEnv,
  servicesFactory: ServicesFactory = () => createServices(env),
) {
  return new Elysia({
    name: "candidate-ingestion",
    adapter: CloudflareAdapter,
    prefix: "/ingestion/event-candidates",
  })
    .post(
      "",
      async ({ request, body, set }) => {
        const services = servicesFactory();
        return withDatabase(
          env,
          async (db) => {
            const result = await db.transaction(async (tx) => {
              const credential = await requireApiCredential(
                tx,
                request,
                "candidates:ingest",
                services.now(),
              );
              const sizes = candidateImageFileSizes(
                request,
                body.image_content_types.length,
                integerSetting(env.CANDIDATE_IMAGE_MAX_BYTES, 5 * 1024 * 1024),
                env.STORAGE_PROVIDER === "r2",
              );
              return ingestCandidate(tx, body, credential, services, env, sizes);
            });
            set.status = result.outcome === "created" ? 201 : 200;
            return result;
          },
          { direct: true },
        );
      },
      { body: candidateIngestionSchema, detail: { tags: ["Candidate Ingestion"] } },
    )
    .post(
      "/:candidate_id/capture-ready",
      async ({ request, params }) => {
        const services = servicesFactory();
        return withDatabase(
          env,
          async (db) =>
            db.transaction(async (tx) => {
              await requireApiCredential(tx, request, "candidates:ingest", services.now());
              const [candidate] = await tx
                .select()
                .from(candidates)
                .where(eq(candidates.id, params.candidate_id))
                .for("update");
              if (!candidate) throw new ApiError(404, "Candidate not found");
              if (candidate.processingCompletedAt || candidate.status !== "pending")
                return {
                  candidate_id: params.candidate_id,
                  status: "completed",
                  dispatched: false,
                };
              const exists = await Promise.all(
                (candidate.imageKeys ?? []).map((key) => services.storage.objectExists(key)),
              );
              if (
                exists.some((value) => !value) &&
                !captureTimedOut(candidate, services.now(), env)
              )
                throw new ApiError(409, "Candidate image uploads are incomplete");
              const dispatch = !candidate.processingError && !candidate.processingDispatchedAt;
              await tx
                .update(candidates)
                .set({
                  captureReadyAt: candidate.captureReadyAt ?? services.now(),
                  ...(dispatch ? { processingDispatchedAt: services.now() } : {}),
                })
                .where(eq(candidates.id, candidate.id));
              // Send last: if it fails (503), nothing is recorded and the ingester's retry sends again.
              if (dispatch)
                await enqueueCandidates(env, [
                  { candidate_id: candidate.id, generation: candidate.processingGeneration },
                ]);
              return { candidate_id: params.candidate_id, status: "ready", dispatched: dispatch };
            }),
          { direct: true },
        );
      },
      { parse: "none", detail: { tags: ["Candidate Ingestion"] } },
    );
}
