import type { Cookies, RequestEvent } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { handle } from '../../src/hooks.server';
import { createApiKey } from '../../src/lib/server/auth/api-keys';
import { consumeInviteToken, createInviteToken } from '../../src/lib/server/auth/tokens';
import { resetRateLimiters } from '../../src/lib/server/auth/rate-limit';
import { closeDb } from '../../src/lib/server/db/client';
import {
	canonicalResources,
	linkShareSections,
	linkShares,
	sections,
	unfurlJobs,
	users,
	type UserRole
} from '../../src/lib/server/db/schema';
import {
	checkDuplicateLink,
	createLinkShare,
	getResourceShareReference,
	LinkServiceError,
	resetShortUrlResolver,
	resolveAndCanonicalizeUrl,
	setShortUrlResolver,
	SHORT_URL_RESOLVE_TIMEOUT_MS,
	softDeleteLinkShare,
	updateLinkShare
} from '../../src/lib/server/links/service';
import {
	GET as linksCheckGet,
	OPTIONS as linksCheckOptions
} from '../../src/routes/api/v1/links/check/+server';
import { GET as meGet, OPTIONS as meOptions } from '../../src/routes/api/v1/me/+server';
import { POST as linksPost, OPTIONS as linksOptions } from '../../src/routes/api/v1/links/+server';
import {
	GET as sectionsGet,
	OPTIONS as sectionsOptions
} from '../../src/routes/api/v1/sections/+server';
import { closeTestDb, migrateTestDb, resetTestDb, testDb } from '../setup/db';

