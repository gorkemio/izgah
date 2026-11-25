import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { buildClientHeaders, createIzgahApiClient } from '../../src/lib/api-client';
import {
	IzgahApiError,
	isAbortError,
	mapApiErrorToTurkish,
	mapNetworkErrorToTurkish,
	parseApiErrorEnvelope,
	parseRetryAfterSeconds
} from '../../src/lib/errors';
import {
	clearSessionMetaCache,
	clearSettings,
	consumePendingShareContext,
	hasConfiguredSettings,
	loadSettings,
	PENDING_SHARE_STORAGE_KEY,
	readSessionMetaCache,
	saveSettings,
	SESSION_META_STORAGE_KEY,
	SETTINGS_STORAGE_KEY,
	updateCachedUser,
	writePendingShareContext,
	writeSessionMetaCache
} from '../../src/lib/storage';
import {
	MAX_URL_LENGTH,
	PENDING_SHARE_TTL_MS,
	SESSION_META_TTL_MS,
	type ExtensionSettings,
	type SectionItem
} from '../../src/lib/types';
import { normalizeServerOrigin, validateShareableUrl } from '../../src/lib/url';

const SAMPLE_USER = {
	id: 'usr_1',
	name: 'Deniz Yılmaz',
	email: 'deniz@example.com',
	role: 'admin' as const
};

const SAMPLE_SECTIONS: SectionItem[] = [
	{ id: 'sec_1', slug: 'ai', name: 'Yapay Zeka', description: null, sortOrder: 1 },
	{ id: 'sec_2', slug: 'web', name: 'Web Platformu', description: 'Standartlar', sortOrder: 2 }
];

describe('url helpers', () => {
	it('normalizes valid https and loopback origins by stripping paths, queries, and hashes', () => {
		expect(normalizeServerOrigin('  https://izgah.example.com/feed?tab=all#top  ')).toEqual({
			ok: true,
			value: 'https://izgah.example.com'
		});
		expect(normalizeServerOrigin('https://izgah.example.com:8443/share')).toEqual({
			ok: true,
			value: 'https://izgah.example.com:8443'
		});
		expect(normalizeServerOrigin('http://localhost:3000/login')).toEqual({
			ok: true,
			value: 'http://localhost:3000'
		});
		expect(normalizeServerOrigin('http://127.0.0.1:4173/')).toEqual({
			ok: true,
			value: 'http://127.0.0.1:4173'
		});
		expect(normalizeServerOrigin('http://[::1]:3000/sections')).toEqual({
			ok: true,
			value: 'http://[::1]:3000'
		});
	});

	it('rejects empty, malformed, credentialed, or remote plain-http server origins', () => {
		expect(normalizeServerOrigin('   ')).toEqual({
			ok: false,
			message: 'İzgah sunucu adresi boş bırakılamaz.'
		});
		expect(normalizeServerOrigin('not-a-url').ok).toBe(false);
		expect(normalizeServerOrigin('ftp://izgah.example.com').ok).toBe(false);
		expect(normalizeServerOrigin('https://user:secret@izgah.example.com')).toEqual({
			ok: false,
			message: 'Sunucu adresinde kullanıcı adı veya parola bulunamaz.'
		});
		expect(normalizeServerOrigin('http://izgah.example.com')).toEqual({
			ok: false,
			message:
				'Uzak İzgah sunucuları için https:// adresi gereklidir (http:// yalnız localhost için desteklenir).'
		});
	});

	it('validates shareable tab URLs across activeTab restrictions, schemes, and length limit', () => {
		expect(validateShareableUrl(undefined)).toEqual({
			ok: false,
			message:
				'Aktif sekmenin adresi tarayıcı kısıtlaması nedeniyle okunamadı; geçerli bir http:// veya https:// adresi yapıştırabilirsiniz.'
		});
		expect(validateShareableUrl('')).toEqual({
			ok: false,
			message:
				'Aktif sekmenin adresi tarayıcı kısıtlaması nedeniyle okunamadı; geçerli bir http:// veya https:// adresi yapıştırabilirsiniz.'
		});
		expect(validateShareableUrl('chrome://extensions').ok).toBe(false);
		expect(validateShareableUrl('file:///Users/demo/index.html').ok).toBe(false);
		expect(validateShareableUrl('about:blank').ok).toBe(false);
		expect(validateShareableUrl('https://user:pass@example.com/path').ok).toBe(false);

		const maxUrl = `https://example.com/${'a'.repeat(MAX_URL_LENGTH - 'https://example.com/'.length)}`;
		expect(maxUrl.length).toBe(MAX_URL_LENGTH);
		expect(validateShareableUrl(maxUrl)).toEqual({ ok: true, value: maxUrl });

		const tooLongUrl = `${maxUrl}x`;
		expect(validateShareableUrl(tooLongUrl).ok).toBe(false);

		expect(validateShareableUrl('  https://example.com/article?id=42  ')).toEqual({
			ok: true,
			value: 'https://example.com/article?id=42'
		});
	});
});

