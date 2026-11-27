<script lang="ts">
	import { t } from '#lib/i18n/index.ts';
	import { goto, invalidate, preloadData } from '$app/navigation';
	import { page } from '$app/state';
	import { tick, untrack } from 'svelte';
	import { flip } from 'svelte/animate';
	import { DURATION, duration, motionFly } from '#lib/motion/index.ts';
	import { toasts } from '#lib/client/toast.svelte.ts';
	import FeedFilterBar from '#lib/components/feed/FeedFilterBar.svelte';
	import NewPostsPill from '#lib/components/feed/NewPostsPill.svelte';
	import PostCard from '#lib/components/feed/PostCard.svelte';
	import ShareComposerDialog, {
		type ShareComposerInitialState
	} from '#lib/components/feed/ShareComposerDialog.svelte';
	import SidePeekDialog from '#lib/components/feed/SidePeekDialog.svelte';
	import { FeedState } from '#lib/feed/feed-state.svelte.ts';
	import { groupByDay } from '#lib/feed/group-by-day.ts';
	import { dayDetail, dayKey, dayLabel, formatTime } from '#lib/format/date.ts';
	import type { SectionListItem } from '#lib/server/sections/service.ts';
	import type { ContentType } from '#lib/types/domain.ts';
	import type { FeedShareItem, FeedSnapshot } from '#lib/types/feed.ts';

	export interface FeedViewData {
		items: FeedShareItem[];
		hasMore: boolean;
		nextCursor: string | null;
		activeType: ContentType | null;
		hasCursorApplied: boolean;
		sections: SectionListItem[];
		user: { id: string; name?: string; role: 'member' | 'admin' };
		todayKey: string;
	}

	interface Props {
		data: FeedViewData;
		basePath: string;
		headingId: string;
		heading: string;
		description?: string | null;
		emptyFiltered: string;
		emptyFilteredReset: string;
		emptyAll: string;
		paginationLabel: string;
		/** Section pages pre-select their own section in the inline composer. */
		presetSectionIds?: string[];
		/** Section scope for the last-visit marker and the new-posts pill; null on the main feed. */
		sectionId?: string | null;
	}

	let {
		data,
		basePath,
		headingId,
		heading,
		description = null,
		emptyFiltered,
		emptyFilteredReset,
		emptyAll,
		paginationLabel,
		presetSectionIds = [],
		sectionId = null
	}: Props = $props();

	const PAGE_SIZE = 25;
	const DEFERRED_FROM_INDEX = 5;

	const queryKeyOf = () =>
		`${page.url.pathname}|${data.activeType ?? ''}|${page.url.searchParams.get('cursor') ?? ''}`;
	const feed = new FeedState<FeedShareItem>(
		untrack(() => data.items),
		untrack(queryKeyOf),
		PAGE_SIZE
	);

	$effect.pre(() => {
		feed.sync(data.items, queryKeyOf());
	});

	let loadingMore = $state(false);
	let loadMoreFailed = $state(false);
	let liveAnnouncement = $state('');
	let peekItem = $state<FeedShareItem | null>(null);

	const effectiveHasMore = $derived(feed.hasMoreOverride ?? data.hasMore);
	const effectiveNextCursor = $derived(
		feed.nextCursorOverride !== undefined ? feed.nextCursorOverride : data.nextCursor
	);
	const firstImageIndex = $derived(
		feed.items.findIndex((item) => Boolean(item.resource.thumbnailAssetKey))
	);

	// Day groups come from the merged list, so they stay continuous after "Load more"
	// (§8.3). Global indices drive content-visibility and the priority image, because
	// :nth-child restarts in every group.
	const dayGroups = $derived(groupByDay(feed.items, data.todayKey));
	const indexById = $derived(new Map(feed.items.map((item, index) => [item.id, index])));

	// Last-visit marker (§8.4): read only in the browser, cursor-less first page only.
	const firstPageView = $derived(!data.hasCursorApplied);
	const lastSeenStorageKey = $derived(
		`izgah:lastSeen:${sectionId ? `section:${sectionId}` : 'feed'}`
	);
	let lastSeenAtLoad = $state<string | null>(null);

	$effect(() => {
		if (!firstPageView) {
			return;
		}
		const key = lastSeenStorageKey;
		let stored: string | null;
		try {
			stored = localStorage.getItem(key);
		} catch {
			return;
		}
		const initial = stored && !Number.isNaN(Date.parse(stored)) ? stored : null;
		lastSeenAtLoad = initial;

		// Moves the marker forward to the newest listed post, never backwards.
		const advance = () => {
			const newest = untrack(() => feed.items[0]?.createdAt);
			if (!newest) {
				return;
			}
			try {
				const current = localStorage.getItem(key);
				if (
					!current ||
					Number.isNaN(Date.parse(current)) ||
					Date.parse(newest) > Date.parse(current)
				) {
					localStorage.setItem(key, newest);
				}
			} catch {
				// Storage became unavailable; the marker simply stays where it was.
			}
		};
		if (!initial) {
			// First visit: no marker, only remember where the reader is.
			advance();
		}
		const onVisibility = () => {
			if (document.visibilityState === 'hidden') {
				advance();
			}
		};
		document.addEventListener('visibilitychange', onVisibility);
		window.addEventListener('pagehide', advance);
		return () => {
			advance();
			document.removeEventListener('visibilitychange', onVisibility);
			window.removeEventListener('pagehide', advance);
		};
	});

	const lastSeenMarker = $derived.by(() => {
		if (!firstPageView || !lastSeenAtLoad) {
			return null;
		}
		const lastSeenMs = Date.parse(lastSeenAtLoad);
		const unseen = new Set<string>();
		let firstSeenId: string | null = null;
		for (const item of feed.items) {
			if (Date.parse(item.createdAt) > lastSeenMs) {
				if (item.author.id !== data.user.id) {
					unseen.add(item.id);
				}
			} else if (!firstSeenId) {
				firstSeenId = item.id;
			}
		}
		if (unseen.size === 0 || !firstSeenId) {
			return null;
		}
		const seenDay = dayKey(lastSeenAtLoad);
		const time = formatTime(lastSeenAtLoad);
		const label = seenDay === data.todayKey ? time : `${dayLabel(seenDay, data.todayKey)} ${time}`;
		return { unseen, firstSeenId, label };
	});

	/** Called by the page's `snapshot.capture` (izgah-ui-v2 §8.6). */
	export function captureSnapshot(): FeedSnapshot | null {
		if (feed.appended.length === 0) {
			return null;
		}
		return {
			key: queryKeyOf(),
			appended: feed.appended,
			hasMore: feed.hasMoreOverride,
			nextCursor: feed.nextCursorOverride ?? null,
			scrollY: window.scrollY
		};
	}

	/**
	 * Called by the page's `snapshot.restore` on Back/Forward. Kit restores the scroll position
	 * before the snapshot, while only the first page exists, so it is re-applied afterwards.
	 */
	export async function restoreSnapshot(snapshot: FeedSnapshot): Promise<void> {
		if (snapshot.key !== queryKeyOf() || snapshot.appended.length === 0) {
			return;
		}
		feed.restore(snapshot.appended, snapshot.hasMore, snapshot.nextCursor);
		await tick();
		window.scrollTo({ top: snapshot.scrollY });
	}

	async function loadNewPosts(): Promise<void> {
		const before = new Set(feed.items.map((item) => item.id));
		await invalidate('app:feed');
		await tick();
		const fresh = feed.items.filter((item) => !before.has(item.id));
		window.scrollTo({ top: 0 });
		if (fresh[0]) {
			document.getElementById(`share-${fresh[0].id}`)?.focus({ preventScroll: true });
		}
		toasts.announce(
			fresh.length > 0 ? t('feed.loadedNew', { count: fresh.length }) : t('feed.noNew')
		);
	}

	const cleanReturnTo = $derived.by(() => {
		const params = new URLSearchParams(page.url.search);
		params.delete('compose');
		params.delete('edit');
		params.delete('delete');
		const encoded = params.toString();
		return encoded ? `${basePath}?${encoded}` : basePath;
	});
	const resetHref = $derived(
		data.activeType ? `${basePath}?type=${encodeURIComponent(data.activeType)}` : basePath
	);
	const loadMoreHref = $derived.by(() => {
		if (!effectiveNextCursor) {
			return basePath;
		}
		const params = new URLSearchParams();
		if (data.activeType) {
			params.set('type', data.activeType);
		}
		params.set('cursor', effectiveNextCursor);
		return `${basePath}?${params.toString()}`;
	});

	// A failed no-JS share re-renders the page with the createShare result (izgah-ui-v2 §8.1).
	const composerInitialValues = $derived.by((): ShareComposerInitialState | undefined => {
		const raw = page.form as
			| {
					formType?: string;
					errorMessage?: string;
					fieldErrors?: Record<string, string[]>;
					values?: ShareComposerInitialState;
			  }
			| null
			| undefined;
		if (raw?.formType !== 'createShare') {
			return undefined;
		}
		return {
			...raw.values,
			errorMessage: raw.errorMessage,
			fieldErrors: raw.fieldErrors
		};
	});

	// Pending previews: refresh up to 5 times every 3s while the tab is visible (core §6).
	let pollCount = 0;
	let knownPendingIds = new Set<string>();
	const pendingUnfurlIds = $derived(
		feed.items
			.filter(
				(item) =>
					item.resource.unfurlStatus === 'queued' || item.resource.unfurlStatus === 'running'
			)
			.map((item) => item.id)
	);

	$effect(() => {
		const ids = pendingUnfurlIds;
		if (ids.length === 0) {
			knownPendingIds.clear();
			pollCount = 0;
			return;
		}
		if (ids.some((id) => !knownPendingIds.has(id))) {
			knownPendingIds = new Set(ids);
			pollCount = 0;
		}
		if (pollCount >= 5) {
			return;
		}
		let timerId: number | null = null;
		const schedule = () => {
			if (document.visibilityState !== 'visible' || timerId !== null) {
				return;
			}
			timerId = window.setTimeout(() => {
				timerId = null;
				if (document.visibilityState !== 'visible') {
					return;
				}
				pollCount += 1;
				void invalidate('app:feed');
			}, 3000);
		};
		const onVisibility = () => {
			if (document.visibilityState === 'visible') {
				schedule();
			} else if (timerId !== null) {
				window.clearTimeout(timerId);
				timerId = null;
			}
		};
		schedule();
		document.addEventListener('visibilitychange', onVisibility);
		return () => {
			if (timerId !== null) {
				window.clearTimeout(timerId);
			}
			document.removeEventListener('visibilitychange', onVisibility);
		};
	});

	function focusPost(id: string | undefined): void {
		if (!id) {
			document.getElementById(headingId)?.focus({ preventScroll: true });
			return;
		}
		document.getElementById(`share-${id}`)?.focus();
	}

	function handleShareDeleted(shareId: string): void {
		const index = feed.items.findIndex((item) => item.id === shareId);
		const next = feed.items[index + 1] ?? feed.items[index - 1];
		if (peekItem?.id === shareId) {
			peekItem = null;
		}
		feed.remove(shareId);
		// Move focus off the removed card (F13).
		queueMicrotask(() => focusPost(next?.id));
	}

	function handlePreview(item: FeedShareItem): void {
		peekItem = item;
	}

	// While the docked reading pane is open, moving focus to another post (j/k, Tab, click) shows
	// that post in the pane (izgah-ui-v4 §3). The modal drawer is unaffected: it holds the focus.
	function handleFeedFocusIn(event: FocusEvent): void {
		if (!peekItem || !document.querySelector('dialog.side-peek-dialog.is-docked[open]')) {
			return;
		}
		const post = (event.target as HTMLElement | null)?.closest?.<HTMLElement>(
			'article[id^="share-"]'
		);
		const id = post?.id.slice('share-'.length);
		if (!id || id === peekItem.id) {
			return;
		}
		const next = feed.items.find((item) => item.id === id);
		if (next) {
			peekItem = next;
		}
	}

	async function handleLoadMore(event: MouseEvent): Promise<void> {
		if (
			event.defaultPrevented ||
			event.button !== 0 ||
			event.metaKey ||
			event.ctrlKey ||
			event.shiftKey ||
			event.altKey ||
			loadingMore ||
			!effectiveNextCursor
		) {
			return;
		}
		event.preventDefault();
		const targetHref = loadMoreHref;
		loadingMore = true;
		loadMoreFailed = false;
		try {
			const result = await preloadData(targetHref);
			// SvelteKit 3 reports a failed load as an error result rather than a loaded 5xx.
			if (result.type === 'error' || (result.type === 'loaded' && result.status >= 500)) {
				// Keep the reader in place instead of replacing the feed with an error page.
				loadMoreFailed = true;
				return;
			}
			if (result.type === 'loaded' && result.status === 200 && result.data) {
				const loaded = result.data as {
					items?: FeedShareItem[];
					hasMore?: boolean;
					nextCursor?: string | null;
				};
				const incoming = loaded.items ?? [];
				// Snapshot ids before appending: afterwards every incoming item is present, so a
				// duplicate carried over from the first page would otherwise steal focus.
				const knownIds = new Set(feed.items.map((entry) => entry.id));
				const firstNew = incoming.find((item) => !knownIds.has(item.id));
				const added = feed.append(incoming, Boolean(loaded.hasMore), loaded.nextCursor ?? null);
				liveAnnouncement = added > 0 ? t('feed.loadedMore', { count: added }) : t('feed.noNewDot');
				// Keep keyboard users in place: focus the first newly loaded post (F13).
				if (added > 0 && firstNew) {
					queueMicrotask(() => focusPost(firstNew.id));
				}
				return;
			}
			await goto(targetHref);
		} catch {
			loadMoreFailed = true;
		} finally {
			loadingMore = false;
		}
	}
