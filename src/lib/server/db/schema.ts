import { sql } from 'drizzle-orm';
import {
	boolean,
	check,
	customType,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex
} from 'drizzle-orm/pg-core';

const tsvector = customType<{ data: string }>({
	dataType() {
		return 'tsvector';
	}
});

export const userRoleEnum = pgEnum('user_role', ['member', 'admin']);
export const inviteTokenPurposeEnum = pgEnum('invite_token_purpose', ['invite', 'password_reset']);
export const contentTypeEnum = pgEnum('content_type', [
	'video',
	'repo',
	'social',
	'article',
	'web'
]);
export const unfurlStatusEnum = pgEnum('unfurl_status', ['queued', 'running', 'ready', 'failed']);
export const sourceChannelEnum = pgEnum('source_channel', ['web', 'api']);
export const unfurlJobStatusEnum = pgEnum('unfurl_job_status', [
	'queued',
	'running',
	'completed',
	'dead'
]);
export const notificationKindEnum = pgEnum('notification_kind', ['like', 'comment', 'reshare']);

export type UserRole = (typeof userRoleEnum.enumValues)[number];
export type InviteTokenPurpose = (typeof inviteTokenPurposeEnum.enumValues)[number];
export type ContentType = (typeof contentTypeEnum.enumValues)[number];
export type UnfurlStatus = (typeof unfurlStatusEnum.enumValues)[number];
export type SourceChannel = (typeof sourceChannelEnum.enumValues)[number];
export type UnfurlJobStatus = (typeof unfurlJobStatusEnum.enumValues)[number];
export type NotificationKind = (typeof notificationKindEnum.enumValues)[number];

export interface ProviderMeta {
	stars?: number;
	language?: string;
	authorName?: string;
}

export const users = pgTable(
	'users',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		name: text('name').notNull(),
		email: text('email').notNull().unique(),
		emailVerified: boolean('email_verified').notNull().default(false),
		image: text('image'),
		role: userRoleEnum('role').notNull().default('member'),
		isActive: boolean('is_active').notNull().default(true),
		disabledAt: timestamp('disabled_at', { withTimezone: true }),
		authVersion: integer('auth_version').notNull().default(1),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		check('users_auth_version_positive_chk', sql`${table.authVersion} >= 1`),
		check('users_email_lowercase_chk', sql`${table.email} = lower(${table.email})`)
	]
);

export const sessions = pgTable(
	'sessions',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		token: text('token').notNull().unique(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'restrict' }),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		userAuthVersion: integer('user_auth_version').notNull().default(1),
		ipAddress: text('ip_address'),
		userAgent: text('user_agent'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [index('sessions_user_id_idx').on(table.userId)]
);

export const accounts = pgTable(
	'accounts',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		accountId: text('account_id').notNull(),
		providerId: text('provider_id').notNull(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'restrict' }),
		accessToken: text('access_token'),
		refreshToken: text('refresh_token'),
		idToken: text('id_token'),
		accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
		refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
		scope: text('scope'),
		password: text('password'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		uniqueIndex('accounts_provider_account_uidx').on(table.providerId, table.accountId),
		index('accounts_user_id_idx').on(table.userId)
	]
);

export const verifications = pgTable(
	'verifications',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		identifier: text('identifier').notNull(),
		value: text('value').notNull(),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [index('verifications_identifier_idx').on(table.identifier)]
);

export const inviteTokens = pgTable(
	'invite_tokens',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		tokenHash: text('token_hash').notNull().unique(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'restrict' }),
		purpose: inviteTokenPurposeEnum('purpose').notNull(),
		createdById: text('created_by_id').references(() => users.id, { onDelete: 'restrict' }),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		consumedAt: timestamp('consumed_at', { withTimezone: true }),
		revokedAt: timestamp('revoked_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [index('invite_tokens_user_purpose_idx').on(table.userId, table.purpose)]
);

export const apiKeys = pgTable(
	'api_keys',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		keyHash: text('key_hash').notNull().unique(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'restrict' }),
		name: text('name').notNull(),
		keyPrefix: text('key_prefix').notNull(),
		authVersionAtCreation: integer('auth_version_at_creation').notNull(),
		lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
		revokedAt: timestamp('revoked_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [index('api_keys_user_id_idx').on(table.userId)]
);

