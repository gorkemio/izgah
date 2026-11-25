import crypto from 'node:crypto';
import { and, count, desc, eq, isNull, lte, or } from 'drizzle-orm';
import { db } from '#lib/server/db/client.ts';
import { apiKeys, users, type UserRole } from '#lib/server/db/schema.ts';
import { sha256Hex } from './tokens';
import { t } from '#lib/i18n/index.ts';

export const API_KEY_PREFIX = 'izk_';
export const API_KEY_RANDOM_BYTES = 30;
export const API_KEY_RAW_LENGTH = 44;
export const MAX_ACTIVE_API_KEYS_PER_USER = 5;
export const API_KEY_NAME_MAX_LENGTH = 80;
export const API_KEY_LAST_USED_THROTTLE_MS = 5 * 60 * 1000;

export const RAW_API_KEY_REGEX = /^izk_[A-Za-z0-9_-]{40}$/;

export class ApiKeyValidationError extends Error {
	readonly status = 422 as const;

	constructor(message: string) {
		super(message);
		this.name = 'ApiKeyValidationError';
	}
}

export class ApiKeyLimitError extends Error {
	readonly status = 409 as const;

	constructor(message = t('apiKey.tooMany', { max: MAX_ACTIVE_API_KEYS_PER_USER })) {
		super(message);
		this.name = 'ApiKeyLimitError';
	}
}

export interface CreatedApiKey {
	id: string;
	name: string;
	keyPrefix: string;
	createdAt: Date;
	rawKey: string;
}

export interface ApiKeyListItem {
	id: string;
	name: string;
	keyPrefix: string;
	lastUsedAt: Date | null;
	createdAt: Date;
}

export interface VerifiedApiKeyContext {
	apiKeyId: string;
	user: {
		id: string;
		name: string;
		email: string;
		role: UserRole;
		authVersion: number;
	};
}

export async function createApiKey(userId: string, name: string): Promise<CreatedApiKey> {
	if (typeof name !== 'string') {
		throw new ApiKeyValidationError(t('apiKey.nameRequired'));
	}

	const trimmedName = name.trim();
	if (trimmedName.length === 0) {
		throw new ApiKeyValidationError(t('apiKey.nameEmpty'));
	}
	if (trimmedName.length > API_KEY_NAME_MAX_LENGTH) {
		throw new ApiKeyValidationError(t('apiKey.nameTooLong', { max: API_KEY_NAME_MAX_LENGTH }));
	}

	const rawKey = API_KEY_PREFIX + crypto.randomBytes(API_KEY_RANDOM_BYTES).toString('base64url');
	if (rawKey.length !== API_KEY_RAW_LENGTH) {
		throw new Error('Generated API key length invariant violated');
	}

	const keyPrefix = rawKey.slice(0, 12);
	const keyHash = sha256Hex(rawKey);

	return db.transaction(async (tx) => {
		const [userRow] = await tx
			.select({
				id: users.id,
				isActive: users.isActive,
				authVersion: users.authVersion
			})
			.from(users)
			.where(eq(users.id, userId))
			.limit(1)
			.for('update');

		if (!userRow || !userRow.isActive) {
			throw new ApiKeyValidationError(t('auth.noActiveUser'));
		}

		const [activeCountRow] = await tx
			.select({ value: count() })
			.from(apiKeys)
			.where(
				and(
					eq(apiKeys.userId, userId),
					isNull(apiKeys.revokedAt),
					eq(apiKeys.authVersionAtCreation, userRow.authVersion)
				)
			);

		const activeCount = Number(activeCountRow?.value ?? 0);
		if (activeCount >= MAX_ACTIVE_API_KEYS_PER_USER) {
			throw new ApiKeyLimitError();
		}

		const [inserted] = await tx
			.insert(apiKeys)
			.values({
				keyHash,
				userId,
				name: trimmedName,
				keyPrefix,
				authVersionAtCreation: userRow.authVersion
			})
			.returning({
				id: apiKeys.id,
				name: apiKeys.name,
				keyPrefix: apiKeys.keyPrefix,
				createdAt: apiKeys.createdAt
			});

		return {
			id: inserted.id,
			name: inserted.name,
			keyPrefix: inserted.keyPrefix,
			createdAt: inserted.createdAt,
			rawKey
		};
	});
}

export async function listUserApiKeys(userId: string): Promise<ApiKeyListItem[]> {
	return db
		.select({
			id: apiKeys.id,
			name: apiKeys.name,
			keyPrefix: apiKeys.keyPrefix,
			lastUsedAt: apiKeys.lastUsedAt,
			createdAt: apiKeys.createdAt
		})
		.from(apiKeys)
		.innerJoin(users, eq(users.id, apiKeys.userId))
		.where(
			and(
				eq(apiKeys.userId, userId),
				isNull(apiKeys.revokedAt),
				eq(apiKeys.authVersionAtCreation, users.authVersion),
				eq(users.isActive, true)
			)
		)
		.orderBy(desc(apiKeys.createdAt), desc(apiKeys.id));
}

export async function verifyApiKey(
	bearerToken: string | null | undefined,
	options?: { now?: Date }
): Promise<VerifiedApiKeyContext | null> {
	if (!bearerToken || typeof bearerToken !== 'string') {
		return null;
	}

	const trimmed = bearerToken.trim();
	if (!RAW_API_KEY_REGEX.test(trimmed)) {
		return null;
	}

	const keyHash = sha256Hex(trimmed);
	const [row] = await db
		.select({
			apiKeyId: apiKeys.id,
			revokedAt: apiKeys.revokedAt,
			authVersionAtCreation: apiKeys.authVersionAtCreation,
			lastUsedAt: apiKeys.lastUsedAt,
			userId: users.id,
			name: users.name,
			email: users.email,
			role: users.role,
			isActive: users.isActive,
			authVersion: users.authVersion
		})
		.from(apiKeys)
		.innerJoin(users, eq(users.id, apiKeys.userId))
		.where(eq(apiKeys.keyHash, keyHash))
		.limit(1);

	if (
		!row ||
		row.revokedAt !== null ||
		!row.isActive ||
		row.authVersionAtCreation !== row.authVersion
	) {
		return null;
	}

	const now = options?.now ?? new Date();
	const staleThreshold = new Date(now.getTime() - API_KEY_LAST_USED_THROTTLE_MS);
	if (!row.lastUsedAt || row.lastUsedAt.getTime() <= staleThreshold.getTime()) {
		await db
			.update(apiKeys)
			.set({ lastUsedAt: now })
			.where(
				and(
					eq(apiKeys.id, row.apiKeyId),
					or(isNull(apiKeys.lastUsedAt), lte(apiKeys.lastUsedAt, staleThreshold))
				)
			);
	}

	return {
		apiKeyId: row.apiKeyId,
		user: {
			id: row.userId,
			name: row.name,
			email: row.email,
			role: row.role,
			authVersion: row.authVersion
		}
	};
}

export async function revokeApiKey(id: string, userId: string): Promise<boolean> {
	if (!id || !userId) {
		return false;
	}

	const revoked = await db
		.update(apiKeys)
		.set({ revokedAt: new Date() })
		.where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)))
		.returning({ id: apiKeys.id });

	return revoked.length > 0;
}
