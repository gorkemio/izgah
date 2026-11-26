<script lang="ts">
	import { t } from '#lib/i18n/index.ts';
	import type { ContentType } from '#lib/server/db/schema.ts';

	/**
	 * Content-type filter as a "Filter" disclosure (docs/designs/izgah-ui-v4.md §7): a native
	 * <details> that starts closed, opens itself while a type is active, and needs no JavaScript.
	 * The links keep the `?type=` URLs, so filters stay shareable and work in search.
	 */
	interface Props {
		basePath: string;
		activeType: ContentType | null;
		preserveParams?: Record<string, string | null | undefined>;
	}

	let { basePath, activeType, preserveParams }: Props = $props();

	const FILTER_ITEMS: ReadonlyArray<{ param: ContentType | null; label: string }> = [
		{ param: null, label: t('filter.all') },
		{ param: 'article', label: t('contentType.article') },
		{ param: 'video', label: t('contentType.video') },
		{ param: 'repo', label: t('contentType.repo') },
		{ param: 'social', label: t('contentType.social') },
		{ param: 'web', label: t('contentType.web') }
	];

	function buildFilterHref(value: ContentType | null): string {
		const params = new URLSearchParams();
		if (preserveParams) {
			for (const [key, paramValue] of Object.entries(preserveParams)) {
				const trimmed = paramValue?.trim();
				if (trimmed) {
					params.set(key, trimmed);
				}
			}
		}
		if (value) {
			params.set('type', value);
		}
		const encoded = params.toString();
		return encoded ? `${basePath}?${encoded}` : basePath;
	}

	const activeLabel = $derived(
		activeType ? (FILTER_ITEMS.find((item) => item.param === activeType)?.label ?? null) : null
	);
</script>

<details class="feed-filter" open={activeType !== null}>
	<summary>
		{t('filter.summary')}{#if activeLabel}<span class="feed-filter-active">
				: {activeLabel}
			</span>{/if}
	</summary>
	<nav aria-label={t('filter.label')}>
		<ul role="list">
			{#each FILTER_ITEMS as item (item.param ?? 'all')}
				<li>
					<a
						href={buildFilterHref(item.param)}
						aria-current={item.param === activeType ? 'page' : undefined}
					>
						{item.label}
					</a>
				</li>
			{/each}
		</ul>
	</nav>
	{#if activeLabel}
		<p class="filter-status" role="status">
			<span>{t('filter.active')} <strong>{activeLabel}</strong></span>
			<a href={buildFilterHref(null)} class="filter-clear-link">{t('filter.clear')}</a>
		</p>
	{/if}
</details>

<style>
	.feed-filter {
		margin-block-end: var(--space-4);
		font: var(--k-text-ui);
	}

	summary {
		display: inline-flex;
		align-items: baseline;
		min-block-size: 32px;
		padding-block: 4px;
		font-size: 0.9375rem;
		color: var(--k-color-text-secondary);
		cursor: pointer;
		list-style: none;
	}

	summary::-webkit-details-marker {
		display: none;
	}

	summary::after {
		content: ' ▾';
		margin-inline-start: 0.3em;
		color: var(--k-color-text-muted);
	}

	.feed-filter[open] > summary::after {
		content: ' ▴';
	}

	summary:hover {
		color: var(--k-color-text);
	}

	.feed-filter-active {
		font-weight: 600;
		color: var(--k-color-text);
	}

	nav ul {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-4);
		margin: var(--space-1) 0 0;
		padding: var(--space-2) 0;
		list-style: none;
		border-block: 1px solid var(--k-color-line);
	}

	nav a {
		font-size: 0.9375rem;
		color: var(--k-color-text-secondary);
		text-decoration: none;
	}

	nav a:hover {
		color: var(--k-color-text);
		text-decoration: underline;
		text-underline-offset: 0.35em;
	}

	nav a[aria-current='page'] {
		font-weight: 600;
		color: var(--k-color-text);
		text-decoration: underline;
		text-decoration-thickness: 2px;
		text-underline-offset: 0.35em;
	}

	.filter-status {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-3);
		margin: var(--space-2) 0 0;
		font: var(--k-text-hint);
		color: var(--k-color-text-muted);
	}

	.filter-status strong {
		font-weight: 600;
		color: var(--k-color-text);
	}

	.filter-clear-link {
		color: var(--k-color-link);
	}

	@media (pointer: coarse) {
		summary,
		nav a {
			display: inline-flex;
			align-items: center;
			min-block-size: 44px;
		}
	}

	@media (forced-colors: active) {
		nav a[aria-current='page'] {
			color: LinkText;
		}
	}
</style>
