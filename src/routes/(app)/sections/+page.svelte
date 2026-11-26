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
		<ul class="section-list" role="list">
			{#each data.sections as section (section.id)}
				<li class="section-card">
					<div class="section-card-head">
						<a class="section-link" href="/sections/{section.slug}">
							<span class="section-name">{section.name}</span>
						</a>
					</div>
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
		max-inline-size: var(--wide-w);
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
		font: var(--text-display);
		letter-spacing: -0.02em;
		color: var(--color-text);
	}

	.page-subtitle {
		font: var(--text-ui);
		font-weight: 400;
		color: var(--color-text-muted);
	}

	.section-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-3);
	}

	@media (min-width: 640px) {
		.section-list {
			grid-template-columns: repeat(2, minmax(0, 1fr));
			gap: var(--space-4);
		}
	}

	.section-card {
		position: relative;
		display: grid;
		align-content: start;
		gap: var(--space-2);
		padding: 18px 20px;
		background: var(--color-surface-1);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-lg);
		transition:
			background-color var(--dur-fast) var(--ease),
			border-color var(--dur-fast) var(--ease);
	}

	.section-card:hover,
	.section-card:focus-within {
		border-color: var(--color-line-strong);
	}

	.section-card:has(.section-link:focus-visible) {
		outline: 2px solid transparent;
		outline-offset: 2px;
		box-shadow:
			0 0 0 2px var(--color-bg),
			0 0 0 4px var(--color-accent);
	}

	.section-card-head {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-inline-size: 0;
	}

	/* Strict serif boundary: section card titles use --font-sans weight 600. */
	.section-link {
		min-inline-size: 0;
		font-family: var(--font-sans);
		font-size: 0.96875rem;
		font-weight: 600;
		line-height: 1.35;
		color: var(--color-text);
		text-decoration: none;
	}

	.section-link::after {
		content: '';
		position: absolute;
		inset: 0;
	}

	.section-link:hover {
		color: var(--color-accent-text);
		text-decoration: none;
	}

	.section-link:focus-visible {
		outline: none;
		box-shadow: none;
	}

	.section-desc {
		padding-inline-start: calc(32px + var(--space-3));
		font: var(--text-hint);
		color: var(--color-text-secondary);
	}

	.empty-title {
		font: var(--text-section);
		color: var(--color-text);
	}

	.empty-desc {
		font: var(--text-hint);
		color: var(--color-text-secondary);
	}

	@media (forced-colors: active) {
		.section-card {
			box-shadow: none;
		}

		.section-card:has(.section-link:focus-visible) {
			outline: 2px solid CanvasText;
			outline-offset: 2px;
			box-shadow: none;
		}
	}
</style>
