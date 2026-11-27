<script lang="ts">
	import { t } from '#lib/i18n/index.ts';
	import { kunyeCase } from '#lib/format/kunye.ts';
	import { contentTypeLabel } from '#lib/types/feed.ts';
	import { tick } from 'svelte';
	import { deserialize } from '$app/forms';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Highlight from '#lib/components/ui/Highlight.svelte';
	import { Skeleton } from '#lib/components/ui/skeleton/index.ts';
	import { getThemeState, type ThemeChoice } from '#lib/client/theme.svelte.ts';
	import { toasts } from '#lib/client/toast.svelte.ts';
	import { highlightTerms } from '#lib/search/highlight.ts';
	import type { SearchShareItem } from '#lib/server/search/service.ts';

	interface SectionItem {
		id: string;
		slug: string;
		name: string;
	}

	type ScopeId = 'all' | 'links' | 'sections' | 'actions';

	interface Props {
		open?: boolean;
		sections: SectionItem[];
		isAdmin: boolean;
		onCompose: () => void;
		onOpenHelp: () => void;
	}

	let { open = $bindable(false), sections, isAdmin, onCompose, onOpenHelp }: Props = $props();

	const themeState = getThemeState();

	let dialogEl = $state<HTMLDialogElement | null>(null);
	let inputEl = $state<HTMLInputElement | null>(null);
	let query = $state('');
	let scope = $state<ScopeId>('all');
	let selectedIndex = $state(0);

	let remoteItems = $state<SearchShareItem[]>([]);
	let remoteTotal = $state(0);
	let searching = $state(false);
	let fetchError = $state(false);

	const scopeTabs: ReadonlyArray<{ id: ScopeId; label: string }> = [
		{ id: 'all', label: t('palette.scope.all') },
		{ id: 'links', label: t('palette.scope.links') },
		{ id: 'sections', label: t('palette.scope.sections') },
		{ id: 'actions', label: t('palette.scope.actions') }
	];

	const trimmedQuery = $derived(query.trim());
	const terms = $derived(highlightTerms(trimmedQuery));
	const foldedQuery = $derived(foldTurkish(trimmedQuery));

	function foldTurkish(text: string): string {
		return text.toLocaleLowerCase('tr').replace(/ı/g, 'i').normalize('NFD').replace(/\p{M}/gu, '');
	}

	function matchesFilter(haystack: string): boolean {
		if (!foldedQuery) {
			return true;
		}
		return foldTurkish(haystack).includes(foldedQuery);
	}

	async function switchTheme(choice: ThemeChoice): Promise<void> {
		themeState?.apply(choice);
		const body = new FormData();
		body.set('theme', choice);
		body.set('returnTo', `${page.url.pathname}${page.url.search}`);
		try {
			// `x-sveltekit-action` makes the action return its result instead of a 303 redirect, so a
			// failed save (expired session, invalid value) is detectable rather than silently ignored.
			const response = await fetch('/settings?/setTheme', {
				method: 'POST',
				headers: { Accept: 'application/json', 'x-sveltekit-action': 'true' },
				body
			});
			const result = deserialize(await response.text());
			if (result.type !== 'success') {
				toasts.push(t('theme.saveFailed'), { tone: 'error' });
			}
		} catch {
			toasts.push(t('theme.saveFailed'), { tone: 'error' });
		}
	}

	interface CommandEntry {
		id: string;
		group: 'links' | 'sections' | 'actions' | 'search';
		title: string;
		subtitle?: string;
		shortcut?: string;
		run: () => void;
	}

	const filteredSections = $derived.by((): CommandEntry[] => {
		if (scope !== 'all' && scope !== 'sections') {
			return [];
		}
		const matched = sections.filter((section) => matchesFilter(`${section.name} ${section.slug}`));
		const visible = trimmedQuery.length > 0 ? matched : matched.slice(0, 6);
		return visible.map((section) => ({
			id: `section-${section.id}`,
			group: 'sections',
			title: section.name,
			subtitle: t('palette.sectionSubtitle'),
			run: () => {
				closePalette();
				void goto(`/sections/${section.slug}`);
			}
		}));
	});

	const filteredActions = $derived.by((): CommandEntry[] => {
		if (scope !== 'all' && scope !== 'actions') {
			return [];
		}
		const currentTheme = themeState?.value ?? 'system';
		const candidates: Array<CommandEntry & { keywords: string }> = [
			{
				id: 'action-compose',
				group: 'actions',
				title: t('palette.action.compose'),
				subtitle: t('palette.action.composeSub'),
				shortcut: 'n',
				keywords: 'yeni baglanti paylas link ekle new share add',
				run: () => {
					closePalette();
					onCompose();
				}
			},
			{
				id: 'action-settings',
				group: 'actions',
				title: t('palette.action.settings'),
				subtitle: t('palette.action.settingsSub'),
				keywords:
					'ayarlar gorunum tema palet vurgu parola hesap dil settings appearance theme language password account',
				run: () => {
					closePalette();
					void goto('/settings');
				}
			},
			{
				id: 'action-api-keys',
				group: 'actions',
				title: t('palette.action.apiKeys'),
				subtitle: t('palette.action.apiKeysSub'),
				keywords: 'api anahtar eklenti token key extension',
				run: () => {
					closePalette();
					void goto('/settings/api-keys');
				}
			}
		];

		if (isAdmin) {
			candidates.push({
				id: 'action-admin',
				group: 'actions',
				title: t('palette.action.admin'),
				subtitle: t('palette.action.adminSub'),
				keywords: 'yonetim admin uyeler davetler olcumler denetim members invites metrics audit',
				run: () => {
					closePalette();
					void goto('/admin/users');
				}
			});
		}

		if (currentTheme !== 'dark') {
			candidates.push({
				id: 'action-theme-dark',
				group: 'actions',
				title: t('palette.action.dark'),
				subtitle: t('palette.action.darkSub'),
				keywords: 'koyu karanlik gece tema dark mod night theme mode',
				run: () => {
					closePalette();
					void switchTheme('dark');
				}
			});
		}
		if (currentTheme !== 'light') {
			candidates.push({
				id: 'action-theme-light',
				group: 'actions',
				title: t('palette.action.light'),
				subtitle: t('palette.action.lightSub'),
				keywords: 'acik gunduz tema light mod day theme mode',
				run: () => {
					closePalette();
					void switchTheme('light');
				}
			});
		}
		if (currentTheme !== 'system') {
			candidates.push({
				id: 'action-theme-system',
				group: 'actions',
				title: t('palette.action.system'),
				subtitle: t('palette.action.systemSub'),
				keywords: 'sistem otomatik tema mod system auto theme mode',
				run: () => {
					closePalette();
					void switchTheme('system');
				}
			});
		}

		candidates.push({
			id: 'action-help',
			group: 'actions',
			title: t('palette.action.help'),
			subtitle: t('palette.action.helpSub'),
			shortcut: '?',
			keywords: 'klavye kisayol yardim keyboard shortcuts help',
			run: () => {
				closePalette();
				onOpenHelp();
			}
		});

		return candidates
			.filter((item) => matchesFilter(`${item.title} ${item.subtitle ?? ''} ${item.keywords}`))
			.map((item) => ({
				id: item.id,
				group: item.group,
				title: item.title,
				subtitle: item.subtitle,
				shortcut: item.shortcut,
				run: item.run
			}));
	});

	const linkEntries = $derived.by((): CommandEntry[] => {
		if (scope !== 'all' && scope !== 'links') {
			return [];
		}
		return remoteItems.map((item) => {
			// The feed's künye order: site · type · sections · author · likes (izgah-ui-v4 §4).
			const subParts = [
				item.resource.domain,
				kunyeCase(contentTypeLabel(item.resource.contentType)),
				...item.sections.map((section) => section.name),
				item.author.name
			];
			if (item.resource.likeCount > 0) {
				subParts.push(t('common.likes', { count: item.resource.likeCount }));
			}
			return {
				id: `link-${item.resource.id}`,
				group: 'links',
				title: item.resource.title || item.resource.domain,
				subtitle: subParts.filter(Boolean).join(' · '),
				run: () => {
					closePalette();
					void goto(`/resources/${item.resource.id}`);
				}
			};
		});
	});

	const searchAllEntry = $derived.by((): CommandEntry | null => {
		if (trimmedQuery.length < 2 || (scope !== 'all' && scope !== 'links')) {
			return null;
		}
		if (remoteItems.length === 0 && !fetchError) {
			return null;
		}
		const label =
			remoteTotal > remoteItems.length
				? t('palette.seeAll', { query: trimmedQuery, count: remoteTotal })
				: t('palette.fullSearch', { query: trimmedQuery });
		return {
			id: 'search-all',
			group: 'search',
			title: label,
			run: () => {
				const target = `/search?q=${encodeURIComponent(trimmedQuery)}`;
				closePalette();
				void goto(target);
			}
		};
	});

	const flatItems = $derived.by((): CommandEntry[] => {
		const list: CommandEntry[] = [...linkEntries, ...filteredSections, ...filteredActions];
		if (searchAllEntry) {
			list.push(searchAllEntry);
		}
		return list;
	});

	const activeOptionId = $derived(
		flatItems[selectedIndex] ? `cmdk-opt-${flatItems[selectedIndex].id}` : undefined
	);

	const statusAnnouncement = $derived.by(() => {
		if (!open) {
			return '';
		}
		if (searching) {
			return t('palette.status.searching');
		}
		if (fetchError) {
			return t('palette.status.error');
		}
		if (flatItems.length === 0) {
			return t('palette.status.empty');
		}
		return t('palette.status.count', { count: flatItems.length });
	});

	function closePalette(): void {
		if (dialogEl?.open) {
			dialogEl.close();
		} else {
			open = false;
		}
	}

	function handleDialogClose(): void {
		if (dialogEl) {
			dialogEl.returnValue = '';
		}
		open = false;
		query = '';
		scope = 'all';
		selectedIndex = 0;
		remoteItems = [];
		remoteTotal = 0;
		searching = false;
		fetchError = false;
	}

	function clearQuery(): void {
		query = '';
		scope = 'all';
		selectedIndex = 0;
		void tick().then(() => {
			inputEl?.focus();
		});
	}

	function setScope(nextScope: ScopeId): void {
		scope = nextScope;
		selectedIndex = 0;
		void tick().then(() => {
			inputEl?.focus();
		});
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (event.isComposing || event.keyCode === 229) {
			return;
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			closePalette();
			return;
		}
		if (event.key === 'ArrowDown') {
			if (flatItems.length === 0) {
				return;
			}
			event.preventDefault();
			selectedIndex = (selectedIndex + 1) % flatItems.length;
			scrollActiveIntoView();
			return;
		}
		if (event.key === 'ArrowUp') {
			if (flatItems.length === 0) {
				return;
			}
			event.preventDefault();
			selectedIndex = (selectedIndex - 1 + flatItems.length) % flatItems.length;
			scrollActiveIntoView();
			return;
		}
		if (event.key === 'Enter') {
			// Only intercept Enter when focus is inside the search input or listbox.
			if (event.target !== inputEl) {
				return;
			}
			const chosen = flatItems[selectedIndex];
			if (chosen) {
				event.preventDefault();
				chosen.run();
			} else if (trimmedQuery.length >= 1) {
				event.preventDefault();
				const target = `/search?q=${encodeURIComponent(trimmedQuery)}`;
				closePalette();
				void goto(target);
			}
		}
	}

	function scrollActiveIntoView(): void {
		void tick().then(() => {
			if (!activeOptionId || !dialogEl) {
				return;
			}
			dialogEl.querySelector<HTMLElement>(`#${CSS.escape(activeOptionId)}`)?.scrollIntoView({
				block: 'nearest'
			});
		});
	}

	// Sync modal <dialog> state with `open` prop.
	$effect(() => {
		const el = dialogEl;
		if (!el) {
			return;
		}
		if (open && !el.open) {
			el.showModal();
			void tick().then(() => {
				inputEl?.focus();
			});
		} else if (!open && el.open) {
			el.close();
		}
	});

	// Keep selectedIndex within bounds whenever results change.
	$effect(() => {
		if (flatItems.length === 0) {
			selectedIndex = 0;
		} else if (selectedIndex >= flatItems.length) {
			selectedIndex = 0;
		}
	});

	// Debounced (200ms) quick search fetch when query >= 2 chars and links scope is active.
	$effect(() => {
		const currentOpen = open;
		const q = trimmedQuery;
		const includeLinks = scope === 'all' || scope === 'links';

		if (!currentOpen || !includeLinks || q.length < 2) {
			remoteItems = [];
			remoteTotal = 0;
			searching = false;
			fetchError = false;
			return;
		}

		// Drop the previous query's matches right away: otherwise they stay selectable during the
		// debounce + request and Enter could open a result that no longer matches the input.
		remoteItems = [];
		remoteTotal = 0;
		searching = true;
		fetchError = false;
		const controller = new AbortController();

		const timer = window.setTimeout(async () => {
			try {
				const response = await fetch(`/api/internal/search/quick?q=${encodeURIComponent(q)}`, {
					method: 'GET',
					headers: { Accept: 'application/json' },
					signal: controller.signal
				});
				if (!response.ok) {
					if (!controller.signal.aborted) {
						fetchError = true;
						remoteItems = [];
						remoteTotal = 0;
						searching = false;
					}
					return;
				}
				const payload = (await response.json()) as {
					items?: SearchShareItem[];
					totalCount?: number;
				};
				if (!controller.signal.aborted) {
					remoteItems = Array.isArray(payload.items) ? payload.items : [];
					remoteTotal =
						typeof payload.totalCount === 'number' ? payload.totalCount : remoteItems.length;
					fetchError = false;
					searching = false;
				}
			} catch (err) {
				if (err instanceof DOMException && err.name === 'AbortError') {
					return;
				}
				if (!controller.signal.aborted) {
					fetchError = true;
					remoteItems = [];
					remoteTotal = 0;
					searching = false;
				}
			}
		}, 200);

		return () => {
			window.clearTimeout(timer);
			controller.abort();
		};
	});

	// Light-dismiss fallback for browsers without native `closedby="any"` (Safari).
	$effect(() => {
		const el = dialogEl;
		if (!el || 'closedBy' in HTMLDialogElement.prototype) {
			return;
		}

		let pressedOutside = false;

		const isOutside = (event: PointerEvent): boolean => {
			const rect = el.getBoundingClientRect();
			return (
				event.clientX < rect.left ||
				event.clientX > rect.right ||
				event.clientY < rect.top ||
				event.clientY > rect.bottom
			);
		};

		const onPointerDown = (event: PointerEvent) => {
			pressedOutside = event.target === el && isOutside(event);
		};

		const onPointerUp = (event: PointerEvent) => {
			if (pressedOutside && event.target === el && isOutside(event)) {
				closePalette();
			}
			pressedOutside = false;
		};

		el.addEventListener('pointerdown', onPointerDown);
		el.addEventListener('pointerup', onPointerUp);

		return () => {
			el.removeEventListener('pointerdown', onPointerDown);
			el.removeEventListener('pointerup', onPointerUp);
		};
	});

	function indexOfEntry(entryId: string): number {
		return flatItems.findIndex((entry) => entry.id === entryId);
	}
