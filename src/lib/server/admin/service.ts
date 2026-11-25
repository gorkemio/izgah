import { randomUUID } from 'node:crypto';
import { error as kitError } from '@sveltejs/kit';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
	ADMIN_AUDIT_ACTIONS,
	KNOWN_AUDIT_ACTIONS,
	KNOWN_SYSTEM_AUDIT_ACTIONS,
	recordAuditLog,
	type AdminAuditAction,
	type KnownAuditAction
} from '#lib/server/audit.ts';
import { createInviteToken, type DbOrTx, type DbTransaction } from '#lib/server/auth/tokens.ts';
import { db } from '#lib/server/db/client.ts';
import {
	decodeTimeIdCursor,
	encodeTimeIdCursor,
	preciseTimestampText,
	type TimeIdCursor
} from '#lib/server/db/cursor.ts';
import {
	accounts,
	apiKeys,
	auditLogs,
	canonicalResources,
	inviteTokens,
	linkShares,
	linkShareSections,
	sections,
	users,
	unfurlJobs,
	type UserRole
} from '#lib/server/db/schema.ts';
import { logger } from '#lib/server/logger.ts';
import { findExistingSectionIds } from '#lib/server/sections/service.ts';
import { notifyUnfurlWorker } from '#lib/server/unfurl/worker.ts';
import { t } from '#lib/i18n/index.ts';

export {
	ADMIN_AUDIT_ACTIONS,
	KNOWN_SYSTEM_AUDIT_ACTIONS,
	KNOWN_AUDIT_ACTIONS as ALL_KNOWN_AUDIT_ACTIONS,
	type AdminAuditAction,
	type KnownAuditAction
};

/** Localized audit action labels (built per call so they follow the request locale). */
export function auditActionLabels(): Record<string, string> {
	return {
		'admin.user_invited': t('audit.userInvited'),
		'admin.user_invite_regenerated': t('audit.inviteRegenerated'),
		'admin.password_reset_issued': t('audit.resetIssued'),
		'admin.user_role_changed': t('audit.roleChanged'),
		'admin.user_disabled': t('audit.userDisabled'),
		'admin.section_created': t('audit.sectionCreated'),
		'admin.section_updated': t('audit.sectionUpdated'),
		'admin.section_reordered': t('audit.sectionReordered'),
		'admin.section_deleted': t('audit.sectionDeleted'),
		'admin.section_silent_shares_resolved': t('audit.silentResolved'),
		'admin.unassigned_shares_assigned': t('audit.unassignedAssigned'),
		'admin.unfurl_job_retried': t('audit.jobRetried'),
		'admin.unfurl_jobs_retried_all': t('audit.jobsRetriedAll'),
		'admin.bootstrap': t('audit.bootstrap'),
		'cli.create_admin': t('audit.cliCreateAdmin'),
		'cli.reset_admin': t('audit.cliResetAdmin'),
		'user.invite_accepted': t('audit.inviteAccepted'),
		'user.password_reset_completed': t('audit.resetCompleted'),
		'user.password_changed': t('audit.passwordChanged'),
		'api_key.created': t('audit.apiKeyCreated'),
		'api_key.revoked': t('audit.apiKeyRevoked')
	};
}

export const AUDIT_PAGE_SIZE = 50;
export const UNASSIGNED_PAGE_SIZE = 25;

export type AdminUserSession = NonNullable<App.Locals['user']> & { role: 'admin' };

export class AdminServiceError extends Error {
	readonly status: number;
	readonly code: string;
	readonly details?: Record<string, unknown>;

	constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
		super(message);
		this.name = 'AdminServiceError';
		this.status = status;
		this.code = code;
		this.details = details;
	}
}

interface LockedUserRow {
	id: string;
	name: string;
	email: string;
	role: UserRole;
	isActive: boolean;
	disabledAt: Date | null;
	emailVerified: boolean;
	authVersion: number;
	createdAt: Date;
	updatedAt: Date;
}

export interface AdminUserItem {
	id: string;
	name: string;
	email: string;
	role: UserRole;
	isActive: boolean;
	disabledAt: string | null;
	emailVerified: boolean;
	hasPassword: boolean;
	hasOpenInvite: boolean;
	openInviteExpiresAt: string | null;
	shareCount: number;
	createdAt: string;
	updatedAt: string;
}

export interface AdminSectionItem {
	id: string;
	slug: string;
	name: string;
	description: string | null;
	sortOrder: number;
	totalShareCount: number;
	exclusiveSilentShareCount: number;
	createdAt: string;
	updatedAt: string;
}

export interface UnassignedShareItem {
	id: string;
	rawUrl: string;
	note: string | null;
	sourceChannel: 'web' | 'api';
	createdAt: string;
	authorId: string;
	authorName: string;
	authorEmail: string;
	resourceId: string;
	canonicalUrl: string;
	title: string | null;
	domain: string;
}

export interface UnfurlQueueSummary {
	queued: number;
	running: number;
	completed: number;
	dead: number;
	total: number;
}

export interface DeadUnfurlJobItem {
	id: string;
	resourceId: string;
	targetUrl: string;
	canonicalUrl: string;
	domain: string;
	title: string | null;
	attempts: number;
	lastErrorCode: string | null;
	lastErrorMessage: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface AuditLogItem {
	id: string;
	actorUserId: string | null;
	actorName: string | null;
	actorEmail: string | null;
	action: string;
	actionLabel: string;
	targetType: string;
	targetId: string | null;
	metadata: Record<string, unknown> | null;
	requestId: string | null;
	createdAt: string;
}

export interface RollingMetricsWindow {
	days: 7 | 30;
	totalActiveUsers: number;
	activeSharingUsers: number;
	activeSearchingUsers: number;
	activeUnionUsers: number;
	totalShares: number;
	webShares: number;
	apiShares: number;
	webShareRatio: number;
	apiShareRatio: number;
	totalSearches: number;
	zeroResultSearches: number;
	zeroResultSearchRate: number;
}

export interface SectionUsageStat {
	id: string;
	slug: string;
	name: string;
	totalShares: number;
	sharesLast30Days: number;
}

export interface AdminUsageMetrics {
	generatedAt: string;
	windows: {
		days7: RollingMetricsWindow;
		days30: RollingMetricsWindow;
	};
	totals: {
		activeUsers: number;
		disabledUsers: number;
		activeShares: number;
		unassignedActiveShares: number;
		canonicalResources: number;
		deadUnfurlJobs: number;
	};
	sectionUsage: SectionUsageStat[];
}

export type { TimeIdCursor };

const SENSITIVE_AUDIT_KEY_PATTERN =
	/token|password|secret|authorization|cookie|hash|inviteurl|reseturl|rawurlwithsecret/i;

function sanitizeAuditValue(value: unknown, depth = 0): unknown {
	if (depth > 4) {
		return '[truncated]';
	}
	if (value === null || value === undefined) {
		return value;
	}
	if (typeof value === 'string') {
		if (
			/[?&]token=/i.test(value) ||
			/\/auth\/(?:accept-invite|reset-password)\?/i.test(value) ||
			/\biz[kg]_[A-Za-z0-9_-]{8,}/.test(value)
		) {
			return '[redacted]';
		}
		return value;
	}
	if (typeof value === 'number' || typeof value === 'boolean') {
		return value;
	}
	if (value instanceof Date) {
		return value.toISOString();
	}
	if (Array.isArray(value)) {
		return value.map((item) => sanitizeAuditValue(item, depth + 1));
	}
	if (typeof value === 'object') {
		const out: Record<string, unknown> = {};
		for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
			if (SENSITIVE_AUDIT_KEY_PATTERN.test(key)) {
				continue;
			}
			out[key] = sanitizeAuditValue(entry, depth + 1);
		}
		return out;
	}
	return String(value);
}

export function sanitizeAuditMetadata(
	metadata: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
	if (!metadata) {
		return null;
	}
	const sanitized = sanitizeAuditValue(metadata, 0);
	if (sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)) {
		return sanitized as Record<string, unknown>;
	}
	return null;
}

/**
 * Enforces admin authentication and role checks inside every load and form action
 * as defense-in-depth behind hooks.server.ts.
 */
