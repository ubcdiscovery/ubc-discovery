DROP INDEX "ix_events_search_trgm";--> statement-breakpoint
CREATE INDEX "ix_events_search_trgm" ON "events" USING gin ((coalesce("title", '') || ' ' || coalesce("location_name", '')) gin_trgm_ops);--> statement-breakpoint
ALTER TABLE "events" DROP COLUMN "club_name";--> statement-breakpoint
ALTER TABLE "event_listing_candidates" DROP COLUMN "club_name";