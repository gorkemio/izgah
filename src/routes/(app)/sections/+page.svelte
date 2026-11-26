<script lang="ts">
	import { t } from '#lib/i18n/index.ts';
	import { pageTitle } from '#lib/instance.ts';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>{pageTitle(t('nav.sections'))}</title>
</svelte:head>

<section class="sections-index" aria-labelledby="sections-heading">
	<header class="page-head">
		<div class="page-head-copy">
			<h1 id="sections-heading" tabindex="-1">{t('nav.sections')}</h1>
			<p class="page-subtitle">{t('sections.subtitle')}</p>
		</div>
		{#if data.user.role === 'admin' && data.sections.length > 0}
			<a class="btn btn-subtle btn-sm" href="/admin/sections">
				<span>{t('sections.manage')}</span>
			</a>
		{/if}
	</header>

	{#if data.sections.length === 0}
		<div class="empty-state-box">
			<p class="empty-title">{t('sections.emptyTitle')}</p>
			<p class="empty-desc">
				{#if data.user.role === 'admin'}
					{t('sections.emptyAdmin')}
				{:else}
					{t('sections.emptyMember')}
				{/if}
			</p>
			{#if data.user.role === 'admin'}
				<a class="btn btn-primary btn-sm" href="/admin/sections">{t('sections.manage')}</a>
			{/if}
		</div>
	{:else}
		<!-- A ruled index, not a card grid (izgah-ui-v4 §5): name, description, count. -->
		<ul class="section-list" role="list">
			{#each data.sections as section (section.id)}
				<li class="section-row">
					<a class="section-link" href="/sections/{section.slug}">{section.name}</a>
					<span class="section-count">{t('sections.count', { count: section.shareCount })}</span>
					{#if section.description}
						<p class="section-desc">{section.description}</p>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.sections-index {
		display: grid;
		gap: var(--space-5);
		max-inline-size: var(--read-w);
	}

	.page-head {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		justify-content: space-between;
		gap: var(--space-4);
	}

	.page-head-copy {
		display: grid;
		gap: var(--space-1);
	}

	h1 {
		font: var(--k-text-display);
		letter-spacing: -0.02em;
		color: var(--k-color-text);
	}

	.page-subtitle {
		font: var(--k-text-ui);
		font-weight: 400;
		color: var(--k-color-text-muted);
	}

	.section-list {
		list-style: none;
		margin: 0;
		padding: 0;
		border-block-start: 1px solid var(--k-color-text);
	}

	.section-row {
		position: relative;
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: baseline;
		gap: 2px var(--space-4);
		padding-block: var(--space-3);
		border-block-end: 1px solid var(--k-color-line);
	}

	.section-link {
		min-inline-size: 0;
		font: var(--k-text-title);
		color: var(--k-color-link);
		text-decoration: none;
	}

	/* The whole row opens the section; the link keeps its own focus ring. */
	.section-link::after {
		content: '';
		position: absolute;
		inset: 0;
	}

	.section-link:hover {
		text-decoration: underline;
		text-underline-offset: 0.2em;
	}

	.section-count {
		font: var(--k-text-meta);
		font-variant-numeric: tabular-nums;
		color: var(--k-color-text-muted);
	}

	.section-desc {
		grid-column: 1 / -1;
		max-inline-size: var(--measure);
		font: var(--k-text-hint);
		color: var(--k-color-text-secondary);
	}

	.empty-title {
		font: var(--k-text-section);
		color: var(--k-color-text);
	}

	.empty-desc {
		font: var(--k-text-hint);
		color: var(--k-color-text-secondary);
	}
</style>
