import crypto from 'node:crypto';
import type { Cookies } from '@sveltejs/kit';
import { and, eq, gt, inArray, isNull, ne, sql } from 'drizzle-orm';
import { db, type Database } from '#lib/server/db/client.ts';
import {
	accounts,
	apiKeys,
	inviteTokens,
	users,
	type InviteTokenPurpose,
	type UserRole
} from '#lib/server/db/schema.ts';
import { env } from '#lib/server/env.ts';
import { applyResponseSetCookies, auth, hashPassword, validatePasswordLength } from './better-auth';
import { t } from '#lib/i18n/index.ts';

export const INVITE_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
export const DISPLAY_NAME_MAX_LENGTH = 120;

export type DbTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type DbOrTx = Database | DbTransaction;

export function sha256Hex(rawValue: string): string {
	return crypto.createHash('sha256').update(rawValue, 'utf8').digest('hex');
}

export class InviteTokenGoneError extends Error {
	readonly status = 410 as const;

	constructor(message = t('auth.tokenInvalid')) {
		super(message);
		this.name = 'InviteTokenGoneError';
	}
}

export class InviteTokenConflictError extends Error {
	readonly status = 409 as const;

	constructor(message: string) {
		super(message);
		this.name = 'InviteTokenConflictError';
	}
}

export class InviteTokenValidationError extends Error {
	readonly status = 422 as const;
	readonly fieldErrors: Record<string, string>;

	constructor(message: string, fieldErrors: Record<string, string> = {}) {
		super(message);
		this.name = 'InviteTokenValidationError';
		this.fieldErrors = fieldErrors;
	}
}

export function buildTokenUrl(
	purpose: InviteTokenPurpose,
	rawToken: string,
	originOverride?: string | null
): string {
	const routeSegment = purpose === 'invite' ? 'accept-invite' : 'reset-password';
	const relativePath = `/auth/${routeSegment}?token=${encodeURIComponent(rawToken)}`;
	const origin = originOverride !== undefined ? originOverride : env.ORIGIN;

	if (origin && origin.trim() !== '') {
		return `${origin.trim().replace(/\/+$/, '')}${relativePath}`;
	}
	return relativePath;
}

export interface CreatedInviteToken {
	id: string;
	rawToken: string;
	expiresAt: Date;
	url: string;
}

/**
 * Generates a single-use 256-bit token (stored as SHA-256 hash), revoking any prior open
 * token for the same (user_id, purpose) pair.
 */
export async function createInviteToken(
	userId: string,
	purpose: InviteTokenPurpose,
	actorId: string | null = null,
	options?: {
		tx?: DbOrTx;
		originOverride?: string | null;
		expiresAt?: Date;
	}
): Promise<CreatedInviteToken> {
	const execute = async (tx: DbOrTx): Promise<CreatedInviteToken> => {
		const [targetUser] = await tx
			.select({ id: users.id, isActive: users.isActive })
			.from(users)
			.where(eq(users.id, userId))
			.limit(1);

		if (!targetUser) {
			throw new InviteTokenConflictError(t('admin.userNotFound'));
		}
		if (!targetUser.isActive) {
			throw new InviteTokenConflictError(t('auth.tokenDisabledUser'));
		}

		const rawToken = crypto.randomBytes(32).toString('base64url');
		const tokenHash = sha256Hex(rawToken);
		const expiresAt = options?.expiresAt ?? new Date(Date.now() + INVITE_TOKEN_TTL_MS);

		await tx
			.update(inviteTokens)
			.set({ revokedAt: sql`now()` })
			.where(
				and(
					eq(inviteTokens.userId, userId),
					eq(inviteTokens.purpose, purpose),
					isNull(inviteTokens.consumedAt),
					isNull(inviteTokens.revokedAt)
				)
			);

		const [inserted] = await tx
			.insert(inviteTokens)
			.values({
				tokenHash,
				userId,
				purpose,
				createdById: actorId,
				expiresAt
			})
			.returning({ id: inviteTokens.id, expiresAt: inviteTokens.expiresAt });

		return {
			id: inserted.id,
			rawToken,
			expiresAt: inserted.expiresAt,
			url: buildTokenUrl(purpose, rawToken, options?.originOverride)
		};
	};

	if (options?.tx) {
		return execute(options.tx);
	}
	return db.transaction(async (tx) => execute(tx));
}

export interface InspectedInviteToken {
	tokenId: string;
	user: {
		id: string;
		name: string;
		email: string;
		role: UserRole;
	};
}

