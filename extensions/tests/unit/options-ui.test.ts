import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { createImeTracker, isImeSafeSubmitShortcut } from '../../src/lib/dom-a11y';
import {
	loadSettings,
	PENDING_SHARE_STORAGE_KEY,
	readSessionMetaCache,
	saveSettings,
	writeSessionMetaCache
} from '../../src/lib/storage';
import { DEFAULT_IZGAH_ORIGIN } from '../../src/lib/types';
import { initOptionsPage, type OptionsPageController } from '../../src/entrypoints/options/main';

const OPTIONS_HTML = readFileSync(
	resolve(process.cwd(), 'src/entrypoints/options/index.html'),
	'utf8'
);

const RAW_BODY_HTML = OPTIONS_HTML.match(/<body>([\s\S]*?)<\/body>/i)?.[1]?.replace(
	/<script[\s\S]*?<\/script>/gi,
	''
);

if (!RAW_BODY_HTML) {
	throw new Error('Could not extract body markup from options/index.html');
}

const BODY_HTML: string = RAW_BODY_HTML;

function mountOptionsDom() {
	document.documentElement.setAttribute('data-manual-init', 'true');
	document.body.innerHTML = BODY_HTML;
}

describe('options UI (CUJ 1) and accessibility primitives', () => {
	let controller: OptionsPageController | null = null;

	beforeEach(() => {
		fakeBrowser.reset();
		mountOptionsDom();
	});

	afterEach(() => {
		controller?.dispose();
		controller = null;
		vi.useRealTimers();
		vi.restoreAllMocks();
		delete (window as unknown as Record<string, unknown>).CommandEvent;
	});

	it('renders initial state with aria-invalid="false", pre-filled default origin, and dynamic /settings/api-keys link', async () => {
		controller = await initOptionsPage();

		const originInput = document.getElementById('server-origin') as HTMLInputElement;
		const apiKeyInput = document.getElementById('api-key') as HTMLInputElement;
		const originError = document.getElementById('server-origin-error') as HTMLElement;
		const apiKeyError = document.getElementById('api-key-error') as HTMLElement;
		const apiKeysLink = document.getElementById('api-keys-link') as HTMLAnchorElement;
		const corsNote = document.getElementById('options-cors-note') as HTMLElement;

		expect(originInput.value).toBe(DEFAULT_IZGAH_ORIGIN);
		expect(originInput.placeholder).toBe(DEFAULT_IZGAH_ORIGIN);
		expect(originInput.getAttribute('aria-invalid')).toBe('false');
		expect(originInput.getAttribute('aria-describedby')).toBe('server-origin-hint');
		expect(originError.hidden).toBe(true);

		expect(apiKeyInput.value).toBe('');
		expect(apiKeyInput.type).toBe('password');
		expect(apiKeyInput.getAttribute('autocomplete')).toBe('off');
		expect(apiKeyInput.getAttribute('aria-invalid')).toBe('false');
		expect(apiKeyInput.getAttribute('aria-describedby')).toBe('api-key-hint');
		expect(apiKeyError.hidden).toBe(true);

		expect(apiKeysLink.href).toBe(`${DEFAULT_IZGAH_ORIGIN}/settings/api-keys`);
		expect(corsNote.hidden).toBe(true);
	});

	it('validates fields only after interaction, clears fixed errors on input, and routes focus on invalid submit', async () => {
		const fetchMock = vi.fn<typeof fetch>();
		controller = await initOptionsPage({ fetchImpl: fetchMock });

		const originInput = document.getElementById('server-origin') as HTMLInputElement;
		const apiKeyInput = document.getElementById('api-key') as HTMLInputElement;
		const originError = document.getElementById('server-origin-error') as HTMLElement;
		const saveBtn = document.getElementById('save-settings-btn') as HTMLButtonElement;

		// Blurring untouched inputs must NOT expose validation errors
		originInput.focus();
		originInput.blur();
		expect(originInput.getAttribute('aria-invalid')).toBe('false');
		expect(originError.hidden).toBe(true);

		// Editing an invalid remote HTTP URL and blurring activates invalid state
		originInput.focus();
		originInput.value = 'http://remote.example.com';
		originInput.dispatchEvent(new Event('input', { bubbles: true }));
		originInput.blur();

		expect(originInput.getAttribute('aria-invalid')).toBe('true');
		expect(originInput.classList.contains('user-invalid-fallback')).toBe(true);
		expect(originInput.getAttribute('aria-describedby')).toContain('server-origin-error');
		expect(originError.hidden).toBe(false);
		expect(originError.textContent).toContain('https://');

		// Fixing the URL clears invalid state immediately on input
		originInput.value = 'https://izgah.team';
		originInput.dispatchEvent(new Event('input', { bubbles: true }));
		expect(originInput.getAttribute('aria-invalid')).toBe('false');
		expect(originError.hidden).toBe(true);
		expect((document.getElementById('api-keys-link') as HTMLAnchorElement).href).toBe(
			'https://izgah.team/settings/api-keys'
		);

		// Submitting while API key is invalid must NOT hit network and must focus #api-key
		apiKeyInput.value = 'bad_token';
		saveBtn.click();
		await new Promise((r) => setTimeout(r, 0));

		expect(fetchMock).not.toHaveBeenCalled();
		expect(apiKeyInput.getAttribute('aria-invalid')).toBe('true');
		expect(document.activeElement).toBe(apiKeyInput);
	});

	it('toggles password visibility via accessible Göster/Gizle button with aria-pressed', async () => {
		controller = await initOptionsPage();

		const apiKeyInput = document.getElementById('api-key') as HTMLInputElement;
		const toggleBtn = document.getElementById('toggle-api-key-btn') as HTMLButtonElement;

		expect(apiKeyInput.type).toBe('password');
		expect(toggleBtn.getAttribute('aria-pressed')).toBe('false');
		expect(toggleBtn.textContent?.trim()).toBe('Göster');

		toggleBtn.click();
		expect(apiKeyInput.type).toBe('text');
		expect(toggleBtn.getAttribute('aria-pressed')).toBe('true');
		expect(toggleBtn.textContent?.trim()).toBe('Gizle');

		toggleBtn.click();
		expect(apiKeyInput.type).toBe('password');
		expect(toggleBtn.getAttribute('aria-pressed')).toBe('false');
		expect(toggleBtn.textContent?.trim()).toBe('Göster');
	});

	it('tests connection via GET /api/v1/me without modifying storage.local', async () => {
		const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
			expect(input).toBe('https://izgah.example.com/api/v1/me');
			const headers = init?.headers as Headers;
			expect(headers.get('Authorization')).toBe('Bearer izk_test_member');
			expect(headers.get('X-Client-Name')).toBe('izgah-firefox-extension');
			expect(headers.get('X-Client-Version')).toBe('0.1.0');
			return new Response(
				JSON.stringify({
					user: {
						id: 'u_member',
						name: 'Ada Demir',
						email: 'ada@izgah.example.com',
						role: 'member'
					}
				}),
				{ status: 200 }
			);
		});

		controller = await initOptionsPage({
			fetchImpl: fetchMock,
			browserTarget: 'firefox',
			clientVersion: '0.1.0'
		});

		const originInput = document.getElementById('server-origin') as HTMLInputElement;
		const apiKeyInput = document.getElementById('api-key') as HTMLInputElement;
		const testBtn = document.getElementById('test-connection-btn') as HTMLButtonElement;
		const userSummary = document.getElementById('options-user-summary') as HTMLElement;

		originInput.value = 'https://izgah.example.com/sections';
		originInput.dispatchEvent(new Event('input', { bubbles: true }));
		apiKeyInput.value = 'izk_test_member';
		testBtn.click();

		await vi.waitFor(() => {
			expect(userSummary.hidden).toBe(false);
		});

		expect(userSummary.textContent).toContain('Ada Demir');
		expect(userSummary.textContent).toContain('ada@izgah.example.com');
		expect(userSummary.textContent).toContain('Üye');
		expect(await loadSettings()).toBeNull();
	});

	it('normalizes origin, saves verified settings to storage.local, clears session cache, and shows CORS note', async () => {
		await writeSessionMetaCache({
			serverOrigin: DEFAULT_IZGAH_ORIGIN,
			user: { id: 'old', name: 'Eski', email: 'eski@example.com', role: 'member' },
			sections: []
		});

		const fetchMock = vi.fn<typeof fetch>(async (input) => {
			expect(input).toBe('https://izgah.team/api/v1/me');
			return new Response(
				JSON.stringify({
					user: {
						id: 'u_admin',
						name: 'Kemal Ak',
						email: 'kemal@izgah.team',
						role: 'admin'
					}
				}),
				{ status: 200 }
			);
		});

		controller = await initOptionsPage({ fetchImpl: fetchMock, browserTarget: 'chrome' });

		const originInput = document.getElementById('server-origin') as HTMLInputElement;
		const apiKeyInput = document.getElementById('api-key') as HTMLInputElement;
		const saveBtn = document.getElementById('save-settings-btn') as HTMLButtonElement;
		const corsNote = document.getElementById('options-cors-note') as HTMLElement;
		const userSummary = document.getElementById('options-user-summary') as HTMLElement;

		originInput.value = 'https://izgah.team/feed?q=rust#top';
		originInput.dispatchEvent(new Event('input', { bubbles: true }));
		apiKeyInput.value = 'izk_admin_token';
		saveBtn.click();

		await vi.waitFor(async () => {
			const saved = await loadSettings();
			expect(saved?.apiKey).toBe('izk_admin_token');
		});

		expect(originInput.value).toBe('https://izgah.team');
		expect(corsNote.hidden).toBe(false);
		expect(userSummary.textContent).toContain('Yönetici');
		expect(await readSessionMetaCache(DEFAULT_IZGAH_ORIGIN)).toBeNull();
		expect(await loadSettings()).toEqual({
			serverOrigin: 'https://izgah.team',
			apiKey: 'izk_admin_token',
			cachedUser: {
				id: 'u_admin',
				name: 'Kemal Ak',
				email: 'kemal@izgah.team',
				role: 'admin'
			}
		});
	});

	it('hydrates stored settings on reopen and clears both storage.local and storage.session on delete', async () => {
		await saveSettings({
			serverOrigin: 'https://izgah.example.com',
			apiKey: 'izk_stored_123',
			cachedUser: {
				id: 'u_1',
				name: 'Ece Kaya',
				email: 'ece@izgah.example.com',
				role: 'admin'
			}
		});
		await writeSessionMetaCache({
			serverOrigin: 'https://izgah.example.com',
			user: {
				id: 'u_1',
				name: 'Ece Kaya',
				email: 'ece@izgah.example.com',
				role: 'admin'
			},
			sections: []
		});

		controller = await initOptionsPage();

		const originInput = document.getElementById('server-origin') as HTMLInputElement;
		const apiKeyInput = document.getElementById('api-key') as HTMLInputElement;
		const userSummary = document.getElementById('options-user-summary') as HTMLElement;
		const clearBtn = document.getElementById('clear-settings-btn') as HTMLButtonElement;

		expect(originInput.value).toBe('https://izgah.example.com');
		expect(apiKeyInput.value).toBe('izk_stored_123');
		expect(userSummary.hidden).toBe(false);
		expect(userSummary.textContent).toContain('Ece Kaya');

		// Put unrelated pending key check cleanly via direct check on session meta removal
		expect(await readSessionMetaCache('https://izgah.example.com')).not.toBeNull();

		clearBtn.click();
		await vi.waitFor(async () => {
			expect(await loadSettings()).toBeNull();
			expect(apiKeyInput.value).toBe('');
			expect(userSummary.hidden).toBe(true);
		});

		expect(await readSessionMetaCache('https://izgah.example.com')).toBeNull();
		expect(originInput.value).toBe(DEFAULT_IZGAH_ORIGIN);
		expect(apiKeyInput.value).toBe('');
		expect(userSummary.hidden).toBe(true);
		const pendingState = await browser.storage.session.get(PENDING_SHARE_STORAGE_KEY);
		expect(pendingState[PENDING_SHARE_STORAGE_KEY]).toBeUndefined();
	});

	it('displays Turkish 401, 404, 429, and network errors and wires requestId copy with Clipboard failure handling', async () => {
		let nextMode: '401' | '404' | '429' | 'network' = '401';
		const fetchMock = vi.fn<typeof fetch>(async () => {
			if (nextMode === 'network') {
				throw new TypeError('Failed to fetch');
			}
			if (nextMode === '401') {
				return new Response(
					JSON.stringify({
						error: { code: 'UNAUTHORIZED', message: 'Invalid', requestId: 'req_opt_401' }
					}),
					{ status: 401 }
				);
			}
			if (nextMode === '404') {
				return new Response(
					JSON.stringify({
						error: { code: 'NOT_FOUND', message: 'Missing', requestId: 'req_opt_404' }
					}),
					{ status: 404 }
				);
			}
			return new Response(
				JSON.stringify({
					error: { code: 'RATE_LIMITED', message: 'Slow', requestId: 'req_opt_429' }
				}),
				{ status: 429, headers: { 'Retry-After': '9' } }
			);
		});

		const writeTextMock = vi.fn(async (_text: string) => {});
		Object.defineProperty(globalThis.navigator, 'clipboard', {
			configurable: true,
			value: { writeText: writeTextMock }
		});

		controller = await initOptionsPage({ fetchImpl: fetchMock });

		const apiKeyInput = document.getElementById('api-key') as HTMLInputElement;
		const testBtn = document.getElementById('test-connection-btn') as HTMLButtonElement;
		const errorBanner = document.getElementById('options-error-banner') as HTMLElement;
		const errorMsg = document.getElementById('options-error-message') as HTMLElement;
		const requestIdRow = document.getElementById('options-request-id-row') as HTMLElement;
		const requestIdCode = document.getElementById('options-request-id') as HTMLElement;
		const copyBtn = document.getElementById('options-copy-btn') as HTMLButtonElement;
		const copyFeedback = document.getElementById('options-copy-feedback') as HTMLElement;

		apiKeyInput.value = 'izk_revoked';

		// 401
		nextMode = '401';
		testBtn.click();
		await vi.waitFor(() => {
			expect(errorBanner.hidden).toBe(false);
		});
		expect(errorMsg.textContent).toContain('/settings/api-keys');
		expect(requestIdRow.hidden).toBe(false);
		expect(requestIdCode.textContent).toBe('req_opt_401');

		// 404
		nextMode = '404';
		testBtn.click();
		await vi.waitFor(() => {
			expect(requestIdCode.textContent).toBe('req_opt_404');
		});
		expect(errorMsg.textContent).toContain('API uç noktası bulunamadı');

		// 429 + copy fallback (jsdom has no CommandEvent)
		nextMode = '429';
		testBtn.click();
		await vi.waitFor(() => {
			expect(requestIdCode.textContent).toBe('req_opt_429');
		});
		expect(errorMsg.textContent).toContain('9 saniye');

		copyBtn.click();
		await vi.waitFor(() => {
			expect(writeTextMock).toHaveBeenCalledWith('req_opt_429');
			expect(copyFeedback.classList.contains('is-visible')).toBe(true);
		});
		expect(copyFeedback.textContent).toBe('Kopyalandı');
		expect(copyBtn.disabled).toBe(false);

		// Consecutive copy alternates NBSP for VoiceOver announcement
		copyBtn.click();
		await vi.waitFor(() => {
			expect(copyFeedback.textContent).toBe('Kopyalandı\u00A0');
		});

		// Clipboard denial shows failure text cleanly
		writeTextMock.mockRejectedValueOnce(new DOMException('Denied', 'NotAllowedError'));
		copyBtn.click();
		await vi.waitFor(() => {
			expect(copyBtn.hasAttribute('data-failed')).toBe(true);
		});
		expect(copyFeedback.textContent).toContain('Kopyalanamadı');

		// Network error hides requestId row
		nextMode = 'network';
		testBtn.click();
		await vi.waitFor(() => {
			expect(errorBanner.hidden).toBe(false);
		});
		expect(requestIdRow.hidden).toBe(true);
		expect(errorMsg.textContent).toContain('sunucusuna bağlanılamadı');
	});

	it('wires Invoker Commands capture-phase listener when CommandEvent is supported without duplicate click handler', async () => {
		(window as unknown as Record<string, unknown>).CommandEvent = class FakeCommandEvent extends (
			Event
		) {};
		mountOptionsDom();

		const fetchMock = vi.fn<typeof fetch>(async () => {
			return new Response(
				JSON.stringify({
					error: { code: 'UNAUTHORIZED', message: 'Invalid', requestId: 'req_cmd_1' }
				}),
				{ status: 401 }
			);
		});

		const writeTextMock = vi.fn(async (_text: string) => {});
		Object.defineProperty(globalThis.navigator, 'clipboard', {
			configurable: true,
			value: { writeText: writeTextMock }
		});

		controller = await initOptionsPage({ fetchImpl: fetchMock });

		const apiKeyInput = document.getElementById('api-key') as HTMLInputElement;
		const testBtn = document.getElementById('test-connection-btn') as HTMLButtonElement;
		const requestIdCode = document.getElementById('options-request-id') as HTMLElement;
		const copyBtn = document.getElementById('options-copy-btn') as HTMLButtonElement;

		apiKeyInput.value = 'izk_revoked';
		testBtn.click();
		await vi.waitFor(() => {
			expect(requestIdCode.textContent).toBe('req_cmd_1');
		});

		// Native click fallback must NOT be registered when CommandEvent is present
		copyBtn.click();
		expect(writeTextMock).not.toHaveBeenCalled();

		// Dispatch capture-phase command event directly on target element
		const cmdEvent = Object.assign(new Event('command', { bubbles: false }), {
			command: '--copy',
			source: copyBtn
		});
		requestIdCode.dispatchEvent(cmdEvent);

		await vi.waitFor(() => {
			expect(writeTextMock).toHaveBeenCalledTimes(1);
			expect(writeTextMock).toHaveBeenCalledWith('req_cmd_1');
		});
	});

	it('blocks Cmd/Ctrl+Enter submit during IME composition and Safari 50ms post-compositionend window', () => {
		const tracker = createImeTracker();
		tracker.onCompositionEnd({ timeStamp: 1000 } as CompositionEvent);

		expect(
			isImeSafeSubmitShortcut(
				{
					key: 'Enter',
					metaKey: true,
					ctrlKey: false,
					altKey: false,
					shiftKey: false,
					isComposing: true,
					keyCode: 13,
					timeStamp: 1200
				} as KeyboardEvent,
				tracker
			)
		).toBe(false);

		expect(
			isImeSafeSubmitShortcut(
				{
					key: 'Enter',
					metaKey: false,
					ctrlKey: true,
					altKey: false,
					shiftKey: false,
					isComposing: false,
					keyCode: 229,
					timeStamp: 1200
				} as KeyboardEvent,
				tracker
			)
		).toBe(false);

		// Within 50ms window around compositionend (handles Safari inverted timestamps too)
		expect(
			isImeSafeSubmitShortcut(
				{
					key: 'Enter',
					metaKey: true,
					ctrlKey: false,
					altKey: false,
					shiftKey: false,
					isComposing: false,
					keyCode: 13,
					timeStamp: 1030
				} as KeyboardEvent,
				tracker
			)
		).toBe(false);

		expect(
			isImeSafeSubmitShortcut(
				{
					key: 'Enter',
					metaKey: true,
					ctrlKey: false,
					altKey: false,
					shiftKey: false,
					isComposing: false,
					keyCode: 13,
					timeStamp: 1050
				} as KeyboardEvent,
				tracker
			)
		).toBe(true);
	});
});