export function requireAdmin(locals: App.Locals): AdminUserSession {
	if (!locals.user) {
		kitError(401, t('auth.signInForAction'));
	}
	if (locals.user.role !== 'admin') {
		kitError(403, t('auth.adminOnly'));
	}
	return locals.user as AdminUserSession;
}

function extractPgErrorCode(err: unknown): { code?: string; constraint?: string } {
	if (!err || typeof err !== 'object') {
		return {};
	}
	const record = err as Record<string, unknown>;
	const cause =
		record.cause && typeof record.cause === 'object'
			? (record.cause as Record<string, unknown>)
			: null;
	const code =
		typeof record.code === 'string'
			? record.code
			: typeof cause?.code === 'string'
				? cause.code
				: undefined;
	const constraint =
		typeof record.constraint === 'string'
			? record.constraint
			: typeof cause?.constraint === 'string'
				? cause.constraint
				: typeof cause?.constraint_name === 'string'
					? cause.constraint_name
					: undefined;
	return { code, constraint };
}

export function decodeCursor(raw: string | null | undefined): TimeIdCursor | null {
	return decodeTimeIdCursor(raw);
}

export function slugifySectionName(input: string): string {
	const transliterated = input
		.trim()
		.replace(/Ç/g, 'c')
		.replace(/ç/g, 'c')
		.replace(/Ğ/g, 'g')
		.replace(/ğ/g, 'g')
		.replace(/İ/g, 'i')
		.replace(/I/g, 'i')
		.replace(/ı/g, 'i')
		.replace(/Ö/g, 'o')
		.replace(/ö/g, 'o')
		.replace(/Ş/g, 's')
		.replace(/ş/g, 's')
		.replace(/Ü/g, 'u')
		.replace(/ü/g, 'u')
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase();

	return transliterated
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.replace(/-{2,}/g, '-')
		.slice(0, 64)
		.replace(/-+$/g, '');
}

async function assertAdminActor(tx: DbOrTx, actorUserId: string): Promise<LockedUserRow> {
	const result = await tx.execute(sql`
		SELECT
			id,
			name,
			email,
			role,
			is_active AS "isActive",
			disabled_at AS "disabledAt",
			email_verified AS "emailVerified",
			auth_version AS "authVersion",
			created_at AS "createdAt",
			updated_at AS "updatedAt"
		FROM users
		WHERE id = ${actorUserId}
		FOR UPDATE
	`);
	const actor = (result[0] as unknown as LockedUserRow | undefined) ?? undefined;
	if (!actor || !actor.isActive || actor.role !== 'admin') {
		throw new AdminServiceError(403, 'FORBIDDEN', t('auth.activeAdminRequired'));
	}
	return actor;
}

/**
 * Locks all active admin rows PLUS the actor and target user rows in deterministic PK order
 * so concurrent role demotions or deactivations serialize without write skew or deadlocks.
 */
async function lockActiveAdminsAndInvolvedUsers(
	tx: DbTransaction,
	actorUserId: string,
	targetUserId: string
): Promise<{
	actor: LockedUserRow;
	target: LockedUserRow;
	activeAdminIds: Set<string>;
}> {
	const rows = (await tx.execute(sql`
		SELECT
			id,
			name,
			email,
			role,
			is_active AS "isActive",
			disabled_at AS "disabledAt",
			email_verified AS "emailVerified",
			auth_version AS "authVersion",
			created_at AS "createdAt",
			updated_at AS "updatedAt"
		FROM users
		WHERE (role = 'admin' AND is_active = true)
			OR id = ${actorUserId}
			OR id = ${targetUserId}
		ORDER BY id ASC
		FOR UPDATE
	`)) as unknown as LockedUserRow[];

	const byId = new Map(rows.map((row) => [row.id, row]));
	const actor = byId.get(actorUserId);
	if (!actor || !actor.isActive || actor.role !== 'admin') {
		throw new AdminServiceError(403, 'FORBIDDEN', t('auth.activeAdminRequired'));
	}

	const target = byId.get(targetUserId);
	if (!target) {
		throw new AdminServiceError(404, 'USER_NOT_FOUND', t('admin.userNotFound'));
	}

	const activeAdminIds = new Set(
		rows.filter((row) => row.role === 'admin' && row.isActive).map((row) => row.id)
	);

	return { actor, target, activeAdminIds };
}

function normalizeName(rawName: string): string {
	const trimmed = rawName.trim().replace(/\s+/g, ' ');
	if (trimmed.length < 2 || trimmed.length > 120) {
		throw new AdminServiceError(422, 'INVALID_NAME', t('admin.nameLength'));
	}
	return trimmed;
}

function normalizeEmail(rawEmail: string): string {
	const normalized = rawEmail.trim().toLowerCase();
	if (!normalized || normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
		throw new AdminServiceError(422, 'INVALID_EMAIL', t('admin.emailInvalid'));
	}
	return normalized;
}

function parseRole(rawRole: string | undefined): UserRole {
	if (rawRole === 'admin' || rawRole === 'member') {
		return rawRole;
	}
	throw new AdminServiceError(422, 'INVALID_ROLE', t('admin.roleInvalid'));
}

export async function listAdminUsers(): Promise<AdminUserItem[]> {
	const rows = await db.execute(sql`
		SELECT
			u.id,
			u.name,
			u.email,
			u.role,
			u.is_active AS "isActive",
			u.disabled_at AS "disabledAt",
			u.email_verified AS "emailVerified",
			u.created_at AS "createdAt",
			u.updated_at AS "updatedAt",
			EXISTS (
				SELECT 1
				FROM accounts a
				WHERE a.user_id = u.id
					AND a.password IS NOT NULL
			) AS "hasPassword",
			(
				SELECT MAX(it.expires_at)
				FROM invite_tokens it
				WHERE it.user_id = u.id
					AND it.purpose = 'invite'
					AND it.consumed_at IS NULL
					AND it.revoked_at IS NULL
					AND it.expires_at > now()
			) AS "openInviteExpiresAt",
			(
				SELECT COUNT(*)::int
				FROM link_shares ls
				WHERE ls.author_id = u.id
					AND ls.deleted_at IS NULL
			) AS "shareCount"
		FROM users u
		ORDER BY u.is_active DESC, u.created_at ASC, u.id ASC
	`);

	return rows.map((row) => {
		const record = row as Record<string, unknown>;
		const openInviteExpiresAt = record.openInviteExpiresAt
			? new Date(record.openInviteExpiresAt as string | Date).toISOString()
			: null;
		return {
			id: String(record.id),
			name: String(record.name),
			email: String(record.email),
			role: record.role as UserRole,
			isActive: Boolean(record.isActive),
			disabledAt: record.disabledAt
				? new Date(record.disabledAt as string | Date).toISOString()
				: null,
			emailVerified: Boolean(record.emailVerified),
			hasPassword: Boolean(record.hasPassword),
			hasOpenInvite: Boolean(openInviteExpiresAt),
			openInviteExpiresAt,
			shareCount: Number(record.shareCount ?? 0),
			createdAt: new Date(record.createdAt as string | Date).toISOString(),
			updatedAt: new Date(record.updatedAt as string | Date).toISOString()
		};
	});
}