export async function inspectInviteToken(
	rawToken: string | null | undefined,
	purpose: InviteTokenPurpose
): Promise<InspectedInviteToken | null> {
	if (!rawToken || typeof rawToken !== 'string' || rawToken.trim() === '') {
		return null;
	}

	const tokenHash = sha256Hex(rawToken.trim());
	const [row] = await db
		.select({
			tokenId: inviteTokens.id,
			userId: users.id,
			name: users.name,
			email: users.email,
			role: users.role
		})
		.from(inviteTokens)
		.innerJoin(users, eq(users.id, inviteTokens.userId))
		.where(
			and(
				eq(inviteTokens.tokenHash, tokenHash),
				eq(inviteTokens.purpose, purpose),
				isNull(inviteTokens.consumedAt),
				isNull(inviteTokens.revokedAt),
				gt(inviteTokens.expiresAt, sql`now()`),
				eq(users.isActive, true)
			)
		)
		.limit(1);

	if (!row) {
		return null;
	}

	return {
		tokenId: row.tokenId,
		user: {
			id: row.userId,
			name: row.name,
			email: row.email,
			role: row.role
		}
	};
}

export interface ConsumeInviteTokenResult {
	user: {
		id: string;
		name: string;
		email: string;
		role: UserRole;
		authVersion: number;
	};
	setCookieHeaders: string[];
}

/**
 * Atomically consumes a single-use token, sets the Better Auth credential password hash,
 * increments auth_version (revoking older sessions/API keys), and starts a browser session
 * automatically when accepting an invite.
 */
