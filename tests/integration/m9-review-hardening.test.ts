import type { RequestEvent } from '@sveltejs/kit';
import { isActionFailure } from '@sveltejs/kit';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { handle } from '../../src/hooks.server';
import { auth } from '../../src/lib/server/auth/better-auth';
import {
	consumeInviteToken,
	createInviteToken,
	InviteTokenGoneError
} from '../../src/lib/server/auth/tokens';
import { closeDb } from '../../src/lib/server/db/client';
import { sql } from 'drizzle-orm';
import { canonicalResources, linkShares, searchLogs, users } from '../../src/lib/server/db/schema';
import { resetSearchLogDedupe, searchResources } from '../../src/lib/server/search/service';
import {
	checkLoginRateLimit,
	LOGIN_MAX_ATTEMPTS,
	resetRateLimiters
} from '../../src/lib/server/auth/rate-limit';
import { _loadFeedPage } from '../../src/routes/(app)/+page.server';
import { actions as loginActions, load as loginLoad } from '../../src/routes/login/+page.server';
import { closeTestDb, migrateTestDb, resetTestDb, testDb } from '../setup/db';

/**
 * Builds a RequestEvent whose setHeaders throws on duplicates, exactly like SvelteKit
 * (`respond.js`: `"<name>" header is already set`).
 */
function createStrictEvent(options: {
	url: string;
	method?: string;
	headers?: HeadersInit;
	formEntries?: Record<string, string>;
	clientAddress?: string;
}): { event: RequestEvent; responseHeaders: Record<string, string> } {
	const fullUrl = new URL(options.url, 'http://localhost:3000');
	const headers = new Headers(options.headers);
	let body: string | undefined;
	if (options.formEntries) {
		body = new URLSearchParams(options.formEntries).toString();
		headers.set('content-type', 'application/x-www-form-urlencoded');
	}
	const method = (options.method ?? (body ? 'POST' : 'GET')).toUpperCase();
	const request = new Request(fullUrl, { method, headers, ...(body ? { body } : {}) });
	const responseHeaders: Record<string, string> = {};

	const event = {
		request,
		url: fullUrl,
		cookies: {
			get: () => undefined,
			getAll: () => [],
			set: () => {},
			delete: () => {},
			serialize: () => ''
		},
		params: {},
		route: { id: null },
		locals: {
			requestId: 'req_test_hardening',
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
			for (const [key, value] of Object.entries(newHeaders)) {
				const lower = key.toLowerCase();
				if (lower in responseHeaders) {
					throw new Error(`"${key}" header is already set`);
				}
				responseHeaders[lower] = value;
			}
		},
		fetch,
		depends: () => {},
		parent: async () => ({}),
		untrack: <T>(fn: () => T) => fn()
	} as unknown as RequestEvent;

	return { event, responseHeaders };
}

