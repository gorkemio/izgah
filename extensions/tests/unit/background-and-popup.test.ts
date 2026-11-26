import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { CONTEXT_MENU_SHARE_ID, setupBackground } from '../../src/entrypoints/background';
import { initPopupPage, type PopupPageController } from '../../src/entrypoints/popup/main';
import {
	loadSettings,
	PENDING_SHARE_STORAGE_KEY,
	readSessionMetaCache,
	saveSettings,
	writePendingShareContext,
	writeSessionMetaCache
} from '../../src/lib/storage';
import {
	PENDING_SHARE_TTL_MS,
	type CachedUserProfile,
	type SectionItem
} from '../../src/lib/types';

const POPUP_HTML = readFileSync(resolve(process.cwd(), 'src/entrypoints/popup/index.html'), 'utf8');

const RAW_BODY_HTML = POPUP_HTML.match(/<body>([\s\S]*?)<\/body>/i)?.[1]?.replace(
	/<script[\s\S]*?<\/script>/gi,
	''
);

if (!RAW_BODY_HTML) {
	throw new Error('Could not extract body markup from popup/index.html');
}

const BODY_HTML: string = RAW_BODY_HTML;

const ADMIN_USER: CachedUserProfile = {
	id: 'u_admin',
	name: 'Deniz Yönetici',
	email: 'deniz@izgah.example.com',
	role: 'admin'
};

const MEMBER_USER: CachedUserProfile = {
	id: 'u_member',
	name: 'Ece Üye',
	email: 'ece@izgah.example.com',
	role: 'member'
};

const SAMPLE_SECTIONS: SectionItem[] = [
	{ id: 'sec_1', slug: 'ai', name: 'Yapay Zeka', description: null, sortOrder: 1 },
	{ id: 'sec_2', slug: 'web', name: 'Web Standartları', description: null, sortOrder: 2 }
];

type ContextClickListener = (
	info: { menuItemId: string; linkUrl?: string; pageUrl?: string },
	tab?: { url?: string; title?: string }
) => void;

function installBrowserSpies() {
	const clickListeners: ContextClickListener[] = [];

	const contextMenusMock = {
		removeAll: vi.fn(async () => {}),
		create: vi.fn(() => {}),
		onClicked: {
			addListener: vi.fn((fn: ContextClickListener) => {
				clickListeners.push(fn);
			}),
			trigger: (
				info: { menuItemId: string; linkUrl?: string; pageUrl?: string },
				tab?: { url?: string; title?: string }
			) => {
				for (const listener of clickListeners) {
					listener(info, tab);
				}
			}
		}
	};

	(browser as unknown as Record<string, unknown>).contextMenus = contextMenusMock;

	const openPopupMock = vi.fn(async () => {});
	(browser.action as unknown as Record<string, unknown>).openPopup = openPopupMock;

	const openOptionsPageMock = vi.fn(async () => {});
	(browser.runtime as unknown as Record<string, unknown>).openOptionsPage = openOptionsPageMock;

	const windowsCreateSpy = vi.spyOn(browser.windows, 'create');
	const tabsQuerySpy = vi
		.spyOn(browser.tabs, 'query')
		.mockResolvedValue([{ id: 1, url: 'https://example.com/tab', title: 'Örnek Sekme' }] as never);

	return {
		contextMenusMock,
		openPopupMock,
		openOptionsPageMock,
		windowsCreateSpy,
		tabsQuerySpy
	};
}

function mountPopupDom() {
	document.documentElement.setAttribute('data-manual-init', 'true');
	document.body.innerHTML = BODY_HTML;
}

