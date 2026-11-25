import crypto from 'node:crypto';
import type { Cookies } from '@sveltejs/kit';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { parseCookies, parseSetCookieHeader } from 'better-auth/cookies';
import { hashPassword, verifyPassword } from 'better-auth/crypto';
import { svelteKitHandler, toSvelteKitHandler } from 'better-auth/svelte-kit';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '$lib/server/db/client';
import * as schema from '$lib/server/db/schema';
import { env } from '$lib/server/env';
import { sanitizeInternalPath } from '$lib/server/http/safe-path';
import { t } from '$lib/i18n';

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

export const SESSION_COOKIE_NAMES = [
	'better-auth.session_token',
	'__Secure-better-auth.session_token'
] as const;

export const useSecureCookies =
	env.NODE_ENV === 'production' || Boolean(env.ORIGIN?.startsWith('https://'));

function resolveAuthBaseUrl() {
	if (env.NODE_ENV === 'production' && env.ORIGIN) {
		return env.ORIGIN;
	}

	const allowedHosts = ['localhost:*', '127.0.0.1:*'];
	if (env.ORIGIN) {
		try {
			const originHost = new URL(env.ORIGIN).host;
			if (!allowedHosts.includes(originHost)) {
				allowedHosts.push(originHost);
			}
		} catch {
			// Invalid ORIGIN is already rejected by env.ts at startup.
		}
	}

	return {
		allowedHosts,
		fallback: env.ORIGIN ?? `http://localhost:${env.PORT}`,
		protocol: env.ORIGIN?.startsWith('https://') ? ('https' as const) : ('http' as const)
	};
}

export const auth = betterAuth({
	database: drizzleAdapter(db, {
		provider: 'pg',
		usePlural: true,
		schema
	}),
	secret: env.BETTER_AUTH_SECRET,
	baseURL: resolveAuthBaseUrl(),
	advanced: {
		database: {
			generateId: () => crypto.randomUUID()
		},
		useSecureCookies
	},
	emailAndPassword: {
		enabled: true,
		disableSignUp: true,
		minPasswordLength: PASSWORD_MIN_LENGTH,
		maxPasswordLength: PASSWORD_MAX_LENGTH
	},
	session: {
		cookieCache: {
			enabled: false
		},
		additionalFields: {
			userAuthVersion: {
				type: 'number',
				required: false,
				defaultValue: 1,
				input: false
			}
		}
	},
	user: {
		additionalFields: {
			role: {
				type: 'string',
				required: false,
				defaultValue: 'member',
				input: false
			},
			isActive: {
				type: 'boolean',
				required: false,
				defaultValue: true,
				input: false
			},
			authVersion: {
				type: 'number',
				required: false,
				defaultValue: 1,
				input: false
			}
		}
	},
	databaseHooks: {
		session: {
			create: {
				before: async (session) => {
					const [user] = await db
						.select({
							id: schema.users.id,
							isActive: schema.users.isActive,
							authVersion: schema.users.authVersion
						})
						.from(schema.users)
						.where(eq(schema.users.id, session.userId))
						.limit(1);

					if (!user || !user.isActive) {
						return false;
					}

					return {
						data: {
							...session,
							userAuthVersion: user.authVersion
						}
					};
				}
			}
		}
	}
});

export { hashPassword, svelteKitHandler, toSvelteKitHandler, verifyPassword };

export type PasswordValidationResult = { ok: true; value: string } | { ok: false; message: string };

export function validatePasswordLength(password: unknown): PasswordValidationResult {
	if (typeof password !== 'string' || password.length === 0) {
		return { ok: false, message: 'Parola zorunludur.' };
	}
	if (password.length < PASSWORD_MIN_LENGTH) {
		return {
			ok: false,
			message: t('auth.passwordMin', { min: PASSWORD_MIN_LENGTH })
		};
	}
	if (password.length > PASSWORD_MAX_LENGTH) {
		return {
			ok: false,
			message: `Parola en fazla ${PASSWORD_MAX_LENGTH} karakter olabilir.`
		};
	}
	return { ok: true, value: password };
}

export function hasSessionCookieInRequest(headers: Headers): boolean {
	const rawCookie = headers.get('cookie');
	if (!rawCookie) {
		return false;
	}
	const parsed = parseCookies(rawCookie);
	return Boolean(
		parsed.get('better-auth.session_token') || parsed.get('__Secure-better-auth.session_token')
	);
}

export function applyResponseSetCookies(responseHeaders: Headers, cookies: Cookies): void {
	const setCookieHeaders =
		typeof responseHeaders.getSetCookie === 'function' ? responseHeaders.getSetCookie() : [];

	const rawHeaders =
		setCookieHeaders.length > 0
			? setCookieHeaders
			: responseHeaders.get('set-cookie')
				? [responseHeaders.get('set-cookie') as string]
				: [];

	for (const headerLine of rawHeaders) {
		const parsedMap = parseSetCookieHeader(headerLine);
		for (const [name, attrs] of parsedMap) {
			const rawSameSite = attrs.samesite?.toLowerCase();
			const sameSite =
				rawSameSite === 'strict' || rawSameSite === 'lax' || rawSameSite === 'none'
					? rawSameSite
					: 'lax';

			cookies.set(name, attrs.value, {
				path: attrs.path ?? '/',
				httpOnly: attrs.httponly ?? true,
				secure: attrs.secure ?? useSecureCookies,
				sameSite,
				...(attrs['max-age'] !== undefined ? { maxAge: attrs['max-age'] } : {}),
				...(attrs.expires !== undefined ? { expires: attrs.expires } : {})
			});
		}
	}
}

