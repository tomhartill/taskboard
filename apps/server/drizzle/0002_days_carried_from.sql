ALTER TYPE "public"."actor" ADD VALUE 'system';--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "carried_from" date;