export async function inviteAdminUser(
	input: {
		name: string;
		email: string;
		role?: UserRole;
		originOverride?: string | null;
	},
	actorUserId: string,
	requestId: string | null = null
): Promise<{
	user: { id: string; name: string; email: string; role: UserRole };
	invite: { id: string; url: string; expiresAt: string };
}> {
	const name = normalizeName(input.name);
	const email = normalizeEmail(input.email);
	const role = parseRole(input.role ?? 'member');

	try {
		return await db.transaction(async (tx) => {
			await assertAdminActor(tx, actorUserId);

			const [existing] = await tx
				.select({ id: users.id })
				.from(users)
				.where(eq(users.email, email))
				.limit(1);

			if (existing) {
				throw new AdminServiceError(409, 'USER_EMAIL_EXISTS', t('admin.emailTaken'));
			}

			const userId = randomUUID();
			const now = new Date();
			await tx.insert(users).values({
				id: userId,
				name,
				email,
				role,
				emailVerified: false,
				isActive: true,
				authVersion: 1,
				createdAt: now,
				updatedAt: now
			});

			const token = await createInviteToken(userId, 'invite', actorUserId, {
				tx,
				originOverride: input.originOverride ?? null
			});

			await recordAuditLog(
				{
					actorUserId,
					action: 'admin.user_invited',
					targetType: 'user',
					targetId: userId,
					metadata: sanitizeAuditMetadata({
						invitedEmail: email,
						invitedRole: role,
						inviteTokenId: token.id,
						expiresAt: token.expiresAt.toISOString()
					}),
					requestId
				},
				tx
			);

			logger
				.child({ request_id: requestId, user_id: actorUserId, channel: 'web' })
				.info('Admin invited team member', {
					target_user_id: userId,
					role
				});

			return {
				user: { id: userId, name, email, role },
				invite: {
					id: token.id,
					url: token.url,
					expiresAt: token.expiresAt.toISOString()
				}
			};
		});
	} catch (err) {
		if (err instanceof AdminServiceError) {
			throw err;
		}
		const { code } = extractPgErrorCode(err);
		if (code === '23505') {
			throw new AdminServiceError(409, 'USER_EMAIL_EXISTS', t('admin.emailTaken'));
		}
		throw err;
	}
}

export async function regenerateUserInvite(
	targetUserId: string,
	actorUserId: string,
	requestId: string | null = null,
	originOverride: string | null = null
): Promise<{
	user: { id: string; name: string; email: string; role: UserRole };
	invite: { id: string; url: string; expiresAt: string };
}> {
	return db.transaction(async (tx) => {
		const { target } = await lockActiveAdminsAndInvolvedUsers(tx, actorUserId, targetUserId);

		if (!target.isActive) {
			throw new AdminServiceError(409, 'USER_INACTIVE', t('admin.inviteDisabledUser'));
		}

		const [passwordAccount] = await tx
			.select({ id: accounts.id })
			.from(accounts)
			.where(and(eq(accounts.userId, target.id), sql`${accounts.password} IS NOT NULL`))
			.limit(1);

		if (target.emailVerified || passwordAccount) {
			throw new AdminServiceError(409, 'USER_ALREADY_ACTIVE', t('admin.inviteAlreadyActive'));
		}

		const now = new Date();
		const revoked = await tx
			.update(inviteTokens)
			.set({ revokedAt: now })
			.where(
				and(
					eq(inviteTokens.userId, target.id),
					eq(inviteTokens.purpose, 'invite'),
					isNull(inviteTokens.consumedAt),
					isNull(inviteTokens.revokedAt)
				)
			)
			.returning({ id: inviteTokens.id });

		const token = await createInviteToken(target.id, 'invite', actorUserId, {
			tx,
			originOverride
		});

		await recordAuditLog(
			{
				actorUserId,
				action: 'admin.user_invite_regenerated',
				targetType: 'user',
				targetId: target.id,
				metadata: sanitizeAuditMetadata({
					revokedInviteCount: revoked.length,
					inviteTokenId: token.id,
					expiresAt: token.expiresAt.toISOString()
				}),
				requestId
			},
			tx
		);

		return {
			user: { id: target.id, name: target.name, email: target.email, role: target.role },
			invite: {
				id: token.id,
				url: token.url,
				expiresAt: token.expiresAt.toISOString()
			}
		};
	});
}

export async function issuePasswordResetLink(
	targetUserId: string,
	actorUserId: string,
	requestId: string | null = null,
	originOverride: string | null = null
): Promise<{
	user: { id: string; name: string; email: string; role: UserRole };
	reset: { id: string; url: string; expiresAt: string };
}> {
	return db.transaction(async (tx) => {
		const { target } = await lockActiveAdminsAndInvolvedUsers(tx, actorUserId, targetUserId);

		if (!target.isActive) {
			throw new AdminServiceError(409, 'USER_INACTIVE', t('admin.resetDisabledUser'));
		}

		const now = new Date();
		await tx
			.update(users)
			.set({
				authVersion: target.authVersion + 1,
				updatedAt: now
			})
			.where(eq(users.id, target.id));

		const revokedKeys = await tx
			.update(apiKeys)
			.set({ revokedAt: now })
			.where(and(eq(apiKeys.userId, target.id), isNull(apiKeys.revokedAt)))
			.returning({ id: apiKeys.id });

		await tx
			.update(inviteTokens)
			.set({ revokedAt: now })
			.where(
				and(
					eq(inviteTokens.userId, target.id),
					isNull(inviteTokens.consumedAt),
					isNull(inviteTokens.revokedAt)
				)
			);

		const token = await createInviteToken(target.id, 'password_reset', actorUserId, {
			tx,
			originOverride
		});

		await recordAuditLog(
			{
				actorUserId,
				action: 'admin.password_reset_issued',
				targetType: 'user',
				targetId: target.id,
				metadata: sanitizeAuditMetadata({
					resetTokenId: token.id,
					expiresAt: token.expiresAt.toISOString(),
					revokedApiKeyCount: revokedKeys.length
				}),
				requestId
			},
			tx
		);

		return {
			user: { id: target.id, name: target.name, email: target.email, role: target.role },
			reset: {
				id: token.id,
				url: token.url,
				expiresAt: token.expiresAt.toISOString()
			}
		};
	});
}

export async function changeAdminUserRole(
	input: { targetUserId: string; newRole: UserRole },
	actorUserId: string,
	requestId: string | null = null
): Promise<{
	user: { id: string; name: string; email: string; role: UserRole };
	previousRole: UserRole;
	changed: boolean;
}> {
	const newRole = parseRole(input.newRole);

	return db.transaction(async (tx) => {
		const { target, activeAdminIds } = await lockActiveAdminsAndInvolvedUsers(
			tx,
			actorUserId,
			input.targetUserId
		);

		if (target.role === newRole) {
			return {
				user: { id: target.id, name: target.name, email: target.email, role: target.role },
				previousRole: target.role,
				changed: false
			};
		}

		if (target.role === 'admin' && target.isActive && newRole === 'member') {
			const remainingAdmins = [...activeAdminIds].filter((id) => id !== target.id);
			if (remainingAdmins.length < 1) {
				throw new AdminServiceError(409, 'LAST_ACTIVE_ADMIN', t('admin.lastAdminRole'));
			}
		}

		const now = new Date();
		await tx
			.update(users)
			.set({
				role: newRole,
				updatedAt: now
			})
			.where(eq(users.id, target.id));

		await recordAuditLog(
			{
				actorUserId,
				action: 'admin.user_role_changed',
				targetType: 'user',
				targetId: target.id,
				metadata: sanitizeAuditMetadata({
					previousRole: target.role,
					newRole
				}),
				requestId
			},
			tx
		);

		return {
			user: { id: target.id, name: target.name, email: target.email, role: newRole },
			previousRole: target.role,
			changed: true
		};
	});
}

export async function disableAdminUser(
	targetUserId: string,
	actorUserId: string,
	requestId: string | null = null
): Promise<{
	user: { id: string; name: string; email: string; isActive: false };
	revokedApiKeyCount: number;
	revokedInviteCount: number;
}> {
	return db.transaction(async (tx) => {
		const { target, activeAdminIds } = await lockActiveAdminsAndInvolvedUsers(
			tx,
			actorUserId,
			targetUserId
		);

		if (!target.isActive) {
			throw new AdminServiceError(409, 'USER_ALREADY_DISABLED', t('admin.alreadyDisabled'));
		}

		if (target.role === 'admin') {
			const remainingAdmins = [...activeAdminIds].filter((id) => id !== target.id);
			if (remainingAdmins.length < 1) {
				throw new AdminServiceError(409, 'LAST_ACTIVE_ADMIN', t('admin.lastAdminDisable'));
			}
		}

		const now = new Date();
		// Preserve sessions rows so hooks.server.ts recognizes the revoked auth_version
		// and returns HTTP 401 with expired cookies instead of an anonymous redirect.
		await tx
			.update(users)
			.set({
				isActive: false,
				disabledAt: now,
				authVersion: target.authVersion + 1,
				updatedAt: now
			})
			.where(eq(users.id, target.id));

		const revokedKeys = await tx
			.update(apiKeys)
			.set({ revokedAt: now })
			.where(and(eq(apiKeys.userId, target.id), isNull(apiKeys.revokedAt)))
			.returning({ id: apiKeys.id });

		const revokedInvites = await tx
			.update(inviteTokens)
			.set({ revokedAt: now })
			.where(
				and(
					eq(inviteTokens.userId, target.id),
					isNull(inviteTokens.consumedAt),
					isNull(inviteTokens.revokedAt)
				)
			)
			.returning({ id: inviteTokens.id });

		await recordAuditLog(
			{
				actorUserId,
				action: 'admin.user_disabled',
				targetType: 'user',
				targetId: target.id,
				metadata: sanitizeAuditMetadata({
					previousRole: target.role,
					revokedApiKeyCount: revokedKeys.length,
					revokedInviteCount: revokedInvites.length
				}),
				requestId
			},
			tx
		);

		logger
			.child({ request_id: requestId, user_id: actorUserId, channel: 'web' })
			.info('Admin disabled team member', {
				target_user_id: target.id,
				revoked_api_keys: revokedKeys.length
			});

		return {
			user: { id: target.id, name: target.name, email: target.email, isActive: false },
			revokedApiKeyCount: revokedKeys.length,
			revokedInviteCount: revokedInvites.length
		};
	});
}