export function clearSessionCookies(cookies: Cookies): void {
	cookies.delete('better-auth.session_token', {
		path: '/',
		secure: useSecureCookies
	});
	cookies.delete('__Secure-better-auth.session_token', {
		path: '/',
		secure: true
	});
}

export function buildExpiredSessionSetCookieHeaders(): string[] {
	const stdFlags = useSecureCookies
		? 'Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure'
		: 'Path=/; Max-Age=0; HttpOnly; SameSite=Lax';

	return [
		`better-auth.session_token=; ${stdFlags}`,
		'__Secure-better-auth.session_token=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure'
	];
}

/**
 * Prevents open redirects by allowing only same-origin application paths (never `/login` or `/logout`).
 */
export function sanitizeNextPath(nextParam: string | null | undefined): string {
	return sanitizeInternalPath(nextParam, { disallowPaths: ['/login', '/logout'] });
}

export class PasswordChangeError extends Error {
	readonly code: 'VALIDATION_ERROR' | 'INVALID_CREDENTIALS';
	readonly status: 401 | 422;

	constructor(
		code: 'VALIDATION_ERROR' | 'INVALID_CREDENTIALS',
		message: string,
		status: 401 | 422
	) {
		super(message);
		this.name = 'PasswordChangeError';
		this.code = code;
		this.status = status;
	}
}

/**
 * Verifies the user's current password, updates the credential hash, bumps auth_version,
 * revokes all open API keys, and preserves only the current browser session.
 */
export async function changeUserPassword(input: {
	userId: string;
	currentSessionId: string;
	currentPassword: string;
	newPassword: string;
}): Promise<{ newAuthVersion: number }> {
	if (!input.currentPassword || typeof input.currentPassword !== 'string') {
		throw new PasswordChangeError('VALIDATION_ERROR', 'Mevcut parola zorunludur.', 422);
	}

	const passwordValidation = validatePasswordLength(input.newPassword);
	if (!passwordValidation.ok) {
		throw new PasswordChangeError('VALIDATION_ERROR', passwordValidation.message, 422);
	}

	const [user] = await db
		.select({
			id: schema.users.id,
			isActive: schema.users.isActive
		})
		.from(schema.users)
		.where(eq(schema.users.id, input.userId))
		.limit(1);

	const [credentialAccount] = await db
		.select({
			id: schema.accounts.id,
			password: schema.accounts.password
		})
		.from(schema.accounts)
		.where(
			and(
				eq(schema.accounts.providerId, 'credential'),
				eq(schema.accounts.accountId, input.userId),
				eq(schema.accounts.userId, input.userId)
			)
		)
		.limit(1);

	if (!user || !user.isActive || !credentialAccount?.password) {
		throw new PasswordChangeError('INVALID_CREDENTIALS', t('auth.wrongPassword'), 401);
	}

	const matchesCurrent = await verifyPassword({
		hash: credentialAccount.password,
		password: input.currentPassword
	});
	if (!matchesCurrent) {
		throw new PasswordChangeError('INVALID_CREDENTIALS', t('auth.wrongPassword'), 401);
	}

	const nextPasswordHash = await hashPassword(passwordValidation.value);

	return db.transaction(async (tx) => {
		const [updatedUser] = await tx
			.update(schema.users)
			.set({
				authVersion: sql`${schema.users.authVersion} + 1`,
				updatedAt: sql`now()`
			})
			.where(and(eq(schema.users.id, input.userId), eq(schema.users.isActive, true)))
			.returning({ authVersion: schema.users.authVersion });

		if (!updatedUser) {
			throw new PasswordChangeError('INVALID_CREDENTIALS', t('auth.accountInactive'), 401);
		}

		await tx
			.update(schema.accounts)
			.set({
				password: nextPasswordHash,
				updatedAt: sql`now()`
			})
			.where(
				and(
					eq(schema.accounts.providerId, 'credential'),
					eq(schema.accounts.accountId, input.userId),
					eq(schema.accounts.userId, input.userId)
				)
			);

		await tx
			.update(schema.apiKeys)
			.set({ revokedAt: sql`now()` })
			.where(and(eq(schema.apiKeys.userId, input.userId), isNull(schema.apiKeys.revokedAt)));

		// Only the active session gets the new user_auth_version; all other sessions fail on next request.
		await tx
			.update(schema.sessions)
			.set({
				userAuthVersion: updatedUser.authVersion,
				updatedAt: sql`now()`
			})
			.where(
				and(
					eq(schema.sessions.id, input.currentSessionId),
					eq(schema.sessions.userId, input.userId)
				)
			);

		await tx
			.update(schema.inviteTokens)
			.set({ revokedAt: sql`now()` })
			.where(
				and(
					eq(schema.inviteTokens.userId, input.userId),
					isNull(schema.inviteTokens.consumedAt),
					isNull(schema.inviteTokens.revokedAt)
				)
			);

		return { newAuthVersion: updatedUser.authVersion };
	});
}