</script>

<dialog
	bind:this={dialogEl}
	id="command-palette-dialog"
	class="izgah-dialog cmdk-dialog"
	aria-label={t('palette.label')}
	closedby="any"
	onclose={handleDialogClose}
>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="cmdk-shell" onkeydown={handleKeydown}>
		<div class="cmdk-input-row">
			<input
				bind:this={inputEl}
				class="cmdk-input"
				type="search"
				bind:value={query}
				role="combobox"
				aria-label={t('palette.inputLabel')}
				aria-autocomplete="list"
				aria-expanded={flatItems.length > 0}
				aria-controls="cmdk-listbox"
				aria-activedescendant={activeOptionId}
				placeholder={t('palette.placeholder')}
				autocomplete="off"
				autocapitalize="none"
				spellcheck={false}
			/>
			{#if query.length > 0}
				<button
					type="button"
					class="cmdk-clear-btn"
					onclick={clearQuery}
					aria-label={t('palette.clear')}
				>
					{t('palette.clearShort')}
				</button>
			{/if}
			<button
				type="button"
				class="cmdk-esc-btn"
				onclick={closePalette}
				aria-label={t('palette.close')}
			>
				<kbd class="kbd">Esc</kbd>
			</button>
		</div>

		<div class="cmdk-scopes" role="group" aria-label={t('palette.scopeLabel')}>
			{#each scopeTabs as tab (tab.id)}
				<button
					type="button"
					aria-pressed={scope === tab.id}
					aria-controls="cmdk-listbox"
					class="cmdk-scope"
					class:is-active={scope === tab.id}
					onclick={() => setScope(tab.id)}
				>
					{tab.label}
				</button>
			{/each}
		</div>

		<div class="visually-hidden" aria-live="polite" aria-atomic="true">
			{statusAnnouncement}
		</div>

		<div id="cmdk-listbox" class="cmdk-body" role="listbox" aria-label={t('palette.results')}>
			{#if searching && (scope === 'all' || scope === 'links')}
				<div class="cmdk-group">
					<div class="cmdk-group-label">{t('palette.group.links')}</div>
					<div class="cmdk-skeleton-list" aria-hidden="true">
						<div class="cmdk-skeleton-row">
							<Skeleton class="size-7 shrink-0 rounded-md" />
							<div class="cmdk-skeleton-text">
								<Skeleton class="h-3.5 w-[76%]" />
								<Skeleton class="h-2.5 w-[48%]" />
							</div>
						</div>
						<div class="cmdk-skeleton-row">
							<Skeleton class="size-7 shrink-0 rounded-md" />
							<div class="cmdk-skeleton-text">
								<Skeleton class="h-3.5 w-[64%]" />
								<Skeleton class="h-2.5 w-[40%]" />
							</div>
						</div>
					</div>
				</div>
			{:else if fetchError && (scope === 'all' || scope === 'links')}
				<div class="cmdk-error" role="status">
					<span>{t('palette.linkSearchFailed')}</span>
					{#if trimmedQuery.length > 0}
						<a
							href="/search?q={encodeURIComponent(trimmedQuery)}"
							class="cmdk-inline-link"
							onclick={closePalette}
						>
							{t('palette.openFullSearch')}
						</a>
					{/if}
				</div>
			{/if}

			{#if linkEntries.length > 0}
				<div class="cmdk-group">
					<div class="cmdk-group-label">{t('palette.group.links')}</div>
					{#each linkEntries as entry (entry.id)}
						{@const idx = indexOfEntry(entry.id)}
						<button
							id="cmdk-opt-{entry.id}"
							type="button"
							role="option"
							aria-selected={idx === selectedIndex}
							class="cmdk-item"
							class:is-selected={idx === selectedIndex}
							onmouseenter={() => {
								selectedIndex = idx;
							}}
							onclick={entry.run}
						>
							<span class="cmdk-item-main">
								<span class="cmdk-item-title">
									<Highlight text={entry.title} {terms} />
								</span>
								{#if entry.subtitle}
									<span class="cmdk-item-sub">
										<Highlight text={entry.subtitle} {terms} />
									</span>
								{/if}
							</span>
							{#if idx === selectedIndex}
								<kbd class="kbd" aria-hidden="true">↵</kbd>
							{/if}
						</button>
					{/each}
				</div>
			{/if}

			{#if filteredSections.length > 0}
				<div class="cmdk-group">
					<div class="cmdk-group-label">{t('palette.group.sections')}</div>
					{#each filteredSections as entry (entry.id)}
						{@const idx = indexOfEntry(entry.id)}
						<button
							id="cmdk-opt-{entry.id}"
							type="button"
							role="option"
							aria-selected={idx === selectedIndex}
							class="cmdk-item"
							class:is-selected={idx === selectedIndex}
							onmouseenter={() => {
								selectedIndex = idx;
							}}
							onclick={entry.run}
						>
							<span class="cmdk-item-main">
								<span class="cmdk-item-title">
									<Highlight text={entry.title} {terms} />
								</span>
							</span>
							{#if idx === selectedIndex}
								<kbd class="kbd" aria-hidden="true">↵</kbd>
							{/if}
						</button>
					{/each}
				</div>
			{/if}

			{#if filteredActions.length > 0}
				<div class="cmdk-group">
					<div class="cmdk-group-label">{t('palette.group.actions')}</div>
					{#each filteredActions as entry (entry.id)}
						{@const idx = indexOfEntry(entry.id)}
						<button
							id="cmdk-opt-{entry.id}"
							type="button"
							role="option"
							aria-selected={idx === selectedIndex}
							class="cmdk-item"
							class:is-selected={idx === selectedIndex}
							onmouseenter={() => {
								selectedIndex = idx;
							}}
							onclick={entry.run}
						>
							<span class="cmdk-item-main">
								<span class="cmdk-item-title">
									<Highlight text={entry.title} {terms} />
								</span>
								{#if entry.subtitle}
									<span class="cmdk-item-sub">{entry.subtitle}</span>
								{/if}
							</span>
							{#if entry.shortcut}
								<kbd class="kbd" aria-hidden="true">{entry.shortcut}</kbd>
							{/if}
						</button>
					{/each}
				</div>
			{/if}

			{#if searchAllEntry}
				{@const idx = indexOfEntry(searchAllEntry.id)}
				<div class="cmdk-group cmdk-group-tail">
					<button
						id="cmdk-opt-{searchAllEntry.id}"
						type="button"
						role="option"
						aria-selected={idx === selectedIndex}
						class="cmdk-item"
						class:is-selected={idx === selectedIndex}
						onmouseenter={() => {
							selectedIndex = idx;
						}}
						onclick={searchAllEntry.run}
					>
						<span class="cmdk-item-main">
							<span class="cmdk-item-title">{searchAllEntry.title}</span>
						</span>
						<kbd class="kbd" aria-hidden="true">↵</kbd>
					</button>
				</div>
			{/if}

			{#if !searching && flatItems.length === 0}
				<div class="cmdk-empty">
					<p class="cmdk-empty-title">
						{#if trimmedQuery.length > 0}
							{t('palette.noMatch', { query: trimmedQuery })}
						{:else if scope === 'links'}
							{t('palette.minChars')}
						{:else}
							{t('palette.nothing')}
						{/if}
					</p>
					<div class="cmdk-empty-actions">
						{#if trimmedQuery.length > 0 || scope !== 'all'}
							<button type="button" class="btn btn-subtle btn-sm" onclick={clearQuery}>
								{t('palette.clear')}
							</button>
						{/if}
						{#if trimmedQuery.length > 0}
							<a
								href="/search?q={encodeURIComponent(trimmedQuery)}"
								class="btn btn-outline btn-sm"
								onclick={closePalette}
							>
								{t('palette.goFullSearch')}
							</a>
						{/if}
					</div>
				</div>
			{/if}
		</div>

		<div class="cmdk-foot">
			<div class="cmdk-hints" aria-hidden="true">
				<span class="cmdk-hint">
					<kbd class="kbd">↑</kbd><kbd class="kbd">↓</kbd>
					{t('palette.hint.navigate')}
				</span>
				<span class="cmdk-hint"><kbd class="kbd">↵</kbd> {t('palette.hint.open')}</span>
				<span class="cmdk-hint"><kbd class="kbd">Esc</kbd> {t('palette.hint.close')}</span>
			</div>
			<span class="cmdk-count">{t('palette.resultCount', { count: flatItems.length })}</span>
		</div>
	</div>
</dialog>

<style>
	/* Do NOT set display unconditionally on <dialog>; scope layout inside [open] (modern-web-guidance). */
	dialog.cmdk-dialog {
		max-inline-size: 37.5rem;
		inline-size: calc(100% - 2 * var(--gutter));
		max-block-size: min(76dvh, 36rem);
		margin-block-start: min(11vh, 6rem);
		margin-inline: auto;
		padding: 0;
		overflow: hidden;
	}

	dialog.cmdk-dialog[open] {
		display: flex;
		flex-direction: column;
	}

	.cmdk-shell {
		display: flex;
		flex-direction: column;
		min-block-size: 0;
		max-block-size: inherit;
	}

	.cmdk-input-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: 12px var(--space-4);
		border-block-end: 1px solid var(--border);
	}

	.cmdk-input {
		flex: 1 1 auto;
		min-inline-size: 0;
		border: 0;
		background: transparent;
		font: var(--type-body);
		color: var(--foreground);
		outline: none;
		box-shadow: none;
	}

	.cmdk-input:focus-visible {
		outline: none;
		box-shadow: none;
	}

	.cmdk-input::placeholder {
		color: var(--muted-foreground);
	}

	.cmdk-input::-webkit-search-cancel-button {
		appearance: none;
	}

	.cmdk-clear-btn,
	.cmdk-esc-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: none;
		padding: 2px;
		background: transparent;
		border: 0;
		border-radius: 4px;
		color: var(--muted-foreground);
		cursor: pointer;
	}

	.cmdk-clear-btn {
		font: var(--type-hint);
		text-decoration: underline;
		text-decoration-color: var(--input);
		text-underline-offset: 0.2em;
	}

	.cmdk-clear-btn:hover {
		color: var(--foreground);
		background: var(--muted);
	}

	.cmdk-scopes {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: var(--space-2) var(--space-4);
		border-block-end: 1px solid var(--border);
		overflow-x: auto;
	}

	.cmdk-scope {
		display: inline-flex;
		align-items: center;
		min-block-size: 26px;
		padding: 0 10px;
		border-radius: 9999px;
		font: var(--type-ui);
		font-size: 0.78125rem;
		color: var(--muted-foreground);
		background: transparent;
		border: 1px solid transparent;
		white-space: nowrap;
		cursor: pointer;
		transition:
			background-color var(--dur-fast) var(--ease),
			color var(--dur-fast) var(--ease),
			border-color var(--dur-fast) var(--ease);
	}

	.cmdk-scope:hover:not(.is-active) {
		color: var(--foreground);
	}

	.cmdk-scope.is-active {
		color: var(--foreground);
		font-weight: 600;
		text-decoration: underline;
		text-underline-offset: 0.3em;
	}

	.cmdk-body {
		flex: 1 1 auto;
		overflow-y: auto;
		padding: var(--space-2);
		display: grid;
		align-content: start;
		gap: var(--space-2);
	}

	.cmdk-group {
		display: grid;
		gap: 2px;
	}

	.cmdk-group-tail {
		padding-block-start: var(--space-2);
		border-block-start: 1px solid var(--border);
	}

	.cmdk-group-label {
		padding: 6px 10px 3px;
		font: var(--type-ui);
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--muted-foreground);
	}

	.cmdk-item {
		display: flex;
		align-items: center;
		gap: 10px;
		inline-size: 100%;
		padding: var(--space-2) 10px;
		border: 1px solid transparent;
		border-radius: 6px;
		background: transparent;
		color: var(--foreground);
		text-align: start;
		cursor: pointer;
		transition:
			background-color var(--dur-fast) var(--ease),
			border-color var(--dur-fast) var(--ease);
	}

	.cmdk-item.is-selected {
		background: var(--muted);
		border-color: var(--border);
	}

	.cmdk-item-main {
		flex: 1 1 auto;
		min-inline-size: 0;
		display: grid;
		gap: 1px;
	}

	.cmdk-item-title {
		font: var(--type-ui);
		font-weight: 500;
		color: var(--foreground);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.cmdk-item-sub {
		font: var(--type-hint);
		font-size: 0.75rem;
		color: var(--muted-foreground);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.cmdk-skeleton-list {
		display: grid;
		gap: var(--space-1);
		padding: var(--space-1) var(--space-2);
	}

	.cmdk-skeleton-row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 6px 2px;
	}

	.cmdk-skeleton-text {
		flex: 1 1 auto;
		display: grid;
		gap: 4px;
	}

	.cmdk-error {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin: var(--space-1) var(--space-2);
		padding: var(--space-2) var(--space-3);
		border-radius: 6px;
		background: color-mix(in oklab, var(--destructive) 10%, transparent);
		border: 1px solid color-mix(in oklab, var(--destructive) 40%, transparent);
		color: var(--destructive);
		font: var(--type-hint);
	}

	.cmdk-inline-link {
		margin-inline-start: auto;
		font-weight: 600;
		color: inherit;
	}

	.cmdk-empty {
		display: grid;
		justify-items: center;
		gap: var(--space-3);
		padding: var(--space-6) var(--space-4);
		text-align: center;
	}

	.cmdk-empty-title {
		font: var(--type-ui);
		color: var(--muted-foreground);
	}

	.cmdk-empty-actions {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		justify-content: center;
		gap: var(--space-2);
	}

	.cmdk-foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: 9px var(--space-4);
		border-block-start: 1px solid var(--border);
		font: var(--type-meta);
		color: var(--muted-foreground);
	}

	.cmdk-hints {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		flex-wrap: wrap;
	}

	.cmdk-hint {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}

	.cmdk-count {
		font: var(--type-meta);
		color: var(--muted-foreground);
		white-space: nowrap;
	}

	@media (forced-colors: active) {
		.cmdk-scope.is-active,
		.cmdk-item.is-selected {
			forced-color-adjust: none;
			background: Highlight;
			color: HighlightText;
			border-color: Highlight;
		}

		.cmdk-item.is-selected .cmdk-item-title,
		.cmdk-item.is-selected .cmdk-item-sub {
			color: HighlightText;
		}
	}
</style>
