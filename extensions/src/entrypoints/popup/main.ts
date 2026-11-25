import { browser } from 'wxt/browser';
import { createIzgahApiClient } from '../../lib/api-client';
import { wireRequestIdCopy } from '../../lib/copy-request-id';
import {
	bindPostInteractionValidation,
	createImeTracker,
	createPoliteAnnouncer,
	isImeSafeSubmitShortcut,
	setTextErrorBanner
} from '../../lib/dom-a11y';
import { isAbortError, IzgahApiError } from '../../lib/errors';
import {
	clearSessionMetaCache,
	consumePendingShareContext,
	isValidExtensionSettings,
	loadSettings,
	readSessionMetaCache,
	updateCachedUser,
	writeSessionMetaCache
} from '../../lib/storage';
import {
	contentTypeLabel,
	MAX_NOTE_LENGTH,
	PENDING_SHARE_TTL_MS,
	type BrowserTarget,
	type CachedUserProfile,
	type ContentType,
	type CreateLinkInput,
	type LinkCheckResponse,
	type PendingShareContext,
	type SectionItem
} from '../../lib/types';
import { validateShareableUrl } from '../../lib/url';
import { localizeDocument, msg, uiLanguage } from '../../lib/i18n';

export interface InitPopupPageDeps {
	root?: Document;
	fetchImpl?: typeof fetch;
	browserTarget?: BrowserTarget;
	clientVersion?: string;
	searchParams?: string;
	closeWindow?: () => void;
}

export interface PopupPageController {
	dispose(): void;
}

const CHECK_DEBOUNCE_MS = 300;

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

function queryRequiredElement<T extends Element>(root: Document, selector: string): T {
	const el = root.querySelector<T>(selector);
	if (!el) {
		throw new Error(`Required popup DOM element not found: ${selector}`);
	}
	return el;
}

function formatShareDate(iso: string): string {
	try {
		return new Intl.DateTimeFormat(uiLanguage(), { dateStyle: 'medium' }).format(new Date(iso));
	} catch {
		return iso;
	}
}

function isPendingShareContext(value: unknown): value is PendingShareContext {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return false;
	}
	const record = value as Record<string, unknown>;
	return (
		typeof record.url === 'string' &&
		(record.title === null || typeof record.title === 'string') &&
		(record.source === 'page' || record.source === 'link') &&
		typeof record.createdAt === 'number'
	);
}

async function consumeIncomingPendingShare(): Promise<PendingShareContext | null> {
	try {
		const response: unknown = await browser.runtime.sendMessage({
			type: 'consumePendingShare'
		});
		if (isPendingShareContext(response)) {
			return Date.now() - response.createdAt <= PENDING_SHARE_TTL_MS ? response : null;
		}
		if (response === null) {
			return null;
		}
	} catch {
		// Fall back to direct session storage consumption if background worker did not respond
	}

	return consumePendingShareContext().catch(() => null);
}

/**
 * Initializes the extension share popup across toolbar, keyboard, context menu, and standalone flows.
 */
