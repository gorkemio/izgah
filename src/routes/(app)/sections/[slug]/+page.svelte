<script lang="ts">
	import { t } from '$lib/i18n';
	import { pageTitle } from '$lib/instance';
	import FeedView from '$lib/components/feed/FeedView.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import type { FeedSnapshot } from '$lib/types/feed';
	import type { PageData, Snapshot } from './$types';

	let { data }: { data: PageData } = $props();

	let view = $state<ReturnType<typeof FeedView>>();

	// Back/Forward keeps pages loaded with "Daha fazla yükle" (izgah-ui-v2 §8.6).
	export const snapshot: Snapshot<FeedSnapshot | null> = {
		capture: () => view?.captureSnapshot() ?? null,
		restore: (value) => {
			if (value) {
				void view?.restoreSnapshot(value);
			}
		}
	};
</script>

<svelte:head>
	<title>{pageTitle(data.section.name)}</title>
</svelte:head>

<!-- Single reading column only: no right context rail on /sections/[slug] (izgah-ui-v3 §4 & §9). -->
<div class="section-feed-page">
	<nav aria-label={t('section.location')} class="section-breadcrumb">
		<a href="/sections" class="back-link">
			<Icon name="arrowLeft" size={15} />
			<span>{t('nav.allSections')}</span>
		</a>
	</nav>

	{#key data.section.id}
		<FeedView
			bind:this={view}
			{data}
			basePath="/sections/{data.section.slug}"
			headingId="section-page-heading"
			heading={data.section.name}
			description={data.section.description}
			emptyFiltered={t('section.emptyFiltered')}
			emptyFilteredReset={t('section.emptyFilteredReset')}
			emptyAll={t('section.emptyAll')}
			paginationLabel={t('section.pagination')}
			presetSectionIds={[data.section.id]}
			sectionId={data.section.id}
		/>
	{/key}
</div>

<style>
	.section-feed-page {
		display: grid;
		gap: var(--space-3);
		min-inline-size: 0;
	}

	.section-breadcrumb {
		display: flex;
		align-items: center;
	}

	.back-link {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font: var(--text-ui);
		color: var(--color-text-muted);
		text-decoration: none;
	}

	.back-link:hover {
		color: var(--color-text);
		text-decoration: none;
	}
</style>