export async function listAdminSections(): Promise<AdminSectionItem[]> {
	const rows = await db.execute(sql`
		SELECT
			s.id,
			s.slug,
			s.name,
			s.description,
			s.sort_order AS "sortOrder",
			s.created_at AS "createdAt",
			s.updated_at AS "updatedAt",
			(
				SELECT COUNT(*)::int
				FROM link_share_sections lss
				INNER JOIN link_shares ls ON ls.id = lss.share_id
				WHERE lss.section_id = s.id
					AND ls.deleted_at IS NULL
			) AS "totalShareCount",
			(
				SELECT COUNT(*)::int
				FROM link_share_sections lss
				INNER JOIN link_shares ls ON ls.id = lss.share_id
				WHERE lss.section_id = s.id
					AND ls.deleted_at IS NULL
					AND ls.is_feed_visible = false
					AND (
						SELECT COUNT(*)
						FROM link_share_sections lss_other
						WHERE lss_other.share_id = ls.id
					) = 1
			) AS "exclusiveSilentShareCount"
		FROM sections s
		ORDER BY s.sort_order ASC, s.name ASC, s.id ASC
	`);

	return rows.map((row) => {
		const record = row as Record<string, unknown>;
		return {
			id: String(record.id),
			slug: String(record.slug),
			name: String(record.name),
			description: typeof record.description === 'string' ? record.description : null,
			sortOrder: Number(record.sortOrder ?? 0),
			totalShareCount: Number(record.totalShareCount ?? 0),
			exclusiveSilentShareCount: Number(record.exclusiveSilentShareCount ?? 0),
			createdAt: new Date(record.createdAt as string | Date).toISOString(),
			updatedAt: new Date(record.updatedAt as string | Date).toISOString()
		};
	});
}

function normalizeSectionInput(input: {
	name: string;
	slug?: string | null;
	description?: string | null;
}): { name: string; slug: string; description: string | null } {
	const name = input.name.trim().replace(/\s+/g, ' ');
	if (name.length < 1 || name.length > 80) {
		throw new AdminServiceError(422, 'INVALID_SECTION_NAME', t('admin.sectionNameLength'));
	}

	const rawSlug = input.slug?.trim();
	const slug =
		rawSlug && rawSlug.length > 0 ? slugifySectionName(rawSlug) : slugifySectionName(name);
	if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
		throw new AdminServiceError(422, 'INVALID_SECTION_SLUG', t('admin.slugInvalid'));
	}

	const trimmedDescription = input.description?.trim() ?? '';
	if (trimmedDescription.length > 280) {
		throw new AdminServiceError(422, 'INVALID_SECTION_DESCRIPTION', t('admin.sectionDescLength'));
	}

	return {
		name,
		slug,
		description: trimmedDescription.length > 0 ? trimmedDescription : null
	};
}

export async function createAdminSection(
	input: { name: string; slug?: string | null; description?: string | null },
	actorUserId: string,
	requestId: string | null = null
): Promise<{
	id: string;
	name: string;
	slug: string;
	description: string | null;
	sortOrder: number;
}> {
	const parsed = normalizeSectionInput(input);

	try {
		return await db.transaction(async (tx) => {
			await assertAdminActor(tx, actorUserId);

			await tx.execute(sql`SELECT id FROM sections ORDER BY id ASC FOR UPDATE`);

			const [maxRow] = await tx.execute(
				sql`SELECT COALESCE(MAX(sort_order), -1)::int AS "maxOrder" FROM sections`
			);
			const nextOrder = Number((maxRow as Record<string, unknown> | undefined)?.maxOrder ?? -1) + 1;
			const now = new Date();
			const id = randomUUID();

			await tx.insert(sections).values({
				id,
				name: parsed.name,
				slug: parsed.slug,
				description: parsed.description,
				sortOrder: nextOrder,
				createdById: actorUserId,
				createdAt: now,
				updatedAt: now
			});

			await recordAuditLog(
				{
					actorUserId,
					action: 'admin.section_created',
					targetType: 'section',
					targetId: id,
					metadata: sanitizeAuditMetadata({
						name: parsed.name,
						slug: parsed.slug,
						sortOrder: nextOrder
					}),
					requestId
				},
				tx
			);

			return {
				id,
				name: parsed.name,
				slug: parsed.slug,
				description: parsed.description,
				sortOrder: nextOrder
			};
		});
	} catch (err) {
		if (err instanceof AdminServiceError) {
			throw err;
		}
		const { code, constraint } = extractPgErrorCode(err);
		if (code === '23505') {
			if (constraint?.includes('slug')) {
				throw new AdminServiceError(409, 'SECTION_SLUG_EXISTS', t('admin.slugTaken'));
			}
			throw new AdminServiceError(409, 'SECTION_NAME_EXISTS', t('admin.sectionNameTaken'));
		}
		throw err;
	}
}

export async function updateAdminSection(
	sectionId: string,
	input: { name: string; slug?: string | null; description?: string | null },
	actorUserId: string,
	requestId: string | null = null
): Promise<{ id: string; name: string; slug: string; description: string | null }> {
	const parsed = normalizeSectionInput(input);

	try {
		return await db.transaction(async (tx) => {
			await assertAdminActor(tx, actorUserId);

			const [existing] = await tx
				.select({
					id: sections.id,
					name: sections.name,
					slug: sections.slug,
					description: sections.description
				})
				.from(sections)
				.where(eq(sections.id, sectionId))
				.limit(1);

			if (!existing) {
				throw new AdminServiceError(404, 'SECTION_NOT_FOUND', t('admin.sectionToUpdateNotFound'));
			}

			const now = new Date();
			await tx
				.update(sections)
				.set({
					name: parsed.name,
					slug: parsed.slug,
					description: parsed.description,
					updatedAt: now
				})
				.where(eq(sections.id, sectionId));

			await recordAuditLog(
				{
					actorUserId,
					action: 'admin.section_updated',
					targetType: 'section',
					targetId: sectionId,
					metadata: sanitizeAuditMetadata({
						previousName: existing.name,
						previousSlug: existing.slug,
						name: parsed.name,
						slug: parsed.slug
					}),
					requestId
				},
				tx
			);

			return {
				id: sectionId,
				name: parsed.name,
				slug: parsed.slug,
				description: parsed.description
			};
		});
	} catch (err) {
		if (err instanceof AdminServiceError) {
			throw err;
		}
		const { code, constraint } = extractPgErrorCode(err);
		if (code === '23505') {
			if (constraint?.includes('slug')) {
				throw new AdminServiceError(409, 'SECTION_SLUG_EXISTS', t('admin.slugTaken'));
			}
			throw new AdminServiceError(409, 'SECTION_NAME_EXISTS', t('admin.sectionNameTaken'));
		}
		throw err;
	}
}

