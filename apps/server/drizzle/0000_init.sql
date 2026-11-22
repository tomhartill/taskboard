CREATE TYPE "public"."actor" AS ENUM('you', 'claude', 'intake', 'github');--> statement-breakpoint
CREATE TYPE "public"."card_column" AS ENUM('triage', 'today', 'in_progress', 'review', 'blocked', 'done');--> statement-breakpoint
CREATE TYPE "public"."card_kind" AS ENUM('work', 'personal');--> statement-breakpoint
CREATE TYPE "public"."card_mode" AS ENUM('auto', 'wait');--> statement-breakpoint
CREATE TYPE "public"."pr_state" AS ENUM('open', 'merged', 'closed');--> statement-breakpoint
CREATE TYPE "public"."card_priority" AS ENUM('high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."card_source" AS ENUM('manual', 'email', 'enquiry');--> statement-breakpoint
CREATE TABLE "activity" (
	"id" serial PRIMARY KEY NOT NULL,
	"card_id" integer NOT NULL,
	"actor" "actor" NOT NULL,
	"text" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cards" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"brief" text DEFAULT '' NOT NULL,
	"column" "card_column" DEFAULT 'today' NOT NULL,
	"rank" double precision NOT NULL,
	"kind" "card_kind" DEFAULT 'work' NOT NULL,
	"project_id" integer,
	"priority" "card_priority" DEFAULT 'medium' NOT NULL,
	"mode" "card_mode" DEFAULT 'wait' NOT NULL,
	"source" "card_source" DEFAULT 'manual' NOT NULL,
	"source_url" text,
	"planned_day" date,
	"session_url" text,
	"branch" text,
	"pr_url" text,
	"pr_state" "pr_state",
	"blocked_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"done_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "events" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"payload" jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"colour" smallint DEFAULT 1 NOT NULL,
	"repo" text,
	"claude_project_url" text,
	"default_mode" "card_mode" DEFAULT 'wait' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '90 days' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_card_idx" ON "activity" USING btree ("card_id","at");--> statement-breakpoint
CREATE INDEX "cards_column_rank_idx" ON "cards" USING btree ("column","rank");--> statement-breakpoint
CREATE INDEX "cards_planned_day_idx" ON "cards" USING btree ("planned_day");