describe('Review hardening (findings C1, C3, S3, S4, S5)', () => {
	beforeAll(async () => {
		await migrateTestDb();
	});

	beforeEach(async () => {
		await resetTestDb();
		resetRateLimiters();
		resetSearchLogDedupe();
	});

	it('does not skip shares created in the same millisecond at a page boundary', async () => {
		const [author] = await testDb
			.insert(users)
			.values({ name: 'Yazar', email: 'yazar-cursor@izgah.test', role: 'member' })
			.returning();
		const [resource] = await testDb
			.insert(canonicalResources)
			.values({ canonicalUrl: 'https://cursor.example/a', domain: 'cursor.example' })
			.returning();

		// 27 shares, newest first; #24 and #25 share one millisecond (…076500µs and …076400µs).
		const stamps: string[] = [];
		for (let i = 0; i < 24; i += 1) {
			stamps.push(`2026-11-20T10:00:00.${String(100 - i).padStart(3, '0')}000Z`);
		}
		stamps.push('2026-11-20T10:00:00.076500Z', '2026-11-20T10:00:00.076400Z');
		stamps.push('2026-11-20T10:00:00.075000Z');
		for (const [index, stamp] of stamps.entries()) {
			await testDb.insert(linkShares).values({
				resourceId: resource.id,
				authorId: author.id,
				rawUrl: `https://cursor.example/a?n=${index}`,
				isFeedVisible: true,
				sourceChannel: 'web',
				createdAt: sql`${stamp}::timestamptz`
			});
		}

		const firstPage = await _loadFeedPage({ depends: () => {}, url: new URL('http://x/') });
		expect(firstPage.items).toHaveLength(25);
		expect(firstPage.nextCursor).not.toBeNull();

		const secondPage = await _loadFeedPage({
			depends: () => {},
			url: new URL(`http://x/?cursor=${firstPage.nextCursor}`)
		});
		const seen = new Set([...firstPage.items, ...secondPage.items].map((item) => item.id));
		expect(seen.size).toBe(27);
	});

	it('logs a repeated identical search only once (refreshes and invalidations do not inflate metrics)', async () => {
		const [member] = await testDb
			.insert(users)
			.values({ name: 'Arayan', email: 'arayan@izgah.test', role: 'member' })
			.returning();

		await searchResources({ userId: member.id, query: 'postgres' });
		await searchResources({ userId: member.id, query: '  postgres ' });
		expect(await testDb.select().from(searchLogs)).toHaveLength(1);

		await searchResources({ userId: member.id, query: 'svelte' });
		expect(await testDb.select().from(searchLogs)).toHaveLength(2);
	});

	afterAll(async () => {
		await closeDb();
		await closeTestDb();
	});

	it('invalidates an open invite link once a password-reset link has been used', async () => {
		const [admin] = await testDb
			.insert(users)
			.values({ name: 'Yönetici', email: 'yonetici@izgah.test', role: 'admin' })
			.returning();
		const [member] = await testDb
			.insert(users)
			.values({ name: 'Üye', email: 'uye-s4@izgah.test', role: 'member' })
			.returning();

		const invite = await createInviteToken(member.id, 'invite', admin.id);
		const reset = await createInviteToken(member.id, 'password_reset', admin.id);

		await consumeInviteToken(reset.rawToken, 'password_reset', 'SifirlananParola123!');

		await expect(
			consumeInviteToken(invite.rawToken, 'invite', 'SaldirganParola123!', 'Saldırgan')
		).rejects.toBeInstanceOf(InviteTokenGoneError);
	});

	it('refuses an invite for an account that already has a password', async () => {
		const [member] = await testDb
			.insert(users)
			.values({ name: 'Etkin Üye', email: 'etkin@izgah.test', role: 'member' })
			.returning();
		const first = await createInviteToken(member.id, 'invite', null);
		await consumeInviteToken(first.rawToken, 'invite', 'IlkParola12345!', 'Etkin Üye');

		const second = await createInviteToken(member.id, 'invite', null);
		await expect(
			consumeInviteToken(second.rawToken, 'invite', 'IkinciParola123!', 'Etkin Üye')
		).rejects.toBeInstanceOf(InviteTokenGoneError);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('returns 429 (not a duplicate-header 500) for a rate-limited login, and the no-JS page render after the action does not throw', async () => {
		const ip = '203.0.113.77';
		for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i += 1) {
			checkLoginRateLimit(ip, 'kilit@izgah.test');
		}

		const { event, responseHeaders } = createStrictEvent({
			url: '/login',
			formEntries: { email: 'kilit@izgah.test', password: 'YanlisParola123!' },
			clientAddress: ip
		});

		const result = await loginActions.default(event as Parameters<typeof loginActions.default>[0]);
		expect(isActionFailure(result)).toBe(true);
		if (isActionFailure(result)) {
			expect(result.status).toBe(429);
		}
		expect(Number(responseHeaders['retry-after'])).toBeGreaterThan(0);
		expect(responseHeaders['cache-control']).toBe('no-store');

		// SvelteKit renders the page (running load) in the same request for non-enhanced posts.
		await expect(
			loginLoad(event as unknown as Parameters<typeof loginLoad>[0])
		).resolves.toMatchObject({ next: '/' });
	});

	it('adds baseline security headers to web responses', async () => {
		const { event } = createStrictEvent({ url: '/login' });
		const response = await handle({
			event,
			resolve: async () => new Response('<html></html>', { status: 200 })
		});
		expect(response.headers.get('x-content-type-options')).toBe('nosniff');
		expect(response.headers.get('x-frame-options')).toBe('DENY');
		expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
		// docs/designs/izgah-ui-v2.md §11 (Karar 2): no CSP or report-only CSP before Faz 8.
		expect(response.headers.get('content-security-policy')).toBeNull();
		expect(response.headers.get('content-security-policy-report-only')).toBeNull();
	});

	it('applies internal-API origin checks to percent-encoded paths', async () => {
		const { event } = createStrictEvent({
			url: '/api/%69nternal/notifications',
			method: 'POST',
			headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }
		});
		const response = await handle({
			event,
			resolve: async () => new Response('should not reach', { status: 200 })
		});
		expect(response.status).toBe(403);
	});

	it('rejects malformed percent-encoding in the path', async () => {
		const { event } = createStrictEvent({ url: '/%E0%A4%A' });
		const response = await handle({
			event,
			resolve: async () => new Response('should not reach', { status: 200 })
		});
		expect(response.status).toBe(400);
	});

	it('answers 503 and keeps cookies when the session lookup itself fails', async () => {
		vi.spyOn(auth.api, 'getSession').mockRejectedValueOnce(new Error('connection refused'));
		const { event } = createStrictEvent({
			url: '/settings',
			headers: { cookie: 'better-auth.session_token=abc.def' }
		});
		const response = await handle({
			event,
			resolve: async () => new Response('should not reach', { status: 200 })
		});
		expect(response.status).toBe(503);
		expect(response.headers.getSetCookie().join(';')).not.toContain('Max-Age=0');
	});
});
