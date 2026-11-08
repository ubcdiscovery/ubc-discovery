DROP TABLE "otp_codes" CASCADE;--> statement-breakpoint
DROP INDEX "ix_users_firebase_uid";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "firebase_uid";