function createMockCookies(initialCookieHeader?: string): Cookies {
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

	return {
		get(name) {
			return store.get(name);
		},
		getAll() {
			return Array.from(store.entries()).map(([name, value]) => ({ name, value }));
		},
		set(name, value) {
			store.set(name, value);
		},
		delete(name) {
			store.delete(name);
		},
		parse: (() => {
			throw new Error('cookies.parse is not used in tests');
		}) as never,
		serialize(name, value) {
			return `${name}=${encodeURIComponent(value)}`;
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
	rawBody?: string;
	jsonBody?: unknown;
}): RequestEvent {
	const fullUrl = new URL(options.url, 'http://localhost:3000');
	const headers = new Headers(options.headers);
	const method = (
		options.method ?? (options.jsonBody !== undefined ? 'POST' : 'GET')
	).toUpperCase();

	let body: BodyInit | undefined;
	if (options.rawBody !== undefined) {
		body = options.rawBody;
		if (!headers.has('content-type')) {
			headers.set('content-type', 'application/json');
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

	return {
		request,
		url: fullUrl,
		cookies: createMockCookies(headers.get('cookie') ?? undefined),
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
		getClientAddress: () => '10.20.30.40',
		setHeaders: () => {},
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
}

async function dispatchApiV1(options: {
	url: string;
	method?: string;
	headers?: HeadersInit;
	rawBody?: string;
	jsonBody?: unknown;
}): Promise<Response> {
	const event = createMockEvent(options);
	return handle({
		event,
		resolve: async (ev) => {
			const pathname = ev.url.pathname;
			const method = ev.request.method.toUpperCase();

			if (pathname === '/api/v1/me') {
				if (method === 'OPTIONS') return meOptions(ev as Parameters<typeof meOptions>[0]);
				if (method === 'GET') return meGet(ev as Parameters<typeof meGet>[0]);
			}
			if (pathname === '/api/v1/sections') {
				if (method === 'OPTIONS')
					return sectionsOptions(ev as Parameters<typeof sectionsOptions>[0]);
				if (method === 'GET') return sectionsGet(ev as Parameters<typeof sectionsGet>[0]);
			}
			if (pathname === '/api/v1/links/check') {
				if (method === 'OPTIONS')
					return linksCheckOptions(ev as Parameters<typeof linksCheckOptions>[0]);
				if (method === 'GET') return linksCheckGet(ev as Parameters<typeof linksCheckGet>[0]);
			}
			if (pathname === '/api/v1/links') {
				if (method === 'OPTIONS') return linksOptions(ev as Parameters<typeof linksOptions>[0]);
				if (method === 'POST') return linksPost(ev as Parameters<typeof linksPost>[0]);
			}

			return new Response('Not Found', { status: 404 });
		}
	});
}

async function seedUserWithSessionAndKey(input: { name: string; email: string; role: UserRole }) {
	const [user] = await testDb
		.insert(users)
		.values({
			name: input.name,
			email: input.email.toLowerCase(),
			role: input.role,
			isActive: true
		})
		.returning();

	const invite = await createInviteToken(user.id, 'invite', null);
	const accepted = await consumeInviteToken(invite.rawToken, 'invite', 'GucluParola1234!');
	const cookie = extractCookiePairFromSetCookies(accepted.setCookieHeaders);
	const apiKey = await createApiKey(user.id, `${input.name} Extension`);

	return { user, cookie, rawApiKey: apiKey.rawKey };
}

async function seedSection(input: {
	name: string;
	slug: string;
	description?: string | null;
	sortOrder: number;
	createdById: string;
}) {
	const [row] = await testDb
		.insert(sections)
		.values({
			name: input.name,
			slug: input.slug,
			description: input.description ?? null,
			sortOrder: input.sortOrder,
			createdById: input.createdById
		})
		.returning();
	return row;
}

describe('M3 link domain services and /api/v1/* contract', () => {
	beforeAll(async () => {
		await migrateTestDb();
	});

	beforeEach(async () => {
		await resetTestDb();
		resetRateLimiters();
		resetShortUrlResolver();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	afterAll(async () => {
		await closeDb();
		await closeTestDb();
	});

	it('enforces Bearer-only auth, CORS headers, X-Request-Id, and passive client header logging', async () => {
		const member = await seedUserWithSessionAndKey({
			name: 'Ayşe Yılmaz',
			email: 'ayse@izgah.test',
			role: 'member'
		});
		const admin = await seedUserWithSessionAndKey({
			name: 'Kemal Admin',
			email: 'kemal@izgah.test',
			role: 'admin'
		});

		await seedSection({
			name: 'Yapay Zeka',
			slug: 'yapay-zeka',
			description: 'Model ve ajan bağlantıları',
			sortOrder: 10,
			createdById: admin.user.id
		});
		await seedSection({
			name: 'Arayüz Tasarımı',
			slug: 'arayuz-tasarimi',
			description: null,
			sortOrder: 10,
			createdById: admin.user.id
		});
		await seedSection({
			name: 'Genel',
			slug: 'genel',
			description: 'Genel paylaşımlar',
			sortOrder: 1,
			createdById: admin.user.id
		});

		// CORS preflight succeeds with expected headers and X-Request-Id
		const preflight = await dispatchApiV1({ url: '/api/v1/links', method: 'OPTIONS' });
		expect(preflight.status).toBe(204);
		expect(preflight.headers.get('access-control-allow-origin')).toBe('*');
		expect(preflight.headers.get('access-control-allow-methods')).toBe('GET, POST, OPTIONS');
		expect(preflight.headers.get('access-control-allow-headers')).toBe(
			'Authorization, Content-Type, X-Client-Name, X-Client-Version'
		);
		expect(preflight.headers.get('access-control-expose-headers')).toBe('X-Request-Id');
		expect(preflight.headers.get('x-request-id')).toMatch(/^req_/);

		// Cookie session is rejected with standard error envelope + CORS + X-Request-Id
		const cookieAttempt = await dispatchApiV1({
			url: '/api/v1/me',
			headers: { cookie: member.cookie }
		});
		expect(cookieAttempt.status).toBe(401);
		expect(cookieAttempt.headers.get('access-control-allow-origin')).toBe('*');
		const cookieReqId = cookieAttempt.headers.get('x-request-id');
		expect(cookieReqId).toMatch(/^req_/);
		const cookieBody = await cookieAttempt.json();
		expect(cookieBody).toEqual({
			error: {
				code: 'UNAUTHORIZED',
				message: 'Geçerli bir kişisel API anahtarı gereklidir.',
				requestId: cookieReqId
			}
		});

		// /api/v1/me succeeds without optional X-Client-* headers
		const meWithoutClientHeaders = await dispatchApiV1({
			url: '/api/v1/me',
			headers: { authorization: `Bearer ${member.rawApiKey}` }
		});
		expect(meWithoutClientHeaders.status).toBe(200);
		expect(meWithoutClientHeaders.headers.get('x-request-id')).toMatch(/^req_/);
		expect(await meWithoutClientHeaders.json()).toEqual({
			user: {
				id: member.user.id,
				name: 'Ayşe Yılmaz',
				email: 'ayse@izgah.test',
				role: 'member'
			}
		});

		// Passive X-Client-Name and X-Client-Version log enrichment
		const stdoutChunks: string[] = [];
		const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
			stdoutChunks.push(String(chunk));
			return true;
		});

		const sectionsRes = await dispatchApiV1({
			url: '/api/v1/sections',
			headers: {
				authorization: `Bearer ${admin.rawApiKey}`,
				'x-client-name': 'izgah-chrome',
				'x-client-version': '1.2.3'
			}
		});
		stdoutSpy.mockRestore();

		expect(sectionsRes.status).toBe(200);
		expect(sectionsRes.headers.get('access-control-allow-origin')).toBe('*');
		expect(sectionsRes.headers.get('x-request-id')).toMatch(/^req_/);
		const sectionsBody = (await sectionsRes.json()) as {
			sections: Array<{ slug: string; sortOrder: number }>;
		};
		expect(sectionsBody.sections.map((s) => s.slug)).toEqual([
			'genel',
			'arayuz-tasarimi',
			'yapay-zeka'
		]);

		const parsedLogs = stdoutChunks
			.join('')
			.trim()
			.split('\n')
			.filter(Boolean)
			.map((line) => JSON.parse(line) as Record<string, unknown>);
		expect(
			parsedLogs.some(
				(entry) =>
					entry.channel === 'api' &&
					entry.user_id === admin.user.id &&
					entry.client_version === '1.2.3' &&
					entry.client_name === 'izgah-chrome'
			)
		).toBe(true);
	});

	it('executes full CUJ 3 check + single-transaction share creation + duplicate detection and silent share guards', async () => {
		const member = await seedUserWithSessionAndKey({
			name: 'Deniz Üye',
			email: 'deniz@izgah.test',
			role: 'member'
		});
		const admin = await seedUserWithSessionAndKey({
			name: 'Ece Yönetici',
			email: 'ece@izgah.test',
			role: 'admin'
		});
		const aiSection = await seedSection({
			name: 'Yapay Zeka',
			slug: 'yapay-zeka',
			sortOrder: 1,
			createdById: admin.user.id
		});
		const webSection = await seedSection({
			name: 'Web Platformu',
			slug: 'web-platformu',
			sortOrder: 2,
			createdById: admin.user.id
		});

		// 1. Check before sharing
		const checkInitial = await dispatchApiV1({
			url: `/api/v1/links/check?url=${encodeURIComponent('https://youtu.be/dQw4w9WgXcQ?t=45&si=track')}`,
			headers: { authorization: `Bearer ${member.rawApiKey}` }
		});
		expect(checkInitial.status).toBe(200);
		expect(await checkInitial.json()).toEqual({
			exists: false,
			canonicalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
			rawUrl: 'https://youtu.be/dQw4w9WgXcQ?t=45',
			suggestedContentType: 'video',
			suggestedSections: []
		});

		// 2. First share creation (single transaction: canonical_resources + link_shares + link_share_sections + unfurl_jobs)
		const createFirst = await dispatchApiV1({
			url: '/api/v1/links',
			method: 'POST',
			headers: { authorization: `Bearer ${member.rawApiKey}` },
			jsonBody: {
				url: 'https://youtu.be/dQw4w9WgXcQ?t=45&utm_source=extension',
				note: '   Harika video özeti   ',
				sectionIds: [aiSection.id, aiSection.id]
			}
		});
		expect(createFirst.status).toBe(201);
		const firstReqId = createFirst.headers.get('x-request-id');
		expect(firstReqId).toMatch(/^req_/);
		const firstBody = (await createFirst.json()) as {
			share: {
				id: string;
				resourceId: string;
				canonicalUrl: string;
				rawUrl: string;
				isFeedVisible: boolean;
				createdAt: string;
			};
			unfurlStatus: string;
			duplicate: boolean;
		};
		expect(firstBody.duplicate).toBe(false);
		expect(firstBody.unfurlStatus).toBe('queued');
		expect(firstBody.share.canonicalUrl).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
		expect(firstBody.share.rawUrl).toBe('https://youtu.be/dQw4w9WgXcQ?t=45');
		expect(firstBody.share.isFeedVisible).toBe(true);

		const resourceRows = await testDb.select().from(canonicalResources);
		const jobRows = await testDb.select().from(unfurlJobs);
		const shareRows = await testDb.select().from(linkShares);
		const shareSectionRows = await testDb.select().from(linkShareSections);
		expect(resourceRows).toHaveLength(1);
		expect(resourceRows[0].contentType).toBe('video');
		expect(resourceRows[0].contentTypeLocked).toBe(false);
		expect(jobRows).toHaveLength(1);
		expect(jobRows[0].resourceId).toBe(resourceRows[0].id);
		expect(jobRows[0].targetUrl).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
		expect(shareRows).toHaveLength(1);
		expect(shareRows[0].sourceChannel).toBe('api');
		expect(shareRows[0].note).toBe('Harika video özeti');
		expect(shareSectionRows).toHaveLength(1);

		// 3. Check after first share using equivalent desktop URL
		const checkAfter = await dispatchApiV1({
			url: `/api/v1/links/check?url=${encodeURIComponent('https://youtube.com/watch?v=dQw4w9WgXcQ&t=99')}`,
			headers: { authorization: `Bearer ${admin.rawApiKey}` }
		});
		expect(checkAfter.status).toBe(200);
		const checkAfterBody = await checkAfter.json();
		expect(checkAfterBody).toEqual({
			exists: true,
			canonicalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
			rawUrl: 'https://youtube.com/watch?v=dQw4w9WgXcQ&t=99',
			suggestedContentType: 'video',
			// The earlier share of the same link was filed under this section (smart capture §3).
			suggestedSections: [expect.objectContaining({ name: 'Yapay Zeka', source: 'history' })],
			resource: {
				id: resourceRows[0].id,
				title: null,
				likeCount: 0,
				commentCount: 0
			},
			sharesSummary: {
				totalCount: 1,
				firstShare: {
					authorName: 'Deniz Üye',
					createdAt: firstBody.share.createdAt,
					isFeedVisible: true,
					sectionNames: ['Yapay Zeka']
				}
			}
		});

		// 4. Second share of same canonical resource returns duplicate: true
		const createDuplicate = await dispatchApiV1({
			url: '/api/v1/links',
			method: 'POST',
			headers: { authorization: `Bearer ${admin.rawApiKey}` },
			jsonBody: {
				url: 'https://m.youtube.com/shorts/dQw4w9WgXcQ',
				note: 'Kısa sürüm linki',
				sectionIds: [webSection.id]
			}
		});
		expect(createDuplicate.status).toBe(201);
		const dupBody = await createDuplicate.json();
		expect(dupBody.duplicate).toBe(true);
		expect(dupBody.share.resourceId).toBe(resourceRows[0].id);
		expect(await testDb.select().from(canonicalResources)).toHaveLength(1);
		expect(await testDb.select().from(unfurlJobs)).toHaveLength(1);
		expect(await testDb.select().from(linkShares)).toHaveLength(2);

		// 5. Member attempting silent share -> 403 FORBIDDEN
		const memberSilent = await dispatchApiV1({
			url: '/api/v1/links',
			method: 'POST',
			headers: { authorization: `Bearer ${member.rawApiKey}` },
			jsonBody: {
				url: 'https://example.com/silent-member',
				sectionIds: [aiSection.id],
				isFeedVisible: false
			}
		});
		expect(memberSilent.status).toBe(403);
		const memberSilentReqId = memberSilent.headers.get('x-request-id');
		expect(await memberSilent.json()).toEqual({
			error: {
				code: 'FORBIDDEN',
				message: 'Ana akışta görünmeyen sessiz kaynak yalnızca yöneticiler tarafından eklenebilir.',
				requestId: memberSilentReqId
			}
		});

		// 6. Admin silent share with empty sectionIds -> 422 VALIDATION_ERROR
		const adminEmptySilent = await dispatchApiV1({
			url: '/api/v1/links',
			method: 'POST',
			headers: { authorization: `Bearer ${admin.rawApiKey}` },
			jsonBody: {
				url: 'https://example.com/silent-admin',
				sectionIds: [],
				isFeedVisible: false
			}
		});
		expect(adminEmptySilent.status).toBe(422);
		const adminEmptyBody = (await adminEmptySilent.json()) as {
			error: { code: string; requestId: string; details?: Record<string, string[]> };
		};
		expect(adminEmptyBody.error.code).toBe('VALIDATION_ERROR');
		expect(adminEmptyBody.error.details?.sectionIds?.length).toBeGreaterThan(0);

		// 7. Admin silent share with valid section succeeds, then member reshare makes it visible on feed
		const adminSilentOk = await dispatchApiV1({
			url: '/api/v1/links',
			method: 'POST',
			headers: { authorization: `Bearer ${admin.rawApiKey}` },
			jsonBody: {
				url: 'https://example.com/basvuru-rehberi',
				sectionIds: [webSection.id],
				isFeedVisible: false
			}
		});
		expect(adminSilentOk.status).toBe(201);
		expect((await adminSilentOk.json()).share.isFeedVisible).toBe(false);

		const checkSilent = await dispatchApiV1({
			url: `/api/v1/links/check?url=${encodeURIComponent('https://example.com/basvuru-rehberi')}`,
			headers: { authorization: `Bearer ${member.rawApiKey}` }
		});
		expect(checkSilent.status).toBe(200);
		expect((await checkSilent.json()).sharesSummary.firstShare).toMatchObject({
			authorName: 'Ece Yönetici',
			isFeedVisible: false,
			sectionNames: ['Web Platformu']
		});

		// 8. Validation and malformed JSON error envelopes
		const badJson = await dispatchApiV1({
			url: '/api/v1/links',
			method: 'POST',
			headers: { authorization: `Bearer ${member.rawApiKey}` },
			rawBody: '{not valid json'
		});
		expect(badJson.status).toBe(400);
		expect((await badJson.json()).error.code).toBe('BAD_REQUEST');

		const unknownSection = await dispatchApiV1({
			url: '/api/v1/links',
			method: 'POST',
			headers: { authorization: `Bearer ${member.rawApiKey}` },
			jsonBody: {
				url: 'https://example.com/valid-url',
				sectionIds: ['missing-section-id']
			}
		});
		expect(unknownSection.status).toBe(422);
		expect((await unknownSection.json()).error.details?.sectionIds).toBeDefined();

		const missingCheckUrl = await dispatchApiV1({
			url: '/api/v1/links/check',
			headers: { authorization: `Bearer ${member.rawApiKey}` }
		});
		expect(missingCheckUrl.status).toBe(422);
		expect((await missingCheckUrl.json()).error.code).toBe('VALIDATION_ERROR');
	});

	it('resolves short URLs via injectable ShortUrlResolver without calling fetch, and falls back on timeout or error', async () => {
		const member = await seedUserWithSessionAndKey({
			name: 'Kısa URL Üyesi',
			email: 'short@izgah.test',
			role: 'member'
		});

		const fetchSpy = vi.spyOn(globalThis, 'fetch');

		// 1. Default M3 ShortUrlResolver makes zero network requests
		const defaultCheck = await checkDuplicateLink('https://bit.ly/izgah-default');
		expect(defaultCheck).toEqual({
			exists: false,
			canonicalUrl: 'https://bit.ly/izgah-default',
			rawUrl: 'https://bit.ly/izgah-default',
			suggestedContentType: 'web',
			suggestedSections: []
		});
		expect(fetchSpy).not.toHaveBeenCalled();

		// 2. Injected mock ShortUrlResolver resolves t.co/bit.ly in both checkDuplicateLink and createLinkShare
		setShortUrlResolver(async (url) => {
			if (url.hostname === 't.co' && url.pathname === '/kit123') {
				return new URL('https://www.github.com/sveltejs/kit.git?utm_source=twitter');
			}
			return url;
		});

		const resolvedCheck = await checkDuplicateLink('https://t.co/kit123');
		expect(resolvedCheck).toEqual({
			exists: false,
			canonicalUrl: 'https://github.com/sveltejs/kit',
			rawUrl: 'https://www.github.com/sveltejs/kit.git',
			suggestedContentType: 'repo',
			suggestedSections: []
		});

		const createdResolved = await dispatchApiV1({
			url: '/api/v1/links',
			method: 'POST',
			headers: { authorization: `Bearer ${member.rawApiKey}` },
			jsonBody: { url: 'https://t.co/kit123' }
		});
		expect(createdResolved.status).toBe(201);
		const createdBody = await createdResolved.json();
		expect(createdBody.share.canonicalUrl).toBe('https://github.com/sveltejs/kit');

		// 3a. Default 1500ms timeout budget on resolveAndCanonicalizeUrl (fake timers, zero DB I/O)
		vi.useFakeTimers();
		let fakeMockTimer: ReturnType<typeof setTimeout> | undefined;
		try {
			const slowResolvePromise = resolveAndCanonicalizeUrl('https://bit.ly/slow-link', {
				shortUrlResolver: () =>
					new Promise<URL>((resolve) => {
						fakeMockTimer = setTimeout(
							() => resolve(new URL('https://example.com/too-late')),
							5000
						);
					})
			});
			await vi.advanceTimersByTimeAsync(SHORT_URL_RESOLVE_TIMEOUT_MS);
			const timedOutCanonical = await slowResolvePromise;
			expect(timedOutCanonical.canonicalUrl).toBe('https://bit.ly/slow-link');
			expect(timedOutCanonical.rawUrl).toBe('https://bit.ly/slow-link');
		} finally {
			if (fakeMockTimer !== undefined) {
				clearTimeout(fakeMockTimer);
			}
			vi.useRealTimers();
		}

		// 3b. Timeout fallback during checkDuplicateLink using real timers (safe for Postgres socket I/O)
		let realMockTimer: ReturnType<typeof setTimeout> | undefined;
		try {
			const timedOutCheck = await checkDuplicateLink('https://bit.ly/slow-link', {
				shortUrlTimeoutMs: 25,
				shortUrlResolver: () =>
					new Promise<URL>((resolve) => {
						realMockTimer = setTimeout(
							() => resolve(new URL('https://example.com/too-late')),
							5000
						);
					})
			});
			expect(timedOutCheck).toEqual({
				exists: false,
				canonicalUrl: 'https://bit.ly/slow-link',
				rawUrl: 'https://bit.ly/slow-link',
				suggestedContentType: 'web',
				suggestedSections: []
			});
		} finally {
			if (realMockTimer !== undefined) {
				clearTimeout(realMockTimer);
			}
		}

		// 4. Throwing resolver fallback during createLinkShare preserves canonicalized short URL
		setShortUrlResolver(async () => {
			throw new Error('Upstream resolver failed');
		});
		const createdFallback = await createLinkShare({
			actor: { id: member.user.id, role: member.user.role },
			url: 'https://tinyurl.com/error-link?utm_medium=social',
			sourceChannel: 'api'
		});
		expect(createdFallback.share.canonicalUrl).toBe('https://tinyurl.com/error-link');
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('manages content_type_locked on createLinkShare and updateLinkShare and enforces update permissions', async () => {
		const author = await seedUserWithSessionAndKey({
			name: 'Yazar',
			email: 'yazar@izgah.test',
			role: 'member'
		});
		const otherMember = await seedUserWithSessionAndKey({
			name: 'Diğer Üye',
			email: 'diger@izgah.test',
			role: 'member'
		});
		const admin = await seedUserWithSessionAndKey({
			name: 'Admin',
			email: 'admin-lock@izgah.test',
			role: 'admin'
		});
		const sec = await seedSection({
			name: 'Mimari',
			slug: 'mimari',
			sortOrder: 1,
			createdById: admin.user.id
		});

		// 1. Auto-classified new resource starts unlocked
		const first = await createLinkShare({
			actor: { id: author.user.id, role: author.user.role },
			url: 'https://example.com/uzun-yazi',
			sectionIds: [sec.id]
		});
		expect(first.share.contentType).toBe('web');

		const [resAfterFirst] = await testDb
			.select()
			.from(canonicalResources)
			.where(eq(canonicalResources.id, first.share.resourceId));
		expect(resAfterFirst.contentTypeLocked).toBe(false);

		// 2. Unlocked resource updated & locked by explicit contentType on reshare
		const second = await createLinkShare({
			actor: { id: otherMember.user.id, role: otherMember.user.role },
			url: 'https://example.com/uzun-yazi',
			contentType: 'article'
		});
		expect(second.duplicate).toBe(true);
		expect(second.share.contentType).toBe('article');

		const [resAfterSecond] = await testDb
			.select()
			.from(canonicalResources)
			.where(eq(canonicalResources.id, first.share.resourceId));
		expect(resAfterSecond.contentTypeLocked).toBe(true);

		// 3. Locked resource ignores conflicting contentType on subsequent createLinkShare
		const third = await createLinkShare({
			actor: { id: admin.user.id, role: admin.user.role },
			url: 'https://example.com/uzun-yazi',
			contentType: 'video'
		});
		expect(third.share.contentType).toBe('article');

		// 4. Non-author member cannot update share; admin cannot edit author's note
		await expect(
			updateLinkShare({
				actor: { id: otherMember.user.id, role: otherMember.user.role },
				shareId: first.share.id,
				note: 'Yetkisiz'
			})
		).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });

		await expect(
			updateLinkShare({
				actor: { id: admin.user.id, role: admin.user.role },
				shareId: first.share.id,
				note: 'Admin not değiştiremez'
			})
		).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });

		// 5. Explicit contentType change via updateLinkShare updates and locks even when previously locked
		const updatedByAdmin = await updateLinkShare({
			actor: { id: admin.user.id, role: admin.user.role },
			shareId: first.share.id,
			contentType: 'repo'
		});
		expect(updatedByAdmin.contentType).toBe('repo');

		// 6. Member cannot toggle isFeedVisible via updateLinkShare
		await expect(
			updateLinkShare({
				actor: { id: author.user.id, role: author.user.role },
				shareId: first.share.id,
				isFeedVisible: false
			})
		).rejects.toBeInstanceOf(LinkServiceError);

		// 7. New resource created with explicit contentType starts locked immediately
		const explicitNew = await createLinkShare({
			actor: { id: author.user.id, role: author.user.role },
			url: 'https://example.com/kilitli-baslangic',
			contentType: 'article'
		});
		expect(explicitNew.share.contentType).toBe('article');
		const [explicitRes] = await testDb
			.select()
			.from(canonicalResources)
			.where(eq(canonicalResources.id, explicitNew.share.resourceId));
		expect(explicitRes.contentTypeLocked).toBe(true);

		const subsequentConflicting = await createLinkShare({
			actor: { id: otherMember.user.id, role: otherMember.user.role },
			url: 'https://example.com/kilitli-baslangic',
			contentType: 'web'
		});
		expect(subsequentConflicting.share.contentType).toBe('article');
	});

	it('preserves active duplicate detection when first share is soft-deleted and hides resource once all shares are deleted', async () => {
		const firstAuthor = await seedUserWithSessionAndKey({
			name: 'İlk Paylaşan',
			email: 'ilk@izgah.test',
			role: 'member'
		});
		const secondAuthor = await seedUserWithSessionAndKey({
			name: 'İkinci Paylaşan',
			email: 'ikinci@izgah.test',
			role: 'member'
		});
		const admin = await seedUserWithSessionAndKey({
			name: 'Admin',
			email: 'admin-del@izgah.test',
			role: 'admin'
		});
		const sec1 = await seedSection({
			name: 'Backend',
			slug: 'backend',
			sortOrder: 1,
			createdById: admin.user.id
		});
		const sec2 = await seedSection({
			name: 'Veritabanı',
			slug: 'veritabani',
			sortOrder: 2,
			createdById: admin.user.id
		});

		const share1 = await createLinkShare({
			actor: { id: firstAuthor.user.id, role: firstAuthor.user.role },
			url: 'https://example.com/ortak-kaynak',
			sectionIds: [sec1.id]
		});
		const share2 = await createLinkShare({
			actor: { id: secondAuthor.user.id, role: secondAuthor.user.role },
			url: 'https://example.com/ortak-kaynak',
			sectionIds: [sec2.id]
		});

		// Other member cannot soft-delete share1
		await expect(
			softDeleteLinkShare({
				actor: { id: secondAuthor.user.id, role: secondAuthor.user.role },
				shareId: share1.share.id
			})
		).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });

		// Soft-delete the first share
		await softDeleteLinkShare({
			actor: { id: firstAuthor.user.id, role: firstAuthor.user.role },
			shareId: share1.share.id
		});

		// Service layer flags originalShareDeleted: true while picking share2 as oldest active share
		const refAfterFirstDelete = await getResourceShareReference(share1.share.resourceId);
		expect(refAfterFirstDelete.totalActiveCount).toBe(1);
		expect(refAfterFirstDelete.originalShareDeleted).toBe(true);
		expect(refAfterFirstDelete.allTimeFirstShareId).toBe(share1.share.id);
		expect(refAfterFirstDelete.firstActiveShare?.id).toBe(share2.share.id);

		const serviceCheckAfterFirstDelete = await checkDuplicateLink(
			'https://example.com/ortak-kaynak'
		);
		expect(serviceCheckAfterFirstDelete.exists).toBe(true);
		if (serviceCheckAfterFirstDelete.exists) {
			expect(serviceCheckAfterFirstDelete.originalShareDeleted).toBe(true);
			expect(serviceCheckAfterFirstDelete.sharesSummary.totalCount).toBe(1);
			expect(serviceCheckAfterFirstDelete.sharesSummary.firstShare.authorName).toBe(
				'İkinci Paylaşan'
			);
			expect(serviceCheckAfterFirstDelete.sharesSummary.firstShare.sectionNames).toEqual([
				'Veritabanı'
			]);
		}

		// /api/v1/links/check keeps §7 schema (oldest active share as firstShare, no extra internal property)
		const apiCheckAfterFirstDelete = await dispatchApiV1({
			url: `/api/v1/links/check?url=${encodeURIComponent('https://example.com/ortak-kaynak')}`,
			headers: { authorization: `Bearer ${firstAuthor.rawApiKey}` }
		});
		expect(apiCheckAfterFirstDelete.status).toBe(200);
		const apiCheckBody = await apiCheckAfterFirstDelete.json();
		expect(apiCheckBody).not.toHaveProperty('originalShareDeleted');
		expect(apiCheckBody.exists).toBe(true);
		expect(apiCheckBody.sharesSummary).toEqual({
			totalCount: 1,
			firstShare: {
				authorName: 'İkinci Paylaşan',
				createdAt: share2.share.createdAt.toISOString(),
				isFeedVisible: true,
				sectionNames: ['Veritabanı']
			}
		});

		// Admin soft-deletes remaining share2 -> resource is hidden from duplicate check and reshare is duplicate: false
		await softDeleteLinkShare({
			actor: { id: admin.user.id, role: admin.user.role },
			shareId: share2.share.id
		});

		const apiCheckAllDeleted = await dispatchApiV1({
			url: `/api/v1/links/check?url=${encodeURIComponent('https://example.com/ortak-kaynak')}`,
			headers: { authorization: `Bearer ${firstAuthor.rawApiKey}` }
		});
		expect(apiCheckAllDeleted.status).toBe(200);
		expect(await apiCheckAllDeleted.json()).toEqual({
			exists: false,
			canonicalUrl: 'https://example.com/ortak-kaynak',
			rawUrl: 'https://example.com/ortak-kaynak',
			suggestedContentType: 'web',
			suggestedSections: []
		});

		const reshareAfterAllDeleted = await createLinkShare({
			actor: { id: firstAuthor.user.id, role: firstAuthor.user.role },
			url: 'https://example.com/ortak-kaynak',
			contentType: 'video'
		});
		expect(reshareAfterAllDeleted.duplicate).toBe(false);
		expect(reshareAfterAllDeleted.share.contentType).toBe('video');

		const [relockedRes] = await testDb
			.select({
				contentType: canonicalResources.contentType,
				contentTypeLocked: canonicalResources.contentTypeLocked
			})
			.from(canonicalResources)
			.where(eq(canonicalResources.id, share1.share.resourceId))
			.limit(1);
		expect(relockedRes).toEqual({ contentType: 'video', contentTypeLocked: true });
	});

	it('wraps 404 and 405 /api/v1/* responses in standard JSON error envelopes with requestId', async () => {
		const member = await seedUserWithSessionAndKey({
			name: 'Zeynep Api',
			email: 'zeynep-api@izgah.test',
			role: 'member'
		});

		const notFoundRes = await dispatchApiV1({
			url: '/api/v1/does-not-exist',
			method: 'GET',
			headers: { authorization: `Bearer ${member.rawApiKey}` }
		});
		expect(notFoundRes.status).toBe(404);
		const notFoundReqId = notFoundRes.headers.get('x-request-id');
		expect(notFoundReqId).toBeTruthy();
		expect(await notFoundRes.json()).toEqual({
			error: {
				code: 'NOT_FOUND',
				message: 'İstenen API uç noktası bulunamadı.',
				requestId: notFoundReqId
			}
		});

		const methodNotAllowedEvent = createMockEvent({
			url: '/api/v1/sections',
			method: 'DELETE',
			headers: { authorization: `Bearer ${member.rawApiKey}` }
		});
		const methodNotAllowedRes = await handle({
			event: methodNotAllowedEvent,
			resolve: async () =>
				new Response('Method Not Allowed', {
					status: 405,
					headers: { Allow: 'GET, HEAD, OPTIONS' }
				})
		});
		expect(methodNotAllowedRes.status).toBe(405);
		expect(methodNotAllowedRes.headers.get('allow')).toBe('GET, HEAD, OPTIONS');
		const methodReqId = methodNotAllowedRes.headers.get('x-request-id');
		expect(methodReqId).toBeTruthy();
		expect(await methodNotAllowedRes.json()).toEqual({
			error: {
				code: 'METHOD_NOT_ALLOWED',
				message: 'Bu uç nokta için HTTP yöntemi desteklenmiyor.',
				requestId: methodReqId
			}
		});
	});
});
