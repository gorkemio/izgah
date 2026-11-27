<script lang="ts">
	import { t } from '#lib/i18n/index.ts';
	import type { ContentType } from '#lib/server/db/schema.ts';

	/**
	 * Content-type filter (docs/designs/izgah-ui-v5.md §5.4): a segmented row of links. The links
	 * keep the `?type=` URLs, so filters stay shareable and work in search.
	 */
	interface Props {
		basePath: string;
		activeType: ContentType | null;
		preserveParams?: Record<string, string | null | undefined>;
	}

	let { basePath, activeType, preserveParams }: Props = $props();

	// The active pill slides between items (izgah-ui-v5.md §6, "Tabs, toggle groups"); before
	// hydration and under reduced effects the active link draws its own background instead.
	let listEl = $state<HTMLUListElement | null>(null);
	let indicator = $state<{ x: number; width: number } | null>(null);

	function measure() {
		const active = listEl?.querySelector<HTMLElement>('a[aria-current="page"]');
		indicator = active ? { x: active.offsetLeft, width: active.offsetWidth } : null;
	}

	$effect(() => {
		void activeType;
		measure();
	});

	$effect(() => {
		const el = listEl;
		if (!el || typeof ResizeObserver === 'undefined') {
			return;
		}
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		return () => observer.disconnect();
	});

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
</script>

<nav
	class="feed-filter mb-4 flex w-fit max-w-full overflow-x-auto rounded-lg border border-hairline bg-muted p-0.5 text-[12.5px]"
	aria-label={t('filter.label')}
>
	<ul role="list" class="relative flex gap-0.5" class:has-indicator={indicator} bind:this={listEl}>
		{#if indicator}
			<li
				aria-hidden="true"
				class="filter-indicator pointer-events-none absolute inset-y-0 left-0 rounded-md bg-card shadow-sm"
				style="translate: {indicator.x}px 0; width: {indicator.width}px"
			></li>
		{/if}
		{#each FILTER_ITEMS as item (item.param ?? 'all')}
			<li>
				<a
					href={buildFilterHref(item.param)}
					aria-current={item.param === activeType ? 'page' : undefined}
					class="filter-link relative block rounded-md px-2.5 py-1 whitespace-nowrap text-muted-foreground no-underline transition-colors hover:text-foreground aria-[current=page]:bg-card aria-[current=page]:font-medium aria-[current=page]:text-foreground aria-[current=page]:shadow-sm pointer-coarse:py-2.5"
				>
					{item.label}
				</a>
			</li>
		{/each}
	</ul>
</nav>

<style>
	.filter-indicator {
		transition:
			translate var(--dur-panel) cubic-bezier(0.2, 0.8, 0.2, 1),
			width var(--dur-panel) cubic-bezier(0.2, 0.8, 0.2, 1);
	}

	/* With the sliding pill in place the active link only changes its text. */
	.has-indicator :global(.filter-link[aria-current='page']) {
		background: transparent;
	}

	.has-indicator :global(.filter-link[aria-current='page']:not(:focus-visible)) {
		box-shadow: none;
	}
</style>
