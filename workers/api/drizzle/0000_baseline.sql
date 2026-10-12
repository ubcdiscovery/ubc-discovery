-- Schema equivalent to the former Alembic head (0012_queue_extraction).
-- Production databases created by Alembic record this migration as applied instead of running it.
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE TABLE "api_credential_audit_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"credential_id" uuid NOT NULL,
	"actor_type" varchar(50) NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" varchar(50) NOT NULL,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_api_credential_audit_actor_type" CHECK ("api_credential_audit_logs"."actor_type" IN ('member', 'api_key')),
	CONSTRAINT "ck_api_credential_audit_action" CHECK ("api_credential_audit_logs"."action" IN ('create', 'replace', 'revoke'))
);
--> statement-breakpoint
CREATE TABLE "api_credentials" (
	"id" uuid PRIMARY KEY NOT NULL,
	"label" varchar(80) NOT NULL,
	"scopes" jsonb DEFAULT '["candidates:ingest"]'::jsonb NOT NULL,
	"secret_hash" varchar(255) NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "ck_api_credential_scopes" CHECK (jsonb_typeof("api_credentials"."scopes") = 'array' AND jsonb_array_length("api_credentials"."scopes") > 0 AND "api_credentials"."scopes" <@ '["candidates:ingest","candidates:extract"]'::jsonb)
);
--> statement-breakpoint
CREATE TABLE "candidate_extraction_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"candidate_id" varchar(8) NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_candidate_extraction_job_candidate_id" UNIQUE("candidate_id"),
	CONSTRAINT "ck_candidate_extraction_job_status" CHECK ("candidate_extraction_jobs"."status" IN ('pending', 'claimed', 'succeeded', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "event_audit_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" varchar(8) NOT NULL,
	"actor_type" varchar(50) NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" varchar(50) NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_event_audit_actor_type" CHECK ("event_audit_logs"."actor_type" IN ('member', 'api_key', 'system')),
	CONSTRAINT "ck_event_audit_action" CHECK ("event_audit_logs"."action" IN ('create', 'update', 'image_upload', 'archive', 'restore'))
);
--> statement-breakpoint
CREATE TABLE "event_listing_candidate_ingestion_audits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"candidate_id" varchar(8) NOT NULL,
	"source_type" varchar(50) NOT NULL,
	"external_source_id" varchar(512) NOT NULL,
	"outcome" varchar(32) NOT NULL,
	"actor_type" varchar(50) NOT NULL,
	"actor_id" uuid NOT NULL,
	"credential_label" varchar(80) NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_candidate_ingestion_audit_actor_type" CHECK ("event_listing_candidate_ingestion_audits"."actor_type" IN ('member', 'api_key')),
	CONSTRAINT "ck_candidate_ingestion_audit_outcome" CHECK ("event_listing_candidate_ingestion_audits"."outcome" IN ('created', 'existing'))
);
--> statement-breakpoint
CREATE TABLE "event_listing_candidates" (
	"id" varchar(8) PRIMARY KEY NOT NULL,
	"description" text NOT NULL,
	"source_account" varchar(255) NOT NULL,
	"source_url" varchar(1024),
	"source_type" varchar(50) NOT NULL,
	"external_source_id" varchar(512) NOT NULL,
	"image_keys" json DEFAULT '[]'::json NOT NULL,
	"posted_at" timestamp with time zone,
	"is_event" boolean,
	"title" varchar(500),
	"location_name" varchar(255),
	"event_date" timestamp with time zone,
	"event_end_date" timestamp with time zone,
	"club_name" varchar(255),
	"vibes" json DEFAULT '[]'::json NOT NULL,
	"source_label" varchar(50),
	"extracted_original" json,
	"extraction_model" varchar(100),
	"extracted_at" timestamp with time zone,
	"capture_ready_at" timestamp with time zone,
	"processing_dispatched_at" timestamp with time zone,
	"processing_completed_at" timestamp with time zone,
	"processing_error" text,
	"processing_generation" integer DEFAULT 1 NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_candidate_source_identity" UNIQUE("source_type","external_source_id"),
	CONSTRAINT "ck_event_listing_candidate_status" CHECK ("event_listing_candidates"."status" IN ('pending', 'approved', 'rejected')),
	CONSTRAINT "ck_event_listing_candidate_source_label" CHECK ("event_listing_candidates"."source_label" IS NULL OR "event_listing_candidates"."source_label" IN ('ubc_official', 'ams_club', 'campus_community'))
);
--> statement-breakpoint
CREATE TABLE "event_ratings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"event_id" varchar(8) NOT NULL,
	"stars" double precision NOT NULL,
	"strong_vibes" json NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_user_event_rating" UNIQUE("user_id","event_id")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" varchar(8) PRIMARY KEY NOT NULL,
	"title" varchar(500) NOT NULL,
	"description" text NOT NULL,
	"source" varchar(50) NOT NULL,
	"source_label" varchar(50) NOT NULL,
	"source_url" varchar(1024),
	"club_name" varchar(255),
	"vibes" json NOT NULL,
	"location_name" varchar(255) NOT NULL,
	"event_date" timestamp with time zone NOT NULL,
	"event_end_date" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"embedding_vector" vector(1024),
	CONSTRAINT "ck_event_source_label" CHECK ("events"."source_label" IN ('ubc_official', 'ams_club', 'campus_community'))
);
--> statement-breakpoint
CREATE TABLE "otp_codes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" varchar(255) NOT NULL,
	"code" varchar(6) NOT NULL,
	"attempts" integer NOT NULL,
	"used" boolean NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_events" (
	"user_id" uuid NOT NULL,
	"event_id" varchar(8) NOT NULL,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_events_pkey" PRIMARY KEY("user_id","event_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"firebase_uid" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL,
	"preferred_name" varchar(255) NOT NULL,
	"major" varchar(255),
	"academic_level" varchar(32),
	"faculty_id" varchar(64),
	"interests" jsonb,
	"bio" text,
	"profile_picture_key" varchar(512),
	"last_active_at" timestamp with time zone,
	"is_admin" boolean NOT NULL,
	"ubc_verified" boolean NOT NULL,
	"onboarding_completed" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_users_faculty_id" CHECK ("users"."faculty_id" IN ('applied-science', 'architecture-landscape-architecture', 'arts', 'sauder', 'dentistry', 'education', 'forestry-environmental-stewardship', 'kinesiology', 'land-food-systems', 'law', 'medicine', 'music', 'nursing', 'pharmaceutical-sciences', 'science', 'social-work', 'vantage-college', 'vancouver-school-economics', 'other')),
	CONSTRAINT "ck_users_academic_level" CHECK ("users"."academic_level" IN ('year_1', 'year_2', 'year_3', 'year_4', 'year_5_plus', 'graduate', 'postdoc', 'other')),
	CONSTRAINT "ck_users_major_normalized" CHECK ("users"."major" IS NULL OR ("users"."major" = btrim("users"."major") AND "users"."major" <> ''))
);
--> statement-breakpoint
ALTER TABLE "api_credential_audit_logs" ADD CONSTRAINT "api_credential_audit_logs_credential_id_fkey" FOREIGN KEY ("credential_id") REFERENCES "public"."api_credentials"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_credentials" ADD CONSTRAINT "api_credentials_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_extraction_jobs" ADD CONSTRAINT "candidate_extraction_jobs_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "public"."event_listing_candidates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_audit_logs" ADD CONSTRAINT "event_audit_logs_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_listing_candidate_ingestion_audits" ADD CONSTRAINT "event_listing_candidate_ingestion_audits_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "public"."event_listing_candidates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_ratings" ADD CONSTRAINT "event_ratings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_ratings" ADD CONSTRAINT "event_ratings_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_events" ADD CONSTRAINT "saved_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_events" ADD CONSTRAINT "saved_events_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_api_credential_audit_logs_credential_id" ON "api_credential_audit_logs" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "ix_api_credential_audit_logs_created_at" ON "api_credential_audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ix_api_credentials_created_by_user_id" ON "api_credentials" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "ix_api_credentials_created_at" ON "api_credentials" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ix_candidate_extraction_jobs_status_available_at" ON "candidate_extraction_jobs" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "ix_event_audit_logs_event_id" ON "event_audit_logs" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "ix_event_audit_logs_created_at" ON "event_audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ix_event_listing_candidate_ingestion_audits_candidate_id" ON "event_listing_candidate_ingestion_audits" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "ix_event_listing_candidate_ingestion_audits_received_at" ON "event_listing_candidate_ingestion_audits" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "ix_event_listing_candidates_source_type" ON "event_listing_candidates" USING btree ("source_type");--> statement-breakpoint
CREATE INDEX "ix_event_listing_candidates_status" ON "event_listing_candidates" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ix_event_listing_candidates_created_at" ON "event_listing_candidates" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ix_event_ratings_user_id" ON "event_ratings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ix_event_ratings_event_id" ON "event_ratings" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "ix_events_search_trgm" ON "events" USING gin ((coalesce("title", '') || ' ' || coalesce("club_name", '') || ' ' || coalesce("location_name", '')) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "ix_events_embedding_vector_hnsw" ON "events" USING hnsw ("embedding_vector" vector_cosine_ops) WHERE "events"."embedding_vector" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "ix_otp_codes_email" ON "otp_codes" USING btree ("email");--> statement-breakpoint
CREATE INDEX "ix_saved_events_user_id" ON "saved_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ix_saved_events_event_id" ON "saved_events" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ix_users_firebase_uid" ON "users" USING btree ("firebase_uid");--> statement-breakpoint
CREATE UNIQUE INDEX "ix_users_email" ON "users" USING btree ("email");