CREATE TABLE "site_icons" (
	"domain" text PRIMARY KEY NOT NULL,
	"asset_key" text,
	"status" text NOT NULL,
	"source_url" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_icons_status_chk" CHECK ("site_icons"."status" IN ('ok', 'none', 'failed')),
	CONSTRAINT "site_icons_domain_length_chk" CHECK (char_length("site_icons"."domain") <= 253)
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_asset_key" text;--> statement-breakpoint
ALTER TABLE "site_icons" ADD CONSTRAINT "site_icons_asset_key_media_assets_asset_key_fk" FOREIGN KEY ("asset_key") REFERENCES "public"."media_assets"("asset_key") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "site_icons_asset_key_idx" ON "site_icons" USING btree ("asset_key");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_avatar_asset_key_media_assets_asset_key_fk" FOREIGN KEY ("avatar_asset_key") REFERENCES "public"."media_assets"("asset_key") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
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
	'admin.user_avatar_removed',
	'admin.bootstrap',
	'cli.create_admin',
	'cli.reset_admin',
	'user.invite_accepted',
	'user.password_reset_completed',
	'user.password_changed',
	'user.avatar_updated',
	'user.avatar_removed',
	'api_key.created',
	'api_key.revoked'
));