export const mediaAssets = pgTable(
	'media_assets',
	{
		assetKey: text('asset_key').primaryKey(),
		mimeType: text('mime_type').notNull().default('image/webp'),
		byteSize: integer('byte_size').notNull(),
		width: integer('width').notNull(),
		height: integer('height').notNull(),
		refCount: integer('ref_count').notNull().default(0),
		orphanedAt: timestamp('orphaned_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		check('media_assets_ref_count_nonnegative_chk', sql`${table.refCount} >= 0`),
		check('media_assets_mime_type_webp_chk', sql`${table.mimeType} = 'image/webp'`),
		check('media_assets_dimensions_positive_chk', sql`${table.width} > 0 AND ${table.height} > 0`),
		check('media_assets_byte_size_positive_chk', sql`${table.byteSize} > 0`),
		check('media_assets_key_hex64_chk', sql`${table.assetKey} ~ '^[0-9a-f]{64}$'`),
		index('media_assets_orphaned_idx')
			.on(table.orphanedAt)
			.where(sql`${table.refCount} = 0 AND ${table.orphanedAt} IS NOT NULL`)
	]
);

export const canonicalResources = pgTable(
	'canonical_resources',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		canonicalUrl: text('canonical_url').notNull().unique(),
		canonicalizerVersion: integer('canonicalizer_version').notNull().default(1),
		domain: text('domain').notNull(),
		contentType: contentTypeEnum('content_type').notNull().default('web'),
		contentTypeLocked: boolean('content_type_locked').notNull().default(false),
		unfurlStatus: unfurlStatusEnum('unfurl_status').notNull().default('queued'),
		title: text('title'),
		description: text('description'),
		siteName: text('site_name'),
		providerMeta: jsonb('provider_meta').$type<ProviderMeta>(),
		thumbnailAssetKey: text('thumbnail_asset_key').references(() => mediaAssets.assetKey, {
			onDelete: 'set null'
		}),
		likeCount: integer('like_count').notNull().default(0),
		commentCount: integer('comment_count').notNull().default(0),
		searchVector: tsvector('search_vector'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		check('canonical_resources_url_length_chk', sql`char_length(${table.canonicalUrl}) <= 2048`),
		check('canonical_resources_like_count_nonnegative_chk', sql`${table.likeCount} >= 0`),
		check('canonical_resources_comment_count_nonnegative_chk', sql`${table.commentCount} >= 0`),
		index('canonical_resources_search_vector_gin_idx').using('gin', table.searchVector),
		index('canonical_resources_url_trgm_idx').using('gin', table.canonicalUrl.op('gin_trgm_ops')),
		index('canonical_resources_title_trgm_idx').using('gin', table.title.op('gin_trgm_ops')),
		index('canonical_resources_thumbnail_idx').on(table.thumbnailAssetKey)
	]
);

export const linkShares = pgTable(
	'link_shares',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		resourceId: text('resource_id')
			.notNull()
			.references(() => canonicalResources.id, { onDelete: 'cascade' }),
		authorId: text('author_id')
			.notNull()
			.references(() => users.id, { onDelete: 'restrict' }),
		rawUrl: text('raw_url').notNull(),
		note: text('note'),
		noteSearchVector: tsvector('note_search_vector'),
		isFeedVisible: boolean('is_feed_visible').notNull().default(true),
		sourceChannel: sourceChannelEnum('source_channel').notNull().default('web'),
		deletedAt: timestamp('deleted_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		check('link_shares_raw_url_length_chk', sql`char_length(${table.rawUrl}) <= 2048`),
		check(
			'link_shares_note_length_chk',
			sql`${table.note} IS NULL OR char_length(${table.note}) <= 1000`
		),
		index('link_shares_feed_cursor_idx')
			.on(table.isFeedVisible, table.createdAt.desc(), table.id.desc())
			.where(sql`${table.deletedAt} IS NULL`),
		index('link_shares_resource_history_idx').on(table.resourceId, table.createdAt.asc()),
		index('link_shares_note_search_vector_gin_idx').using('gin', table.noteSearchVector),
		index('link_shares_author_id_idx').on(table.authorId)
	]
);

export const sections = pgTable(
	'sections',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		slug: text('slug').notNull().unique(),
		name: text('name').notNull().unique(),
		description: text('description'),
		sortOrder: integer('sort_order').notNull().default(0),
		createdById: text('created_by_id')
			.notNull()
			.references(() => users.id, { onDelete: 'restrict' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [index('sections_sort_order_name_idx').on(table.sortOrder, table.name)]
);

export const linkShareSections = pgTable(
	'link_share_sections',
	{
		shareId: text('share_id')
			.notNull()
			.references(() => linkShares.id, { onDelete: 'cascade' }),
		sectionId: text('section_id')
			.notNull()
			.references(() => sections.id, { onDelete: 'cascade' })
	},
	(table) => [
		primaryKey({ columns: [table.shareId, table.sectionId] }),
		index('link_share_sections_section_share_idx').on(table.sectionId, table.shareId)
	]
);

export const unfurlJobs = pgTable(
	'unfurl_jobs',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		resourceId: text('resource_id')
			.notNull()
			.unique()
			.references(() => canonicalResources.id, { onDelete: 'cascade' }),
		targetUrl: text('target_url').notNull(),
		status: unfurlJobStatusEnum('status').notNull().default('queued'),
		attempts: integer('attempts').notNull().default(0),
		nextRunAt: timestamp('next_run_at', { withTimezone: true }).notNull().defaultNow(),
		lockedUntil: timestamp('locked_until', { withTimezone: true }),
		lockToken: text('lock_token'),
		lastErrorCode: text('last_error_code'),
		lastErrorMessage: text('last_error_message'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		check('unfurl_jobs_attempts_nonnegative_chk', sql`${table.attempts} >= 0`),
		index('unfurl_jobs_queued_next_run_idx')
			.on(table.status, table.nextRunAt)
			.where(sql`${table.status} = 'queued'`),
		index('unfurl_jobs_running_locked_until_idx')
			.on(table.status, table.lockedUntil)
			.where(sql`${table.status} = 'running'`)
	]
);

export const resourceLikes = pgTable(
	'resource_likes',
	{
		resourceId: text('resource_id')
			.notNull()
			.references(() => canonicalResources.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'restrict' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		primaryKey({ columns: [table.resourceId, table.userId] }),
		index('resource_likes_user_id_idx').on(table.userId)
	]
);

export const resourceComments = pgTable(
	'resource_comments',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		resourceId: text('resource_id')
			.notNull()
			.references(() => canonicalResources.id, { onDelete: 'cascade' }),
		authorId: text('author_id')
			.notNull()
			.references(() => users.id, { onDelete: 'restrict' }),
		body: text('body').notNull(),
		deletedAt: timestamp('deleted_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		check(
			'resource_comments_body_length_chk',
			sql`char_length(${table.body}) >= 1 AND char_length(${table.body}) <= 2000`
		),
		index('resource_comments_resource_created_idx').on(table.resourceId, table.createdAt.asc())
	]
);

export const notifications = pgTable(
	'notifications',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		recipientUserId: text('recipient_user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'restrict' }),
		actorUserId: text('actor_user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'restrict' }),
		resourceId: text('resource_id')
			.notNull()
			.references(() => canonicalResources.id, { onDelete: 'cascade' }),
		commentId: text('comment_id').references(() => resourceComments.id, {
			onDelete: 'set null'
		}),
		kind: notificationKindEnum('kind').notNull(),
		readAt: timestamp('read_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		index('notifications_unread_recipient_idx')
			.on(table.recipientUserId, table.createdAt.desc())
			.where(sql`${table.readAt} IS NULL`),
		uniqueIndex('notifications_like_dedup_uidx')
			.on(table.recipientUserId, table.actorUserId, table.resourceId)
			.where(sql`${table.kind} = 'like'`)
	]
);

export const auditLogs = pgTable(
	'audit_logs',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		actorUserId: text('actor_user_id').references(() => users.id, { onDelete: 'restrict' }),
		action: text('action').notNull(),
		targetType: text('target_type').notNull(),
		targetId: text('target_id'),
		metadata: jsonb('metadata').$type<Record<string, unknown>>(),
		requestId: text('request_id'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [index('audit_logs_created_id_idx').on(table.createdAt.desc(), table.id.desc())]
);

export const searchLogs = pgTable(
	'search_logs',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'restrict' }),
		sectionId: text('section_id').references(() => sections.id, { onDelete: 'set null' }),
		resultCount: integer('result_count').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		check('search_logs_result_count_nonnegative_chk', sql`${table.resultCount} >= 0`),
		index('search_logs_created_at_idx').on(table.createdAt.desc()),
		index('search_logs_user_created_idx').on(table.userId, table.createdAt.desc())
	]
);
