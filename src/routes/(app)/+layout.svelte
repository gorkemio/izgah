<script lang="ts">
	import { t } from '#lib/i18n/index.ts';
	import { untrack, type Snippet } from 'svelte';
	import { goto, onNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import ShareComposerDialog, {
		type ShareComposerInitialState
	} from '#lib/components/feed/ShareComposerDialog.svelte';
	import BottomTabBar from '#lib/components/shell/BottomTabBar.svelte';
	import CommandPalette from '#lib/components/shell/CommandPalette.svelte';
	import KeyboardHelpDialog from '#lib/components/shell/KeyboardHelpDialog.svelte';
	import SiteHeader from '#lib/components/shell/SiteHeader.svelte';
	import Toaster from '#lib/components/ui/Toaster.svelte';
	import {
		ComposerController,
		setComposerController
	} from '#lib/share/composer-controller.svelte.ts';
	import { extractShareFromText, firstUriFromUriList } from '#lib/share/paste.ts';
	import { resolveShortcut } from '#lib/client/keyboard-filter.ts';
	import { ThemeState, setThemeState } from '#lib/client/theme.svelte.ts';
	import {
		ShortcutPreference,
		focusedPost,
		listPosts,
		movePostFocus,
		setShortcutPreference
	} from '#lib/client/shortcuts.svelte.ts';
	import type { LayoutData } from './$types';

	interface CreateShareFormPayload {
		formType?: string;
		errorMessage?: string;
		fieldErrors?: Record<string, string[]>;
		values?: {
			url?: string;
			note?: string;
			sectionIds?: string[];
			contentType?: string;
			silentMode?: boolean;
		};
	}

	let { data, children }: { data: LayoutData; children: Snippet } = $props();

	let hydrated = $state(false);
	const composer = setComposerController(new ComposerController());
	let handledInitialCompose = $state(false);
	const shortcutPreference = setShortcutPreference(new ShortcutPreference());
	setThemeState(
		new ThemeState(
			untrack(() => data.theme),
			untrack(() => data.palette)
		)
	);
	let helpOpen = $state(false);
	let helpHasPosts = $state(false);
	let cmdkOpen = $state(false);

	let headerQuery = $state('');
	let scopeInCurrentSection = $state(false);
	let lastSyncedSearchKey = '';

	const activeSection = $derived.by(() => {
		if (page.url.pathname.startsWith('/sections/')) {
			const rawSlug = page.url.pathname.slice('/sections/'.length).split('/')[0] ?? '';
			let decodedSlug = rawSlug;
			try {
				decodedSlug = decodeURIComponent(rawSlug);
			} catch {
				decodedSlug = rawSlug;
			}
			return data.sections.find((section) => section.slug === decodedSlug) ?? null;
		}
		if (page.url.pathname === '/search') {
			const sectionParam = page.url.searchParams.get('section');
			if (sectionParam) {
				return data.sections.find((section) => section.id === sectionParam) ?? null;
			}
		}
		return null;
	});

	$effect(() => {
		const routeKey = `${page.url.pathname}${page.url.search}`;
		if (routeKey !== lastSyncedSearchKey) {
			lastSyncedSearchKey = routeKey;
			if (page.url.pathname === '/search') {
				headerQuery = page.url.searchParams.get('q') ?? '';
				scopeInCurrentSection = Boolean(
					activeSection && page.url.searchParams.get('section') === activeSection.id
				);
			} else {
				scopeInCurrentSection = false;
			}
		}
	});

	$effect(() => {
		hydrated = true;
		// Stable hydration signal for tests and CSS (the share trigger is a button even without JS).
		document.documentElement.dataset.hydrated = 'true';
		shortcutPreference.load();
		if (data.composeRequested && !handledInitialCompose) {
			handledInitialCompose = true;
			// Feed pages focus their inline form; elsewhere the dialog opens (izgah-ui-v2 Karar 1).
			composer.open();
		}
	});

	function openComposer(): void {
		composer.open();
	}

	function openHelp(): void {
		helpHasPosts = listPosts().length > 0;
		helpOpen = true;
	}

	function overlayOpen(): boolean {
		if (document.querySelector('dialog:modal')) {
			return true;
		}
		try {
			return Boolean(document.querySelector(':popover-open'));
		} catch {
			return false;
		}
	}

	function isEditable(target: EventTarget | null): boolean {
		const element = target as HTMLElement | null;
		return Boolean(
			element &&
			(element.isContentEditable ||
				element.closest?.('input, textarea, select, [contenteditable="true"], [role="textbox"]'))
		);
	}

	function focusSearch(): void {
		const railInput = document.querySelector<HTMLInputElement>('#rail-search-input');
		if (railInput && railInput.getClientRects().length > 0) {
			railInput.focus();
			railInput.select();
			return;
		}
		const focusPageSearch = () =>
			document.querySelector<HTMLInputElement>('#main-content input[type="search"]')?.focus();
		if (page.url.pathname === '/search') {
			focusPageSearch();
			return;
		}
		void goto('/search').then(focusPageSearch);
	}

	// Modifier shortcut (Cmd+K / Ctrl+K) + single-key shortcuts (izgah-ui-v2 §8.2, izgah-ui-v3 §7.2).
	function handleShortcut(event: KeyboardEvent): void {
		if (
			(event.metaKey || event.ctrlKey) &&
			!event.altKey &&
			!event.shiftKey &&
			event.key.toLowerCase() === 'k'
		) {
			if (event.defaultPrevented || event.isComposing || event.keyCode === 229) {
				return;
			}
			if (cmdkOpen) {
				event.preventDefault();
				cmdkOpen = false;
				return;
			}
			if (overlayOpen()) {
				return;
			}
			event.preventDefault();
			cmdkOpen = true;
			return;
		}

		const key = resolveShortcut(event, {
			enabled: shortcutPreference.enabled,
			overlayOpen: overlayOpen()
		});
		if (!key) {
			return;
		}
		switch (key) {
			case 'j':
			case 'k':
				if (movePostFocus(key === 'j' ? 1 : -1)) {
					event.preventDefault();
				}
				return;
			case 'o':
			case 'Enter': {
				// Only when the post itself has focus; inner buttons and links keep native Enter.
				const active = document.activeElement;
				if (active instanceof HTMLElement && active.matches('[data-post]') && active.dataset.url) {
					event.preventDefault();
					window.open(active.dataset.url, '_blank', 'noopener,noreferrer');
				}
				return;
			}
			case 'l': {
				if (event.repeat) {
					return;
				}
				const like = focusedPost()?.querySelector<HTMLButtonElement>('[data-shortcut="like"]');
				if (like && !like.disabled) {
					event.preventDefault();
					like.click();
				}
				return;
			}
			case 'c': {
				const comments = focusedPost()?.querySelector<HTMLElement>('[data-shortcut="comments"]');
				if (comments) {
					event.preventDefault();
					comments.click();
				}
				return;
			}
			case '/':
				event.preventDefault();
				focusSearch();
				return;
			case 'n':
				event.preventDefault();
				composer.open();
				return;
			case '?':
				event.preventDefault();
				openHelp();
				return;
		}
	}

	// Paste anywhere (outside text fields) to share; progressive enhancement — Safari only fires
	// paste in editable contexts, so the inline URL field remains the universal path (§8.1).
	function handleDocumentPaste(event: ClipboardEvent): void {
		if (event.defaultPrevented || isEditable(event.target) || overlayOpen()) {
			return;
		}
		const pasted = extractShareFromText(event.clipboardData?.getData('text/plain') ?? '');
		if (!pasted) {
			return;
		}
		event.preventDefault();
		composer.open({ url: pasted.url, note: pasted.note });
	}

	let dropActive = $state(false);

	function isLinkDrag(event: DragEvent): boolean {
		const types = Array.from(event.dataTransfer?.types ?? []);
		return types.includes('text/uri-list') && !types.includes('Files');
	}

	function handleDragOver(event: DragEvent): void {
		if (!isLinkDrag(event) || overlayOpen()) {
			return;
		}
		event.preventDefault();
		dropActive = true;
	}

	function handleDragLeave(event: DragEvent): void {
		if (event.relatedTarget === null) {
			dropActive = false;
		}
	}

	function handleDrop(event: DragEvent): void {
		if (!isLinkDrag(event)) {
			return;
		}
		event.preventDefault();
		dropActive = false;
		const uri = firstUriFromUriList(event.dataTransfer?.getData('text/uri-list') ?? '');
		const pasted = uri ? extractShareFromText(uri) : null;
		if (pasted) {
			composer.open({ url: pasted.url, note: null });
		}
	}

	/**
	 * Moves focus after a client-side navigation without fighting SvelteKit's scroll handling:
	 * - Back/forward (popstate): leave focus and the restored scroll position alone.
	 * - URL with a #fragment: focus that target (SvelteKit already scrolled to it).
	 * - Otherwise: focus the page heading without scrolling.
	 */
	function focusAfterNavigation(
		navigationType: string | undefined,
		hash: string | undefined
	): void {
		if (navigationType === 'popstate') {
			return;
		}
		let target: HTMLElement | null = null;
		if (hash && hash.length > 1) {
			try {
				target = document.getElementById(decodeURIComponent(hash.slice(1)));
			} catch {
				target = null;
			}
		}
		target ??= document.querySelector<HTMLElement>('#main-content h1');
		if (!target) {
			return;
		}
		if (
			!target.hasAttribute('tabindex') &&
			!target.matches('a[href], button, input, select, textarea')
		) {
			target.setAttribute('tabindex', '-1');
		}
		target.focus({ preventScroll: true });
	}

	/**
	 * The navigation a view transition is holding back until the old state has been captured.
	 * SvelteKit renders a navigation as soon as its onNavigate promises resolve and only then checks
	 * whether a newer one started. A quick Back while the transition is still pending would render
	 * the feed and then let the stale resource page render over it, so a navigation superseded
	 * before its transition starts is never released.
	 */
	let heldTransition: { superseded: boolean } | null = null;

	onNavigate((navigation) => {
		if (navigation.shallow && navigation.type === 'goto') return;

		if (heldTransition) {
			heldTransition.superseded = true;
			heldTransition = null;
		}

		const fromPath = navigation.from?.url.pathname;
		const toPath = navigation.to?.url.pathname;
		const isPathnameChange = Boolean(toPath && fromPath !== toPath);

		if (!isPathnameChange) {
			return;
		}

		const isResourceTransition = Boolean(
			fromPath?.startsWith('/resources/') || toPath?.startsWith('/resources/')
		);
		const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		const canUseViewTransition =
			isResourceTransition &&
			typeof document.startViewTransition === 'function' &&
			!prefersReducedMotion;

		const navigationType = navigation.type;
		const targetHash = navigation.to?.url.hash;

		if (!canUseViewTransition) {
			void navigation.complete.then(() => {
				focusAfterNavigation(navigationType, targetHash);
			});
			return;
		}

		const held = { superseded: false };
		heldTransition = held;
		// Aborted after its render (a newer navigation won): focus belongs to that navigation.
		navigation.complete.catch(() => {
			held.superseded = true;
		});

		return new Promise<void>((resolve) => {
			const transition = document.startViewTransition(async () => {
				if (heldTransition === held) {
					heldTransition = null;
				}
				if (held.superseded) {
					// Left pending on purpose: releasing it would render the stale page.
					transition.skipTransition();
					return;
				}
				resolve();
				await navigation.complete;
			});

			void transition.finished
				.catch(() => {
					// An aborted navigation rejects the update callback; the transition is skipped.
				})
				.finally(() => {
					for (const cardEl of document.querySelectorAll<HTMLElement>('[data-vt-card]')) {
						cardEl.style.removeProperty('view-transition-name');
						cardEl.removeAttribute('data-vt-card');
					}
					if (!held.superseded) {
						focusAfterNavigation(navigationType, targetHash);
					}
				});
		});
	});

	function buildCleanReturnTo(currentUrl: { pathname: string; search: string }): string {
		if (currentUrl.pathname.startsWith('/settings') || currentUrl.pathname.startsWith('/admin')) {
			return '/';
		}
		const params = new URLSearchParams(currentUrl.search);
		params.delete('compose');
		params.delete('edit');
		params.delete('delete');
		const encoded = params.toString();
		return encoded ? `${currentUrl.pathname}?${encoded}` : currentUrl.pathname;
	}

	const cleanReturnTo = $derived(buildCleanReturnTo(page.url));
	const composerActionUrl = $derived(
		page.url.pathname.startsWith('/sections/') ? page.url.pathname : '/'
	);
	const navigateHomeOnSuccess = $derived(
		page.url.pathname.startsWith('/settings') || page.url.pathname.startsWith('/admin')
	);

	const createShareForm = $derived.by((): CreateShareFormPayload | null => {
		const raw = page.form as CreateShareFormPayload | null | undefined;
		if (raw && raw.formType === 'createShare') {
			return raw;
		}
		return null;
	});

	// Feed pages render the inline composer, which owns a failed no-JS createShare result.
	const isFeedRoute = $derived(
		page.route.id === '/(app)' || page.route.id === '/(app)/sections/[slug]'
	);

	const composerInitialValues = $derived.by((): ShareComposerInitialState | undefined => {
		if (!createShareForm || isFeedRoute) {
			return undefined;
		}
		return {
			url: createShareForm.values?.url,
			note: createShareForm.values?.note,
			sectionIds: createShareForm.values?.sectionIds,
			contentType: createShareForm.values?.contentType,
			silentMode: createShareForm.values?.silentMode,
			errorMessage: createShareForm.errorMessage,
			fieldErrors: createShareForm.fieldErrors
		};
	});
</script>

<div class="app-shell">
	<SiteHeader
		user={data.user}
		sections={data.sections}
		theme={data.theme}
		{activeSection}
		{headerQuery}
		{scopeInCurrentSection}
		onQueryInput={(value) => {
			headerQuery = value;
		}}
		onScopeChange={(checked) => {
			scopeInCurrentSection = checked;
		}}
		onCompose={openComposer}
	/>

	<div class="app-content-wrap">
		<main id="main-content" class="app-main">
			{@render children()}
		</main>
	</div>
</div>

<BottomTabBar onCompose={openComposer} />
<Toaster />

<svelte:window onkeydown={handleShortcut} />

<svelte:document
	onpaste={handleDocumentPaste}
	ondragover={handleDragOver}
	ondragleave={handleDragLeave}
	ondrop={handleDrop}
></svelte:document>

{#if dropActive}
	<div class="drop-zone" aria-hidden="true">{t('share.dropHint')}</div>
{/if}

{#if hydrated}
	<CommandPalette
		bind:open={cmdkOpen}
		sections={data.sections}
		isAdmin={data.user.role === 'admin'}
		onCompose={openComposer}
		onOpenHelp={openHelp}
	/>
	<KeyboardHelpDialog
		bind:open={helpOpen}
		preference={shortcutPreference}
		hasPosts={helpHasPosts}
	/>
	<ShareComposerDialog
		bind:open={composer.dialogOpen}
		prefill={composer.dialogPrefill}
		sections={data.sections}
		isAdmin={data.user.role === 'admin'}
		actionUrl={composerActionUrl}
		returnTo={cleanReturnTo}
		{navigateHomeOnSuccess}
		initialValues={composerInitialValues}
	/>
{/if}

<style>
	.drop-zone {
		position: fixed;
		inset: var(--space-4);
		z-index: 70;
		display: grid;
		place-items: center;
		font: var(--text-section);
		color: var(--color-text);
		background: color-mix(in oklab, var(--color-bg) 92%, transparent);
		border: 2px dashed var(--color-accent);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-lg);
		pointer-events: none;
	}

	@media (forced-colors: active) {
		.drop-zone {
			box-shadow: none;
			border-color: Highlight;
		}
	}

	.app-shell {
		display: grid;
		grid-template-columns: var(--rail-w) minmax(0, 1fr);
		min-block-size: 100dvh;
	}

	.app-content-wrap {
		display: flex;
		flex-direction: column;
		min-inline-size: 0;
		min-block-size: 100dvh;
	}

	.app-main {
		flex: 1 1 auto;
		min-inline-size: 0;
		padding: var(--space-5) var(--gutter) var(--space-7);
	}

	/* The docked reading pane (≥ 1280px) takes the right edge; the register makes room for it. */
	@media (min-width: 1280px) {
		:global(html:has(dialog.side-peek-dialog.is-docked[open])) .app-content-wrap {
			padding-inline-end: var(--pane-w);
		}
	}

	@media (max-width: 767px) {
		.app-shell {
			grid-template-columns: minmax(0, 1fr);
			grid-template-rows: auto minmax(0, 1fr);
		}

		.app-content-wrap {
			min-block-size: 0;
		}

		.app-main {
			padding-block: var(--space-4)
				calc(var(--tab-bar-h) + env(safe-area-inset-bottom, 0px) + var(--space-6));
		}
	}
</style>
