ALTER TABLE "cards" ADD COLUMN "external_key" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "external_key" text;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "external_key" text;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_external_key_unique" UNIQUE("external_key");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_external_key_unique" UNIQUE("external_key");--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_external_key_unique" UNIQUE("external_key");