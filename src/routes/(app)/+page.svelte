<script lang="ts">
	import { snapshot } from '$app/navigation';
	import { t } from '#lib/i18n/index.ts';
	import { pageTitle } from '#lib/instance.ts';
	import FeedContextRail from '#lib/components/feed/FeedContextRail.svelte';
	import FeedView from '#lib/components/feed/FeedView.svelte';
	import type { FeedSnapshot } from '#lib/types/feed.ts';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let view = $state<ReturnType<typeof FeedView>>();

	// Back/Forward keeps pages loaded with "Daha fazla yükle" (izgah-ui-v2 §8.6).
	snapshot<FeedSnapshot | null>({
		id: 'feed',
		capture: () => view?.captureSnapshot() ?? null,
		restore: (value) => {
			if (value) {
				void view?.restoreSnapshot(value);
			}
		}
	});
</script>

<svelte:head>
	<title>{pageTitle(t('page.feed'))}</title>
</svelte:head>

<div class="feed-workspace" class:has-rail={Boolean(data.railSummary)}>
	<FeedView
		bind:this={view}
		{data}
		basePath="/"
		headingId="feed-page-heading"
		heading={t('page.feed')}
		description={t('feed.description')}
		emptyFiltered={t('feed.emptyFiltered')}
		emptyFilteredReset={t('feed.emptyFilteredReset')}
		emptyAll={t('feed.emptyAll')}
		paginationLabel={t('feed.pagination')}
	/>

	{#if data.railSummary}
		<FeedContextRail
			summary={data.railSummary}
			currentUserId={data.user.id}
			todayKey={data.todayKey}
		/>
	{/if}
</div>

<style>
	.feed-workspace {
		display: grid;
		grid-template-columns: minmax(0, var(--read-w));
		justify-content: center;
		align-items: start;
	}

	@media (min-width: 1280px) {
		.feed-workspace.has-rail {
			grid-template-columns: minmax(0, var(--read-w)) var(--context-rail-w);
			gap: 28px;
		}
	}
</style>