describe('storage helpers', () => {
	beforeEach(() => {
		fakeBrowser.reset();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('persists, updates, and clears extension settings strictly in storage.local', async () => {
		expect(await loadSettings()).toBeNull();
		expect(await hasConfiguredSettings()).toBe(false);

		const initial: ExtensionSettings = {
			serverOrigin: 'https://izgah.example.com',
			apiKey: 'izk_secret_123',
			cachedUser: SAMPLE_USER
		};
		await saveSettings(initial);

		expect(await hasConfiguredSettings()).toBe(true);
		expect(await loadSettings()).toEqual(initial);
		const rawLocal = await browser.storage.local.get(SETTINGS_STORAGE_KEY);
		expect(rawLocal[SETTINGS_STORAGE_KEY]).toEqual(initial);

		const downgraded = await updateCachedUser({ ...SAMPLE_USER, role: 'member' });
		expect(downgraded?.cachedUser?.role).toBe('member');
		expect(downgraded?.apiKey).toBe('izk_secret_123');

		const clearedUser = await updateCachedUser(null);
		expect(clearedUser?.cachedUser).toBeNull();
		expect(clearedUser?.serverOrigin).toBe('https://izgah.example.com');

		await clearSettings();
		expect(await loadSettings()).toBeNull();
		expect(await hasConfiguredSettings()).toBe(false);
	});

	it('writes and atomically consumes pending share context with a 10s TTL', async () => {
		await writePendingShareContext({
			url: 'https://example.com/a',
			title: null,
			source: 'link',
			createdAt: 1000
		});

		const firstRead = await consumePendingShareContext(1000 + PENDING_SHARE_TTL_MS);
		expect(firstRead).toEqual({
			url: 'https://example.com/a',
			title: null,
			source: 'link',
			createdAt: 1000
		});

		// Must be deleted after first consumption
		expect(await consumePendingShareContext(1001)).toBeNull();
		const sessionState = await browser.storage.session.get(PENDING_SHARE_STORAGE_KEY);
		expect(sessionState[PENDING_SHARE_STORAGE_KEY]).toBeUndefined();

		await writePendingShareContext({
			url: 'https://example.com/expired',
			title: 'Expired',
			source: 'page',
			createdAt: 5000
		});
		expect(await consumePendingShareContext(5000 + PENDING_SHARE_TTL_MS + 1)).toBeNull();
	});

	it('caches session metadata for 60s and invalidates on origin change, TTL expiry, or clear', async () => {
		await writeSessionMetaCache({
			serverOrigin: 'https://izgah.example.com',
			user: SAMPLE_USER,
			sections: SAMPLE_SECTIONS,
			cachedAt: 10_000
		});

		const fresh = await readSessionMetaCache(
			'https://izgah.example.com',
			10_000 + SESSION_META_TTL_MS
		);
		expect(fresh?.user).toEqual(SAMPLE_USER);
		expect(fresh?.sections).toEqual(SAMPLE_SECTIONS);

		// Different origin must invalidate
		expect(await readSessionMetaCache('https://other.example.com', 10_500)).toBeNull();
		const afterOriginMismatch = await browser.storage.session.get(SESSION_META_STORAGE_KEY);
		expect(afterOriginMismatch[SESSION_META_STORAGE_KEY]).toBeUndefined();

		await writeSessionMetaCache({
			serverOrigin: 'https://izgah.example.com',
			user: SAMPLE_USER,
			sections: SAMPLE_SECTIONS,
			cachedAt: 20_000
		});
		expect(
			await readSessionMetaCache('https://izgah.example.com', 20_000 + SESSION_META_TTL_MS + 1)
		).toBeNull();

		await writeSessionMetaCache({
			serverOrigin: 'https://izgah.example.com',
			user: SAMPLE_USER,
			sections: SAMPLE_SECTIONS,
			cachedAt: 30_000
		});
		await clearSessionMetaCache();
		expect(await readSessionMetaCache('https://izgah.example.com', 30_100)).toBeNull();
	});

	it('throws an explicit Error when browser.storage.session is unavailable', async () => {
		const storageObj = browser.storage as { session?: unknown };
		const originalSession = storageObj.session;
		storageObj.session = undefined;

		try {
			await expect(
				writePendingShareContext({
					url: 'https://example.com',
					title: null,
					source: 'link',
					createdAt: 1
				})
			).rejects.toThrow(/storage\.session/i);
			await expect(consumePendingShareContext()).rejects.toThrow(/storage\.session/i);
			await expect(readSessionMetaCache('https://izgah.example.com')).rejects.toThrow(
				/storage\.session/i
			);
			await expect(clearSessionMetaCache()).rejects.toThrow(/storage\.session/i);
		} finally {
			storageObj.session = originalSession;
		}
	});
});

describe('api-client and Turkish error mapping', () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it('sends mandatory headers and credentials: omit on API calls', async () => {
		const headers = buildClientHeaders({
			apiKey: '  izk_test_token  ',
			browserTarget: 'firefox',
			clientVersion: '0.1.0',
			includeContentType: false
		});
		expect(headers.get('Authorization')).toBe('Bearer izk_test_token');
		expect(headers.get('X-Client-Name')).toBe('izgah-firefox-extension');
		expect(headers.get('X-Client-Version')).toBe('0.1.0');
		expect(headers.get('Accept')).toBe('application/json');
		expect(headers.get('Content-Type')).toBeNull();

		const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
			const reqHeaders = init?.headers as Headers;
			expect(input).toBe('https://izgah.example.com/api/v1/me');
			expect(init?.method).toBe('GET');
			expect(init?.credentials).toBe('omit');
			expect(reqHeaders.get('Authorization')).toBe('Bearer izk_test_token');
			expect(reqHeaders.get('X-Client-Name')).toBe('izgah-chrome-extension');
			expect(reqHeaders.get('X-Client-Version')).toBe('0.1.0');
			return new Response(JSON.stringify({ user: SAMPLE_USER }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			});
		});

		const client = createIzgahApiClient({
			serverOrigin: 'https://izgah.example.com/',
			apiKey: 'izk_test_token',
			browserTarget: 'chrome',
			clientVersion: '0.1.0',
			fetchImpl: fetchMock
		});

		const me = await client.getMe();
		expect(me.user).toEqual(SAMPLE_USER);
	});

	it('encodes checkLink query and builds strict POST /api/v1/links payloads', async () => {
		const recordedBodies: Array<Record<string, unknown>> = [];
		const recordedUrls: string[] = [];

		const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
			recordedUrls.push(String(input));
			if (init?.body) {
				recordedBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
			}
			return new Response(
				JSON.stringify(
					init?.method === 'GET'
						? {
								exists: false,
								canonicalUrl: 'https://example.com/post',
								rawUrl: 'https://example.com/post',
								suggestedContentType: 'article'
							}
						: {
								share: {
									id: 'shr_1',
									resourceId: 'res_1',
									canonicalUrl: 'https://example.com/post',
									rawUrl: 'https://example.com/post',
									isFeedVisible: false,
									createdAt: '2026-11-20T00:00:00.000Z'
								},
								unfurlStatus: 'pending',
								duplicate: false
							}
				),
				{ status: init?.method === 'POST' ? 201 : 200 }
			);
		});

		const client = createIzgahApiClient({
			serverOrigin: 'https://izgah.example.com',
			apiKey: 'izk_test',
			browserTarget: 'safari',
			clientVersion: '0.1.0',
			fetchImpl: fetchMock
		});

		await client.checkLink('https://example.com/post?ref=home&a=1');
		expect(recordedUrls[0]).toBe(
			'https://izgah.example.com/api/v1/links/check?url=https%3A%2F%2Fexample.com%2Fpost%3Fref%3Dhome%26a%3D1'
		);

		// Auto-detect contentType + empty note + empty sectionIds + feed-visible should omit optional keys
		await client.createLink({
			url: '  https://example.com/post  ',
			note: '   ',
			sectionIds: [],
			isFeedVisible: true
		});
		expect(recordedBodies[0]).toEqual({
			url: 'https://example.com/post'
		});

		// Silent admin share with manual contentType + note + sectionIds
		await client.createLink({
			url: 'https://example.com/post',
			note: 'Faydalı kaynak',
			sectionIds: ['sec_1'],
			contentType: 'repo',
			isFeedVisible: false
		});
		expect(recordedBodies[1]).toEqual({
			url: 'https://example.com/post',
			note: 'Faydalı kaynak',
			sectionIds: ['sec_1'],
			contentType: 'repo',
			isFeedVisible: false
		});
	});

	it('passes through caller AbortError without wrapping while mapping timeouts to TIMEOUT_ERROR', async () => {
		const abortingFetch = vi.fn<typeof fetch>((_input, init) => {
			return new Promise((_resolve, reject) => {
				init?.signal?.addEventListener('abort', () => {
					const reason = init.signal?.reason;
					reject(
						reason instanceof Error
							? reason
							: Object.assign(new Error('Aborted'), { name: 'AbortError' })
					);
				});
			});
		});

		const client = createIzgahApiClient({
			serverOrigin: 'https://izgah.example.com',
			apiKey: 'izk_test',
			browserTarget: 'chrome',
			clientVersion: '0.1.0',
			timeoutMs: 50,
			fetchImpl: abortingFetch
		});

		const callerController = new AbortController();
		const pendingAbort = client.checkLink('https://example.com', callerController.signal);
		callerController.abort();

		await expect(pendingAbort).rejects.toSatisfy(
			(err: unknown) => isAbortError(err) && !(err instanceof IzgahApiError)
		);

		// Now trigger timeout path
		await expect(client.checkLink('https://example.com')).rejects.toSatisfy(
			(err: unknown) =>
				err instanceof IzgahApiError &&
				err.mapped.code === 'TIMEOUT_ERROR' &&
				err.mapped.isNetworkError &&
				err.mapped.requestId === null
		);
	});

	it('maps 400, 401, 403, 404, 405, 409, 422, 429, non-JSON 502, and TypeError consistently in Turkish', async () => {
		expect(parseApiErrorEnvelope(null)).toBeNull();
		expect(parseRetryAfterSeconds('12')).toBe(12);
		expect(parseRetryAfterSeconds('invalid')).toBeNull();

		const cases = [
			{
				status: 400,
				payload: { error: { code: 'BAD_REQUEST', message: 'Bad', requestId: 'req_400' } },
				expectText: /İstek biçimi/,
				expectAuth: false
			},
			{
				status: 401,
				payload: { error: { code: 'UNAUTHORIZED', message: 'No', requestId: 'req_401' } },
				expectText: /\/settings\/api-keys/,
				expectAuth: true
			},
			{
				status: 403,
				payload: { error: { code: 'FORBIDDEN', message: 'Admin only', requestId: 'req_403' } },
				expectText: /yetkiniz bulunmuyor/i,
				expectAuth: false
			},
			{
				status: 404,
				payload: { error: { code: 'NOT_FOUND', message: 'Missing', requestId: 'req_404' } },
				expectText: /API uç noktası bulunamadı/,
				expectAuth: false
			},
			{
				status: 405,
				payload: { error: { code: 'METHOD_NOT_ALLOWED', message: 'Method', requestId: 'req_405' } },
				expectText: /desteklenmiyor/,
				expectAuth: false
			},
			{
				status: 409,
				payload: { error: { code: 'CONFLICT', message: 'Çakışma detayı', requestId: 'req_409' } },
				expectText: /Çakışma detayı/,
				expectAuth: false
			}
		];

		for (const c of cases) {
			const mapped = mapApiErrorToTurkish({ status: c.status, payload: c.payload });
			expect(mapped.status).toBe(c.status);
			expect(mapped.userMessage).toMatch(c.expectText);
			expect(mapped.requestId).toBe(`req_${c.status}`);
			expect(mapped.isAuthError).toBe(c.expectAuth);
		}

		// 422 with field errors + _root + unknown key
		const validationMapped = mapApiErrorToTurkish({
			status: 422,
			payload: {
				error: {
					code: 'VALIDATION_ERROR',
					message: 'Doğrulama hatası.',
					requestId: 'req_422',
					details: {
						sectionIds: ['En az bir bölüm seçilmelidir.'],
						_root: ['Genel kural ihlali.'],
						unexpectedExtraKey: ['Bilinmeyen alan uyarısı.']
					}
				}
			}
		});
		expect(validationMapped.fieldErrors).toEqual({
			sectionIds: ['En az bir bölüm seçilmelidir.']
		});
		expect(validationMapped.userMessage).toContain('Genel kural ihlali.');
		expect(validationMapped.userMessage).toContain('Bilinmeyen alan uyarısı.');

		// 429 with numeric Retry-After vs missing Retry-After
		const rateLimitedWithHeader = mapApiErrorToTurkish({
			status: 429,
			headers: new Headers({ 'Retry-After': '17', 'X-Request-Id': 'req_429_a' }),
			payload: { error: { code: 'RATE_LIMITED', message: 'Slow down' } }
		});
		expect(rateLimitedWithHeader.retryAfterSeconds).toBe(17);
		expect(rateLimitedWithHeader.userMessage).toContain('17 saniye');
		expect(rateLimitedWithHeader.requestId).toBe('req_429_a');

		const rateLimitedWithoutHeader = mapApiErrorToTurkish({
			status: 429,
			payload: { error: { code: 'RATE_LIMITED', message: 'Slow down', requestId: 'req_429_b' } }
		});
		expect(rateLimitedWithoutHeader.retryAfterSeconds).toBeNull();
		expect(rateLimitedWithoutHeader.userMessage).toContain('kısa süre bekleyip');

		// Non-JSON 502 reverse proxy response with X-Request-Id header
		const client = createIzgahApiClient({
			serverOrigin: 'https://izgah.example.com',
			apiKey: 'izk_test',
			browserTarget: 'chrome',
			clientVersion: '0.1.0',
			fetchImpl: vi.fn<typeof fetch>(async () => {
				return new Response('<html>502 Bad Gateway</html>', {
					status: 502,
					headers: { 'Content-Type': 'text/html', 'X-Request-Id': 'req_proxy_502' }
				});
			})
		});

		await expect(client.getMe()).rejects.toSatisfy(
			(err: unknown) =>
				err instanceof IzgahApiError &&
				err.mapped.status === 502 &&
				err.mapped.requestId === 'req_proxy_502' &&
				err.mapped.userMessage.includes('beklenmeyen bir hata')
		);

		const networkMapped = mapNetworkErrorToTurkish(new TypeError('Failed to fetch'));
		expect(networkMapped.status).toBeNull();
		expect(networkMapped.requestId).toBeNull();
		expect(networkMapped.isNetworkError).toBe(true);
	});
});
