ALTER TABLE "events" ADD COLUMN "embedding_model" varchar(100);--> statement-breakpoint
-- Every vector stored before this migration came from Bedrock Titan Text Embeddings V2.
UPDATE "events" SET "embedding_model" = 'amazon.titan-embed-text-v2:0' WHERE "embedding_vector" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "ck_event_embedding_model" CHECK (("events"."embedding_vector" IS NULL) = ("events"."embedding_model" IS NULL));
