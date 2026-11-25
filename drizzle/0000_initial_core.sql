DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'unaccent') THEN
		CREATE EXTENSION IF NOT EXISTS unaccent;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
		CREATE EXTENSION IF NOT EXISTS pg_trgm;
	END IF;
END
$$;--> statement-breakpoint
CREATE TYPE "public"."content_type" AS ENUM('video', 'repo', 'social', 'article', 'web');--> statement-breakpoint
CREATE TYPE "public"."invite_token_purpose" AS ENUM('invite', 'password_reset');--> statement-breakpoint
CREATE TYPE "public"."notification_kind" AS ENUM('like', 'comment', 'reshare');--> statement-breakpoint
CREATE TYPE "public"."source_channel" AS ENUM('web', 'api');--> statement-breakpoint
CREATE TYPE "public"."unfurl_job_status" AS ENUM('queued', 'running', 'completed', 'dead');--> statement-breakpoint
CREATE TYPE "public"."unfurl_status" AS ENUM('queued', 'running', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('member', 'admin');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"key_hash" text NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"key_prefix" text NOT NULL,
	"auth_version_at_creation" integer NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_user_id" text,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"metadata" jsonb,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "canonical_resources" (
	"id" text PRIMARY KEY NOT NULL,
	"canonical_url" text NOT NULL,
	"canonicalizer_version" integer DEFAULT 1 NOT NULL,
	"domain" text NOT NULL,
	"content_type" "content_type" DEFAULT 'web' NOT NULL,
	"content_type_locked" boolean DEFAULT false NOT NULL,
	"unfurl_status" "unfurl_status" DEFAULT 'queued' NOT NULL,
	"title" text,
	"description" text,
	"site_name" text,
	"provider_meta" jsonb,
	"thumbnail_asset_key" text,
	"like_count" integer DEFAULT 0 NOT NULL,
	"comment_count" integer DEFAULT 0 NOT NULL,
	"search_vector" "tsvector",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "canonical_resources_canonical_url_unique" UNIQUE("canonical_url"),
	CONSTRAINT "canonical_resources_url_length_chk" CHECK (char_length("canonical_resources"."canonical_url") <= 2048),
	CONSTRAINT "canonical_resources_like_count_nonnegative_chk" CHECK ("canonical_resources"."like_count" >= 0),
	CONSTRAINT "canonical_resources_comment_count_nonnegative_chk" CHECK ("canonical_resources"."comment_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "invite_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" text NOT NULL,
	"purpose" "invite_token_purpose" NOT NULL,
	"created_by_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invite_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "link_share_sections" (
	"share_id" text NOT NULL,
	"section_id" text NOT NULL,
	CONSTRAINT "link_share_sections_share_id_section_id_pk" PRIMARY KEY("share_id","section_id")
);
--> statement-breakpoint
CREATE TABLE "link_shares" (
	"id" text PRIMARY KEY NOT NULL,
	"resource_id" text NOT NULL,
	"author_id" text NOT NULL,
	"raw_url" text NOT NULL,
	"note" text,
	"note_search_vector" "tsvector",
	"is_feed_visible" boolean DEFAULT true NOT NULL,
	"source_channel" "source_channel" DEFAULT 'web' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "link_shares_raw_url_length_chk" CHECK (char_length("link_shares"."raw_url") <= 2048),
	CONSTRAINT "link_shares_note_length_chk" CHECK ("link_shares"."note" IS NULL OR char_length("link_shares"."note") <= 1000)
);
--> statement-breakpoint
CREATE TABLE "media_assets" (
	"asset_key" text PRIMARY KEY NOT NULL,
	"mime_type" text DEFAULT 'image/webp' NOT NULL,
	"byte_size" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"ref_count" integer DEFAULT 0 NOT NULL,
	"orphaned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_assets_ref_count_nonnegative_chk" CHECK ("media_assets"."ref_count" >= 0),
	CONSTRAINT "media_assets_mime_type_webp_chk" CHECK ("media_assets"."mime_type" = 'image/webp'),
	CONSTRAINT "media_assets_dimensions_positive_chk" CHECK ("media_assets"."width" > 0 AND "media_assets"."height" > 0),
	CONSTRAINT "media_assets_byte_size_positive_chk" CHECK ("media_assets"."byte_size" > 0),
	CONSTRAINT "media_assets_key_hex64_chk" CHECK ("media_assets"."asset_key" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"recipient_user_id" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"resource_id" text NOT NULL,
	"comment_id" text,
	"kind" "notification_kind" NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resource_comments" (
	"id" text PRIMARY KEY NOT NULL,
	"resource_id" text NOT NULL,
	"author_id" text NOT NULL,
	"body" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resource_comments_body_length_chk" CHECK (char_length("resource_comments"."body") >= 1 AND char_length("resource_comments"."body") <= 2000)
);
--> statement-breakpoint
CREATE TABLE "resource_likes" (
	"resource_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resource_likes_resource_id_user_id_pk" PRIMARY KEY("resource_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "search_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"section_id" text,
	"result_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "search_logs_result_count_nonnegative_chk" CHECK ("search_logs"."result_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sections" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sections_slug_unique" UNIQUE("slug"),
	CONSTRAINT "sections_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"user_auth_version" integer DEFAULT 1 NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "unfurl_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"resource_id" text NOT NULL,
	"target_url" text NOT NULL,
	"status" "unfurl_job_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone,
	"lock_token" text,
	"last_error_code" text,
	"last_error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unfurl_jobs_resource_id_unique" UNIQUE("resource_id"),
	CONSTRAINT "unfurl_jobs_attempts_nonnegative_chk" CHECK ("unfurl_jobs"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"role" "user_role" DEFAULT 'member' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"disabled_at" timestamp with time zone,
	"auth_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_auth_version_positive_chk" CHECK ("users"."auth_version" >= 1),
	CONSTRAINT "users_email_lowercase_chk" CHECK ("users"."email" = lower("users"."email"))
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canonical_resources" ADD CONSTRAINT "canonical_resources_thumbnail_asset_key_media_assets_asset_key_fk" FOREIGN KEY ("thumbnail_asset_key") REFERENCES "public"."media_assets"("asset_key") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_tokens" ADD CONSTRAINT "invite_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_tokens" ADD CONSTRAINT "invite_tokens_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_share_sections" ADD CONSTRAINT "link_share_sections_share_id_link_shares_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."link_shares"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_share_sections" ADD CONSTRAINT "link_share_sections_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_shares" ADD CONSTRAINT "link_shares_resource_id_canonical_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."canonical_resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_shares" ADD CONSTRAINT "link_shares_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_resource_id_canonical_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."canonical_resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_comment_id_resource_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."resource_comments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_comments" ADD CONSTRAINT "resource_comments_resource_id_canonical_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."canonical_resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_comments" ADD CONSTRAINT "resource_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_likes" ADD CONSTRAINT "resource_likes_resource_id_canonical_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."canonical_resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_likes" ADD CONSTRAINT "resource_likes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_logs" ADD CONSTRAINT "search_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_logs" ADD CONSTRAINT "search_logs_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sections" ADD CONSTRAINT "sections_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unfurl_jobs" ADD CONSTRAINT "unfurl_jobs_resource_id_canonical_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."canonical_resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_provider_account_uidx" ON "accounts" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "accounts_user_id_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "api_keys_user_id_idx" ON "api_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_created_id_idx" ON "audit_logs" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "canonical_resources_search_vector_gin_idx" ON "canonical_resources" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "canonical_resources_url_trgm_idx" ON "canonical_resources" USING gin ("canonical_url" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "canonical_resources_title_trgm_idx" ON "canonical_resources" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "canonical_resources_thumbnail_idx" ON "canonical_resources" USING btree ("thumbnail_asset_key");--> statement-breakpoint
CREATE INDEX "invite_tokens_user_purpose_idx" ON "invite_tokens" USING btree ("user_id","purpose");--> statement-breakpoint
CREATE INDEX "link_share_sections_section_share_idx" ON "link_share_sections" USING btree ("section_id","share_id");--> statement-breakpoint
CREATE INDEX "link_shares_feed_cursor_idx" ON "link_shares" USING btree ("is_feed_visible","created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "link_shares"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "link_shares_resource_history_idx" ON "link_shares" USING btree ("resource_id","created_at");--> statement-breakpoint
CREATE INDEX "link_shares_note_search_vector_gin_idx" ON "link_shares" USING gin ("note_search_vector");--> statement-breakpoint
CREATE INDEX "link_shares_author_id_idx" ON "link_shares" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "media_assets_orphaned_idx" ON "media_assets" USING btree ("orphaned_at") WHERE "media_assets"."ref_count" = 0 AND "media_assets"."orphaned_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "notifications_unread_recipient_idx" ON "notifications" USING btree ("recipient_user_id","created_at" DESC NULLS LAST) WHERE "notifications"."read_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_like_dedup_uidx" ON "notifications" USING btree ("recipient_user_id","actor_user_id","resource_id") WHERE "notifications"."kind" = 'like';--> statement-breakpoint
CREATE INDEX "resource_comments_resource_created_idx" ON "resource_comments" USING btree ("resource_id","created_at");--> statement-breakpoint
CREATE INDEX "resource_likes_user_id_idx" ON "resource_likes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "search_logs_created_at_idx" ON "search_logs" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "search_logs_user_created_idx" ON "search_logs" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "sections_sort_order_name_idx" ON "sections" USING btree ("sort_order","name");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "unfurl_jobs_queued_next_run_idx" ON "unfurl_jobs" USING btree ("status","next_run_at") WHERE "unfurl_jobs"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "unfurl_jobs_running_locked_until_idx" ON "unfurl_jobs" USING btree ("status","locked_until") WHERE "unfurl_jobs"."status" = 'running';--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."canonical_resources_search_vector_update"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	url_tokens text;
BEGIN
	url_tokens := regexp_replace(coalesce(NEW.canonical_url, ''), '[^[:alnum:]]+', ' ', 'g');
	NEW.search_vector :=
		setweight(to_tsvector('simple', unaccent(coalesce(NEW.title, ''))), 'A') ||
		setweight(to_tsvector('simple', unaccent(coalesce(NEW.domain, '') || ' ' || coalesce(NEW.canonical_url, '') || ' ' || url_tokens)), 'B') ||
		setweight(to_tsvector('turkish', unaccent(coalesce(NEW.title, ''))), 'B') ||
		setweight(to_tsvector('turkish', unaccent(coalesce(NEW.description, '') || ' ' || coalesce(NEW.site_name, ''))), 'C') ||
		setweight(to_tsvector('simple', unaccent(coalesce(NEW.description, '') || ' ' || coalesce(NEW.site_name, ''))), 'C');
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "canonical_resources_search_vector_trg"
BEFORE INSERT OR UPDATE OF "title", "description", "site_name", "domain", "canonical_url"
ON "public"."canonical_resources"
FOR EACH ROW
EXECUTE FUNCTION "public"."canonical_resources_search_vector_update"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."link_shares_note_search_vector_update"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NEW.deleted_at IS NOT NULL OR NEW.note IS NULL OR btrim(NEW.note) = '' THEN
		NEW.note_search_vector := ''::tsvector;
	ELSE
		NEW.note_search_vector :=
			setweight(to_tsvector('simple', unaccent(NEW.note)), 'B') ||
			setweight(to_tsvector('turkish', unaccent(NEW.note)), 'B');
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "link_shares_note_search_vector_trg"
BEFORE INSERT OR UPDATE OF "note", "deleted_at"
ON "public"."link_shares"
FOR EACH ROW
EXECUTE FUNCTION "public"."link_shares_note_search_vector_update"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."enforce_silent_share_has_section"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	target_share_id text;
BEGIN
	IF TG_TABLE_NAME = 'link_shares' THEN
		target_share_id := NEW.id;
	ELSE
		target_share_id := OLD.share_id;
	END IF;

	IF EXISTS (
		SELECT 1
		FROM "public"."link_shares" ls
		WHERE ls.id = target_share_id
			AND ls.is_feed_visible = false
			AND ls.deleted_at IS NULL
			AND NOT EXISTS (
				SELECT 1
				FROM "public"."link_share_sections" lss
				WHERE lss.share_id = target_share_id
			)
	) THEN
		RAISE EXCEPTION 'Silent share (%) must belong to at least one section', target_share_id
			USING ERRCODE = '23514';
	END IF;

	RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "link_shares_silent_section_check_trg"
AFTER INSERT OR UPDATE OF "is_feed_visible", "deleted_at"
ON "public"."link_shares"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "public"."enforce_silent_share_has_section"();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "link_share_sections_silent_section_check_trg"
AFTER UPDATE OR DELETE
ON "public"."link_share_sections"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "public"."enforce_silent_share_has_section"();--> statement-breakpoint
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
	'admin.bootstrap',
	'cli.create_admin',
	'cli.reset_admin',
	'user.invite_accepted',
	'user.password_reset_completed',
	'user.password_changed',
	'api_key.created',
	'api_key.revoked'
));--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."prevent_audit_logs_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION 'audit_logs rows are immutable and cannot be updated or deleted'
		USING ERRCODE = '55000';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "audit_logs_immutable_trigger"
BEFORE UPDATE OR DELETE
ON "public"."audit_logs"
FOR EACH ROW
EXECUTE FUNCTION "public"."prevent_audit_logs_mutation"();