export async function moveAdminSection(
	sectionId: string,
	direction: 'up' | 'down',
	actorUserId: string,
	requestId: string | null = null
): Promise<{ moved: boolean; orderedSectionIds: string[] }> {
	return db.transaction(async (tx) => {
		await assertAdminActor(tx, actorUserId);

		const locked = await tx
			.select({
				id: sections.id,
				name: sections.name,
				sortOrder: sections.sortOrder,
				createdAt: sections.createdAt
			})
			.from(sections)
			.orderBy(sections.id)
			.for('update');

		const ordered = [...locked].sort((a, b) => {
			if (a.sortOrder !== b.sortOrder) {
				return a.sortOrder - b.sortOrder;
			}
			const nameDiff = a.name.localeCompare(b.name);
			if (nameDiff !== 0) {
				return nameDiff;
			}
			return a.id.localeCompare(b.id);
		});

		const index = ordered.findIndex((item) => item.id === sectionId);
		if (index === -1) {
			throw new AdminServiceError(404, 'SECTION_NOT_FOUND', t('admin.sectionToMoveNotFound'));
		}

		const targetIndex = direction === 'up' ? index - 1 : index + 1;
		if (targetIndex < 0 || targetIndex >= ordered.length) {
			return {
				moved: false,
				orderedSectionIds: ordered.map((item) => item.id)
			};
		}

		const swapped = [...ordered];
		const [removed] = swapped.splice(index, 1);
		swapped.splice(targetIndex, 0, removed);

		const now = new Date();
		for (let i = 0; i < swapped.length; i += 1) {
			await tx
				.update(sections)
				.set({ sortOrder: i, updatedAt: now })
				.where(eq(sections.id, swapped[i].id));
		}

		const orderedSectionIds = swapped.map((item) => item.id);

		await recordAuditLog(
			{
				actorUserId,
				action: 'admin.section_reordered',
				targetType: 'section',
				targetId: sectionId,
				metadata: sanitizeAuditMetadata({
					direction,
					orderedSectionIds
				}),
				requestId
			},
			tx
		);

		return {
			moved: true,
			orderedSectionIds
		};
	});
}

export async function resolveSectionSilentShares(
	input: {
		sourceSectionId: string;
		mode: 'move' | 'publish';
		targetSectionId?: string | null;
	},
	actorUserId: string,
	requestId: string | null = null
): Promise<{ affectedShareCount: number; mode: 'move' | 'publish' }> {
	if (input.mode !== 'move' && input.mode !== 'publish') {
		throw new AdminServiceError(422, 'INVALID_RESOLUTION_MODE', t('admin.resolveModeInvalid'));
	}

	return db.transaction(async (tx) => {
		await assertAdminActor(tx, actorUserId);

		const [source] = await tx
			.select({ id: sections.id })
			.from(sections)
			.where(eq(sections.id, input.sourceSectionId))
			.limit(1);

		if (!source) {
			throw new AdminServiceError(404, 'SECTION_NOT_FOUND', t('admin.sourceSectionNotFound'));
		}

		if (input.mode === 'move') {
			if (!input.targetSectionId || input.targetSectionId === input.sourceSectionId) {
				throw new AdminServiceError(422, 'INVALID_TARGET_SECTION', t('admin.moveTargetSame'));
			}
			const [target] = await tx
				.select({ id: sections.id })
				.from(sections)
				.where(eq(sections.id, input.targetSectionId))
				.limit(1);
			if (!target) {
				throw new AdminServiceError(
					404,
					'TARGET_SECTION_NOT_FOUND',
					t('admin.targetSectionNotFound')
				);
			}
		}

		const exclusiveRows = await tx.execute(sql`
			SELECT ls.id
			FROM link_shares ls
			INNER JOIN link_share_sections lss ON lss.share_id = ls.id
			WHERE lss.section_id = ${input.sourceSectionId}
				AND ls.deleted_at IS NULL
				AND ls.is_feed_visible = false
				AND (
					SELECT COUNT(*)
					FROM link_share_sections lss_other
					WHERE lss_other.share_id = ls.id
				) = 1
			ORDER BY ls.id ASC
			FOR UPDATE OF ls
		`);

		const shareIds = exclusiveRows.map((row) => String((row as Record<string, unknown>).id));
		if (shareIds.length === 0) {
			return { affectedShareCount: 0, mode: input.mode };
		}

		const now = new Date();
		if (input.mode === 'move' && input.targetSectionId) {
			// Insert target link BEFORE removing source link so the deferred trigger validates cleanly at commit.
			await tx
				.insert(linkShareSections)
				.values(shareIds.map((shareId) => ({ shareId, sectionId: input.targetSectionId! })))
				.onConflictDoNothing();

			await tx
				.delete(linkShareSections)
				.where(
					and(
						eq(linkShareSections.sectionId, input.sourceSectionId),
						inArray(linkShareSections.shareId, shareIds)
					)
				);
		} else {
			await tx
				.update(linkShares)
				.set({
					isFeedVisible: true,
					updatedAt: now
				})
				.where(inArray(linkShares.id, shareIds));
		}

		await recordAuditLog(
			{
				actorUserId,
				action: 'admin.section_silent_shares_resolved',
				targetType: 'section',
				targetId: input.sourceSectionId,
				metadata: sanitizeAuditMetadata({
					mode: input.mode,
					targetSectionId: input.mode === 'move' ? (input.targetSectionId ?? null) : null,
					affectedShareCount: shareIds.length
				}),
				requestId
			},
			tx
		);

		return { affectedShareCount: shareIds.length, mode: input.mode };
	});
}

export async function deleteAdminSection(
	sectionId: string,
	actorUserId: string,
	requestId: string | null = null
): Promise<{ deletedSectionId: string; sectionName: string }> {
	try {
		return await db.transaction(async (tx) => {
			await assertAdminActor(tx, actorUserId);

			const lockedRows = await tx
				.select({
					id: sections.id,
					name: sections.name,
					slug: sections.slug
				})
				.from(sections)
				.where(eq(sections.id, sectionId))
				.for('update');

			const existing = lockedRows[0];
			if (!existing) {
				throw new AdminServiceError(404, 'SECTION_NOT_FOUND', t('admin.sectionToDeleteNotFound'));
			}

			const exclusiveSilent = await tx.execute(sql`
				SELECT ls.id
				FROM link_shares ls
				INNER JOIN link_share_sections lss ON lss.share_id = ls.id
				WHERE lss.section_id = ${sectionId}
					AND ls.deleted_at IS NULL
					AND ls.is_feed_visible = false
					AND (
						SELECT COUNT(*)
						FROM link_share_sections lss_other
						WHERE lss_other.share_id = ls.id
					) = 1
			`);

			if (exclusiveSilent.length > 0) {
				throw new AdminServiceError(
					409,
					'SECTION_HAS_EXCLUSIVE_SILENT_SHARES',
					t('admin.sectionExclusiveSilent', { count: exclusiveSilent.length }),
					{ exclusiveSilentShareCount: exclusiveSilent.length }
				);
			}

			await tx.delete(sections).where(eq(sections.id, sectionId));

			await recordAuditLog(
				{
					actorUserId,
					action: 'admin.section_deleted',
					targetType: 'section',
					targetId: sectionId,
					metadata: sanitizeAuditMetadata({
						name: existing.name,
						slug: existing.slug
					}),
					requestId
				},
				tx
			);

			return {
				deletedSectionId: sectionId,
				sectionName: existing.name
			};
		});
	} catch (err) {
		if (err instanceof AdminServiceError) {
			throw err;
		}
		const { code } = extractPgErrorCode(err);
		if (code === '23514') {
			throw new AdminServiceError(
				409,
				'SECTION_HAS_EXCLUSIVE_SILENT_SHARES',
				t('admin.sectionHasSilent')
			);
		}
		throw err;
	}
}

