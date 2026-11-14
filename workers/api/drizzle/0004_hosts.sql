CREATE TABLE "candidate_hosts" (
	"candidate_id" varchar(8) NOT NULL,
	"host_handle" varchar(30) NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "candidate_hosts_pkey" PRIMARY KEY("candidate_id","host_handle")
);
--> statement-breakpoint
CREATE TABLE "event_hosts" (
	"event_id" varchar(8) NOT NULL,
	"host_handle" varchar(30) NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "event_hosts_pkey" PRIMARY KEY("event_id","host_handle")
);
--> statement-breakpoint
CREATE TABLE "hosts" (
	"handle" varchar(30) PRIMARY KEY NOT NULL,
	"display_name" varchar(255),
	"profile_name" varchar(255),
	"instagram_user_id" varchar(32),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_host_handle" CHECK ("hosts"."handle" ~ '^[a-z0-9._]{1,30}$')
);
--> statement-breakpoint
ALTER TABLE "event_listing_candidates" ADD COLUMN "is_repost" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "candidate_hosts" ADD CONSTRAINT "candidate_hosts_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "public"."event_listing_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_hosts" ADD CONSTRAINT "candidate_hosts_host_handle_fkey" FOREIGN KEY ("host_handle") REFERENCES "public"."hosts"("handle") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "event_hosts" ADD CONSTRAINT "event_hosts_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_hosts" ADD CONSTRAINT "event_hosts_host_handle_fkey" FOREIGN KEY ("host_handle") REFERENCES "public"."hosts"("handle") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "ix_candidate_hosts_host_handle" ON "candidate_hosts" USING btree ("host_handle");--> statement-breakpoint
CREATE INDEX "ix_event_hosts_host_handle" ON "event_hosts" USING btree ("host_handle");--> statement-breakpoint
-- Backfill: one Host per Instagram account Candidates came from, named by the club
-- name extraction read most often for it until ingestion supplies the profile name.
INSERT INTO "hosts" ("handle", "profile_name")
SELECT lower(trim("source_account")), mode() WITHIN GROUP (ORDER BY nullif(trim("club_name"), ''))
FROM "event_listing_candidates"
WHERE "source_type" = 'instagram' AND lower(trim("source_account")) ~ '^[a-z0-9._]{1,30}$'
GROUP BY 1;--> statement-breakpoint
-- Manual Event Listings whose organizer text is an Instagram handle.
INSERT INTO "hosts" ("handle")
SELECT DISTINCT lower(trim("club_name")) FROM "events"
WHERE "source" = 'manual' AND lower(trim("club_name")) ~ '^[a-z0-9._]{1,30}$'
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "candidate_hosts" ("candidate_id", "host_handle", "position")
SELECT c."id", h."handle", 0
FROM "event_listing_candidates" c JOIN "hosts" h ON h."handle" = lower(trim(c."source_account"))
WHERE c."source_type" = 'instagram';--> statement-breakpoint
-- Published Candidates share their id with the Event Listing.
INSERT INTO "event_hosts" ("event_id", "host_handle", "position")
SELECT e."id", ch."host_handle", ch."position"
FROM "events" e JOIN "candidate_hosts" ch ON ch."candidate_id" = e."id";--> statement-breakpoint
INSERT INTO "event_hosts" ("event_id", "host_handle", "position")
SELECT e."id", h."handle", 0
FROM "events" e JOIN "hosts" h ON h."handle" = lower(trim(e."club_name"))
WHERE e."source" = 'manual'
ON CONFLICT DO NOTHING;