export async function initPopupPage(deps: InitPopupPageDeps = {}): Promise<PopupPageController> {
	const doc = deps.root ?? document;
	localizeDocument(doc);
	const runtimeMeta = resolveRuntimeClientMeta();
	const browserTarget = deps.browserTarget ?? runtimeMeta.browserTarget;
	const clientVersion = deps.clientVersion ?? runtimeMeta.clientVersion;
	const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
	const closeWindow =
		deps.closeWindow ??
		(() => {
			doc.defaultView?.close();
		});

	const searchRaw = deps.searchParams ?? doc.defaultView?.location?.search ?? '';
	const isStandalone = new URLSearchParams(searchRaw).get('mode') === 'standalone';
	if (isStandalone) {
		doc.documentElement.setAttribute('data-standalone', 'true');
	} else {
		doc.documentElement.removeAttribute('data-standalone');
	}

	const setupPanel = queryRequiredElement<HTMLElement>(doc, '#popup-setup-panel');
	const setupOptionsBtn = queryRequiredElement<HTMLButtonElement>(doc, '#popup-setup-options-btn');
	const composerPanel = queryRequiredElement<HTMLElement>(doc, '#popup-composer-panel');
	const userBadgeEl = queryRequiredElement<HTMLElement>(doc, '#popup-user-badge');
	const headerOptionsBtn = queryRequiredElement<HTMLButtonElement>(
		doc,
		'#popup-header-options-btn'
	);
	const form = queryRequiredElement<HTMLFormElement>(doc, '#popup-share-form');
	const urlInput = queryRequiredElement<HTMLInputElement>(doc, '#share-url');
	const sourceBadgeEl = queryRequiredElement<HTMLElement>(doc, '#share-source-badge');
	const urlNoticeEl = queryRequiredElement<HTMLElement>(doc, '#share-url-notice');
	const urlNoticeTextEl = queryRequiredElement<HTMLElement>(doc, '#share-url-notice-text');
	const titlePreviewEl = queryRequiredElement<HTMLElement>(doc, '#share-title-preview');
	const titleTextEl = queryRequiredElement<HTMLElement>(doc, '#share-title-text');
	const linkCheckRegion = queryRequiredElement<HTMLElement>(doc, '#link-check-region');
	const linkCheckLoading = queryRequiredElement<HTMLElement>(doc, '#link-check-loading');
	const duplicateBanner = queryRequiredElement<HTMLElement>(doc, '#duplicate-banner');
	const duplicatePrimaryText = queryRequiredElement<HTMLElement>(doc, '#duplicate-primary-text');
	const duplicateMetaText = queryRequiredElement<HTMLElement>(doc, '#duplicate-meta-text');
	const noteInput = queryRequiredElement<HTMLTextAreaElement>(doc, '#share-note');
	const noteCounterEl = queryRequiredElement<HTMLElement>(doc, '#share-note-counter');
	const sectionsFieldset = queryRequiredElement<HTMLFieldSetElement>(doc, '#sections-fieldset');
	const sectionsLegend = queryRequiredElement<HTMLLegendElement>(doc, '#sections-legend');
	const sectionsListEl = queryRequiredElement<HTMLElement>(doc, '#sections-list');
	const sectionsEmptyHint = queryRequiredElement<HTMLElement>(doc, '#sections-empty-hint');
	const sectionsLoadErrorEl = queryRequiredElement<HTMLElement>(doc, '#sections-load-error');
	const reloadSectionsBtn = queryRequiredElement<HTMLButtonElement>(doc, '#reload-sections-btn');
	const sectionsErrorEl = queryRequiredElement<HTMLElement>(doc, '#sections-error');
	const contentTypeSelect = queryRequiredElement<HTMLSelectElement>(doc, '#share-content-type');
	const autoContentTypeOption = queryRequiredElement<HTMLOptionElement>(
		doc,
		'#auto-content-type-option'
	);
	const adminSilentRow = queryRequiredElement<HTMLElement>(doc, '#admin-silent-row');
	const silentCheckbox = queryRequiredElement<HTMLInputElement>(doc, '#share-silent-mode');
	const errorBannerEl = queryRequiredElement<HTMLElement>(doc, '#popup-error-banner');
	const errorMessageEl = queryRequiredElement<HTMLElement>(doc, '#popup-error-message');
	const authActionRow = queryRequiredElement<HTMLElement>(doc, '#popup-auth-action-row');
	const errorOptionsBtn = queryRequiredElement<HTMLButtonElement>(doc, '#popup-error-options-btn');
	const requestIdRowEl = queryRequiredElement<HTMLElement>(doc, '#popup-request-id-row');
	const requestIdCodeEl = queryRequiredElement<HTMLElement>(doc, '#popup-request-id');
	const submitBtn = queryRequiredElement<HTMLButtonElement>(doc, '#popup-submit-btn');
	const successPanel = queryRequiredElement<HTMLElement>(doc, '#popup-success-panel');
	const successHeading = queryRequiredElement<HTMLElement>(doc, '#popup-success-heading');
	const successSummaryEl = queryRequiredElement<HTMLElement>(doc, '#popup-success-summary');
	const newShareBtn = queryRequiredElement<HTMLButtonElement>(doc, '#popup-new-share-btn');
	const closeBtn = queryRequiredElement<HTMLButtonElement>(doc, '#popup-close-btn');
	const liveRegionEl = queryRequiredElement<HTMLElement>(doc, '#popup-live-region');

	const announcer = createPoliteAnnouncer(liveRegionEl);
	const disposeCopy = wireRequestIdCopy(errorBannerEl);
	const imeTracker = createImeTracker();
	const validator = bindPostInteractionValidation(
		[
			{
				control: urlInput,
				validate() {
					const result = validateShareableUrl(urlInput.value);
					return result.ok ? null : result.message;
				}
			},
			{
				control: noteInput,
				validate() {
					return noteInput.value.length > MAX_NOTE_LENGTH
						? `Not en fazla ${MAX_NOTE_LENGTH} karakter olabilir.`
						: null;
				}
			}
		],
		announcer
	);

	let currentSource: 'page' | 'link' | null = null;
	let initialCapturedUrl = '';
	let activeTabTitle: string | null = null;
	let lastCheckResult: LinkCheckResponse | null = null;
	let currentUser: CachedUserProfile | null = null;
	let sections: SectionItem[] = [];
	let sectionsLoadFailed = false;
	let checkDebounceTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
	let activeCheckController: AbortController | null = null;
	let disposed = false;

	function openOptionsPage() {
		void Promise.resolve(browser.runtime.openOptionsPage()).catch(() => {});
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
		if (!error) {
			authActionRow.hidden = true;
		}
	}

	function setUrlNotice(message: string | null) {
		if (!message) {
			urlNoticeTextEl.textContent = '';
			urlNoticeEl.hidden = true;
			return;
		}
		urlNoticeTextEl.textContent = message;
		urlNoticeEl.hidden = false;
	}

	function updateNoteCounter() {
		noteCounterEl.textContent = `${noteInput.value.length} / ${MAX_NOTE_LENGTH}`;
	}

	function renderSourceBadge(source: 'page' | 'link' | null) {
		if (source === 'link') {
			sourceBadgeEl.textContent = msg('sourceContextLink');
			sourceBadgeEl.hidden = false;
		} else if (source === 'page') {
			sourceBadgeEl.textContent = msg('sourceContextPage');
			sourceBadgeEl.hidden = false;
		} else {
			sourceBadgeEl.textContent = '';
			sourceBadgeEl.hidden = true;
		}
	}

	function renderTitlePreview() {
		if (currentSource === 'link') {
			titleTextEl.textContent = '';
			titlePreviewEl.hidden = true;
			return;
		}
		const resolvedTitle = lastCheckResult?.resource?.title?.trim() || activeTabTitle?.trim() || '';
		if (resolvedTitle === '') {
			titleTextEl.textContent = '';
			titlePreviewEl.hidden = true;
			return;
		}
		titleTextEl.textContent = resolvedTitle;
		titlePreviewEl.hidden = false;
	}

	function clearSectionsValidationError() {
		sectionsErrorEl.textContent = '';
		sectionsErrorEl.hidden = true;
		sectionsFieldset.classList.remove('has-error-fallback');
		for (const cb of sectionsListEl.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
			cb.setAttribute('aria-invalid', 'false');
		}
	}

	function setSectionsValidationError(message: string) {
		sectionsErrorEl.textContent = message;
		sectionsErrorEl.hidden = false;
		sectionsFieldset.classList.add('has-error-fallback');
		for (const cb of sectionsListEl.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
			cb.setAttribute('aria-invalid', 'true');
		}
	}

	function getSelectedSectionIds(): string[] {
		return Array.from(
			sectionsListEl.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked')
		).map((cb) => cb.value);
	}

	function updateSectionsLegend() {
		const isAdminSilent = currentUser?.role === 'admin' && silentCheckbox.checked;
		sectionsLegend.textContent = isAdminSilent ? msg('sectionsRequired') : msg('sectionsOptional');
	}

	function applyUserRoleUi(user: CachedUserProfile | null) {
		if (user) {
			const roleLabel = user.role === 'admin' ? msg('roleAdmin') : msg('roleMember');
			userBadgeEl.textContent = `${user.name} · ${roleLabel}`;
			userBadgeEl.hidden = false;
		} else {
			userBadgeEl.textContent = '';
			userBadgeEl.hidden = true;
		}

		const isAdmin = user?.role === 'admin';
		adminSilentRow.hidden = !isAdmin;
		if (!isAdmin) {
			silentCheckbox.checked = false;
			clearSectionsValidationError();
		}
		updateSectionsLegend();
	}

	function renderSections(
		sectionItems: SectionItem[],
		preserveIds: ReadonlySet<string> = new Set()
	) {
		sectionsListEl.replaceChildren();
		sectionsLoadErrorEl.hidden = true;

		if (sectionItems.length === 0) {
			sectionsListEl.hidden = true;
			sectionsEmptyHint.hidden = false;
			return;
		}

		sectionsEmptyHint.hidden = true;
		sectionsListEl.hidden = false;

		for (const section of sectionItems) {
			const row = doc.createElement('div');
			row.className = 'checkbox-row';

			const checkbox = doc.createElement('input');
			checkbox.type = 'checkbox';
			checkbox.id = `popup-section-${section.id}`;
			checkbox.name = 'sectionIds';
			checkbox.value = section.id;
			checkbox.checked = preserveIds.has(section.id);
			checkbox.setAttribute('aria-invalid', 'false');

			const label = doc.createElement('label');
			label.htmlFor = checkbox.id;
			label.textContent = section.name;

			row.append(checkbox, label);
			sectionsListEl.append(row);
		}
	}

	function showSectionsLoadFailure() {
		sectionsListEl.replaceChildren();
		sectionsListEl.hidden = true;
		sectionsEmptyHint.hidden = true;
		sectionsLoadErrorEl.hidden = false;
	}

	function resetAutoContentTypeLabel() {
		autoContentTypeOption.textContent = msg('autoDetect');
	}

	function clearCheckUi() {
		lastCheckResult = null;
		linkCheckLoading.hidden = true;
		duplicatePrimaryText.textContent = '';
		duplicateMetaText.textContent = '';
		duplicateMetaText.hidden = true;
		duplicateBanner.hidden = true;
		linkCheckRegion.hidden = true;
		resetAutoContentTypeLabel();
		renderTitlePreview();
	}

	function renderCheckResult(result: LinkCheckResponse) {
		lastCheckResult = result;
		renderTitlePreview();

		if (!result.exists) {
			duplicatePrimaryText.textContent = '';
			duplicateMetaText.textContent = '';
			duplicateMetaText.hidden = true;
			duplicateBanner.hidden = true;
			linkCheckRegion.hidden = true;
			const label = contentTypeLabel(result.suggestedContentType);
			autoContentTypeOption.textContent = msg('autoDetectSuggested', label);
			return;
		}

		resetAutoContentTypeLabel();
		const summary = result.sharesSummary;
		const first = summary?.firstShare;
		if (first) {
			duplicatePrimaryText.textContent = msg(
				'dupSharedBy',
				first.authorName,
				formatShareDate(first.createdAt)
			);
		} else {
			duplicatePrimaryText.textContent = msg('dupSharedBefore');
		}

		const metaParts: string[] = [];
		if (summary && summary.totalCount > 1) {
			metaParts.push(msg('dupTotal', summary.totalCount));
		}
		if (first && !first.isFeedVisible) {
			const sectionListText =
				first.sectionNames.length > 0 ? first.sectionNames.join(', ') : msg('noSectionInfo');
			metaParts.push(msg('dupSilent', sectionListText));
		} else if (first && first.sectionNames.length > 0) {
			metaParts.push(msg('dupSections', first.sectionNames.join(', ')));
		}

		if (metaParts.length > 0) {
			duplicateMetaText.textContent = metaParts.join(' ');
			duplicateMetaText.hidden = false;
		} else {
			duplicateMetaText.textContent = '';
			duplicateMetaText.hidden = true;
		}

		duplicateBanner.hidden = false;
		linkCheckRegion.hidden = false;
	}

	function showPanel(panel: 'setup' | 'composer' | 'success') {
		setupPanel.hidden = panel !== 'setup';
		composerPanel.hidden = panel !== 'composer';
		successPanel.hidden = panel !== 'success';
	}

	const onSetupOptionsClick = () => openOptionsPage();
	const onHeaderOptionsClick = () => openOptionsPage();
	const onErrorOptionsClick = () => openOptionsPage();
	setupOptionsBtn.addEventListener('click', onSetupOptionsClick);
	headerOptionsBtn.addEventListener('click', onHeaderOptionsClick);
	errorOptionsBtn.addEventListener('click', onErrorOptionsClick);

	const pendingShare = await consumeIncomingPendingShare();
	const settings = await loadSettings();

	if (!isValidExtensionSettings(settings)) {
		showPanel('setup');
		return {
			dispose() {
				disposed = true;
				setupOptionsBtn.removeEventListener('click', onSetupOptionsClick);
				headerOptionsBtn.removeEventListener('click', onHeaderOptionsClick);
				errorOptionsBtn.removeEventListener('click', onErrorOptionsClick);
				validator.dispose();
				disposeCopy();
				announcer.dispose();
			}
		};
	}

	showPanel('composer');

	const apiClient = createIzgahApiClient({
		serverOrigin: settings.serverOrigin,
		apiKey: settings.apiKey,
		browserTarget,
		clientVersion,
		fetchImpl
	});

	async function handleAuthFailure(mapped: IzgahApiError['mapped']) {
		await Promise.all([
			updateCachedUser(null).catch(() => null),
			clearSessionMetaCache().catch(() => {})
		]);
		if (disposed) {
			return;
		}
		currentUser = null;
		applyUserRoleUi(null);
		setBannerError({
			message: mapped.userMessage,
			requestId: mapped.requestId
		});
		authActionRow.hidden = false;
		announcer.announce(mapped.userMessage);
	}

	async function runLinkCheck(targetUrl: string) {
		activeCheckController?.abort();
		const controller = new AbortController();
		activeCheckController = controller;

		linkCheckRegion.hidden = false;
		linkCheckLoading.hidden = false;
		duplicateBanner.hidden = true;

		try {
			const checkResult = await apiClient.checkLink(targetUrl, controller.signal);
			if (disposed || controller.signal.aborted || activeCheckController !== controller) {
				return;
			}
			linkCheckLoading.hidden = true;
			renderCheckResult(checkResult);
		} catch (error) {
			if (isAbortError(error) || controller.signal.aborted || disposed) {
				return;
			}
			linkCheckLoading.hidden = true;
			if (error instanceof IzgahApiError && error.mapped.isAuthError) {
				await handleAuthFailure(error.mapped);
				return;
			}
			duplicateBanner.hidden = true;
			linkCheckRegion.hidden = true;
		}
	}

	async function refreshRoleAfterForbidden() {
		try {
			const me = await apiClient.getMe();
			if (disposed) {
				return;
			}
			currentUser = me.user;
			await updateCachedUser(currentUser).catch(() => null);
			applyUserRoleUi(currentUser);
		} catch (error) {
			if (error instanceof IzgahApiError && error.mapped.isAuthError) {
				await handleAuthFailure(error.mapped);
			}
		}
	}

	function resetComposerForNewShare() {
		activeCheckController?.abort();
		if (checkDebounceTimer !== null) {
			globalThis.clearTimeout(checkDebounceTimer);
			checkDebounceTimer = null;
		}
		currentSource = null;
		initialCapturedUrl = '';
		activeTabTitle = null;
		renderSourceBadge(null);
		urlInput.value = '';
		noteInput.value = '';
		updateNoteCounter();
		contentTypeSelect.value = '';
		silentCheckbox.checked = false;
		for (const cb of sectionsListEl.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
			cb.checked = false;
		}
		clearSectionsValidationError();
		updateSectionsLegend();
		validator.resetValidation();
		setUrlNotice(null);
		setBannerError(null);
		clearCheckUi();
		showPanel('composer');
		urlInput.focus();
	}

	// Determine initial URL, source badge, and read-only title
	let initialUrlNotice: string | null = null;
	let initialUrl = '';

	if (pendingShare) {
		initialUrl = pendingShare.url;
		currentSource = pendingShare.source;
		activeTabTitle = pendingShare.source === 'link' ? null : pendingShare.title;
	} else if (isStandalone) {
		initialUrl = '';
		currentSource = null;
		activeTabTitle = null;
		initialUrlNotice = msg('contextExpired');
	} else {
		try {
			const tabs = await browser.tabs.query({ active: true, currentWindow: true });
			const activeTab = tabs[0];
			initialUrl = activeTab?.url ?? '';
			activeTabTitle =
				typeof activeTab?.title === 'string' && activeTab.title.trim() !== ''
					? activeTab.title
					: null;
		} catch {
			initialUrl = '';
			activeTabTitle = null;
		}
	}

	initialCapturedUrl = initialUrl;
	urlInput.value = initialUrl;
	renderSourceBadge(currentSource);
	renderTitlePreview();
	updateNoteCounter();

	const initialUrlValidation = validateShareableUrl(initialUrl);
	if (initialUrlNotice) {
		setUrlNotice(initialUrlNotice);
	} else if (!initialUrlValidation.ok) {
		setUrlNotice(initialUrlValidation.message);
	}

	// Optimistic role hydration before waiting for network
	currentUser = settings.cachedUser;
	applyUserRoleUi(currentUser);

	const onUrlInput = () => {
		if (checkDebounceTimer !== null) {
			globalThis.clearTimeout(checkDebounceTimer);
			checkDebounceTimer = null;
		}
		activeCheckController?.abort();

		if (urlInput.value !== initialCapturedUrl) {
			currentSource = null;
			activeTabTitle = null;
			renderSourceBadge(null);
		}
		clearCheckUi();

		checkDebounceTimer = globalThis.setTimeout(() => {
			checkDebounceTimer = null;
			const result = validateShareableUrl(urlInput.value);
			if (!result.ok) {
				setUrlNotice(result.message);
				return;
			}
			setUrlNotice(null);
			void runLinkCheck(result.value);
		}, CHECK_DEBOUNCE_MS);
	};

	const onNoteInput = () => {
		updateNoteCounter();
	};

	const onNoteKeyDown = (event: KeyboardEvent) => {
		if (isImeSafeSubmitShortcut(event, imeTracker)) {
			event.preventDefault();
			form.requestSubmit();
		}
	};

	const onSectionsChange = () => {
		if (getSelectedSectionIds().length > 0 || !silentCheckbox.checked) {
			clearSectionsValidationError();
		}
	};

	const onSilentModeChange = () => {
		updateSectionsLegend();
		validator.setServerFieldError(silentCheckbox, '');
		if (!silentCheckbox.checked) {
			clearSectionsValidationError();
		}
	};

	const onContentTypeChange = () => {
		validator.setServerFieldError(contentTypeSelect, '');
	};

	const onReloadSectionsClick = () => {
		void (async () => {
			const preserved = new Set(getSelectedSectionIds());
			reloadSectionsBtn.disabled = true;
			try {
				const [meRes, secRes] = await Promise.all([
					currentUser ? Promise.resolve({ user: currentUser }) : apiClient.getMe(),
					apiClient.getSections()
				]);
				if (disposed) {
					return;
				}
				currentUser = meRes.user;
				sections = secRes.sections;
				sectionsLoadFailed = false;
				applyUserRoleUi(currentUser);
				renderSections(sections, preserved);
				clearSectionsValidationError();
				await writeSessionMetaCache({
					serverOrigin: settings.serverOrigin,
					user: currentUser,
					sections
				}).catch(() => {});
				announcer.announce(msg('sectionsLoaded'));
			} catch (error) {
				if (disposed) {
					return;
				}
				if (error instanceof IzgahApiError && error.mapped.isAuthError) {
					await handleAuthFailure(error.mapped);
					return;
				}
				if (error instanceof IzgahApiError) {
					setBannerError({
						message: error.mapped.userMessage,
						requestId: error.mapped.requestId
					});
					announcer.announce(error.mapped.userMessage);
				}
			} finally {
				reloadSectionsBtn.disabled = false;
			}
		})();
	};

	const onFormSubmit = (event: SubmitEvent) => {
		event.preventDefault();
		void (async () => {
			setBannerError(null);
			clearSectionsValidationError();
			validator.setServerFieldError(contentTypeSelect, '');
			validator.setServerFieldError(silentCheckbox, '');

			if (!validator.validateAllAndFocusFirst()) {
				announcer.announce(msg('fixFormErrors'));
				return;
			}

			const urlResult = validateShareableUrl(urlInput.value);
			if (!urlResult.ok) {
				return;
			}

			const isSilent = currentUser?.role === 'admin' && silentCheckbox.checked;
			const selectedSectionIds = getSelectedSectionIds();

			if (isSilent && (sectionsLoadFailed || selectedSectionIds.length === 0)) {
				const sectionsMessage = sectionsLoadFailed
					? msg('silentNeedsLoadedSections')
					: msg('silentNeedsSection');
				setSectionsValidationError(sectionsMessage);
				const focusTarget =
					sectionsListEl.querySelector<HTMLInputElement>('input[type="checkbox"]') ??
					(sectionsLoadFailed ? reloadSectionsBtn : silentCheckbox);
				focusTarget.focus();
				announcer.announce(sectionsMessage);
				return;
			}

			const manualContentType = contentTypeSelect.value as ContentType | '';
			const payload: CreateLinkInput = {
				url: urlResult.value
			};
			const trimmedNote = noteInput.value.trim();
			if (trimmedNote !== '') {
				payload.note = trimmedNote;
			}
			if (selectedSectionIds.length > 0) {
				payload.sectionIds = selectedSectionIds;
			}
			if (manualContentType !== '') {
				payload.contentType = manualContentType;
			}
			if (isSilent) {
				payload.isFeedVisible = false;
			}

			submitBtn.disabled = true;
			submitBtn.textContent = msg('sharing');

			try {
				const created = await apiClient.createLink(payload);
				if (disposed) {
					return;
				}
				const visibilitySummary = created.share.isFeedVisible
					? msg('publishedToFeed')
					: msg('addedSilently');
				successSummaryEl.textContent = `${created.share.canonicalUrl} · ${visibilitySummary}`;

				// Reset underlying form state so reopening or starting a new share starts clean
				form.reset();
				updateNoteCounter();
				showPanel('success');
				successHeading.focus();
				announcer.announce(msg('sharedToIzgah'));
			} catch (error) {
				if (disposed) {
					return;
				}
				if (!(error instanceof IzgahApiError)) {
					const fallbackMsg = msg('shareUnexpected');
					setBannerError({ message: fallbackMsg, requestId: null });
					announcer.announce(fallbackMsg);
					return;
				}

				const { mapped } = error;
				if (mapped.isAuthError) {
					await handleAuthFailure(mapped);
					return;
				}

				setBannerError({
					message: mapped.userMessage,
					requestId: mapped.requestId
				});

				if (mapped.status === 403) {
					await clearSessionMetaCache().catch(() => {});
					void refreshRoleAfterForbidden();
				}

				if (mapped.status === 422) {
					const urlErr = mapped.fieldErrors.url?.[0];
					if (urlErr) {
						validator.setServerFieldError(urlInput, urlErr);
					}
					const noteErr = mapped.fieldErrors.note?.[0];
					if (noteErr) {
						validator.setServerFieldError(noteInput, noteErr);
					}
					const typeErr = mapped.fieldErrors.contentType?.[0];
					if (typeErr) {
						validator.setServerFieldError(contentTypeSelect, typeErr);
					}
					const silentErr = mapped.fieldErrors.isFeedVisible?.[0];
					if (silentErr) {
						validator.setServerFieldError(silentCheckbox, silentErr);
					}
					const sectionsErr = mapped.fieldErrors.sectionIds?.[0];
					if (sectionsErr) {
						setSectionsValidationError(sectionsErr);
						await clearSessionMetaCache().catch(() => {});
					}
				}

				announcer.announce(mapped.userMessage);
			} finally {
				submitBtn.disabled = false;
				submitBtn.textContent = msg('share');
			}
		})();
	};

	const onNewShareClick = () => {
		resetComposerForNewShare();
	};

	const onCloseClick = () => {
		closeWindow();
	};

	urlInput.addEventListener('input', onUrlInput);
	noteInput.addEventListener('input', onNoteInput);
	noteInput.addEventListener('compositionend', imeTracker.onCompositionEnd);
	noteInput.addEventListener('keydown', onNoteKeyDown);
	sectionsListEl.addEventListener('change', onSectionsChange);
	contentTypeSelect.addEventListener('change', onContentTypeChange);
	silentCheckbox.addEventListener('change', onSilentModeChange);
	reloadSectionsBtn.addEventListener('click', onReloadSectionsClick);
	form.addEventListener('submit', onFormSubmit);
	newShareBtn.addEventListener('click', onNewShareClick);
	closeBtn.addEventListener('click', onCloseClick);

	// Hydrate metadata from 60s session cache or parallel /me + /sections fetches alongside /links/check
	const cachedMeta = await readSessionMetaCache(settings.serverOrigin).catch(() => null);
	if (cachedMeta) {
		currentUser = cachedMeta.user;
		sections = cachedMeta.sections;
		sectionsLoadFailed = false;
		applyUserRoleUi(currentUser);
		renderSections(sections);
		if (initialUrlValidation.ok) {
			await runLinkCheck(initialUrlValidation.value);
		}
	} else {
		const checkPromise = initialUrlValidation.ok
			? runLinkCheck(initialUrlValidation.value)
			: Promise.resolve();
		const [meSettled, sectionsSettled] = await Promise.allSettled([
			apiClient.getMe(),
			apiClient.getSections(),
			checkPromise
		]);

		if (!disposed) {
			const authRejected =
				(meSettled.status === 'rejected' &&
					meSettled.reason instanceof IzgahApiError &&
					meSettled.reason.mapped.isAuthError &&
					meSettled.reason.mapped) ||
				(sectionsSettled.status === 'rejected' &&
					sectionsSettled.reason instanceof IzgahApiError &&
					sectionsSettled.reason.mapped.isAuthError &&
					sectionsSettled.reason.mapped) ||
				null;

			if (authRejected) {
				await handleAuthFailure(authRejected);
			} else {
				if (meSettled.status === 'fulfilled') {
					currentUser = meSettled.value.user;
					await updateCachedUser(currentUser).catch(() => null);
					applyUserRoleUi(currentUser);
				}

				if (sectionsSettled.status === 'fulfilled') {
					sections = sectionsSettled.value.sections;
					sectionsLoadFailed = false;
					renderSections(sections);
				} else {
					sectionsLoadFailed = true;
					showSectionsLoadFailure();
				}

				if (
					meSettled.status === 'fulfilled' &&
					sectionsSettled.status === 'fulfilled' &&
					currentUser
				) {
					await writeSessionMetaCache({
						serverOrigin: settings.serverOrigin,
						user: currentUser,
						sections
					}).catch(() => {});
				}
			}
		}
	}

	return {
		dispose() {
			disposed = true;
			if (checkDebounceTimer !== null) {
				globalThis.clearTimeout(checkDebounceTimer);
				checkDebounceTimer = null;
			}
			activeCheckController?.abort();
			setupOptionsBtn.removeEventListener('click', onSetupOptionsClick);
			headerOptionsBtn.removeEventListener('click', onHeaderOptionsClick);
			errorOptionsBtn.removeEventListener('click', onErrorOptionsClick);
			urlInput.removeEventListener('input', onUrlInput);
			noteInput.removeEventListener('input', onNoteInput);
			noteInput.removeEventListener('compositionend', imeTracker.onCompositionEnd);
			noteInput.removeEventListener('keydown', onNoteKeyDown);
			sectionsListEl.removeEventListener('change', onSectionsChange);
			contentTypeSelect.removeEventListener('change', onContentTypeChange);
			silentCheckbox.removeEventListener('change', onSilentModeChange);
			reloadSectionsBtn.removeEventListener('click', onReloadSectionsClick);
			form.removeEventListener('submit', onFormSubmit);
			newShareBtn.removeEventListener('click', onNewShareClick);
			closeBtn.removeEventListener('click', onCloseClick);
			validator.dispose();
			disposeCopy();
			announcer.dispose();
		}
	};
}

function bootstrapPopupPage() {
	if (
		typeof document === 'undefined' ||
		document.documentElement.hasAttribute('data-manual-init') ||
		!document.getElementById('popup-share-form')
	) {
		return;
	}
	void initPopupPage();
}

if (typeof document !== 'undefined') {
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', bootstrapPopupPage, { once: true });
	} else {
		bootstrapPopupPage();
	}
}