export async function consumeInviteToken(
	rawToken: string,
	purpose: InviteTokenPurpose,
	newPassword: string,
	displayName?: string,
	sessionContext?: {
		headers?: Headers;
		cookies?: Cookies;
	}
): Promise<ConsumeInviteTokenResult> {
	if (!rawToken || typeof rawToken !== 'string' || rawToken.trim() === '') {
		throw new InviteTokenGoneError();
	}

	const fieldErrors: Record<string, string> = {};
	const passwordValidation = validatePasswordLength(newPassword);
	if (!passwordValidation.ok) {
		fieldErrors.password = passwordValidation.message;
	}

	let normalizedDisplayName: string | undefined;
	if (purpose === 'invite' && displayName !== undefined) {
		const trimmedName = displayName.trim();
		if (trimmedName.length === 0) {
			fieldErrors.name = t('auth.nameEmpty');
		} else if (trimmedName.length > DISPLAY_NAME_MAX_LENGTH) {
			fieldErrors.name = `Ad Soyad en fazla ${DISPLAY_NAME_MAX_LENGTH} karakter olabilir.`;
		} else {
			normalizedDisplayName = trimmedName;
		}
	}

	if (Object.keys(fieldErrors).length > 0 || !passwordValidation.ok) {
		const firstMessage =
			fieldErrors.name ?? fieldErrors.password ?? 'Girilen bilgileri kontrol edin.';
		throw new InviteTokenValidationError(firstMessage, fieldErrors);
	}

	const tokenHash = sha256Hex(rawToken.trim());
	const passwordHash = await hashPassword(passwordValidation.value);

	const txResult = await db.transaction(async (tx) => {
		const [consumed] = await tx
			.update(inviteTokens)
			.set({ consumedAt: sql`now()` })
			.where(
				and(
					eq(inviteTokens.tokenHash, tokenHash),
					eq(inviteTokens.purpose, purpose),
					isNull(inviteTokens.consumedAt),
					isNull(inviteTokens.revokedAt),
					gt(inviteTokens.expiresAt, sql`now()`)
				)
			)
			.returning({ id: inviteTokens.id, userId: inviteTokens.userId });

		if (!consumed) {
			throw new InviteTokenGoneError();
		}

		const [prevUser] = await tx
			.select({
				id: users.id,
				name: users.name,
				emailVerified: users.emailVerified,
				authVersion: users.authVersion,
				isActive: users.isActive
			})
			.from(users)
			.where(eq(users.id, consumed.userId))
			.for('update')
			.limit(1);

		if (!prevUser || !prevUser.isActive) {
			throw new InviteTokenGoneError(t('auth.tokenInactiveAccount'));
		}

		const [prevAccount] = await tx
			.select({ id: accounts.id, password: accounts.password })
			.from(accounts)
			.where(and(eq(accounts.providerId, 'credential'), eq(accounts.accountId, prevUser.id)))
			.limit(1);

		// An invite is only for setting the first password; once the account has one, only a
		// password-reset link may change it.
		if (purpose === 'invite' && prevAccount?.password) {
			throw new InviteTokenGoneError(t('auth.alreadyActivated'));
		}

		// Using one link invalidates every other open invite/reset link for this member, so a
		// stale link from either flow cannot overwrite the password afterwards.
		const revokedSiblingTokens = await tx
			.update(inviteTokens)
			.set({ revokedAt: sql`now()` })
			.where(
				and(
					eq(inviteTokens.userId, consumed.userId),
					ne(inviteTokens.id, consumed.id),
					isNull(inviteTokens.consumedAt),
					isNull(inviteTokens.revokedAt)
				)
			)
			.returning({ id: inviteTokens.id });

		const [userRow] = await tx
			.update(users)
			.set({
				authVersion: sql`${users.authVersion} + 1`,
				emailVerified: true,
				updatedAt: sql`now()`,
				...(normalizedDisplayName !== undefined ? { name: normalizedDisplayName } : {})
			})
			.where(and(eq(users.id, consumed.userId), eq(users.isActive, true)))
			.returning({
				id: users.id,
				name: users.name,
				email: users.email,
				role: users.role,
				authVersion: users.authVersion
			});

		if (!userRow) {
			throw new InviteTokenGoneError(t('auth.tokenInactiveAccount'));
		}

		await tx
			.insert(accounts)
			.values({
				accountId: userRow.id,
				providerId: 'credential',
				userId: userRow.id,
				password: passwordHash
			})
			.onConflictDoUpdate({
				target: [accounts.providerId, accounts.accountId],
				set: {
					password: passwordHash,
					updatedAt: sql`now()`
				}
			});

		const revokedKeys = await tx
			.update(apiKeys)
			.set({ revokedAt: sql`now()` })
			.where(and(eq(apiKeys.userId, userRow.id), isNull(apiKeys.revokedAt)))
			.returning({ id: apiKeys.id });

		return {
			tokenId: consumed.id,
			prevUser,
			prevAccount: prevAccount ?? null,
			revokedApiKeyIds: revokedKeys.map((row) => row.id),
			revokedSiblingTokenIds: revokedSiblingTokens.map((row) => row.id),
			userRow
		};
	});

	if (purpose === 'invite') {
		const compensateInviteConsume = async () => {
			await db.transaction(async (tx) => {
				await tx
					.update(inviteTokens)
					.set({ consumedAt: null })
					.where(eq(inviteTokens.id, txResult.tokenId));

				await tx
					.update(users)
					.set({
						name: txResult.prevUser.name,
						emailVerified: txResult.prevUser.emailVerified,
						authVersion: txResult.prevUser.authVersion,
						updatedAt: sql`now()`
					})
					.where(eq(users.id, txResult.prevUser.id));

				if (txResult.prevAccount) {
					await tx
						.update(accounts)
						.set({ password: txResult.prevAccount.password, updatedAt: sql`now()` })
						.where(eq(accounts.id, txResult.prevAccount.id));
				} else {
					await tx
						.delete(accounts)
						.where(
							and(
								eq(accounts.providerId, 'credential'),
								eq(accounts.accountId, txResult.prevUser.id)
							)
						);
				}

				if (txResult.revokedApiKeyIds.length > 0) {
					await tx
						.update(apiKeys)
						.set({ revokedAt: null })
						.where(inArray(apiKeys.id, txResult.revokedApiKeyIds));
				}

				if (txResult.revokedSiblingTokenIds.length > 0) {
					await tx
						.update(inviteTokens)
						.set({ revokedAt: null })
						.where(inArray(inviteTokens.id, txResult.revokedSiblingTokenIds));
				}
			});
		};

		try {
			const signInResponse = await auth.api.signInEmail({
				body: {
					email: txResult.userRow.email,
					password: passwordValidation.value
				},
				...(sessionContext?.headers ? { headers: sessionContext.headers } : {}),
				asResponse: true
			});

			if (!signInResponse.ok) {
				throw new Error(t('auth.inviteSessionFailed'));
			}

			if (sessionContext?.cookies) {
				applyResponseSetCookies(signInResponse.headers, sessionContext.cookies);
			}

			const setCookieHeaders =
				typeof signInResponse.headers.getSetCookie === 'function'
					? signInResponse.headers.getSetCookie()
					: [];

			return {
				user: txResult.userRow,
				setCookieHeaders
			};
		} catch (error) {
			await compensateInviteConsume().catch(() => {});
			throw error;
		}
	}

	return {
		user: txResult.userRow,
		setCookieHeaders: []
	};
}
