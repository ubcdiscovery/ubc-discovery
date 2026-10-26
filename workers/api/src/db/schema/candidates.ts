import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  json,
  pgTable,
  text,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import {
  instant,
  uuidId,
  createdAt,
  updatedAt,
  createShortId,
  type SourceLabel,
  type EventVibe,
  type CandidateStatus,
  type AuditActorType,
} from "./common";

export const eventListingCandidates = pgTable(
  "event_listing_candidates",
  {
    id: varchar("id", { length: 8 }).primaryKey().$defaultFn(createShortId),
    description: text("description")
      .notNull()
      .$defaultFn(() => ""),
    sourceAccount: varchar("source_account", { length: 255 }).notNull(),
    sourceUrl: varchar("source_url", { length: 1024 }),
    sourceType: varchar("source_type", { length: 50 }).notNull(),
    externalSourceId: varchar("external_source_id", { length: 512 }).notNull(),
    imageKeys: json("image_keys")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::json`),
    postedAt: instant("posted_at"),
    isEvent: boolean("is_event"),
    title: varchar("title", { length: 500 }),
    locationName: varchar("location_name", { length: 255 }),
    eventDate: instant("event_date"),
    eventEndDate: instant("event_end_date"),
    clubName: varchar("club_name", { length: 255 }),
    vibes: json("vibes")
      .$type<EventVibe[]>()
      .notNull()
      .default(sql`'[]'::json`),
    sourceLabel: varchar("source_label", { length: 50 }).$type<SourceLabel>(),
    extractedOriginal: json("extracted_original").$type<Record<string, unknown> | unknown[]>(),
    extractionModel: varchar("extraction_model", { length: 100 }),
    extractedAt: instant("extracted_at"),
    captureReadyAt: instant("capture_ready_at"),
    processingDispatchedAt: instant("processing_dispatched_at"),
    processingCompletedAt: instant("processing_completed_at"),
    processingError: text("processing_error"),
    processingGeneration: integer("processing_generation").notNull().default(1),
    status: varchar("status", { length: 32 }).$type<CandidateStatus>().notNull().default("pending"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("uq_candidate_source_identity").on(table.sourceType, table.externalSourceId),
    check(
      "ck_event_listing_candidate_status",
      sql`${table.status} IN ('pending', 'approved', 'rejected')`,
    ),
    check(
      "ck_event_listing_candidate_source_label",
      sql`${table.sourceLabel} IS NULL OR ${table.sourceLabel} IN ('ubc_official', 'ams_club', 'campus_community')`,
    ),
    index("ix_event_listing_candidates_source_type").on(table.sourceType),
    index("ix_event_listing_candidates_status").on(table.status),
    index("ix_event_listing_candidates_created_at").on(table.createdAt),
  ],
);

export const eventListingCandidateIngestionAudits = pgTable(
  "event_listing_candidate_ingestion_audits",
  {
    id: uuidId(),
    candidateId: varchar("candidate_id", { length: 8 }).notNull(),
    sourceType: varchar("source_type", { length: 50 }).notNull(),
    externalSourceId: varchar("external_source_id", { length: 512 }).notNull(),
    outcome: varchar("outcome", { length: 32 }).$type<"created" | "existing">().notNull(),
    actorType: varchar("actor_type", { length: 50 }).$type<AuditActorType>().notNull(),
    actorId: uuid("actor_id").notNull(),
    credentialLabel: varchar("credential_label", { length: 80 }).notNull(),
    receivedAt: instant("received_at").notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "event_listing_candidate_ingestion_audits_candidate_id_fkey",
      columns: [table.candidateId],
      foreignColumns: [eventListingCandidates.id],
    }).onDelete("restrict"),
    index("ix_event_listing_candidate_ingestion_audits_candidate_id").on(table.candidateId),
    index("ix_event_listing_candidate_ingestion_audits_received_at").on(table.receivedAt),
    check(
      "ck_candidate_ingestion_audit_actor_type",
      sql`${table.actorType} IN ('member', 'api_key')`,
    ),
    check("ck_candidate_ingestion_audit_outcome", sql`${table.outcome} IN ('created', 'existing')`),
  ],
);

/** Retained solely for rollback compatibility; Cloudflare Queues owns dispatch. */
export const candidateExtractionJobs = pgTable(
  "candidate_extraction_jobs",
  {
    id: uuidId(),
    candidateId: varchar("candidate_id", { length: 8 }).notNull(),
    status: varchar("status", { length: 32 })
      .$type<"pending" | "claimed" | "succeeded" | "failed">()
      .notNull()
      .default("pending"),
    availableAt: instant("available_at").notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    claimedAt: instant("claimed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      name: "candidate_extraction_jobs_candidate_id_fkey",
      columns: [table.candidateId],
      foreignColumns: [eventListingCandidates.id],
    }).onDelete("restrict"),
    unique("uq_candidate_extraction_job_candidate_id").on(table.candidateId),
    check(
      "ck_candidate_extraction_job_status",
      sql`${table.status} IN ('pending', 'claimed', 'succeeded', 'failed')`,
    ),
    index("ix_candidate_extraction_jobs_status_available_at").on(table.status, table.availableAt),
  ],
);

export type EventListingCandidate = typeof eventListingCandidates.$inferSelect;