export async function listUnassignedShares(options?: {
	limit?: number;
	cursor?: string | null;
}): Promise<{
	items: UnassignedShareItem[];
	nextCursor: string | null;
	totalUnassignedCount: number;
}> {
	const limit = Math.min(Math.max(options?.limit ?? UNASSIGNED_PAGE_SIZE, 1), 100);
	const cursor = decodeCursor(options?.cursor);

	const [countRow] = await db.execute(sql`
		SELECT COUNT(*)::int AS "count"
		FROM link_shares ls
		WHERE ls.deleted_at IS NULL
			AND NOT EXISTS (
				SELECT 1
				FROM link_share_sections lss
				WHERE lss.share_id = ls.id
			)
	`);

	const cursorClause = cursor
		? sql`AND (ls.created_at, ls.id) < (${cursor.createdAt}::timestamptz, ${cursor.id})`
		: sql``;

	const rows = await db.execute(sql`
		SELECT
			ls.id,
			ls.raw_url AS "rawUrl",
			ls.note,
			ls.source_channel AS "sourceChannel",
			ls.created_at AS "createdAt",
			to_char(ls.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAtCursor",
			u.id AS "authorId",
			u.name AS "authorName",
			u.email AS "authorEmail",
			cr.id AS "resourceId",
			cr.canonical_url AS "canonicalUrl",
			cr.title,
			cr.domain
		FROM link_shares ls
		INNER JOIN users u ON u.id = ls.author_id
		INNER JOIN canonical_resources cr ON cr.id = ls.resource_id
		WHERE ls.deleted_at IS NULL
			AND NOT EXISTS (
				SELECT 1
				FROM link_share_sections lss
				WHERE lss.share_id = ls.id
			)
			${cursorClause}
		ORDER BY ls.created_at DESC, ls.id DESC
		LIMIT ${limit + 1}
	`);

	const hasMore = rows.length > limit;
	const sliced = hasMore ? rows.slice(0, limit) : rows;

	const items: UnassignedShareItem[] = sliced.map((row) => {
		const record = row as Record<string, unknown>;
		return {
			id: String(record.id),
			rawUrl: String(record.rawUrl),
			note: typeof record.note === 'string' ? record.note : null,
			sourceChannel: record.sourceChannel as 'web' | 'api',
			createdAt: new Date(record.createdAt as string | Date).toISOString(),
			authorId: String(record.authorId),
			authorName: String(record.authorName),
			authorEmail: String(record.authorEmail),
			resourceId: String(record.resourceId),
			canonicalUrl: String(record.canonicalUrl),
			title: typeof record.title === 'string' ? record.title : null,
			domain: String(record.domain)
		};
	});

	const last = sliced[sliced.length - 1] as Record<string, unknown> | undefined;
	const nextCursor =
		hasMore && last ? encodeTimeIdCursor(String(last.createdAtCursor), String(last.id)) : null;

	return {
		items,
		nextCursor,
		totalUnassignedCount: Number((countRow as Record<string, unknown> | undefined)?.count ?? 0)
	};
}

export async function bulkAssignSharesToSections(
	input: {
		shareIds: readonly string[];
		sectionIds: readonly string[];
	},
	actorUserId: string,
	requestId: string | null = null
): Promise<{ assignedShareCount: number; sectionCount: number }> {
	const uniqueShareIds = [...new Set(input.shareIds.map((id) => id.trim()).filter(Boolean))];
	const uniqueSectionIds = [...new Set(input.sectionIds.map((id) => id.trim()).filter(Boolean))];

	if (uniqueShareIds.length === 0) {
		throw new AdminServiceError(422, 'NO_SHARES_SELECTED', t('admin.assignPickShare'));
	}
	if (uniqueSectionIds.length === 0) {
		throw new AdminServiceError(422, 'NO_SECTIONS_SELECTED', t('admin.assignPickSection'));
	}

	return db.transaction(async (tx) => {
		await assertAdminActor(tx, actorUserId);

		const existingSections = await findExistingSectionIds(uniqueSectionIds, tx);
		if (existingSections.size !== uniqueSectionIds.length) {
			throw new AdminServiceError(404, 'SECTION_NOT_FOUND', t('admin.assignSectionMissing'));
		}

		const activeShares = await tx
			.select({ id: linkShares.id })
			.from(linkShares)
			.where(and(inArray(linkShares.id, uniqueShareIds), isNull(linkShares.deletedAt)));

		if (activeShares.length === 0) {
			throw new AdminServiceError(404, 'SHARES_NOT_FOUND', t('admin.assignSharesMissing'));
		}

		const validShareIds = activeShares.map((row) => row.id);
		const pairs: Array<{ shareId: string; sectionId: string }> = [];
		for (const shareId of validShareIds) {
			for (const sectionId of uniqueSectionIds) {
				pairs.push({ shareId, sectionId });
			}
		}

		await tx.insert(linkShareSections).values(pairs).onConflictDoNothing();

		await recordAuditLog(
			{
				actorUserId,
				action: 'admin.unassigned_shares_assigned',
				targetType: 'link_share',
				targetId: validShareIds.length === 1 ? validShareIds[0] : null,
				metadata: sanitizeAuditMetadata({
					shareCount: validShareIds.length,
					sectionIds: uniqueSectionIds,
					shareIds: validShareIds.slice(0, 50)
				}),
				requestId
			},
			tx
		);

		return {
			assignedShareCount: validShareIds.length,
			sectionCount: uniqueSectionIds.length
		};
	});
}

export async function getUnfurlQueueSummary(): Promise<UnfurlQueueSummary> {
	const rows = await db.execute(sql`
		SELECT
			uj.status,
			COUNT(*)::int AS "count"
		FROM unfurl_jobs uj
		INNER JOIN canonical_resources cr ON cr.id = uj.resource_id
		WHERE NOT (
			EXISTS (SELECT 1 FROM link_shares ls WHERE ls.resource_id = cr.id)
			AND NOT EXISTS (
				SELECT 1 FROM link_shares ls WHERE ls.resource_id = cr.id AND ls.deleted_at IS NULL
			)
		)
		GROUP BY uj.status
	`);

	const summary: UnfurlQueueSummary = {
		queued: 0,
		running: 0,
		completed: 0,
		dead: 0,
		total: 0
	};

	for (const row of rows) {
		const record = row as Record<string, unknown>;
		const status = String(record.status);
		const count = Number(record.count ?? 0);
		if (
			status === 'queued' ||
			status === 'running' ||
			status === 'completed' ||
			status === 'dead'
		) {
			summary[status] = count;
		}
		summary.total += count;
	}

	return summary;
}

export async function listFailedUnfurlJobs(limit = 50): Promise<DeadUnfurlJobItem[]> {
	const bounded = Math.min(Math.max(limit, 1), 200);
	const rows = await db
		.select({
			id: unfurlJobs.id,
			resourceId: unfurlJobs.resourceId,
			targetUrl: unfurlJobs.targetUrl,
			canonicalUrl: canonicalResources.canonicalUrl,
			domain: canonicalResources.domain,
			title: canonicalResources.title,
			attempts: unfurlJobs.attempts,
			lastErrorCode: unfurlJobs.lastErrorCode,
			lastErrorMessage: unfurlJobs.lastErrorMessage,
			createdAt: unfurlJobs.createdAt,
			updatedAt: unfurlJobs.updatedAt
		})
		.from(unfurlJobs)
		.innerJoin(canonicalResources, eq(unfurlJobs.resourceId, canonicalResources.id))
		.where(
			and(
				eq(unfurlJobs.status, 'dead'),
				sql`NOT (
					EXISTS (SELECT 1 FROM link_shares ls WHERE ls.resource_id = ${canonicalResources.id})
					AND NOT EXISTS (
						SELECT 1 FROM link_shares ls
						WHERE ls.resource_id = ${canonicalResources.id} AND ls.deleted_at IS NULL
					)
				)`
			)
		)
		.orderBy(desc(unfurlJobs.updatedAt), desc(unfurlJobs.id))
		.limit(bounded);

	return rows.map((row) => ({
		id: row.id,
		resourceId: row.resourceId,
		targetUrl: row.targetUrl,
		canonicalUrl: row.canonicalUrl,
		domain: row.domain,
		title: row.title,
		attempts: row.attempts,
		lastErrorCode: row.lastErrorCode,
		lastErrorMessage: row.lastErrorMessage,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString()
	}));
}

