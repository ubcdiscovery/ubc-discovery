import { Elysia, t } from "elysia";
import { CloudflareAdapter } from "elysia/adapter/cloudflare-worker";
import { eq, inArray } from "drizzle-orm";
import { withDatabase } from "../../db";
import { eventListingCandidates as candidates } from "../../db/schema";
import { type ApiEnv } from "../../env";
import { requireApiCredential } from "../../http/auth";
import { ApiError } from "../../http/errors";
import { deliveriesSchema, deliverySchema, resultsSchema } from "../../schemas/candidates";
import { parseDate } from "../../schemas/events";
import { createServices, type ServicesFactory } from "../../services";
import { processAutoPublication } from "../../services/candidate-publication";
import { postgresErrorCode } from "../../services/event-administration";
import { captureTimedOut } from "../../services/extraction-queue";
import { SYSTEM_PROMPT, RESPONSE_SCHEMA } from "./contract";
import { settledStatus, uniqueDeliveries, lockedCandidate, extractionFields } from "./candidates";

/** Evidence, result and terminal callbacks from the extraction Worker. */
export function createDeliveryRoutes(
  env: ApiEnv,
  servicesFactory: ServicesFactory = () => createServices(env),
) {
  return new Elysia({
    name: "queue-extraction-delivery",
    adapter: CloudflareAdapter,
    prefix: "/extraction",
  })
    .post(
      "/evidence",
      async ({ request, body }) => {
        uniqueDeliveries(body.candidates);
        const services = servicesFactory();
        return withDatabase(
          env,
          async (db) =>
            db.transaction(async (tx) => {
              await requireApiCredential(tx, request, "candidates:extract", services.now());
              const rows = await tx
                .select()
                .from(candidates)
                .where(
                  inArray(
                    candidates.id,
                    body.candidates.map((item) => item.candidate_id),
                  ),
                )
                .orderBy(candidates.createdAt, candidates.id);
              const byId = new Map(rows.map((item) => [item.id, item]));
              const items = [];
              for (const delivery of body.candidates) {
                const candidate = byId.get(delivery.candidate_id);
                if (!candidate) {
                  items.push({
                    candidate_id: delivery.candidate_id,
                    generation: delivery.generation,
                    state: "missing",
                  });
                  continue;
                }
                let state: string;
                if (candidate.processingGeneration !== delivery.generation) state = "stale";
                else if (candidate.processingCompletedAt || candidate.status !== "pending")
                  state = "completed";
                else if (candidate.processingError) state = "terminal";
                else if (candidate.extractedAt) state = "extracted";
                else if (
                  !candidate.captureReadyAt &&
                  !captureTimedOut(candidate, services.now(), env)
                )
                  state = "waiting";
                else state = "ready";
                const item: Record<string, unknown> = {
                  candidate_id: candidate.id,
                  generation: delivery.generation,
                  state,
                  created_at: candidate.createdAt.toISOString(),
                };
                if (state === "ready") {
                  const images = [];
                  for (const key of candidate.imageKeys ?? [])
                    if (await services.storage.objectExists(key))
                      images.push({
                        url: await services.storage.generatePresignedDownloadUrl(key),
                      });
                  Object.assign(item, {
                    caption: candidate.description,
                    source_account: candidate.sourceAccount,
                    source_type: candidate.sourceType,
                    reference_timestamp: (candidate.postedAt ?? candidate.createdAt).toISOString(),
                    images,
                  });
                }
                items.push(item);
              }
              return {
                model: env.EXTRACTION_MODEL || "gpt-5.6-luna",
                reasoning_effort: env.EXTRACTION_REASONING_EFFORT || "none",
                image_detail: env.EXTRACTION_IMAGE_DETAIL || "high",
                system_prompt: SYSTEM_PROMPT,
                schema: RESPONSE_SCHEMA,
                items,
              };
            }),
          { direct: true },
        );
      },
      { body: deliveriesSchema, detail: { tags: ["Queue Extraction"] } },
    )
    .post(
      "/results",
      async ({ request, body }) => {
        if (new Set(body.results.map((item) => item.candidate_id)).size !== body.results.length)
          throw new ApiError(422, "results must have unique candidate IDs");
        for (const item of body.results) {
          if (item.extraction && item.extraction.candidate_id !== item.candidate_id)
            throw new ApiError(422, "extraction candidate_id must match result candidate_id");
          if (item.extraction) {
            parseDate(item.extraction.event_date, true);
            parseDate(item.extraction.event_end_date, true);
          }
        }
        const services = servicesFactory();
        return withDatabase(
          env,
          async (db) => {
            const rows = await db.transaction(async (tx) => {
              await requireApiCredential(tx, request, "candidates:extract", services.now());
              return tx
                .select()
                .from(candidates)
                .where(
                  inArray(
                    candidates.id,
                    body.results.map((item) => item.candidate_id),
                  ),
                )
                .orderBy(candidates.createdAt, candidates.id)
                .for("update");
            });
            const byId = new Map(body.results.map((item) => [item.candidate_id, item]));
            const found = new Set(rows.map((item) => item.id));
            const outcomes: { candidate_id: string; status: string }[] = body.results
              .filter((item) => !found.has(item.candidate_id))
              .map((item) => ({ candidate_id: item.candidate_id, status: "missing" }));
            for (const row of rows) {
              const item = byId.get(row.id)!;
              const status = await db.transaction(async (tx) => {
                const candidate = await lockedCandidate(tx, row.id);
                if (!candidate) return "missing";
                const settled = settledStatus(candidate, item.generation);
                if (settled) return settled;
                if (!candidate.extractedAt) {
                  if (!item.extraction)
                    throw new ApiError(409, `Extraction required for ${candidate.id}`);
                  if (!candidate.captureReadyAt && !captureTimedOut(candidate, services.now(), env))
                    throw new ApiError(409, `Capture not ready for ${candidate.id}`);
                  await tx
                    .update(candidates)
                    .set(extractionFields(item.extraction, body.model, services.now()))
                    .where(eq(candidates.id, candidate.id));
                }
                return null;
              });
              if (status) {
                outcomes.push({ candidate_id: row.id, status });
                continue;
              }
              try {
                const publicationStatus = await db.transaction(async (tx) => {
                  const candidate = await lockedCandidate(tx, row.id);
                  if (!candidate) return "missing";
                  const settled = settledStatus(candidate, item.generation);
                  if (settled) return settled;
                  try {
                    await tx.transaction(async (savepoint) =>
                      processAutoPublication(savepoint, candidate, services),
                    );
                  } catch (error) {
                    if (
                      !(error instanceof ApiError && error.status === 422) &&
                      !postgresErrorCode(error)?.startsWith("23")
                    )
                      throw error;
                    console.warn(
                      JSON.stringify({
                        event: "auto_publication_withheld",
                        candidate_id: candidate.id,
                      }),
                    );
                  }
                  await tx
                    .update(candidates)
                    .set({ processingCompletedAt: services.now() })
                    .where(eq(candidates.id, candidate.id));
                  return "completed";
                });
                outcomes.push({ candidate_id: row.id, status: publicationStatus });
              } catch {
                console.warn(
                  JSON.stringify({ event: "queue_publication_retry", candidate_id: row.id }),
                );
                outcomes.push({ candidate_id: row.id, status: "retry" });
              }
            }
            return { results: outcomes };
          },
          { direct: true },
        );
      },
      { body: resultsSchema, detail: { tags: ["Queue Extraction"] } },
    )
    .post(
      "/terminal",
      async ({ request, body }) => {
        const services = servicesFactory();
        return withDatabase(
          env,
          async (db) =>
            db.transaction(async (tx) => {
              await requireApiCredential(tx, request, "candidates:extract", services.now());
              const candidate = await lockedCandidate(tx, body.candidate_id);
              if (
                candidate &&
                candidate.processingGeneration === body.generation &&
                !candidate.processingCompletedAt &&
                candidate.status === "pending"
              ) {
                await tx
                  .update(candidates)
                  .set({ processingError: body.error })
                  .where(eq(candidates.id, candidate.id));
              }
              return {
                candidate_id: body.candidate_id,
                status:
                  candidate && candidate.processingGeneration !== body.generation
                    ? "stale"
                    : "terminal",
              };
            }),
          { direct: true },
        );
      },
      {
        body: t.Object(
          { ...deliverySchema.properties, error: t.String({ minLength: 1, maxLength: 2000 }) },
          { additionalProperties: true },
        ),
        detail: { tags: ["Queue Extraction"] },
      },
    );
}
