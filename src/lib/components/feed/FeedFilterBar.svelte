<script lang="ts">
	import { t } from '#lib/i18n/index.ts';
	import SegmentedControl, {
		type SegmentedOption
	} from '#lib/components/ui/SegmentedControl.svelte';
	import type { ContentType } from '#lib/server/db/schema.ts';

	interface Props {
		basePath: string;
		activeType: ContentType | null;
		preserveParams?: Record<string, string | null | undefined>;
	}

	type FilterValue = 'all' | ContentType;

	const FILTER_ITEMS: ReadonlyArray<{
		value: FilterValue;
		param: ContentType | null;
		label: string;
	}> = [
		{ value: 'all', param: null, label: t('filter.all') },
		{ value: 'article', param: 'article', label: t('contentType.article') },
		{ value: 'video', param: 'video', label: t('contentType.video') },
		{ value: 'repo', param: 'repo', label: t('contentType.repo') },
		{ value: 'social', param: 'social', label: t('contentType.social') },
		{ value: 'web', param: 'web', label: t('contentType.web') }
	];

	let { basePath, activeType, preserveParams }: Props = $props();

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

	const options = $derived<ReadonlyArray<SegmentedOption<FilterValue>>>(
		FILTER_ITEMS.map((item) => ({
			value: item.value,
			label: item.label,
			href: buildFilterHref(item.param)
		}))
	);

	const selectedValue = $derived<FilterValue>(activeType ?? 'all');

	const activeLabel = $derived(
		activeType ? (FILTER_ITEMS.find((option) => option.param === activeType)?.label ?? null) : null
	);

	const clearHref = $derived(buildFilterHref(null));
</script>

<div class="filter-bar-wrap">
	<SegmentedControl
		{options}
		value={selectedValue}
		ariaLabel={t('filter.label')}
		mode="links"
		class="filter-bar"
	/>

	{#if activeLabel}
		<div class="filter-status" role="status">
			<span>{t('filter.active')} <strong>{activeLabel}</strong></span>
			<a href={clearHref} class="filter-clear-link">{t('filter.clear')}</a>
		</div>
	{/if}
</div>

<style>
	.filter-bar-wrap {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		justify-items: start;
		gap: var(--space-2);
		margin-block-end: var(--space-4);
	}

	.filter-bar-wrap :global(.filter-bar) {
		scrollbar-width: none;
		overscroll-behavior-inline: contain;
	}

	.filter-status {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
		font: var(--text-hint);
		color: var(--color-text-muted);
	}

	.filter-status strong {
		color: var(--color-text);
		font-weight: 600;
	}

	.filter-clear-link {
		color: var(--color-accent-text);
		font-weight: 500;
	}
</style>