export async function retryDeadUnfurlJob(
	jobId: string,
	actorUserId: string,
	requestId: string | null = null
): Promise<{ jobId: string; resourceId: string; status: 'queued' }> {
	const result = await db.transaction(async (tx) => {
		await assertAdminActor(tx, actorUserId);

		// Lock order everywhere is canonical_resources -> unfurl_jobs (see createLinkShare).
		const [jobRef] = await tx
			.select({ resourceId: unfurlJobs.resourceId })
			.from(unfurlJobs)
			.where(eq(unfurlJobs.id, jobId))
			.limit(1);
		if (jobRef) {
			await tx
				.select({ id: canonicalResources.id })
				.from(canonicalResources)
				.where(eq(canonicalResources.id, jobRef.resourceId))
				.for('update');
		}

		const locked = await tx
			.select({
				id: unfurlJobs.id,
				resourceId: unfurlJobs.resourceId,
				targetUrl: unfurlJobs.targetUrl,
				status: unfurlJobs.status,
				attempts: unfurlJobs.attempts,
				lastErrorCode: unfurlJobs.lastErrorCode
			})
			.from(unfurlJobs)
			.where(eq(unfurlJobs.id, jobId))
			.for('update');

		const job = locked[0];
		if (!job) {
			throw new AdminServiceError(404, 'UNFURL_JOB_NOT_FOUND', t('admin.jobNotFound'));
		}
		if (job.status !== 'dead') {
			throw new AdminServiceError(409, 'UNFURL_JOB_NOT_DEAD', t('admin.jobNotDead'));
		}

		const now = new Date();
		await tx
			.update(unfurlJobs)
			.set({
				status: 'queued',
				attempts: 0,
				nextRunAt: now,
				lockedUntil: null,
				lockToken: null,
				lastErrorCode: null,
				lastErrorMessage: null,
				updatedAt: now
			})
			.where(eq(unfurlJobs.id, job.id));

		await tx
			.update(canonicalResources)
			.set({
				unfurlStatus: 'queued',
				updatedAt: now
			})
			.where(eq(canonicalResources.id, job.resourceId));

		await recordAuditLog(
			{
				actorUserId,
				action: 'admin.unfurl_job_retried',
				targetType: 'unfurl_job',
				targetId: job.id,
				metadata: sanitizeAuditMetadata({
					resourceId: job.resourceId,
					targetUrl: job.targetUrl,
					previousAttempts: job.attempts,
					previousErrorCode: job.lastErrorCode
				}),
				requestId
			},
			tx
		);

		return {
			jobId: job.id,
			resourceId: job.resourceId,
			status: 'queued' as const
		};
	});

	notifyUnfurlWorker();
	return result;
}

export async function retryAllDeadUnfurlJobs(
	actorUserId: string,
	requestId: string | null = null
): Promise<{ retriedCount: number; retriedJobIds: string[] }> {
	const result = await db.transaction(async (tx) => {
		await assertAdminActor(tx, actorUserId);

		// Only jobs the admin can actually see (same filter as listDeadUnfurlJobs): hide resources
		// that had shares which are now all soft-deleted.
		const visibleDead = await tx
			.select({
				id: unfurlJobs.id,
				resourceId: unfurlJobs.resourceId
			})
			.from(unfurlJobs)
			.where(
				and(
					eq(unfurlJobs.status, 'dead'),
					sql`NOT (
						EXISTS (SELECT 1 FROM link_shares ls WHERE ls.resource_id = ${unfurlJobs.resourceId})
						AND NOT EXISTS (
							SELECT 1 FROM link_shares ls
							WHERE ls.resource_id = ${unfurlJobs.resourceId} AND ls.deleted_at IS NULL
						)
					)`
				)
			);

		if (visibleDead.length === 0) {
			return { retriedCount: 0, retriedJobIds: [] as string[] };
		}

		// Lock order everywhere is canonical_resources -> unfurl_jobs (see createLinkShare).
		await tx
			.select({ id: canonicalResources.id })
			.from(canonicalResources)
			.where(inArray(canonicalResources.id, [...new Set(visibleDead.map((job) => job.resourceId))]))
			.orderBy(canonicalResources.id)
			.for('update');

		const lockedDead = await tx
			.select({
				id: unfurlJobs.id,
				resourceId: unfurlJobs.resourceId
			})
			.from(unfurlJobs)
			.where(
				and(
					inArray(
						unfurlJobs.id,
						visibleDead.map((job) => job.id)
					),
					eq(unfurlJobs.status, 'dead')
				)
			)
			.orderBy(unfurlJobs.id)
			.for('update');

		if (lockedDead.length === 0) {
			return { retriedCount: 0, retriedJobIds: [] as string[] };
		}

		const jobIds = lockedDead.map((job) => job.id);
		const resourceIds = [...new Set(lockedDead.map((job) => job.resourceId))];
		const now = new Date();

		await tx
			.update(unfurlJobs)
			.set({
				status: 'queued',
				attempts: 0,
				nextRunAt: now,
				lockedUntil: null,
				lockToken: null,
				lastErrorCode: null,
				lastErrorMessage: null,
				updatedAt: now
			})
			.where(inArray(unfurlJobs.id, jobIds));

		await tx
			.update(canonicalResources)
			.set({
				unfurlStatus: 'queued',
				updatedAt: now
			})
			.where(inArray(canonicalResources.id, resourceIds));

		await recordAuditLog(
			{
				actorUserId,
				action: 'admin.unfurl_jobs_retried_all',
				targetType: 'unfurl_job',
				targetId: null,
				metadata: sanitizeAuditMetadata({
					retriedCount: jobIds.length,
					jobIds: jobIds.slice(0, 50)
				}),
				requestId
			},
			tx
		);

		return {
			retriedCount: jobIds.length,
			retriedJobIds: jobIds
		};
	});

	if (result.retriedCount > 0) {
		notifyUnfurlWorker();
	}

	return result;
}

export async function listAuditLogs(options?: {
	action?: string | null;
	cursor?: string | null;
}): Promise<{
	items: AuditLogItem[];
	nextCursor: string | null;
	availableActions: string[];
}> {
	const actionFilter = options?.action?.trim() || null;
	const cursor = decodeCursor(options?.cursor);

	const conditions = [];
	if (actionFilter) {
		conditions.push(eq(auditLogs.action, actionFilter));
	}
	if (cursor) {
		conditions.push(
			sql`(${auditLogs.createdAt}, ${auditLogs.id}) < (${cursor.createdAt}::timestamptz, ${cursor.id})`
		);
	}

	const rows = await db
		.select({
			id: auditLogs.id,
			actorUserId: auditLogs.actorUserId,
			actorName: users.name,
			actorEmail: users.email,
			action: auditLogs.action,
			targetType: auditLogs.targetType,
			targetId: auditLogs.targetId,
			metadata: auditLogs.metadata,
			requestId: auditLogs.requestId,
			createdAt: auditLogs.createdAt,
			createdAtCursor: preciseTimestampText(auditLogs.createdAt)
		})
		.from(auditLogs)
		.leftJoin(users, eq(auditLogs.actorUserId, users.id))
		.where(conditions.length > 0 ? and(...conditions) : undefined)
		.orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
		.limit(AUDIT_PAGE_SIZE + 1);

	const hasMore = rows.length > AUDIT_PAGE_SIZE;
	const sliced = hasMore ? rows.slice(0, AUDIT_PAGE_SIZE) : rows;

	const distinctRows = await db.execute(sql`
		SELECT DISTINCT action
		FROM audit_logs
		ORDER BY action ASC
	`);
	const actionSet = new Set<string>(KNOWN_AUDIT_ACTIONS);
	for (const row of distinctRows) {
		const action = (row as Record<string, unknown>).action;
		if (typeof action === 'string' && action.trim()) {
			actionSet.add(action.trim());
		}
	}

	const items: AuditLogItem[] = sliced.map((row) => ({
		id: row.id,
		actorUserId: row.actorUserId,
		actorName: row.actorName,
		actorEmail: row.actorEmail,
		action: row.action,
		actionLabel: auditActionLabels()[row.action] ?? row.action,
		targetType: row.targetType,
		targetId: row.targetId,
		metadata: sanitizeAuditMetadata(row.metadata as Record<string, unknown> | null),
		requestId: row.requestId,
		createdAt: row.createdAt.toISOString()
	}));

	const last = sliced[sliced.length - 1];
	const nextCursor = hasMore && last ? encodeTimeIdCursor(last.createdAtCursor, last.id) : null;

	return {
		items,
		nextCursor,
		availableActions: [...actionSet].sort()
	};
}

