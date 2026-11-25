import type { Cookies, RequestEvent } from '@sveltejs/kit';
import { isActionFailure, isHttpError, isRedirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli';
import { handle, handleError } from '../../src/hooks.server';
import {
	API_KEY_RAW_LENGTH,
	createApiKey,
	listUserApiKeys,
	RAW_API_KEY_REGEX,
	revokeApiKey,
	verifyApiKey
} from '../../src/lib/server/auth/api-keys';
import { sanitizeNextPath } from '../../src/lib/server/auth/better-auth';
import { ensureInitialAdminBootstrap } from '../../src/lib/server/auth/bootstrap';
import {
	BoundedSlidingWindowStore,
	checkLoginRateLimit,
	RATE_LIMIT_MAX_KEYS,
	resetRateLimiters
} from '../../src/lib/server/auth/rate-limit';
import {
	consumeInviteToken,
	createInviteToken,
	inspectInviteToken,
	InviteTokenGoneError,
	InviteTokenValidationError,
	sha256Hex
} from '../../src/lib/server/auth/tokens';
import { closeDb } from '../../src/lib/server/db/client';
import {
	accounts,
	apiKeys,
	auditLogs,
	inviteTokens,
	sessions,
	users,
	type UserRole
} from '../../src/lib/server/db/schema';
import type { Logger } from '../../src/lib/server/logger';
import { POST as logoutPost } from '../../src/routes/logout/+server';
import { actions as loginActions, load as loginLoad } from '../../src/routes/login/+page.server';
import {
	actions as acceptInviteActions,
	load as acceptInviteLoad
} from '../../src/routes/auth/accept-invite/+page.server';
import {
	actions as resetPasswordActions,
	load as resetPasswordLoad
} from '../../src/routes/auth/reset-password/+page.server';
import { actions as settingsActions } from '../../src/routes/(app)/settings/+page.server';
import {
	actions as apiKeysActions,
	load as apiKeysLoad
} from '../../src/routes/(app)/settings/api-keys/+page.server';
import { closeTestDb, migrateTestDb, resetTestDb, testDb } from '../setup/db';

interface MockCookies extends Cookies {
	_setLog: Array<{ name: string; value: string; opts: unknown }>;
	_deletedLog: Array<{ name: string; opts: unknown }>;
	toCookieHeader: () => string;
}

function createMockCookies(initialCookieHeader?: string): MockCookies {
	const store = new Map<string, string>();
	if (initialCookieHeader) {
		for (const part of initialCookieHeader.split(';')) {
			const idx = part.indexOf('=');
			if (idx === -1) {
				continue;
			}
			const name = part.slice(0, idx).trim();
			const value = part.slice(idx + 1).trim();
			if (name) {
				try {
					store.set(name, decodeURIComponent(value));
				} catch {
					store.set(name, value);
				}
			}
		}
	}

	const _setLog: Array<{ name: string; value: string; opts: unknown }> = [];
	const _deletedLog: Array<{ name: string; opts: unknown }> = [];

	return {
		_setLog,
		_deletedLog,
		get(name) {
			return store.get(name);
		},
		getAll() {
			return Array.from(store.entries()).map(([name, value]) => ({ name, value }));
		},
		set(name, value, opts) {
			store.set(name, value);
			_setLog.push({ name, value, opts });
		},
		delete(name, opts) {
			store.delete(name);
			_deletedLog.push({ name, opts });
		},
		serialize(name, value) {
			return `${name}=${encodeURIComponent(value)}`;
		},
		toCookieHeader() {
			return Array.from(store.entries())
				.map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
				.join('; ');
		}
	};
}

function extractCookiePairFromSetCookies(setCookieHeaders: string[]): string {
	for (const line of setCookieHeaders) {
		const semi = line.indexOf(';');
		const pair = semi === -1 ? line : line.slice(0, semi);
		if (
			pair.startsWith('better-auth.session_token=') ||
			pair.startsWith('__Secure-better-auth.session_token=')
		) {
			return pair.trim();
		}
	}
	throw new Error('Session Set-Cookie header not found');
}

function createMockEvent(options: {
	url: string;
	method?: string;
	headers?: HeadersInit;
	formEntries?: Record<string, string>;
	jsonBody?: unknown;
	clientAddress?: string;
}): {
	event: RequestEvent;
	cookies: MockCookies;
	responseHeaders: Record<string, string>;
} {
	const fullUrl = new URL(options.url, 'http://localhost:3000');
	const headers = new Headers(options.headers);
	const method = (
		options.method ?? (options.formEntries || options.jsonBody ? 'POST' : 'GET')
	).toUpperCase();

	let body: BodyInit | undefined;
	if (options.formEntries) {
		const params = new URLSearchParams(options.formEntries);
		body = params.toString();
		if (!headers.has('content-type')) {
			headers.set('content-type', 'application/x-www-form-urlencoded');
		}
	} else if (options.jsonBody !== undefined) {
		body = JSON.stringify(options.jsonBody);
		if (!headers.has('content-type')) {
			headers.set('content-type', 'application/json');
		}
	}

	const request = new Request(fullUrl, {
		method,
		headers,
		...(body !== undefined ? { body } : {})
	});

	const cookies = createMockCookies(headers.get('cookie') ?? undefined);
	const responseHeaders: Record<string, string> = {};

	const event = {
		request,
		url: fullUrl,
		cookies,
		params: {},
		route: { id: null },
		locals: {
			requestId: 'req_test_default',
			user: null,
			session: null,
			authChannel: null,
			apiKeyId: null
		},
		platform: undefined,
		isDataRequest: false,
		isSubRequest: false,
		getClientAddress: () => options.clientAddress ?? '10.20.30.40',
		setHeaders: (newHeaders: Record<string, string>) => {
			for (const [k, v] of Object.entries(newHeaders)) {
				responseHeaders[k.toLowerCase()] = v;
			}
		},
		fetch,
		depends: () => {},
		parent: async () => ({}),
		untrack: <T>(fn: () => T) => fn(),
		tracing: {
			enabled: false,
			root: {} as RequestEvent['tracing']['root'],
			current: {} as RequestEvent['tracing']['current']
		}
	} as unknown as RequestEvent;

	return { event, cookies, responseHeaders };
}

async function seedUser(input: {
	name?: string;
	email: string;
	role?: UserRole;
	isActive?: boolean;
}) {
	const [row] = await testDb
		.insert(users)
		.values({
			name: input.name ?? 'Test Kullanıcısı',
			email: input.email.toLowerCase(),
			role: input.role ?? 'member',
			isActive: input.isActive ?? true
		})
		.returning();
	return row;
}

describe('M2 auth, single-use invite/reset tokens, API keys, rate limiting, and CLI', () => {
	beforeAll(async () => {
		await migrateTestDb();
	});

	beforeEach(async () => {
		await resetTestDb();
		resetRateLimiters();
	});

	afterAll(async () => {
		await closeDb();
		await closeTestDb();
	});

	it('enforces single-use atomic token consumption, 410 Gone, SHA-256 storage, and no-referrer/no-store headers', async () => {
		const admin = await seedUser({ name: 'Kurucu', email: 'admin@izgah.test', role: 'admin' });
		const member = await seedUser({ name: 'İlk Ad', email: 'uye@izgah.test', role: 'member' });

		const firstInvite = await createInviteToken(member.id, 'invite', admin.id);
		const resetBefore = await createInviteToken(member.id, 'password_reset', admin.id);

		// Creating a new invite revokes only prior open invites for the same (user_id, purpose)
		const secondInvite = await createInviteToken(member.id, 'invite', admin.id);

		const storedFirst = await testDb.query.inviteTokens.findFirst({
			where: eq(inviteTokens.id, firstInvite.id)
		});
		const storedSecond = await testDb.query.inviteTokens.findFirst({
			where: eq(inviteTokens.id, secondInvite.id)
		});
		const storedReset = await testDb.query.inviteTokens.findFirst({
			where: eq(inviteTokens.id, resetBefore.id)
		});

		expect(storedFirst?.revokedAt).not.toBeNull();
		expect(storedReset?.revokedAt).toBeNull();
		expect(storedSecond?.tokenHash).toBe(sha256Hex(secondInvite.rawToken));
		expect(storedSecond?.tokenHash).not.toBe(secondInvite.rawToken);

		// Wrong purpose inspection fails
		expect(await inspectInviteToken(secondInvite.rawToken, 'password_reset')).toBeNull();
		expect(await inspectInviteToken(secondInvite.rawToken, 'invite')).not.toBeNull();

		// Concurrent consume attempts: exactly 1 succeeds, the other throws 410 InviteTokenGoneError
		const concurrentResults = await Promise.allSettled([
			consumeInviteToken(secondInvite.rawToken, 'invite', 'GucluParola1234!', 'Çağrı Öztürk'),
			consumeInviteToken(secondInvite.rawToken, 'invite', 'GucluParola1234!', 'Çağrı Öztürk')
		]);

		const fulfilled = concurrentResults.filter((r) => r.status === 'fulfilled');
		const rejected = concurrentResults.filter((r) => r.status === 'rejected');
		expect(fulfilled).toHaveLength(1);
		expect(rejected).toHaveLength(1);
		expect(rejected[0].reason).toBeInstanceOf(InviteTokenGoneError);

		// Name, auth_version, and credential account updated properly
		const [updatedMember] = await testDb.select().from(users).where(eq(users.id, member.id));
		expect(updatedMember.name).toBe('Çağrı Öztürk');
		expect(updatedMember.authVersion).toBe(2);
		expect(updatedMember.emailVerified).toBe(true);

		const [credAccount] = await testDb
			.select()
			.from(accounts)
			.where(eq(accounts.userId, member.id));
		expect(credAccount.providerId).toBe('credential');
		expect(credAccount.accountId).toBe(member.id);

		// Consumed token throws 410 on load and returns 410 on action
		const loadMock = createMockEvent({
			url: `/auth/accept-invite?token=${encodeURIComponent(secondInvite.rawToken)}`
		});
		let loadError: unknown;
		try {
			await acceptInviteLoad(loadMock.event as Parameters<typeof acceptInviteLoad>[0]);
		} catch (err) {
			loadError = err;
		}
		expect(isHttpError(loadError, 410)).toBe(true);
		expect(loadMock.responseHeaders['referrer-policy']).toBe('no-referrer');
		expect(loadMock.responseHeaders['cache-control']).toBe('no-store');

		const actionMock = createMockEvent({
			url: '/auth/accept-invite',
			method: 'POST',
			formEntries: {
				token: secondInvite.rawToken,
				name: 'Deneme',
				password: 'BaskaGucluParola123!'
			}
		});
		const actionResult = await acceptInviteActions.default(
			actionMock.event as Parameters<typeof acceptInviteActions.default>[0]
		);
		expect(isActionFailure(actionResult)).toBe(true);
		if (isActionFailure(actionResult)) {
			expect(actionResult.status).toBe(410);
			expect(actionResult.data).toMatchObject({ tokenGone: true });
		}

		// Handle middleware enforces Referrer-Policy & Cache-Control on /auth/* even on 410 response
		const middlewareAuthMock = createMockEvent({
			url: `/auth/reset-password?token=nonexistent`,
			method: 'GET'
		});
		const authRes = await handle({
			event: middlewareAuthMock.event,
			resolve: async () => new Response('Gone', { status: 410 })
		});
		expect(authRes.status).toBe(410);
		expect(authRes.headers.get('referrer-policy')).toBe('no-referrer');
		expect(authRes.headers.get('cache-control')).toBe('no-store');
		expect(authRes.headers.get('x-request-id')).toMatch(/^req_/);

		// Accepting the invite revoked the reset link issued before it (no stale link may overwrite the password)
		let staleResetError: unknown;
		try {
			await resetPasswordLoad(
				createMockEvent({
					url: `/auth/reset-password?token=${encodeURIComponent(resetBefore.rawToken)}`
				}).event as Parameters<typeof resetPasswordLoad>[0]
			);
		} catch (err) {
			staleResetError = err;
		}
		expect(isHttpError(staleResetError, 410)).toBe(true);

		// Valid password_reset load returns masked payload with no-referrer/no-store headers
		const freshReset = await createInviteToken(member.id, 'password_reset', admin.id);
		const resetLoadMock = createMockEvent({
			url: `/auth/reset-password?token=${encodeURIComponent(freshReset.rawToken)}`
		});
		const resetLoadData = await resetPasswordLoad(
			resetLoadMock.event as Parameters<typeof resetPasswordLoad>[0]
		);
		expect(resetLoadData).toMatchObject({
			token: freshReset.rawToken,
			email: member.email
		});
		expect(resetLoadMock.responseHeaders['referrer-policy']).toBe('no-referrer');
		expect(resetLoadMock.responseHeaders['cache-control']).toBe('no-store');

		// Expired token is rejected as 410 Gone
		const expiredToken = await createInviteToken(member.id, 'password_reset', admin.id, {
			expiresAt: new Date(Date.now() - 60_000)
		});
		let expiredLoadError: unknown;
		try {
			await resetPasswordLoad(
				createMockEvent({
					url: `/auth/reset-password?token=${encodeURIComponent(expiredToken.rawToken)}`
				}).event as Parameters<typeof resetPasswordLoad>[0]
			);
		} catch (err) {
			expiredLoadError = err;
		}
		expect(isHttpError(expiredLoadError, 410)).toBe(true);
		await expect(
			consumeInviteToken(expiredToken.rawToken, 'password_reset', 'YeniGucluParola123!')
		).rejects.toBeInstanceOf(InviteTokenGoneError);
	});

	it('validates 10-128 character password boundaries without consuming single-use tokens', async () => {
		const member = await seedUser({ name: 'Sınır Testi', email: 'sinir@izgah.test' });
		const invite = await createInviteToken(member.id, 'invite', null);

		await expect(
			consumeInviteToken(invite.rawToken, 'invite', 'a'.repeat(9), 'Sınır Testi')
		).rejects.toBeInstanceOf(InviteTokenValidationError);

		await expect(
			consumeInviteToken(invite.rawToken, 'invite', 'a'.repeat(129), 'Sınır Testi')
		).rejects.toBeInstanceOf(InviteTokenValidationError);

		// Token must remain unconsumed after validation rejections
		expect(await inspectInviteToken(invite.rawToken, 'invite')).not.toBeNull();

		// Exact 10-character minimum succeeds
		const minAccepted = await consumeInviteToken(
			invite.rawToken,
			'invite',
			'a'.repeat(10),
			'Sınır Testi'
		);
		expect(minAccepted.setCookieHeaders.length).toBeGreaterThan(0);

		// Exact 128-character maximum succeeds via reset-password route action
		const resetToken = await createInviteToken(member.id, 'password_reset', null);
		const resetMock = createMockEvent({
			url: '/auth/reset-password',
			method: 'POST',
			formEntries: {
				token: resetToken.rawToken,
				password: 'b'.repeat(128)
			}
		});
		let resetRedirect: unknown;
		try {
			await resetPasswordActions.default(
				resetMock.event as Parameters<typeof resetPasswordActions.default>[0]
			);
		} catch (err) {
			resetRedirect = err;
		}
		expect(isRedirect(resetRedirect)).toBe(true);
		if (isRedirect(resetRedirect)) {
			expect(resetRedirect.status).toBe(303);
			expect(resetRedirect.location).toBe('/login?reset=1');
		}
	});

	it('preserves active session on password change while dropping other sessions and API keys immediately (401)', async () => {
		const user = await seedUser({
			name: 'Zeynep Kaya',
			email: 'zeynep@izgah.test',
			role: 'member'
		});
		const invite = await createInviteToken(user.id, 'invite', null);

		// Session A started via invite acceptance
		const inviteRes = await consumeInviteToken(
			invite.rawToken,
			'invite',
			'IlkParola1234!',
			'Zeynep Kaya'
		);
		const cookieA = extractCookiePairFromSetCookies(inviteRes.setCookieHeaders);

		// Session B started via /login
		const loginEventMock = createMockEvent({
			url: '/login',
			method: 'POST',
			formEntries: {
				email: 'zeynep@izgah.test',
				password: 'IlkParola1234!',
				next: '/settings'
			},
			clientAddress: '10.0.0.5'
		});
		let loginRedirect: unknown;
		try {
			await loginActions.default(
				loginEventMock.event as Parameters<typeof loginActions.default>[0]
			);
		} catch (err) {
			loginRedirect = err;
		}
		expect(isRedirect(loginRedirect)).toBe(true);
		const cookieB = loginEventMock.cookies.toCookieHeader();
		expect(cookieB).toContain('better-auth.session_token=');
		expect(cookieB).not.toBe(cookieA);

		// Create a personal API key
		const createdKey = await createApiKey(user.id, 'Firefox Eklentisi');

		// Verify Session A, Session B, and API key all pass middleware
		for (const cookieHeader of [cookieA, cookieB]) {
			const reqMock = createMockEvent({
				url: '/settings',
				method: 'GET',
				headers: { cookie: cookieHeader }
			});
			const res = await handle({
				event: reqMock.event,
				resolve: async (ev) => {
					expect(ev.locals.user?.id).toBe(user.id);
					expect(ev.locals.authChannel).toBe('cookie');
					return new Response('OK', { status: 200 });
				}
			});
			expect(res.status).toBe(200);
		}

		// Resolve Session A's verified locals and run /settings?/changePassword
		const settingsAuthMock = createMockEvent({
			url: '/settings?/changePassword',
			method: 'POST',
			headers: { cookie: cookieA },
			formEntries: {
				currentPassword: 'IlkParola1234!',
				newPassword: 'YeniGucluParola567!'
			}
		});
		const settingsResponse = await handle({
			event: settingsAuthMock.event,
			resolve: async (ev) => {
				const actionRes = await settingsActions.changePassword(
					ev as Parameters<typeof settingsActions.changePassword>[0]
				);
				return new Response(JSON.stringify(actionRes), { status: 200 });
			}
		});
		expect(settingsResponse.status).toBe(200);
		expect(await settingsResponse.json()).toMatchObject({ passwordChanged: true });

		// Session A remains valid on next request!
		const sessionAAfterMock = createMockEvent({
			url: '/settings',
			method: 'GET',
			headers: { cookie: cookieA }
		});
		const sessionAAfterRes = await handle({
			event: sessionAAfterMock.event,
			resolve: async () => new Response('OK', { status: 200 })
		});
		expect(sessionAAfterRes.status).toBe(200);

		// Session B is immediately rejected with 401 and Set-Cookie expiration
		const sessionBAfterMock = createMockEvent({
			url: '/settings',
			method: 'GET',
			headers: { cookie: cookieB }
		});
		const sessionBAfterRes = await handle({
			event: sessionBAfterMock.event,
			resolve: async () => new Response('Should not reach', { status: 200 })
		});
		expect(sessionBAfterRes.status).toBe(401);
		expect(sessionBAfterRes.headers.getSetCookie().join(';')).toContain('Max-Age=0');

		// Previously active izk_ API key is immediately rejected with 401
		const apiV1AfterMock = createMockEvent({
			url: '/api/v1/me',
			method: 'GET',
			headers: { authorization: `Bearer ${createdKey.rawKey}` }
		});
		const apiV1AfterRes = await handle({
			event: apiV1AfterMock.event,
			resolve: async () => new Response('Should not reach', { status: 200 })
		});
		expect(apiV1AfterRes.status).toBe(401);

		// Old password fails login, new password succeeds
		const wrongPwLogin = createMockEvent({
			url: '/login',
			method: 'POST',
			formEntries: { email: 'zeynep@izgah.test', password: 'IlkParola1234!' },
			clientAddress: '10.0.0.6'
		});
		const wrongPwRes = await loginActions.default(
			wrongPwLogin.event as Parameters<typeof loginActions.default>[0]
		);
		expect(isActionFailure(wrongPwRes)).toBe(true);
		if (isActionFailure(wrongPwRes)) {
			expect(wrongPwRes.status).toBe(401);
		}
	});

	it('immediately rejects sessions and API keys and blocks login when user is deactivated', async () => {
		const member = await seedUser({ name: 'Ayrılan Üye', email: 'pasif@izgah.test' });
		const invite = await createInviteToken(member.id, 'invite', null);
		const accepted = await consumeInviteToken(invite.rawToken, 'invite', 'Parola123456!');
		const cookieHeader = extractCookiePairFromSetCookies(accepted.setCookieHeaders);
		const key = await createApiKey(member.id, 'Chrome Eklentisi');

		// Deactivate user atomically (as admin panel M7 will do)
		await testDb
			.update(users)
			.set({
				isActive: false,
				disabledAt: new Date(),
				authVersion: 99
			})
			.where(eq(users.id, member.id));

		// Existing cookie fails immediately on next request
		const webMock = createMockEvent({
			url: '/settings',
			method: 'GET',
			headers: { cookie: cookieHeader }
		});
		const webRes = await handle({
			event: webMock.event,
			resolve: async () => new Response('Should not reach', { status: 200 })
		});
		expect(webRes.status).toBe(401);

		// Existing API key fails with 401
		const apiMock = createMockEvent({
			url: '/api/v1/sections',
			method: 'GET',
			headers: { authorization: `Bearer ${key.rawKey}` }
		});
		const apiRes = await handle({
			event: apiMock.event,
			resolve: async () => new Response('Should not reach', { status: 200 })
		});
		expect(apiRes.status).toBe(401);

		// Login via /login fails with 401 (generic error) and /api/auth/sign-in/email fails with 401
		const loginMock = createMockEvent({
			url: '/login',
			method: 'POST',
			formEntries: { email: 'pasif@izgah.test', password: 'Parola123456!' },
			clientAddress: '10.0.0.9'
		});
		const loginRes = await loginActions.default(
			loginMock.event as Parameters<typeof loginActions.default>[0]
		);
		expect(isActionFailure(loginRes)).toBe(true);
		if (isActionFailure(loginRes)) {
			expect(loginRes.status).toBe(401);
			expect(loginRes.data).toMatchObject({ error: 'E-posta adresi veya parola hatalı.' });
		}

		const directAuthMock = createMockEvent({
			url: '/api/auth/sign-in/email',
			method: 'POST',
			headers: { origin: 'http://localhost:3000' },
			jsonBody: { email: 'pasif@izgah.test', password: 'Parola123456!' },
			clientAddress: '10.0.0.10'
		});
		const directAuthRes = await handle({
			event: directAuthMock.event,
			resolve: async () => new Response('Unused', { status: 404 })
		});
		expect(directAuthRes.status).toBe(401);
	});

	it('isolates /api/v1/* vs /api/internal/*, enforces admin 403 on GET/POST, blocks open redirects, and cleans up on /logout', async () => {
		const member = await seedUser({
			name: 'Normal Üye',
			email: 'normal@izgah.test',
			role: 'member'
		});
		const admin = await seedUser({ name: 'Yönetici', email: 'yonetici@izgah.test', role: 'admin' });

		const memberInvite = await createInviteToken(member.id, 'invite', null);
		const memberAccepted = await consumeInviteToken(
			memberInvite.rawToken,
			'invite',
			'Parola123456!'
		);
		const memberCookie = extractCookiePairFromSetCookies(memberAccepted.setCookieHeaders);
		const memberKey = await createApiKey(member.id, 'Safari');

		const adminInvite = await createInviteToken(admin.id, 'invite', null);
		const adminAccepted = await consumeInviteToken(
			adminInvite.rawToken,
			'invite',
			'AdminParola123!'
		);
		const adminCookie = extractCookiePairFromSetCookies(adminAccepted.setCookieHeaders);

		// 1. /api/v1/* CORS preflight + rejects cookie + accepts Bearer
		const optionsMock = createMockEvent({ url: '/api/v1/links', method: 'OPTIONS' });
		const optionsRes = await handle({
			event: optionsMock.event,
			resolve: async () => new Response('Unused', { status: 200 })
		});
		expect(optionsRes.status).toBe(204);
		expect(optionsRes.headers.get('access-control-allow-origin')).toBe('*');
		expect(optionsRes.headers.get('access-control-expose-headers')).toBe('X-Request-Id');

		const v1CookieOnlyMock = createMockEvent({
			url: '/api/v1/me',
			method: 'GET',
			headers: { cookie: memberCookie }
		});
		const v1CookieRes = await handle({
			event: v1CookieOnlyMock.event,
			resolve: async () => new Response('Should not reach', { status: 200 })
		});
		expect(v1CookieRes.status).toBe(401);

		const v1BearerMock = createMockEvent({
			url: '/api/v1/me',
			method: 'GET',
			headers: { authorization: `Bearer ${memberKey.rawKey}` }
		});
		const v1BearerRes = await handle({
			event: v1BearerMock.event,
			resolve: async (ev) => {
				expect(ev.locals.authChannel).toBe('api_key');
				expect(ev.locals.apiKeyId).toBe(memberKey.id);
				return new Response(JSON.stringify({ ok: true }), { status: 200 });
			}
		});
		expect(v1BearerRes.status).toBe(200);
		expect(v1BearerRes.headers.get('access-control-allow-origin')).toBe('*');

		// 2. /api/internal/* rejects Bearer, rejects cross-origin/cross-site (403), accepts same-origin cookie
		const internalBearerMock = createMockEvent({
			url: '/api/internal/notifications',
			method: 'GET',
			headers: { authorization: `Bearer ${memberKey.rawKey}` }
		});
		const internalBearerRes = await handle({
			event: internalBearerMock.event,
			resolve: async () => new Response('Should not reach', { status: 200 })
		});
		expect(internalBearerRes.status).toBe(401);

		const internalCrossOriginMock = createMockEvent({
			url: '/api/internal/notifications',
			method: 'POST',
			headers: {
				cookie: memberCookie,
				origin: 'https://evil.example',
				'sec-fetch-site': 'cross-site'
			}
		});
		const internalCrossRes = await handle({
			event: internalCrossOriginMock.event,
			resolve: async () => new Response('Should not reach', { status: 200 })
		});
		expect(internalCrossRes.status).toBe(403);
		expect(internalCrossRes.headers.get('vary')).toContain('Origin');

		const internalValidMock = createMockEvent({
			url: '/api/internal/links/check?url=https://example.com',
			method: 'GET',
			headers: {
				cookie: memberCookie,
				origin: 'http://localhost:3000',
				'sec-fetch-site': 'same-origin'
			}
		});
		const internalValidRes = await handle({
			event: internalValidMock.event,
			resolve: async (ev) => {
				expect(ev.locals.authChannel).toBe('cookie');
				return new Response('OK', { status: 200 });
			}
		});
		expect(internalValidRes.status).toBe(200);

		// 3. /media/thumbnails/* returns 401 (no redirect) when unauthenticated, accepts cookie or Bearer
		const mediaUnauthMock = createMockEvent({
			url: '/media/thumbnails/' + 'a'.repeat(64),
			method: 'GET'
		});
		const mediaUnauthRes = await handle({
			event: mediaUnauthMock.event,
			resolve: async () => new Response('Should not reach', { status: 200 })
		});
		expect(mediaUnauthRes.status).toBe(401);

		const mediaBearerMock = createMockEvent({
			url: '/media/thumbnails/' + 'a'.repeat(64),
			method: 'GET',
			headers: { authorization: `Bearer ${memberKey.rawKey}` }
		});
		const mediaBearerRes = await handle({
			event: mediaBearerMock.event,
			resolve: async () => new Response('webp-bytes', { status: 200 })
		});
		expect(mediaBearerRes.status).toBe(200);

		// 4. Sign-up route is blocked (403)
		const signUpMock = createMockEvent({
			url: '/api/auth/sign-up/email',
			method: 'POST',
			jsonBody: { email: 'yeni@izgah.test', password: 'Parola123456!', name: 'Yeni' }
		});
		const signUpRes = await handle({
			event: signUpMock.event,
			resolve: async () => new Response('Should not reach', { status: 200 })
		});
		expect(signUpRes.status).toBe(403);

		// 5. /admin/* enforces role === 'admin' on both GET and POST (403 for member)
		for (const adminMethod of ['GET', 'POST'] as const) {
			const memberAdminMock = createMockEvent({
				url: '/admin/users',
				method: adminMethod,
				headers: { cookie: memberCookie }
			});
			const memberAdminRes = await handle({
				event: memberAdminMock.event,
				resolve: async () => new Response('Should not reach', { status: 200 })
			});
			expect(memberAdminRes.status).toBe(403);

			const adminOkMock = createMockEvent({
				url: '/admin/users',
				method: adminMethod,
				headers: { cookie: adminCookie }
			});
			const adminOkRes = await handle({
				event: adminOkMock.event,
				resolve: async () => new Response('Admin OK', { status: 200 })
			});
			expect(adminOkRes.status).toBe(200);
		}

		// 6. ?next= open redirect protection
		expect(sanitizeNextPath('https://evil.com/phish')).toBe('/');
		expect(sanitizeNextPath('//evil.com')).toBe('/');
		expect(sanitizeNextPath('/\\evil.com')).toBe('/');
		expect(sanitizeNextPath('javascript:alert(1)')).toBe('/');
		expect(sanitizeNextPath('/.//evil.com/x')).toBe('/');
		expect(sanitizeNextPath('/%2e//evil.com')).toBe('/');
		expect(sanitizeNextPath('/settings/api-keys?tab=active')).toBe('/settings/api-keys?tab=active');

		const openRedirectLoadMock = createMockEvent({
			url: '/login?next=' + encodeURIComponent('//evil.com'),
			method: 'GET'
		});
		const loginData = await loginLoad(
			openRedirectLoadMock.event as Parameters<typeof loginLoad>[0]
		);
		expect(loginData).toEqual({ next: '/', resetSuccess: false });

		// 7. POST /logout terminates session, sends Clear-Site-Data, and subsequent request gets 401
		const sessionRowsBeforeLogout = await testDb
			.select()
			.from(sessions)
			.where(eq(sessions.userId, member.id));
		expect(sessionRowsBeforeLogout).toHaveLength(1);

		const logoutMock = createMockEvent({
			url: '/logout',
			method: 'POST',
			headers: { cookie: memberCookie }
		});
		const logoutResponse = await handle({
			event: logoutMock.event,
			resolve: async (ev) => logoutPost(ev as Parameters<typeof logoutPost>[0])
		});
		expect(logoutResponse.status).toBe(303);
		expect(logoutResponse.headers.get('location')).toBe('/login');
		expect(logoutResponse.headers.get('clear-site-data')).toBe('"cookies", "storage", "cache"');

		const sessionRowsAfterLogout = await testDb
			.select()
			.from(sessions)
			.where(eq(sessions.userId, member.id));
		expect(sessionRowsAfterLogout).toHaveLength(0);

		const afterLogoutMock = createMockEvent({
			url: '/settings',
			method: 'GET',
			headers: { cookie: memberCookie }
		});
		const afterLogoutRes = await handle({
			event: afterLogoutMock.event,
			resolve: async () => new Response('Should not reach', { status: 200 })
		});
		expect(afterLogoutRes.status).toBe(401);
	});

	it('enforces API key format, 5 active key cap, 5-minute last_used_at throttle, and owner-scoped revocation', async () => {
		const user = await seedUser({ name: 'Anahtar Üyesi', email: 'anahtar@izgah.test' });
		const otherUser = await seedUser({ name: 'Diğer Üye', email: 'diger@izgah.test' });

		const createdKeys = [];
		for (let i = 1; i <= 5; i += 1) {
			const keyMock = createMockEvent({
				url: '/settings/api-keys?/create',
				method: 'POST',
				formEntries: { name: `Anahtar ${i}` }
			});
			keyMock.event.locals = {
				requestId: `req_k_${i}`,
				user: {
					id: user.id,
					name: user.name,
					email: user.email,
					role: user.role,
					authVersion: user.authVersion
				},
				session: { id: 'sess_mock', expiresAt: new Date(Date.now() + 60_000) },
				authChannel: 'cookie',
				apiKeyId: null
			};
			const result = await apiKeysActions.create(
				keyMock.event as unknown as Parameters<typeof apiKeysActions.create>[0]
			);

			expect(isActionFailure(result)).toBe(false);
			if (!isActionFailure(result) && result && 'createdKey' in result) {
				expect(result.createdKey.rawKey).toHaveLength(API_KEY_RAW_LENGTH);
				expect(result.createdKey.rawKey).toMatch(RAW_API_KEY_REGEX);
				expect(result.createdKey.keyPrefix).toBe(result.createdKey.rawKey.slice(0, 12));
				createdKeys.push(result.createdKey);
			}
		}

		// Verify plaintext secret is never stored in api_keys
		const [dbKeyRow] = await testDb.select().from(apiKeys).where(eq(apiKeys.id, createdKeys[0].id));
		expect(dbKeyRow.keyHash).toBe(sha256Hex(createdKeys[0].rawKey));
		expect(dbKeyRow.keyHash).not.toBe(createdKeys[0].rawKey);

		// 6th key creation fails with 409 Conflict
		const sixthMock = createMockEvent({
			url: '/settings/api-keys?/create',
			method: 'POST',
			formEntries: { name: 'Altıncı Anahtar' }
		});
		sixthMock.event.locals = {
			requestId: 'req_k_6',
			user: {
				id: user.id,
				name: user.name,
				email: user.email,
				role: user.role,
				authVersion: user.authVersion
			},
			session: { id: 'sess_mock', expiresAt: new Date(Date.now() + 60_000) },
			authChannel: 'cookie',
			apiKeyId: null
		};
		const sixthRes = await apiKeysActions.create(
			sixthMock.event as unknown as Parameters<typeof apiKeysActions.create>[0]
		);
		expect(isActionFailure(sixthRes)).toBe(true);
		if (isActionFailure(sixthRes)) {
			expect(sixthRes.status).toBe(409);
		}

		// Check 5-minute throttled last_used_at updates
		const t0 = new Date('2026-06-01T10:00:00.000Z');
		const t1WithinThrottle = new Date('2026-06-01T10:02:00.000Z');
		const t2AfterThrottle = new Date('2026-06-01T10:05:01.000Z');

		const v0 = await verifyApiKey(createdKeys[0].rawKey, { now: t0 });
		expect(v0?.apiKeyId).toBe(createdKeys[0].id);
		const [afterT0] = await testDb
			.select({ lastUsedAt: apiKeys.lastUsedAt })
			.from(apiKeys)
			.where(eq(apiKeys.id, createdKeys[0].id));
		expect(afterT0.lastUsedAt?.toISOString()).toBe(t0.toISOString());

		await verifyApiKey(createdKeys[0].rawKey, { now: t1WithinThrottle });
		const [afterT1] = await testDb
			.select({ lastUsedAt: apiKeys.lastUsedAt })
			.from(apiKeys)
			.where(eq(apiKeys.id, createdKeys[0].id));
		expect(afterT1.lastUsedAt?.toISOString()).toBe(t0.toISOString());

		await verifyApiKey(createdKeys[0].rawKey, { now: t2AfterThrottle });
		const [afterT2] = await testDb
			.select({ lastUsedAt: apiKeys.lastUsedAt })
			.from(apiKeys)
			.where(eq(apiKeys.id, createdKeys[0].id));
		expect(afterT2.lastUsedAt?.toISOString()).toBe(t2AfterThrottle.toISOString());

		// Another user cannot revoke this key
		expect(await revokeApiKey(createdKeys[0].id, otherUser.id)).toBe(false);

		// Owner revokes key -> immediate rejection + frees a slot under the 5-key cap
		expect(await revokeApiKey(createdKeys[0].id, user.id)).toBe(true);
		expect(await verifyApiKey(createdKeys[0].rawKey)).toBeNull();
		expect(await listUserApiKeys(user.id)).toHaveLength(4);

		const loadMock = createMockEvent({
			url: '/settings/api-keys',
			method: 'GET'
		});
		loadMock.event.locals = {
			requestId: 'req_keys_load',
			user: {
				id: user.id,
				name: user.name,
				email: user.email,
				role: user.role,
				authVersion: user.authVersion
			},
			session: { id: 'sess_mock', expiresAt: new Date(Date.now() + 60_000) },
			authChannel: 'cookie',
			apiKeyId: null
		};
		const loadData = await apiKeysLoad(
			loadMock.event as unknown as Parameters<typeof apiKeysLoad>[0]
		);
		if (!loadData) {
			throw new Error('Expected load data from apiKeysLoad');
		}
		expect(loadData.apiKeys).toHaveLength(4);
		expect(loadData.maxKeys).toBe(5);
	});

	it('caps sliding-window rate limiter memory at 10,000 keys and returns 429 on excessive login and API requests', async () => {
		const boundedStore = new BoundedSlidingWindowStore();
		expect(boundedStore.maxKeys).toBe(RATE_LIMIT_MAX_KEYS);

		for (let i = 0; i < RATE_LIMIT_MAX_KEYS + 250; i += 1) {
			boundedStore.consume(`key_${i}`, 10, 60_000, 1_000_000 + i);
		}
		expect(boundedStore.size).toBe(RATE_LIMIT_MAX_KEYS);

		// Login rate limit: 10 attempts allowed per 15 min, 11th returns 429
		const now = 5_000_000;
		for (let i = 0; i < 10; i += 1) {
			expect(checkLoginRateLimit('203.0.113.5', 'uye@izgah.test', undefined, now + i).allowed).toBe(
				true
			);
		}
		const blockedLogin = checkLoginRateLimit('203.0.113.5', 'uye@izgah.test', undefined, now + 11);
		expect(blockedLogin.allowed).toBe(false);
		expect(blockedLogin.retryAfterSeconds).toBeGreaterThan(0);

		const login429Mock = createMockEvent({
			url: '/login',
			method: 'POST',
			formEntries: { email: 'uye@izgah.test', password: 'WrongPassword1!' },
			clientAddress: '203.0.113.5'
		});
		for (let i = 0; i < 10; i += 1) {
			await loginActions.default(
				createMockEvent({
					url: '/login',
					method: 'POST',
					formEntries: { email: 'uye@izgah.test', password: 'WrongPassword1!' },
					clientAddress: '203.0.113.9'
				}).event as Parameters<typeof loginActions.default>[0]
			);
		}
		const eleventhMock = createMockEvent({
			url: '/login',
			method: 'POST',
			formEntries: { email: 'uye@izgah.test', password: 'WrongPassword1!' },
			clientAddress: '203.0.113.9'
		});
		const eleventhActionRes = await loginActions.default(
			eleventhMock.event as Parameters<typeof loginActions.default>[0]
		);
		expect(isActionFailure(eleventhActionRes)).toBe(true);
		if (isActionFailure(eleventhActionRes)) {
			expect(eleventhActionRes.status).toBe(429);
		}
		expect(Number(eleventhMock.responseHeaders['retry-after'])).toBeGreaterThan(0);

		// Prevent unused variable warning on sample mock while also testing window expiration recovery
		expect(login429Mock.event.url.pathname).toBe('/login');
		expect(
			checkLoginRateLimit('203.0.113.5', 'uye@izgah.test', undefined, now + 15 * 60 * 1000 + 1)
				.allowed
		).toBe(true);

		// API v1 rate limits: 60/min read, 30/min write per api_keys.id
		const apiUser = await seedUser({ name: 'Hız Testi', email: 'hiz@izgah.test' });
		const key = await createApiKey(apiUser.id, 'RateLimit Key');

		for (let i = 0; i < 60; i += 1) {
			const res = await handle({
				event: createMockEvent({
					url: '/api/v1/sections',
					method: 'GET',
					headers: { authorization: `Bearer ${key.rawKey}` }
				}).event,
				resolve: async () => new Response('OK', { status: 200 })
			});
			expect(res.status).toBe(200);
		}
		const resRead61 = await handle({
			event: createMockEvent({
				url: '/api/v1/sections',
				method: 'GET',
				headers: { authorization: `Bearer ${key.rawKey}` }
			}).event,
			resolve: async () => new Response('Should not reach', { status: 200 })
		});
		expect(resRead61.status).toBe(429);

		for (let i = 0; i < 30; i += 1) {
			const res = await handle({
				event: createMockEvent({
					url: '/api/v1/links',
					method: 'POST',
					headers: { authorization: `Bearer ${key.rawKey}` }
				}).event,
				resolve: async () => new Response('Created', { status: 201 })
			});
			expect(res.status).toBe(201);
		}
		const resWrite31 = await handle({
			event: createMockEvent({
				url: '/api/v1/links',
				method: 'POST',
				headers: { authorization: `Bearer ${key.rawKey}` }
			}).event,
			resolve: async () => new Response('Should not reach', { status: 200 })
		});
		expect(resWrite31.status).toBe(429);
		expect(Number(resWrite31.headers.get('retry-after'))).toBeGreaterThan(0);
	});

	it('handles initial admin bootstrap and CLI create-admin / reset-admin commands with audit logs', async () => {
		const warnings: string[] = [];
		const infos: Array<{ msg: string; fields?: Record<string, unknown> }> = [];
		const fakeLogger: Logger = {
			child: () => fakeLogger,
			debug: () => {},
			info: (msg, fields) => infos.push({ msg, fields }),
			warn: (msg) => warnings.push(msg),
			error: () => {}
		};

		// No admin + no ADMIN_BOOTSTRAP_EMAIL -> warns and returns missing_bootstrap_email
		const missingRes = await ensureInitialAdminBootstrap({
			bootstrapEmail: null,
			log: fakeLogger
		});
		expect(missingRes.status).toBe('missing_bootstrap_email');
		expect(warnings).toHaveLength(1);

		// With bootstrapEmail and unset ORIGIN -> relative /auth/accept-invite URL + audit log
		const bootstrapRes = await ensureInitialAdminBootstrap({
			bootstrapEmail: 'IlkAdmin@Izgah.Test',
			originOverride: null,
			log: fakeLogger
		});
		expect(bootstrapRes.status).toBe('bootstrapped');
		if (bootstrapRes.status === 'bootstrapped') {
			expect(bootstrapRes.email).toBe('ilkadmin@izgah.test');
			expect(bootstrapRes.setupUrl).toMatch(/^\/auth\/accept-invite\?token=/);
		}

		// Subsequent bootstrap call is a no-op once an active admin exists
		const secondBootstrap = await ensureInitialAdminBootstrap({
			bootstrapEmail: 'BaskaAdmin@Izgah.Test',
			log: fakeLogger
		});
		expect(secondBootstrap.status).toBe('already_initialized');

		// Reset DB to test CLI create-admin and reset-admin cleanly
		await resetTestDb();

		const cliStdout: string[] = [];
		const cliStderr: string[] = [];
		const createExitCode = await runCli(
			['create-admin', '--email', 'Kurucu@Izgah.Test', '--name', 'Kurucu Admin'],
			{
				stdout: (text) => cliStdout.push(text),
				stderr: (text) => cliStderr.push(text),
				originOverride: null
			}
		);
		expect(createExitCode).toBe(0);
		expect(cliStderr).toHaveLength(0);

		const inviteUrlMatch = cliStdout.join('').match(/(\/auth\/accept-invite\?token=[^\s]+)/);
		expect(inviteUrlMatch).not.toBeNull();
		const inviteRawToken = decodeURIComponent(inviteUrlMatch![1].split('token=')[1]);

		const accepted = await consumeInviteToken(
			inviteRawToken,
			'invite',
			'KurucuParola2026!',
			'Kurucu Admin'
		);
		const adminKey = await createApiKey(accepted.user.id, 'Kurtarma Öncesi Anahtar');

		// Run reset-admin with ORIGIN set -> prints full ORIGIN URL, bumps auth_version, revokes API key
		const resetStdout: string[] = [];
		const resetExitCode = await runCli(['reset-admin', '--email', 'kurucu@izgah.test'], {
			stdout: (text) => resetStdout.push(text),
			stderr: (text) => cliStderr.push(text),
			originOverride: 'https://izgah.example.com'
		});
		expect(resetExitCode).toBe(0);
		const resetUrlMatch = resetStdout
			.join('')
			.match(/(https:\/\/izgah\.example\.com\/auth\/reset-password\?token=[^\s]+)/);
		expect(resetUrlMatch).not.toBeNull();

		// API key was revoked immediately by reset-admin
		expect(await verifyApiKey(adminKey.rawKey)).toBeNull();

		const [adminAfterReset] = await testDb
			.select()
			.from(users)
			.where(eq(users.id, accepted.user.id));
		expect(adminAfterReset.authVersion).toBe(3);

		// Verify audit_logs contain cli.create_admin and cli.reset_admin with nullable actor_user_id
		const logs = await testDb.select().from(auditLogs);
		const actions = logs.map((l) => l.action);
		expect(actions).toContain('cli.create_admin');
		expect(actions).toContain('cli.reset_admin');

		// Verify handleError returns sanitized error + requestId
		const errOut = handleError({
			error: new Error('Internal failure'),
			event: createMockEvent({ url: '/settings' }).event,
			status: 500,
			message: 'boom'
		});
		expect(errOut).toEqual({
			message: 'Beklenmeyen bir sunucu hatası oluştu.',
			requestId: 'req_test_default'
		});
	});

	it('restricts /api/auth/* routes, rejects invalid /api/auth/get-session cookies with 401, and isolates login and auth-token rate limits', async () => {
		for (const disallowed of [
			{ url: '/api/auth/forget-password', method: 'POST', jsonBody: { email: 'a@izgah.test' } },
			{ url: '/api/auth/callback/google', method: 'GET' }
		]) {
			const blockedMock = createMockEvent(disallowed);
			const blockedRes = await handle({
				event: blockedMock.event,
				resolve: async () => new Response('Should not reach', { status: 200 })
			});
			expect(blockedRes.status).toBe(403);
		}

		// Invalid or deactivated /api/auth/get-session cookie returns 401 and expires cookies
		const user = await seedUser({ name: 'Oturum Kontrol', email: 'oturum@izgah.test' });
		const invite = await createInviteToken(user.id, 'invite', null);
		const consumed = await consumeInviteToken(invite.rawToken, 'invite', 'OturumParola123!');
		const validCookie = extractCookiePairFromSetCookies(consumed.setCookieHeaders);

		await testDb.update(users).set({ isActive: false }).where(eq(users.id, user.id));

		const deactivatedGetSessionMock = createMockEvent({
			url: '/api/auth/get-session',
			method: 'GET',
			headers: { cookie: validCookie }
		});
		const deactivatedGetSessionRes = await handle({
			event: deactivatedGetSessionMock.event,
			resolve: async () => new Response('Should not reach', { status: 200 })
		});
		expect(deactivatedGetSessionRes.status).toBe(401);
		expect(deactivatedGetSessionRes.headers.getSetCookie().join(';')).toContain('Max-Age=0');

		// Login rate limits are keyed per IP + email so one locked email does not lock another user on the same IP
		const t0 = 9_000_000;
		for (let i = 0; i < 10; i += 1) {
			expect(
				checkLoginRateLimit('203.0.113.44', 'kilitli@izgah.test', undefined, t0 + i).allowed
			).toBe(true);
		}
		expect(
			checkLoginRateLimit('203.0.113.44', 'kilitli@izgah.test', undefined, t0 + 11).allowed
		).toBe(false);
		expect(
			checkLoginRateLimit('203.0.113.44', 'baska@izgah.test', undefined, t0 + 12).allowed
		).toBe(true);

		// Auth token rate limit enforces 429 on /auth/accept-invite GET and isolates by IP + token hash
		for (let i = 0; i < 10; i += 1) {
			let loadErr: unknown;
			try {
				await acceptInviteLoad(
					createMockEvent({
						url: '/auth/accept-invite?token=invalid_tok_a',
						method: 'GET',
						clientAddress: '198.51.100.7'
					}).event as Parameters<typeof acceptInviteLoad>[0]
				);
			} catch (err) {
				loadErr = err;
			}
			expect(isHttpError(loadErr, 410)).toBe(true);
		}

		let token429Thrown: unknown;
		try {
			await acceptInviteLoad(
				createMockEvent({
					url: '/auth/accept-invite?token=invalid_tok_a',
					method: 'GET',
					clientAddress: '198.51.100.7'
				}).event as Parameters<typeof acceptInviteLoad>[0]
			);
		} catch (err) {
			token429Thrown = err;
		}
		expect(isHttpError(token429Thrown, 429)).toBe(true);

		// Different token from same IP is unaffected (returns 410, not 429)
		let differentTokenErr: unknown;
		try {
			await resetPasswordLoad(
				createMockEvent({
					url: '/auth/reset-password?token=invalid_tok_b',
					method: 'GET',
					clientAddress: '198.51.100.7'
				}).event as Parameters<typeof resetPasswordLoad>[0]
			);
		} catch (err) {
			differentTokenErr = err;
		}
		expect(isHttpError(differentTokenErr, 410)).toBe(true);
	});
});
