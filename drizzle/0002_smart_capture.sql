CREATE TYPE "public"."enrichment_job_status" AS ENUM('queued', 'running', 'completed', 'dead');--> statement-breakpoint
CREATE TYPE "public"."suggestion_source" AS ENUM('history', 'ai');--> statement-breakpoint
CREATE TYPE "public"."suggestion_status" AS ENUM('pending', 'accepted', 'dismissed', 'auto_applied');--> statement-breakpoint
CREATE TABLE "ai_usage_daily" (
	"day" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_usage_daily_day_provider_model_pk" PRIMARY KEY("day","provider","model")
);
--> statement-breakpoint
CREATE TABLE "enrichment_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"resource_id" text NOT NULL,
	"status" "enrichment_job_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone,
	"lock_token" text,
	"last_error_code" text,
	"last_error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enrichment_jobs_resource_id_unique" UNIQUE("resource_id"),
	CONSTRAINT "enrichment_jobs_attempts_nonnegative_chk" CHECK ("enrichment_jobs"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "instance_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secret" text,
	"updated_by_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resource_enrichments" (
	"resource_id" text PRIMARY KEY NOT NULL,
	"summary" text,
	"language" text,
	"suggested_sections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" integer NOT NULL,
	"input_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "share_section_suggestions" (
	"share_id" text NOT NULL,
	"section_id" text NOT NULL,
	"source" "suggestion_source" NOT NULL,
	"status" "suggestion_status" DEFAULT 'pending' NOT NULL,
	"resolved_by_id" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "share_section_suggestions_share_id_section_id_pk" PRIMARY KEY("share_id","section_id")
);
--> statement-breakpoint
ALTER TABLE "canonical_resources" ADD COLUMN "content_text" text;--> statement-breakpoint
ALTER TABLE "canonical_resources" ADD COLUMN "ai_keywords" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "enrichment_jobs" ADD CONSTRAINT "enrichment_jobs_resource_id_canonical_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."canonical_resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD CONSTRAINT "instance_settings_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_enrichments" ADD CONSTRAINT "resource_enrichments_resource_id_canonical_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."canonical_resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_section_suggestions" ADD CONSTRAINT "share_section_suggestions_share_id_link_shares_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."link_shares"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_section_suggestions" ADD CONSTRAINT "share_section_suggestions_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_section_suggestions" ADD CONSTRAINT "share_section_suggestions_resolved_by_id_users_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "enrichment_jobs_queued_next_run_idx" ON "enrichment_jobs" USING btree ("status","next_run_at") WHERE "enrichment_jobs"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "enrichment_jobs_running_locked_until_idx" ON "enrichment_jobs" USING btree ("status","locked_until") WHERE "enrichment_jobs"."status" = 'running';--> statement-breakpoint
CREATE INDEX "share_section_suggestions_section_idx" ON "share_section_suggestions" USING btree ("section_id");--> statement-breakpoint
-- Search covers AI keywords (weight C) and page text (weight D) — docs/designs/izgah-smart-capture.md §4.
CREATE OR REPLACE FUNCTION "public"."canonical_resources_search_vector_update"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	url_tokens text;
	keywords text;
	page_text text;
BEGIN
	url_tokens := regexp_replace(coalesce(NEW.canonical_url, ''), '[^[:alnum:]]+', ' ', 'g');
	keywords := array_to_string(coalesce(NEW.ai_keywords, '{}'::text[]), ' ');
	page_text := left(coalesce(NEW.content_text, ''), 20000);
	NEW.search_vector :=
		setweight(to_tsvector('simple', unaccent(coalesce(NEW.title, ''))), 'A') ||
		setweight(to_tsvector('simple', unaccent(coalesce(NEW.domain, '') || ' ' || coalesce(NEW.canonical_url, '') || ' ' || url_tokens)), 'B') ||
		setweight(to_tsvector('turkish', unaccent(coalesce(NEW.title, ''))), 'B') ||
		setweight(to_tsvector('english', unaccent(coalesce(NEW.title, ''))), 'B') ||
		setweight(to_tsvector('turkish', unaccent(coalesce(NEW.description, '') || ' ' || coalesce(NEW.site_name, ''))), 'C') ||
		setweight(to_tsvector('english', unaccent(coalesce(NEW.description, '') || ' ' || coalesce(NEW.site_name, ''))), 'C') ||
		setweight(to_tsvector('simple', unaccent(coalesce(NEW.description, '') || ' ' || coalesce(NEW.site_name, ''))), 'C') ||
		setweight(to_tsvector('simple', unaccent(keywords)), 'C') ||
		setweight(to_tsvector('turkish', unaccent(keywords)), 'C') ||
		setweight(to_tsvector('english', unaccent(keywords)), 'C') ||
		setweight(to_tsvector('simple', unaccent(page_text)), 'D') ||
		setweight(to_tsvector('turkish', unaccent(page_text)), 'D') ||
		setweight(to_tsvector('english', unaccent(page_text)), 'D');
	RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "canonical_resources_search_vector_trg" ON "canonical_resources";--> statement-breakpoint
CREATE TRIGGER "canonical_resources_search_vector_trg"
BEFORE INSERT OR UPDATE OF "title", "description", "site_name", "domain", "canonical_url", "content_text", "ai_keywords"
ON "canonical_resources"
FOR EACH ROW
EXECUTE FUNCTION "public"."canonical_resources_search_vector_update"();--> statement-breakpoint
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_action_known_check";--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_action_known_check" CHECK ("action" IN (
	'admin.user_invited',
	'admin.user_invite_regenerated',
	'admin.password_reset_issued',
	'admin.user_role_changed',
	'admin.user_disabled',
	'admin.section_created',
	'admin.section_updated',
	'admin.section_reordered',
	'admin.section_deleted',
	'admin.section_silent_shares_resolved',
	'admin.unassigned_shares_assigned',
	'admin.unfurl_job_retried',
	'admin.unfurl_jobs_retried_all',
	'admin.ai_settings_updated',
	'admin.ai_key_updated',
	'admin.ai_key_removed',
	'admin.ai_backfill_started',
	'admin.ai_data_purged',
	'admin.ai_jobs_retried',
	'admin.bootstrap',
	'cli.create_admin',
	'cli.reset_admin',
	'user.invite_accepted',
	'user.password_reset_completed',
	'user.password_changed',
	'api_key.created',
	'api_key.revoked'
));
