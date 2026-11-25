import { browser } from 'wxt/browser';
import { createIzgahApiClient } from '../../lib/api-client';
import { wireRequestIdCopy } from '../../lib/copy-request-id';
import {
	bindPostInteractionValidation,
	createPoliteAnnouncer,
	setTextErrorBanner
} from '../../lib/dom-a11y';
import { IzgahApiError } from '../../lib/errors';
import {
	clearSessionMetaCache,
	clearSettings,
	loadSettings,
	saveSettings
} from '../../lib/storage';
import {
	DEFAULT_IZGAH_ORIGIN,
	type BrowserTarget,
	type CachedUserProfile,
	type UserRole
} from '../../lib/types';
import { normalizeServerOrigin } from '../../lib/url';
import { localizeDocument, msg } from '../../lib/i18n';

export interface InitOptionsPageDeps {
	root?: Document;
	fetchImpl?: typeof fetch;
	browserTarget?: BrowserTarget;
	clientVersion?: string;
}

export interface OptionsPageController {
	dispose(): void;
}

function resolveRuntimeClientMeta(): {
	browserTarget: BrowserTarget;
	clientVersion: string;
} {
	const rawBrowser = import.meta.env?.BROWSER;
	const browserTarget: BrowserTarget =
		rawBrowser === 'firefox' || rawBrowser === 'safari' || rawBrowser === 'chrome'
			? rawBrowser
			: 'chrome';
	let manifestVersion: string | undefined;
	try {
		manifestVersion = browser.runtime?.getManifest?.()?.version;
	} catch {
		manifestVersion = undefined;
	}
	return {
		browserTarget,
		clientVersion:
			typeof manifestVersion === 'string' && manifestVersion.trim() !== ''
				? manifestVersion
				: '0.1.0'
	};
}

function formatRoleLabel(role: UserRole): string {
	return role === 'admin' ? msg('roleAdmin') : msg('roleMember');
}

function validateApiKeyInput(rawKey: string): string | null {
	const trimmed = rawKey.trim();
	if (trimmed === '') {
		return msg('apiKeyEmpty');
	}
	if (!trimmed.startsWith('izk_') || trimmed.length <= 4) {
		return msg('apiKeyInvalid');
	}
	return null;
}

function queryRequiredElement<T extends Element>(root: Document, selector: string): T {
	const el = root.querySelector<T>(selector);
	if (!el) {
		throw new Error(`Required options DOM element not found: ${selector}`);
	}
	return el;
}

/**
 * Initializes the extension options page UI, local storage hydration, and /api/v1/me verification.
 */
