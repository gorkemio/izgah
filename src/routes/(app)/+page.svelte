<script lang="ts">
	import { snapshot } from '$app/navigation';
	import { t } from '#lib/i18n/index.ts';
	import { pageTitle } from '#lib/instance.ts';
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

<div class="feed-workspace">
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
</div>

<style>
	.feed-workspace {
		display: grid;
		grid-template-columns: minmax(0, var(--read-w));
		justify-content: center;
		align-items: start;
	}
</style>