async function computeRollingWindow(
	days: 7 | 30,
	totalActiveUsers: number,
	now: Date
): Promise<RollingMetricsWindow> {
	const cutoffIso = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

	const [shareRow] = await db.execute(sql`
		SELECT
			COUNT(*)::int AS "totalShares",
			COUNT(*) FILTER (WHERE ls.source_channel = 'web')::int AS "webShares",
			COUNT(*) FILTER (WHERE ls.source_channel = 'api')::int AS "apiShares",
			COUNT(DISTINCT ls.author_id)::int AS "activeSharingUsers"
		FROM link_shares ls
		INNER JOIN users u ON u.id = ls.author_id AND u.is_active = true
		WHERE ls.deleted_at IS NULL
			AND ls.created_at >= ${cutoffIso}::timestamptz
	`);

	const [searchRow] = await db.execute(sql`
		SELECT
			COUNT(*)::int AS "totalSearches",
			COUNT(*) FILTER (WHERE sl.result_count = 0)::int AS "zeroResultSearches",
			COUNT(DISTINCT sl.user_id)::int AS "activeSearchingUsers"
		FROM search_logs sl
		INNER JOIN users u ON u.id = sl.user_id AND u.is_active = true
		WHERE sl.created_at >= ${cutoffIso}::timestamptz
	`);

	const [unionRow] = await db.execute(sql`
		SELECT COUNT(DISTINCT active_users.user_id)::int AS "activeUnionUsers"
		FROM (
			SELECT ls.author_id AS user_id
			FROM link_shares ls
			INNER JOIN users u ON u.id = ls.author_id AND u.is_active = true
			WHERE ls.deleted_at IS NULL
				AND ls.created_at >= ${cutoffIso}::timestamptz
			UNION
			SELECT sl.user_id
			FROM search_logs sl
			INNER JOIN users u ON u.id = sl.user_id AND u.is_active = true
			WHERE sl.created_at >= ${cutoffIso}::timestamptz
		) active_users
	`);

	const shareStats = (shareRow ?? {}) as Record<string, unknown>;
	const searchStats = (searchRow ?? {}) as Record<string, unknown>;
	const unionStats = (unionRow ?? {}) as Record<string, unknown>;

	const totalShares = Number(shareStats.totalShares ?? 0);
	const webShares = Number(shareStats.webShares ?? 0);
	const apiShares = Number(shareStats.apiShares ?? 0);
	const totalSearches = Number(searchStats.totalSearches ?? 0);
	const zeroResultSearches = Number(searchStats.zeroResultSearches ?? 0);

	return {
		days,
		totalActiveUsers,
		activeSharingUsers: Number(shareStats.activeSharingUsers ?? 0),
		activeSearchingUsers: Number(searchStats.activeSearchingUsers ?? 0),
		activeUnionUsers: Number(unionStats.activeUnionUsers ?? 0),
		totalShares,
		webShares,
		apiShares,
		webShareRatio: totalShares > 0 ? webShares / totalShares : 0,
		apiShareRatio: totalShares > 0 ? apiShares / totalShares : 0,
		totalSearches,
		zeroResultSearches,
		zeroResultSearchRate: totalSearches > 0 ? zeroResultSearches / totalSearches : 0
	};
}

export async function getAdminUsageMetrics(now = new Date()): Promise<AdminUsageMetrics> {
	const cutoff30Iso = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

	const [userTotalsRow] = await db.execute(sql`
		SELECT
			COUNT(*) FILTER (WHERE is_active = true)::int AS "activeUsers",
			COUNT(*) FILTER (WHERE is_active = false)::int AS "disabledUsers"
		FROM users
	`);

	const [contentTotalsRow] = await db.execute(sql`
		SELECT
			(SELECT COUNT(*)::int FROM link_shares WHERE deleted_at IS NULL) AS "activeShares",
			(
				SELECT COUNT(*)::int
				FROM link_shares ls
				WHERE ls.deleted_at IS NULL
					AND NOT EXISTS (
						SELECT 1 FROM link_share_sections lss WHERE lss.share_id = ls.id
					)
			) AS "unassignedActiveShares",
			(
				SELECT COUNT(*)::int
				FROM canonical_resources cr
				WHERE NOT (
					EXISTS (SELECT 1 FROM link_shares ls WHERE ls.resource_id = cr.id)
					AND NOT EXISTS (
						SELECT 1 FROM link_shares ls WHERE ls.resource_id = cr.id AND ls.deleted_at IS NULL
					)
				)
			) AS "canonicalResources",
			(
				SELECT COUNT(*)::int
				FROM unfurl_jobs uj
				WHERE uj.status = 'dead'
					AND NOT (
						EXISTS (SELECT 1 FROM link_shares ls WHERE ls.resource_id = uj.resource_id)
						AND NOT EXISTS (
							SELECT 1 FROM link_shares ls
							WHERE ls.resource_id = uj.resource_id AND ls.deleted_at IS NULL
						)
					)
			) AS "deadUnfurlJobs"
	`);

	const sectionRows = await db.execute(sql`
		SELECT
			s.id,
			s.slug,
			s.name,
			COUNT(ls.id) FILTER (WHERE ls.deleted_at IS NULL)::int AS "totalShares",
			COUNT(ls.id) FILTER (WHERE ls.deleted_at IS NULL AND ls.created_at >= ${cutoff30Iso}::timestamptz)::int AS "sharesLast30Days"
		FROM sections s
		LEFT JOIN link_share_sections lss ON lss.section_id = s.id
		LEFT JOIN link_shares ls ON ls.id = lss.share_id
		GROUP BY s.id, s.slug, s.name, s.sort_order
		ORDER BY s.sort_order ASC, s.name ASC
	`);

	const userTotals = (userTotalsRow ?? {}) as Record<string, unknown>;
	const contentTotals = (contentTotalsRow ?? {}) as Record<string, unknown>;
	const activeUsers = Number(userTotals.activeUsers ?? 0);

	const [days7, days30] = await Promise.all([
		computeRollingWindow(7, activeUsers, now),
		computeRollingWindow(30, activeUsers, now)
	]);

	return {
		generatedAt: now.toISOString(),
		windows: { days7, days30 },
		totals: {
			activeUsers,
			disabledUsers: Number(userTotals.disabledUsers ?? 0),
			activeShares: Number(contentTotals.activeShares ?? 0),
			unassignedActiveShares: Number(contentTotals.unassignedActiveShares ?? 0),
			canonicalResources: Number(contentTotals.canonicalResources ?? 0),
			deadUnfurlJobs: Number(contentTotals.deadUnfurlJobs ?? 0)
		},
		sectionUsage: sectionRows.map((row) => {
			const record = row as Record<string, unknown>;
			return {
				id: String(record.id),
				slug: String(record.slug),
				name: String(record.name),
				totalShares: Number(record.totalShares ?? 0),
				sharesLast30Days: Number(record.sharesLast30Days ?? 0)
			};
		})
	};
}

export async function getAdminSidebarCounts(): Promise<{
	unassignedCount: number;
	deadJobsCount: number;
}> {
	const [row] = await db.execute(sql`
		SELECT
			(
				SELECT COUNT(*)::int
				FROM link_shares ls
				WHERE ls.deleted_at IS NULL
					AND NOT EXISTS (
						SELECT 1 FROM link_share_sections lss WHERE lss.share_id = ls.id
					)
			) AS "unassignedCount",
			(
				SELECT COUNT(*)::int
				FROM unfurl_jobs uj
				WHERE uj.status = 'dead'
					AND NOT (
						EXISTS (SELECT 1 FROM link_shares ls WHERE ls.resource_id = uj.resource_id)
						AND NOT EXISTS (
							SELECT 1 FROM link_shares ls
							WHERE ls.resource_id = uj.resource_id AND ls.deleted_at IS NULL
						)
					)
			) AS "deadJobsCount"
	`);
	const record = (row ?? {}) as Record<string, unknown>;
	return {
		unassignedCount: Number(record.unassignedCount ?? 0),
		deadJobsCount: Number(record.deadJobsCount ?? 0)
	};
}