export async function initOptionsPage(
	deps: InitOptionsPageDeps = {}
): Promise<OptionsPageController> {
	const doc = deps.root ?? document;
	localizeDocument(doc);
	const runtimeMeta = resolveRuntimeClientMeta();
	const browserTarget = deps.browserTarget ?? runtimeMeta.browserTarget;
	const clientVersion = deps.clientVersion ?? runtimeMeta.clientVersion;
	const fetchImpl = deps.fetchImpl ?? globalThis.fetch;

	const form = queryRequiredElement<HTMLFormElement>(doc, '#options-form');
	const serverOriginInput = queryRequiredElement<HTMLInputElement>(doc, '#server-origin');
	const apiKeyInput = queryRequiredElement<HTMLInputElement>(doc, '#api-key');
	const toggleApiKeyBtn = queryRequiredElement<HTMLButtonElement>(doc, '#toggle-api-key-btn');
	const apiKeysLink = queryRequiredElement<HTMLAnchorElement>(doc, '#api-keys-link');
	const testBtn = queryRequiredElement<HTMLButtonElement>(doc, '#test-connection-btn');
	const saveBtn = queryRequiredElement<HTMLButtonElement>(doc, '#save-settings-btn');
	const clearBtn = queryRequiredElement<HTMLButtonElement>(doc, '#clear-settings-btn');
	const statusCardEl = queryRequiredElement<HTMLElement>(doc, '#options-status-card');
	const statusTextEl = queryRequiredElement<HTMLElement>(doc, '#options-status-text');
	const userSummaryEl = queryRequiredElement<HTMLElement>(doc, '#options-user-summary');
	const corsNoteEl = queryRequiredElement<HTMLElement>(doc, '#options-cors-note');
	const errorBannerEl = queryRequiredElement<HTMLElement>(doc, '#options-error-banner');
	const errorMessageEl = queryRequiredElement<HTMLElement>(doc, '#options-error-message');
	const requestIdRowEl = queryRequiredElement<HTMLElement>(doc, '#options-request-id-row');
	const requestIdCodeEl = queryRequiredElement<HTMLElement>(doc, '#options-request-id');
	const liveRegionEl = queryRequiredElement<HTMLElement>(doc, '#options-live-region');

	serverOriginInput.placeholder = DEFAULT_IZGAH_ORIGIN || 'https://links.example.com';

	const announcer = createPoliteAnnouncer(liveRegionEl);
	const disposeCopy = wireRequestIdCopy(errorBannerEl);
	const validator = bindPostInteractionValidation(
		[
			{
				control: serverOriginInput,
				validate() {
					const result = normalizeServerOrigin(serverOriginInput.value);
					return result.ok ? null : result.message;
				}
			},
			{
				control: apiKeyInput,
				validate() {
					return validateApiKeyInput(apiKeyInput.value);
				}
			}
		],
		announcer
	);

	function renderStatusCard(
		variant: 'info' | 'success' | 'warn',
		statusText: string,
		user: CachedUserProfile | null
	) {
		statusCardEl.className = `banner banner-${variant} status-card`;
		statusTextEl.textContent = statusText;
		if (user) {
			userSummaryEl.textContent = msg(
				'roleSummary',
				user.name,
				user.email,
				formatRoleLabel(user.role)
			);
			userSummaryEl.hidden = false;
		} else {
			userSummaryEl.textContent = '';
			userSummaryEl.hidden = true;
		}
	}

	function updateOriginDerivedUi() {
		const normalized = normalizeServerOrigin(serverOriginInput.value);
		const targetOrigin = normalized.ok ? normalized.value : DEFAULT_IZGAH_ORIGIN;
		// Store builds have no built-in address: hide the link until a valid address is typed.
		apiKeysLink.hidden = targetOrigin === '';
		apiKeysLink.href = targetOrigin ? `${targetOrigin}/settings/api-keys` : '#';
		corsNoteEl.hidden = !(
			DEFAULT_IZGAH_ORIGIN !== '' &&
			normalized.ok &&
			normalized.value !== DEFAULT_IZGAH_ORIGIN
		);
	}

	function setBusy(busy: boolean) {
		testBtn.disabled = busy;
		saveBtn.disabled = busy;
		clearBtn.disabled = busy;
	}

	function setBannerError(error: { message: string; requestId?: string | null } | null) {
		setTextErrorBanner(
			{
				bannerEl: errorBannerEl,
				messageEl: errorMessageEl,
				requestIdRowEl,
				requestIdCodeEl
			},
			error
		);
	}

	function handleApiFailure(error: unknown) {
		if (error instanceof IzgahApiError) {
			const { mapped } = error;
			setBannerError({
				message: mapped.userMessage,
				requestId: mapped.requestId
			});
			const urlError = mapped.fieldErrors.url?.[0];
			if (urlError) {
				validator.setServerFieldError(serverOriginInput, urlError);
			}
			announcer.announce(mapped.userMessage);
			return;
		}

		const fallbackMsg = msg('unexpectedOptions');
		setBannerError({ message: fallbackMsg, requestId: null });
		announcer.announce(fallbackMsg);
	}

	async function verifyWithServer(mode: 'test' | 'save') {
		setBannerError(null);
		if (!validator.validateAllAndFocusFirst()) {
			announcer.announce(msg('fixFormErrors'));
			return;
		}

		const originResult = normalizeServerOrigin(serverOriginInput.value);
		if (!originResult.ok) {
			return;
		}
		const normalizedOrigin = originResult.value;
		const trimmedKey = apiKeyInput.value.trim();

		if (mode === 'save') {
			serverOriginInput.value = normalizedOrigin;
			updateOriginDerivedUi();
		}

		setBusy(true);
		try {
			const client = createIzgahApiClient({
				serverOrigin: normalizedOrigin,
				apiKey: trimmedKey,
				browserTarget,
				clientVersion,
				fetchImpl
			});
			const me = await client.getMe();

			if (mode === 'save') {
				await saveSettings({
					serverOrigin: normalizedOrigin,
					apiKey: trimmedKey,
					cachedUser: me.user
				});
				await clearSessionMetaCache();
				renderStatusCard('success', msg('savedAndVerified'), me.user);
				announcer.announce(msg('savedAndVerified'));
			} else {
				renderStatusCard('success', msg('verifiedNotSaved'), me.user);
				announcer.announce(msg('verified'));
			}
		} catch (error) {
			handleApiFailure(error);
		} finally {
			setBusy(false);
		}
	}

	const onOriginInput = () => {
		updateOriginDerivedUi();
	};

	const onToggleApiKeyClick = () => {
		const reveal = apiKeyInput.type === 'password';
		apiKeyInput.type = reveal ? 'text' : 'password';
		toggleApiKeyBtn.setAttribute('aria-pressed', reveal ? 'true' : 'false');
		toggleApiKeyBtn.textContent = reveal ? msg('hide') : msg('show');
	};

	const onTestClick = () => {
		void verifyWithServer('test');
	};

	const onFormSubmit = (event: SubmitEvent) => {
		event.preventDefault();
		void verifyWithServer('save');
	};

	const onClearClick = () => {
		void (async () => {
			setBusy(true);
			setBannerError(null);
			try {
				await Promise.all([clearSettings(), clearSessionMetaCache()]);
				serverOriginInput.value = DEFAULT_IZGAH_ORIGIN;
				apiKeyInput.value = '';
				apiKeyInput.type = 'password';
				toggleApiKeyBtn.setAttribute('aria-pressed', 'false');
				toggleApiKeyBtn.textContent = msg('show');
				validator.resetValidation();
				updateOriginDerivedUi();
				renderStatusCard('info', msg('cleared'), null);
				announcer.announce(msg('cleared'));
			} finally {
				setBusy(false);
			}
		})();
	};

	serverOriginInput.addEventListener('input', onOriginInput);
	toggleApiKeyBtn.addEventListener('click', onToggleApiKeyClick);
	testBtn.addEventListener('click', onTestClick);
	form.addEventListener('submit', onFormSubmit);
	clearBtn.addEventListener('click', onClearClick);

	// Hydrate initial local settings
	const existing = await loadSettings();
	if (existing) {
		serverOriginInput.value = existing.serverOrigin;
		apiKeyInput.value = existing.apiKey;
		renderStatusCard(
			'info',
			existing.cachedUser ? msg('loadedSaved') : msg('loadedSavedTest'),
			existing.cachedUser
		);
	} else {
		serverOriginInput.value = DEFAULT_IZGAH_ORIGIN;
		apiKeyInput.value = '';
		renderStatusCard('info', msg('notConfigured'), null);
	}
	updateOriginDerivedUi();

	return {
		dispose() {
			serverOriginInput.removeEventListener('input', onOriginInput);
			toggleApiKeyBtn.removeEventListener('click', onToggleApiKeyClick);
			testBtn.removeEventListener('click', onTestClick);
			form.removeEventListener('submit', onFormSubmit);
			clearBtn.removeEventListener('click', onClearClick);
			validator.dispose();
			disposeCopy();
			announcer.dispose();
		}
	};
}

function bootstrapOptionsPage() {
	if (
		typeof document === 'undefined' ||
		document.documentElement.hasAttribute('data-manual-init') ||
		!document.getElementById('options-form')
	) {
		return;
	}
	void initOptionsPage();
}

if (typeof document !== 'undefined') {
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', bootstrapOptionsPage, { once: true });
	} else {
		bootstrapOptionsPage();
	}
}