</script>

<section class="feed-view" aria-labelledby={headingId} onfocusin={handleFeedFocusIn}>
	<header class="feed-head">
		<div class="feed-head-copy">
			<h1 id={headingId} tabindex="-1">{heading}</h1>
			{#if description}
				<p class="feed-desc">{description}</p>
			{/if}
		</div>
	</header>

	<FeedFilterBar {basePath} activeType={data.activeType} />

	<ShareComposerDialog
		variant="feed"
		sections={data.sections}
		isAdmin={data.user.role === 'admin'}
		actionUrl={basePath}
		returnTo={cleanReturnTo}
		{presetSectionIds}
		initialValues={composerInitialValues}
	/>

	<p class="visually-hidden" aria-live="polite">{liveAnnouncement}</p>

	<NewPostsPill
		enabled={firstPageView}
		{sectionId}
		type={data.activeType}
		newestId={feed.items[0]?.id ?? null}
		onLoad={loadNewPosts}
	/>

	{#if feed.items.length === 0}
		<div class="empty-state-box empty-feed">
			{#if data.activeType}
				<p>{emptyFiltered}</p>
				<a href={basePath} class="btn btn-outline">{emptyFilteredReset}</a>
			{:else if data.hasCursorApplied}
				<p>{t('feed.noOlder')}</p>
				<a href={resetHref} class="btn btn-outline">{t('feed.backToTop')}</a>
			{:else}
				<p>{emptyAll}</p>
			{/if}
		</div>
	{:else}
		{#each dayGroups as group (group.key)}
			<section class="day-group" aria-labelledby="{headingId}-day-{group.key}">
				<div class="day-row">
					<h2 id="{headingId}-day-{group.key}" class="day-heading">
						{group.label}
						{#if dayDetail(group.key, data.todayKey)}
							<span class="day-date">{dayDetail(group.key, data.todayKey)}</span>
						{/if}
					</h2>
					<span class="day-count">{t('feed.dayCount', { count: group.items.length })}</span>
				</div>
				<ol class="feed-list" role="list">
					{#each group.items as item (item.id)}
						{@const index = indexById.get(item.id) ?? 0}
						{@const firstSeen = lastSeenMarker?.firstSeenId === item.id}
						<li
							class:is-deferred={index >= DEFERRED_FROM_INDEX}
							class:is-first-seen={firstSeen}
							in:motionFly={{ y: -8 }}
							animate:flip={{ duration: duration(DURATION.base) }}
						>
							{#if firstSeen && lastSeenMarker}
								<p class="last-seen-label">
									<span aria-hidden="true">
										{t('feed.lastVisit', { time: lastSeenMarker.label })}
									</span>
									<span class="visually-hidden">{t('feed.lastVisitSr')}</span>
								</p>
							{/if}
							<PostCard
								{item}
								sections={data.sections}
								currentUserId={data.user.id}
								isAdmin={data.user.role === 'admin'}
								actionBase={basePath}
								returnTo={cleanReturnTo}
								priorityImage={index === firstImageIndex}
								unseen={lastSeenMarker?.unseen.has(item.id) ?? false}
								selected={peekItem?.id === item.id}
								onDeleted={handleShareDeleted}
								onPreview={handlePreview}
							/>
						</li>
					{/each}
				</ol>
			</section>
		{/each}
	{/if}

	{#if data.hasCursorApplied || (effectiveHasMore && effectiveNextCursor)}
		<nav class="pagination-bar" aria-label={paginationLabel}>
			{#if data.hasCursorApplied}
				<a href={resetHref} class="btn btn-outline">{t('feed.backToTop')}</a>
			{/if}
			{#if effectiveHasMore && effectiveNextCursor}
				<a
					href={loadMoreHref}
					class="btn btn-outline load-more"
					class:is-loading={loadingMore}
					aria-busy={loadingMore}
					data-sveltekit-preload-data="false"
					onclick={handleLoadMore}
				>
					{loadingMore
						? t('common.loading')
						: loadMoreFailed
							? t('common.retry')
							: t('feed.loadMore')}
				</a>
			{/if}
		</nav>
		{#if loadMoreFailed}
			<p class="banner banner-error load-more-error" role="alert">
				<span>{t('feed.loadMoreFailed')}</span>
			</p>
		{/if}
	{/if}
</section>

<SidePeekDialog
	item={peekItem}
	onClose={() => {
		peekItem = null;
	}}
/>

<style>
	/* Feed (izgah-ui-v5.md §5.1, §5.2): cards on a calm column, sticky day rows, an accent
	   last-visit marker. */
	.feed-view {
		inline-size: 100%;
		max-inline-size: var(--read-w);
		margin-inline: auto;
	}

	.feed-head {
		padding-block-end: var(--space-4);
	}

	.feed-head h1 {
		font-size: 1.625rem;
		font-weight: 600;
		line-height: 1.1;
		letter-spacing: -0.03em;
	}

	.feed-desc {
		margin-block-start: 6px;
		font-size: 13px;
		color: var(--muted-foreground);
	}

	.day-group {
		margin-block-start: var(--space-5);
	}

	.day-row {
		position: sticky;
		inset-block-start: var(--header-h);
		z-index: 5;
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding-block: var(--space-3) var(--space-2);
		background: var(--background);
	}

	.day-row::after {
		content: '';
		order: 1;
		flex: 1;
		block-size: 1px;
		background: var(--hairline);
	}

	.day-group .day-heading {
		position: static;
		margin: 0;
		padding: 0;
		font-size: 12px;
		font-weight: 500;
		letter-spacing: 0;
		background: none;
		border: 0;
	}

	.day-date {
		margin-inline-start: var(--space-2);
		font-weight: 400;
		color: var(--muted-foreground);
	}

	.day-count {
		order: 2;
		font-size: 12px;
		font-variant-numeric: tabular-nums;
		color: var(--muted-foreground);
	}

	.feed-view .feed-list {
		gap: var(--space-3);
	}

	.empty-feed {
		justify-items: center;
		margin-block-start: var(--space-2);
		padding: var(--space-7) var(--space-5);
		text-align: center;
		border: 1px dashed var(--hairline);
		border-radius: var(--radius-lg);
	}

	.empty-feed p {
		color: var(--muted-foreground);
	}

	.pagination-bar {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		padding-block: var(--space-5);
	}

	.load-more {
		inline-size: 100%;
	}

	.load-more-error {
		margin-block-end: var(--space-5);
	}

	.load-more.is-loading {
		color: var(--muted-foreground);
		cursor: progress;
	}

	/* j/k reveal posts below the sticky day row as well as the sticky bars. */
	.feed-list :global(.share-card) {
		scroll-margin-block-start: calc(var(--space-7) + var(--space-3));
	}

	.last-seen-label {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin: 0 0 var(--space-2);
		font-size: 12px;
		font-weight: 500;
		color: var(--primary);
	}

	.last-seen-label::after {
		content: '';
		flex: 1;
		block-size: 1px;
		background: color-mix(in oklab, var(--primary) 40%, transparent);
	}

	@media (forced-colors: active) {
		.last-seen-label {
			background: Highlight;
			color: HighlightText;
		}
	}
</style>
