import { Elysia, t } from "elysia";
import { CloudflareAdapter } from "elysia/adapter/cloudflare-worker";
import { and, eq, inArray, isNull, isNotNull, lt, lte, or } from "drizzle-orm";
import { withDatabase, type DbTransaction } from "../../db";
import { eventListingCandidates as candidates, type EventListingCandidate } from "../../db/schema";
import { integerSetting, type ApiEnv } from "../../env";
import { requireApiCredential } from "../../http/auth";
import { ApiError } from "../../http/errors";
import {
  deliveriesSchema,
  resultsSchema,
  deliverySchema,
  type Delivery,
  type ExtractionValue,
} from "../../schemas/candidates";
import { parseDate } from "../../schemas/events";
import { createServices, type ServicesFactory } from "../../services";
import { processAutoPublication } from "../../services/candidate-publication";
import { postgresErrorCode } from "../../services/event-administration";
import { captureTimedOut } from "../../services/extraction-queue";
import { SYSTEM_PROMPT, RESPONSE_SCHEMA } from "./contract";

export function settledStatus(candidate: EventListingCandidate, generation: number) {
  if (candidate.processingGeneration !== generation) return "stale";
  if (candidate.processingError) return "terminal";
  if (candidate.processingCompletedAt || candidate.status !== "pending") return "completed";
  return null;
}
function uniqueDeliveries(items: Delivery[]) {
  if (
    new Set(items.map((item) => JSON.stringify([item.candidate_id, item.generation]))).size !==
    items.length
  )
    throw new ApiError(422, "deliveries must be unique");
}
async function lockedCandidate(tx: DbTransaction, id: string) {
  const [candidate] = await tx.select().from(candidates).where(eq(candidates.id, id)).for("update");
  return candidate;
}
function extractionFields(value: ExtractionValue, model: string, now: Date) {
  const eventDate = parseDate(value.event_date, true);
  const eventEndDate = parseDate(value.event_end_date, true);
  const original = {
    candidate_id: value.candidate_id,
    is_event: value.is_event,
    title: value.title ?? null,
    event_date: eventDate?.toISOString() ?? null,
    event_end_date: eventEndDate?.toISOString() ?? null,
    location_name: value.location_name ?? null,
    club_name: value.club_name ?? null,
    vibes: value.vibes ?? [],
  };
  const base = {
    extractedOriginal: original,
    extractionModel: model,
    extractedAt: now,
    isEvent: value.is_event,
  };
  return value.is_event
    ? {
        ...base,
        title: value.title ?? null,
        eventDate,
        eventEndDate,
        locationName: value.location_name ?? null,
        clubName: value.club_name ?? null,
        vibes: value.vibes ?? [],
        sourceLabel: "ams_club" as const,
      }
    : {
        ...base,
        title: null,
        eventDate: null,
        eventEndDate: null,
        locationName: null,
        clubName: null,
        vibes: [],
        sourceLabel: null,
      };
}
export function createExtractionRoutes(
  env: ApiEnv,
  servicesFactory: ServicesFactory = () => createServices(env),
) {
  return new Elysia({ name: "queue-extraction", adapter: CloudflareAdapter, prefix: "/extraction" })
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
    )
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