describe('background service worker and popup UI (CUJ 2–5)', () => {
	let controller: PopupPageController | null = null;
	let spies: ReturnType<typeof installBrowserSpies>;

	beforeEach(() => {
		fakeBrowser.reset();
		mountPopupDom();
		spies = installBrowserSpies();
	});

	afterEach(() => {
		controller?.dispose();
		controller = null;
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it('registers single right-click context menu on install and performs atomic context handoff with standalone fallback', async () => {
		setupBackground();

		await fakeBrowser.runtime.onInstalled.trigger({ reason: 'install' });
		expect(spies.contextMenusMock.removeAll).toHaveBeenCalledTimes(1);
		expect(spies.contextMenusMock.create).toHaveBeenCalledWith({
			id: CONTEXT_MENU_SHARE_ID,
			title: "İzgah'ta iz bırak",
			contexts: ['page', 'link']
		});

		// Unrelated menuItemId is ignored
		spies.contextMenusMock.onClicked.trigger(
			{ menuItemId: 'other-menu', linkUrl: 'https://ignored.example.com' },
			undefined
		);
		expect(spies.openPopupMock).not.toHaveBeenCalled();

		// Simulate slow storage.session.set while checking synchronous openPopup invocation
		let releaseStorageWrite!: () => void;
		const delayedWrite = new Promise<void>((resolve) => {
			releaseStorageWrite = resolve;
		});
		const originalSessionSet = browser.storage.session.set.bind(browser.storage.session);
		vi.spyOn(browser.storage.session, 'set').mockImplementation(async (items) => {
			await delayedWrite;
			return originalSessionSet(items);
		});

		spies.contextMenusMock.onClicked.trigger(
			{ menuItemId: CONTEXT_MENU_SHARE_ID, linkUrl: 'https://example.com/target-link' },
			{ url: 'https://example.com/parent', title: 'Ana Sayfa' }
		);

		// openPopup MUST be called immediately in the same event turn before storage write finishes
		expect(spies.openPopupMock).toHaveBeenCalledTimes(1);

		// Message handshake awaits write completion and returns context atomically
		const consumePromise = browser.runtime.sendMessage({ type: 'consumePendingShare' });
		releaseStorageWrite();
		const consumed = await consumePromise;
		expect(consumed).toMatchObject({
			url: 'https://example.com/target-link',
			title: null,
			source: 'link'
		});
		// Second consumption returns null
		expect(await browser.runtime.sendMessage({ type: 'consumePendingShare' })).toBeNull();
		const storedAfter = await browser.storage.session.get(PENDING_SHARE_STORAGE_KEY);
		expect(storedAfter[PENDING_SHARE_STORAGE_KEY]).toBeUndefined();

		// When openPopup rejects, background waits for storage write before calling windows.create
		let releaseSecondWrite!: () => void;
		const secondWriteGate = new Promise<void>((resolve) => {
			releaseSecondWrite = resolve;
		});
		vi.spyOn(browser.storage.session, 'set').mockImplementationOnce(async (items) => {
			await secondWriteGate;
			return originalSessionSet(items);
		});
		spies.openPopupMock.mockRejectedValueOnce(new Error('No active browser window toolbar'));

		spies.contextMenusMock.onClicked.trigger(
			{ menuItemId: CONTEXT_MENU_SHARE_ID, pageUrl: 'https://example.com/page-fallback' },
			{ url: 'https://example.com/page-fallback', title: 'Sayfa Başlığı' }
		);

		await new Promise((r) => setTimeout(r, 0));
		expect(spies.windowsCreateSpy).not.toHaveBeenCalled();

		releaseSecondWrite();
		await vi.waitFor(() => {
			expect(spies.windowsCreateSpy).toHaveBeenCalledWith({
				url: 'chrome-extension://test-extension-id/popup.html?mode=standalone',
				type: 'popup',
				width: 420,
				height: 620
			});
		});
	});

	it('never queries tabs in standalone mode when pending context is missing or expired', async () => {
		await saveSettings({
			serverOrigin: 'https://izgah.example.com',
			apiKey: 'izk_valid',
			cachedUser: MEMBER_USER
		});
		await writeSessionMetaCache({
			serverOrigin: 'https://izgah.example.com',
			user: MEMBER_USER,
			sections: SAMPLE_SECTIONS
		});

		const fetchMock = vi.fn<typeof fetch>();
		controller = await initPopupPage({
			fetchImpl: fetchMock,
			searchParams: '?mode=standalone'
		});

		const urlInput = document.getElementById('share-url') as HTMLInputElement;
		const urlNotice = document.getElementById('share-url-notice') as HTMLElement;

		expect(spies.tabsQuerySpy).not.toHaveBeenCalled();
		expect(urlInput.value).toBe('');
		expect(urlNotice.hidden).toBe(false);
		expect(urlNotice.textContent).toContain('süresi dolduğu');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('handles link vs page handoff, 10s expiry, setup state, and restricted activeTab URLs cleanly', async () => {
		// Unconfigured popup shows setup card and opens options
		controller = await initPopupPage();
		const setupPanel = document.getElementById('popup-setup-panel') as HTMLElement;
		const setupBtn = document.getElementById('popup-setup-options-btn') as HTMLButtonElement;
		expect(setupPanel.hidden).toBe(false);
		setupBtn.click();
		expect(spies.openOptionsPageMock).toHaveBeenCalledTimes(1);
		controller.dispose();

		// Configure and test link handoff (title preview must remain hidden even with resource.title)
		mountPopupDom();
		await saveSettings({
			serverOrigin: 'https://izgah.example.com',
			apiKey: 'izk_valid',
			cachedUser: MEMBER_USER
		});
		await writeSessionMetaCache({
			serverOrigin: 'https://izgah.example.com',
			user: MEMBER_USER,
			sections: SAMPLE_SECTIONS
		});
		await writePendingShareContext({
			url: 'https://example.com/deep-link',
			title: null,
			source: 'link',
			createdAt: Date.now()
		});

		const linkFetchMock = vi.fn<typeof fetch>(async () => {
			return new Response(
				JSON.stringify({
					exists: true,
					canonicalUrl: 'https://example.com/deep-link',
					rawUrl: 'https://example.com/deep-link',
					suggestedContentType: 'article',
					resource: {
						id: 'res_1',
						title: 'Gizlenmesi Gereken Başlık',
						likeCount: 0,
						commentCount: 0
					},
					sharesSummary: {
						totalCount: 2,
						firstShare: {
							authorName: 'Ali Veli',
							createdAt: '2026-11-10T10:00:00.000Z',
							isFeedVisible: true,
							sectionNames: ['Web Standartları']
						}
					}
				}),
				{ status: 200 }
			);
		});

		controller = await initPopupPage({ fetchImpl: linkFetchMock });
		expect((document.getElementById('share-url') as HTMLInputElement).value).toBe(
			'https://example.com/deep-link'
		);
		expect((document.getElementById('share-source-badge') as HTMLElement).textContent).toBe(
			'Sağ tık: bağlantı'
		);
		expect((document.getElementById('share-title-preview') as HTMLElement).hidden).toBe(true);
		expect(
			(document.getElementById('duplicate-primary-text') as HTMLElement).textContent
		).toContain('Ali Veli');
		expect((document.getElementById('duplicate-meta-text') as HTMLElement).textContent).toContain(
			'Toplam 2 paylaşım'
		);
		controller.dispose();

		// Expired pending context in normal mode falls back to tabs.query and handles chrome:// URLs
		mountPopupDom();
		await writePendingShareContext({
			url: 'https://example.com/stale',
			title: 'Bayat',
			source: 'page',
			createdAt: Date.now() - PENDING_SHARE_TTL_MS - 500
		});
		spies.tabsQuerySpy.mockResolvedValueOnce([
			{ id: 2, url: 'chrome://extensions', title: 'Ayarlar' }
		] as never);

		const skipFetchMock = vi.fn<typeof fetch>();
		controller = await initPopupPage({ fetchImpl: skipFetchMock });

		expect((document.getElementById('share-url') as HTMLInputElement).value).toBe(
			'chrome://extensions'
		);
		expect((document.getElementById('share-url-notice') as HTMLElement).hidden).toBe(false);
		expect((document.getElementById('share-url-notice-text') as HTMLElement).textContent).toContain(
			'http:// veya https://'
		);
		expect(skipFetchMock).not.toHaveBeenCalled();
	});

	it('caches /me and /sections for 60s, shows silent-share duplicate info, and keeps contentType omitted in auto mode', async () => {
		await saveSettings({
			serverOrigin: 'https://izgah.example.com',
			apiKey: 'izk_member_key',
			cachedUser: null
		});
		spies.tabsQuerySpy.mockResolvedValue([
			{ id: 1, url: 'https://github.com/org/repo', title: 'Harika Repo' }
		] as never);

		const calls: string[] = [];
		const postedBodies: Array<Record<string, unknown>> = [];

		const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
			const url = String(input);
			calls.push(url);
			if (url.endsWith('/api/v1/me')) {
				return new Response(JSON.stringify({ user: MEMBER_USER }), { status: 200 });
			}
			if (url.endsWith('/api/v1/sections')) {
				return new Response(JSON.stringify({ sections: SAMPLE_SECTIONS }), { status: 200 });
			}
			if (url.includes('/api/v1/links/check')) {
				if (url.includes(encodeURIComponent('https://silent.example.com'))) {
					return new Response(
						JSON.stringify({
							exists: true,
							canonicalUrl: 'https://silent.example.com',
							rawUrl: 'https://silent.example.com',
							suggestedContentType: 'article',
							sharesSummary: {
								totalCount: 1,
								firstShare: {
									authorName: 'Deniz Yönetici',
									createdAt: '2026-11-12T12:00:00.000Z',
									isFeedVisible: false,
									sectionNames: ['Yapay Zeka']
								}
							}
						}),
						{ status: 200 }
					);
				}
				return new Response(
					JSON.stringify({
						exists: false,
						canonicalUrl: 'https://github.com/org/repo',
						rawUrl: 'https://github.com/org/repo',
						suggestedContentType: 'repo'
					}),
					{ status: 200 }
				);
			}
			if (url.endsWith('/api/v1/links') && init?.method === 'POST') {
				postedBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
				return new Response(
					JSON.stringify({
						share: {
							id: 'shr_new',
							resourceId: 'res_new',
							canonicalUrl: 'https://github.com/org/repo',
							rawUrl: 'https://github.com/org/repo',
							isFeedVisible: true,
							createdAt: '2026-11-20T00:00:00.000Z'
						},
						unfurlStatus: 'pending',
						duplicate: false
					}),
					{ status: 201 }
				);
			}
			return new Response(null, { status: 404 });
		});

		// First open: cold cache -> /me, /sections, /links/check
		controller = await initPopupPage({ fetchImpl: fetchMock });
		expect(calls.some((u) => u.endsWith('/api/v1/me'))).toBe(true);
		expect(calls.some((u) => u.endsWith('/api/v1/sections'))).toBe(true);
		expect((document.getElementById('admin-silent-row') as HTMLElement).hidden).toBe(true);
		expect(
			(document.getElementById('auto-content-type-option') as HTMLOptionElement).textContent
		).toBe('Otomatik algıla (Önerilen: Repo)');
		expect((document.getElementById('share-title-text') as HTMLElement).textContent).toBe(
			'Harika Repo'
		);

		// Submit in auto mode -> contentType omitted
		(document.getElementById('popup-submit-btn') as HTMLButtonElement).click();
		await vi.waitFor(() => {
			expect((document.getElementById('popup-success-panel') as HTMLElement).hidden).toBe(false);
		});
		expect(postedBodies[0]).toEqual({
			url: 'https://github.com/org/repo'
		});
		controller.dispose();

		// Second open within 60s: skips /me and /sections and calls only /links/check
		calls.length = 0;
		mountPopupDom();
		spies.tabsQuerySpy.mockResolvedValue([
			{ id: 1, url: 'https://silent.example.com', title: 'Sessiz Doküman' }
		] as never);

		controller = await initPopupPage({ fetchImpl: fetchMock });
		expect(calls).toEqual([
			'https://izgah.example.com/api/v1/links/check?url=https%3A%2F%2Fsilent.example.com'
		]);
		expect((document.getElementById('duplicate-meta-text') as HTMLElement).textContent).toContain(
			'Yapay Zeka'
		);
		expect((document.getElementById('duplicate-meta-text') as HTMLElement).textContent).toContain(
			'ana akışa da eklenir'
		);

		// Manual contentType override locks selected contentType into POST payload
		const typeSelect = document.getElementById('share-content-type') as HTMLSelectElement;
		typeSelect.value = 'video';
		typeSelect.dispatchEvent(new Event('change', { bubbles: true }));
		(document.getElementById('popup-submit-btn') as HTMLButtonElement).click();

		await vi.waitFor(() => {
			expect(postedBodies).toHaveLength(2);
		});
		expect(postedBodies[1]).toEqual({
			url: 'https://silent.example.com',
			contentType: 'video'
		});
	});

	it('shows optimistic admin UI, validates silent 0-section requirement, handles member downgrade, and sends isFeedVisible: false', async () => {
		await saveSettings({
			serverOrigin: 'https://izgah.example.com',
			apiKey: 'izk_admin_key',
			cachedUser: ADMIN_USER
		});
		await writeSessionMetaCache({
			serverOrigin: 'https://izgah.example.com',
			user: ADMIN_USER,
			sections: SAMPLE_SECTIONS
		});

		const postedBodies: Array<Record<string, unknown>> = [];
		const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
			const url = String(input);
			if (url.includes('/api/v1/links/check')) {
				return new Response(
					JSON.stringify({
						exists: false,
						canonicalUrl: 'https://example.com/tab',
						rawUrl: 'https://example.com/tab',
						suggestedContentType: 'web'
					}),
					{ status: 200 }
				);
			}
			if (url.endsWith('/api/v1/links') && init?.method === 'POST') {
				postedBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
				return new Response(
					JSON.stringify({
						share: {
							id: 'shr_silent',
							resourceId: 'res_silent',
							canonicalUrl: 'https://example.com/tab',
							rawUrl: 'https://example.com/tab',
							isFeedVisible: false,
							createdAt: '2026-11-20T00:00:00.000Z'
						},
						unfurlStatus: 'pending',
						duplicate: false
					}),
					{ status: 201 }
				);
			}
			return new Response(JSON.stringify({ user: MEMBER_USER }), { status: 200 });
		});

		const closeWindowSpy = vi.fn();
		controller = await initPopupPage({
			fetchImpl: fetchMock,
			closeWindow: closeWindowSpy
		});

		const silentCheckbox = document.getElementById('share-silent-mode') as HTMLInputElement;
		const adminSilentRow = document.getElementById('admin-silent-row') as HTMLElement;
		const sectionsFieldset = document.getElementById('sections-fieldset') as HTMLFieldSetElement;
		const sectionsError = document.getElementById('sections-error') as HTMLElement;
		const submitBtn = document.getElementById('popup-submit-btn') as HTMLButtonElement;

		expect(adminSilentRow.hidden).toBe(false);
		silentCheckbox.checked = true;
		silentCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
		expect((document.getElementById('sections-legend') as HTMLLegendElement).textContent).toContain(
			'en az bir bölüm zorunlu'
		);

		// 0 sections must block before POST and add fieldset error class
		submitBtn.click();
		await new Promise((r) => setTimeout(r, 0));
		expect(postedBodies).toHaveLength(0);
		expect(sectionsError.hidden).toBe(false);
		expect(sectionsFieldset.classList.contains('has-error-fallback')).toBe(true);

		// Check a section and submit silently
		const firstSectionCb = document.querySelector<HTMLInputElement>(
			'#sections-list input[type="checkbox"]'
		)!;
		firstSectionCb.checked = true;
		firstSectionCb.dispatchEvent(new Event('change', { bubbles: true }));
		expect(sectionsFieldset.classList.contains('has-error-fallback')).toBe(false);

		submitBtn.click();
		await vi.waitFor(() => {
			expect((document.getElementById('popup-success-panel') as HTMLElement).hidden).toBe(false);
		});

		expect(postedBodies[0]).toEqual({
			url: 'https://example.com/tab',
			sectionIds: ['sec_1'],
			isFeedVisible: false
		});
		expect(closeWindowSpy).not.toHaveBeenCalled();

		// Verify Yeni iz & Kapat controls
		(document.getElementById('popup-close-btn') as HTMLButtonElement).click();
		expect(closeWindowSpy).toHaveBeenCalledTimes(1);

		(document.getElementById('popup-new-share-btn') as HTMLButtonElement).click();
		expect((document.getElementById('popup-composer-panel') as HTMLElement).hidden).toBe(false);
		expect((document.getElementById('share-url') as HTMLInputElement).value).toBe('');
		controller.dispose();

		// Admin->member role downgrade on cold /me hides and unchecks silent checkbox
		mountPopupDom();
		await writeSessionMetaCache({
			serverOrigin: 'https://other.example.com',
			user: ADMIN_USER,
			sections: []
		});
		// Clear session cache for https://izgah.example.com so /me runs
		await browser.storage.session.clear();
		const downgradeFetch = vi.fn<typeof fetch>(async (input) => {
			const url = String(input);
			if (url.endsWith('/api/v1/me')) {
				return new Response(JSON.stringify({ user: MEMBER_USER }), { status: 200 });
			}
			if (url.endsWith('/api/v1/sections')) {
				return new Response(JSON.stringify({ sections: SAMPLE_SECTIONS }), { status: 200 });
			}
			return new Response(
				JSON.stringify({
					exists: false,
					canonicalUrl: 'https://example.com/tab',
					rawUrl: 'https://example.com/tab',
					suggestedContentType: 'web'
				}),
				{ status: 200 }
			);
		});

		controller = await initPopupPage({ fetchImpl: downgradeFetch });
		expect((document.getElementById('admin-silent-row') as HTMLElement).hidden).toBe(true);
		expect((document.getElementById('share-silent-mode') as HTMLInputElement).checked).toBe(false);
	});

	it('recovers from /sections failure via reload button, preserves drafts on 403/422/429/401, and guards IME Cmd/Ctrl+Enter', async () => {
		await saveSettings({
			serverOrigin: 'https://izgah.example.com',
			apiKey: 'izk_admin_key',
			cachedUser: ADMIN_USER
		});

		let failSections = true;
		let postResponseMode: '403' | '422' | '429' | '401' | '201' = '422';

		const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
			const url = String(input);
			if (url.endsWith('/api/v1/me')) {
				return new Response(
					JSON.stringify({
						user: postResponseMode === '403' ? MEMBER_USER : ADMIN_USER
					}),
					{ status: 200 }
				);
			}
			if (url.endsWith('/api/v1/sections')) {
				if (failSections) {
					return new Response(
						JSON.stringify({
							error: { code: 'INTERNAL_ERROR', message: 'DB error', requestId: 'req_sec' }
						}),
						{ status: 500 }
					);
				}
				return new Response(JSON.stringify({ sections: SAMPLE_SECTIONS }), { status: 200 });
			}
			if (url.includes('/api/v1/links/check')) {
				return new Response(
					JSON.stringify({
						exists: false,
						canonicalUrl: 'https://example.com/tab',
						rawUrl: 'https://example.com/tab',
						suggestedContentType: 'article'
					}),
					{ status: 200 }
				);
			}
			if (url.endsWith('/api/v1/links') && init?.method === 'POST') {
				if (postResponseMode === '422') {
					return new Response(
						JSON.stringify({
							error: {
								code: 'VALIDATION_ERROR',
								message: 'Geçersiz bölüm.',
								requestId: 'req_pop_422',
								details: { sectionIds: ['Seçilen bölüm artık mevcut değil.'] }
							}
						}),
						{ status: 422 }
					);
				}
				if (postResponseMode === '429') {
					return new Response(
						JSON.stringify({
							error: { code: 'RATE_LIMITED', message: 'Limit', requestId: 'req_pop_429' }
						}),
						{ status: 429, headers: { 'Retry-After': '15' } }
					);
				}
				if (postResponseMode === '403') {
					return new Response(
						JSON.stringify({
							error: { code: 'FORBIDDEN', message: 'Admin required', requestId: 'req_pop_403' }
						}),
						{ status: 403 }
					);
				}
				if (postResponseMode === '401') {
					return new Response(
						JSON.stringify({
							error: { code: 'UNAUTHORIZED', message: 'Revoked', requestId: 'req_pop_401' }
						}),
						{ status: 401 }
					);
				}
				return new Response(
					JSON.stringify({
						share: {
							id: 'shr_ime',
							resourceId: 'res_ime',
							canonicalUrl: 'https://example.com/tab',
							rawUrl: 'https://example.com/tab',
							isFeedVisible: true,
							createdAt: '2026-11-20T00:00:00.000Z'
						},
						unfurlStatus: 'pending',
						duplicate: false
					}),
					{ status: 201 }
				);
			}
			return new Response(null, { status: 404 });
		});

		controller = await initPopupPage({ fetchImpl: fetchMock });

		// Sections failed initially -> retry control visible while share button remains usable
		const loadErr = document.getElementById('sections-load-error') as HTMLElement;
		const reloadBtn = document.getElementById('reload-sections-btn') as HTMLButtonElement;
		expect(loadErr.hidden).toBe(false);

		failSections = false;
		reloadBtn.click();
		await vi.waitFor(() => {
			expect(loadErr.hidden).toBe(true);
			expect(document.querySelectorAll('#sections-list input[type="checkbox"]')).toHaveLength(2);
		});

		// Type draft note and select section
		const noteInput = document.getElementById('share-note') as HTMLTextAreaElement;
		noteInput.value = 'Taslak notum';
		noteInput.dispatchEvent(new Event('input', { bubbles: true }));
		expect((document.getElementById('share-note-counter') as HTMLElement).textContent).toBe(
			'12 / 1000'
		);

		const cb1 = document.querySelector<HTMLInputElement>('#sections-list input[type="checkbox"]')!;
		cb1.checked = true;
		cb1.dispatchEvent(new Event('change', { bubbles: true }));

		// Populate session cache so 422 sectionIds invalidation can be verified
		await writeSessionMetaCache({
			serverOrigin: 'https://izgah.example.com',
			user: ADMIN_USER,
			sections: SAMPLE_SECTIONS
		});

		// 422 sectionIds error preserves draft and invalidates session cache
		postResponseMode = '422';
		(document.getElementById('popup-submit-btn') as HTMLButtonElement).click();
		await vi.waitFor(() => {
			expect((document.getElementById('popup-request-id') as HTMLElement).textContent).toBe(
				'req_pop_422'
			);
		});
		expect((document.getElementById('sections-error') as HTMLElement).textContent).toContain(
			'artık mevcut değil'
		);
		expect(noteInput.value).toBe('Taslak notum');
		expect(cb1.checked).toBe(true);
		expect(await readSessionMetaCache('https://izgah.example.com')).toBeNull();

		// 429 error shows Retry-After wait seconds and preserves draft
		postResponseMode = '429';
		(document.getElementById('popup-submit-btn') as HTMLButtonElement).click();
		await vi.waitFor(() => {
			expect((document.getElementById('popup-request-id') as HTMLElement).textContent).toBe(
				'req_pop_429'
			);
		});
		expect((document.getElementById('popup-error-message') as HTMLElement).textContent).toContain(
			'15 saniye'
		);
		expect(noteInput.value).toBe('Taslak notum');

		// 403 error invalidates session cache and refreshes user role -> hides admin checkbox
		postResponseMode = '403';
		(document.getElementById('popup-submit-btn') as HTMLButtonElement).click();
		await vi.waitFor(() => {
			expect((document.getElementById('popup-request-id') as HTMLElement).textContent).toBe(
				'req_pop_403'
			);
			expect((document.getElementById('admin-silent-row') as HTMLElement).hidden).toBe(true);
		});

		// 401 shows Ayarları aç button inside error banner and clears cachedUser
		postResponseMode = '401';
		(document.getElementById('popup-submit-btn') as HTMLButtonElement).click();
		await vi.waitFor(() => {
			expect((document.getElementById('popup-auth-action-row') as HTMLElement).hidden).toBe(false);
		});
		expect((await loadSettings())?.cachedUser).toBeNull();
		expect((document.getElementById('popup-request-id') as HTMLElement).textContent).toBe(
			'req_pop_401'
		);

		// IME composition blocks Cmd+Enter; clean Cmd+Enter submits -> 201 Created
		postResponseMode = '201';
		const composingEvent = new KeyboardEvent('keydown', {
			key: 'Enter',
			metaKey: true,
			isComposing: true,
			bubbles: true,
			cancelable: true
		});
		noteInput.dispatchEvent(composingEvent);
		await new Promise((r) => setTimeout(r, 0));
		expect((document.getElementById('popup-success-panel') as HTMLElement).hidden).toBe(true);

		const cleanShortcut = new KeyboardEvent('keydown', {
			key: 'Enter',
			ctrlKey: true,
			isComposing: false,
			bubbles: true,
			cancelable: true
		});
		noteInput.dispatchEvent(cleanShortcut);
		await vi.waitFor(() => {
			expect((document.getElementById('popup-success-panel') as HTMLElement).hidden).toBe(false);
		});
		expect((document.getElementById('popup-success-heading') as HTMLElement).textContent).toBe(
			'İz bırakıldı'
		);
	});

	it('debounces manual URL edits by 300ms, aborts in-flight checkLink without showing errors, and switches to edited URL', async () => {
		vi.useFakeTimers();
		await saveSettings({
			serverOrigin: 'https://izgah.example.com',
			apiKey: 'izk_debounce',
			cachedUser: MEMBER_USER
		});
		await writeSessionMetaCache({
			serverOrigin: 'https://izgah.example.com',
			user: MEMBER_USER,
			sections: SAMPLE_SECTIONS
		});

		const signals: AbortSignal[] = [];
		const checkedUrls: string[] = [];

		const fetchMock = vi.fn<typeof fetch>((input, init) => {
			const url = String(input);
			checkedUrls.push(url);
			if (init?.signal) {
				signals.push(init.signal);
			}
			if (url.includes(encodeURIComponent('https://example.com/slow-first'))) {
				return new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener('abort', () => {
						const err = new Error('Aborted');
						err.name = 'AbortError';
						reject(err);
					});
				});
			}
			return Promise.resolve(
				new Response(
					JSON.stringify({
						exists: false,
						canonicalUrl: 'https://example.com/second',
						rawUrl: 'https://example.com/second',
						suggestedContentType: 'article'
					}),
					{ status: 200 }
				)
			);
		});

		spies.tabsQuerySpy.mockResolvedValueOnce([
			{ id: 1, url: 'https://example.com/tab', title: 'İlk Sekme' }
		] as never);

		controller = await initPopupPage({ fetchImpl: fetchMock });

		const urlInput = document.getElementById('share-url') as HTMLInputElement;

		// Edit 1 -> after 300ms starts slow check
		urlInput.value = 'https://example.com/slow-first';
		urlInput.dispatchEvent(new Event('input', { bubbles: true }));
		expect(checkedUrls).toHaveLength(1);
		await vi.advanceTimersByTimeAsync(300);
		expect(checkedUrls).toHaveLength(2);
		expect(signals[1]?.aborted).toBe(false);

		// Edit 2 cancels slow check synchronously via AbortController
		urlInput.value = 'https://example.com/second';
		urlInput.dispatchEvent(new Event('input', { bubbles: true }));
		expect(signals[1]?.aborted).toBe(true);

		await vi.advanceTimersByTimeAsync(300);
		expect(checkedUrls).toHaveLength(3);
		expect(checkedUrls[2]).toContain(encodeURIComponent('https://example.com/second'));
		expect((document.getElementById('popup-error-banner') as HTMLElement).hidden).toBe(true);
		expect(
			(document.getElementById('auto-content-type-option') as HTMLOptionElement).textContent
		).toBe('Otomatik algıla (Önerilen: Makale)');
	});
});
