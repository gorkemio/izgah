<script lang="ts">
	import { formatNumber, t } from '#lib/i18n/index.ts';
	import { instanceName, pageTitle } from '#lib/instance.ts';
	import { untrack } from 'svelte';
	import FeedFilterBar from '#lib/components/feed/FeedFilterBar.svelte';
	import PostCard from '#lib/components/feed/PostCard.svelte';
	import { highlightTerms } from '#lib/search/highlight.ts';
	import type { ShareCardFormError } from '#lib/types/feed.ts';
	import type { ContentType } from '#lib/types/domain.ts';
	import type { PageData } from './$types';

	interface SearchShareFormErrorPayload {
		formType?: string;
		shareId?: string;
		errorMessage?: string;
		fieldErrors?: Record<string, string[]>;
		values?: {
			note?: string;
			sectionIds?: string[];
			contentType?: string;
			silentMode?: boolean;
		};
	}

	let { data, form }: { data: PageData; form: SearchShareFormErrorPayload | null } = $props();

	// Seed the controls from `data` synchronously so the server-rendered HTML (and JS-off users)
	// show the submitted query and scope; the effect below keeps them in sync on later navigations.
	const initialData = untrack(() => data);
	let hydrated = $state(false);
	let queryInput = $state(initialData.query);
	let scopeMode = $state<'all' | 'section'>(initialData.sectionId ? 'section' : 'all');
	let selectedSectionId = $state(initialData.sectionId ?? initialData.sections[0]?.id ?? '');
	let lastSyncedKey = `${initialData.query}::${initialData.sectionId ?? ''}::${initialData.contentType ?? ''}`;

	$effect(() => {
		hydrated = true;
	});

	$effect(() => {
		const nextKey = `${data.query}::${data.sectionId ?? ''}::${data.contentType ?? ''}`;
		if (nextKey !== lastSyncedKey) {
			lastSyncedKey = nextKey;
			queryInput = data.query;
			if (data.sectionId) {
				scopeMode = 'section';
				selectedSectionId = data.sectionId;
			} else {
				scopeMode = 'all';
				if (!selectedSectionId && data.sections.length > 0) {
					selectedSectionId = data.sections[0].id;
				}
			}
		}
	});

	const effectiveSectionId = $derived(
		scopeMode === 'section' ? selectedSectionId || data.sectionId || null : null
	);

	const activeSectionObj = $derived(
		data.sectionId ? (data.sections.find((s) => s.id === data.sectionId) ?? null) : null
	);

	function buildSearchUrl(options: {
		q: string;
		sectionId: string | null;
		type: ContentType | null;
		page?: number;
	}): string {
		const params = new URLSearchParams();
		if (options.q.trim()) {
			params.set('q', options.q.trim());
		}
		if (options.sectionId) {
			params.set('section', options.sectionId);
		}
		if (options.type) {
			params.set('type', options.type);
		}
		if (options.page && options.page > 1) {
			params.set('page', String(options.page));
		}
		const encoded = params.toString();
		return encoded ? `/search?${encoded}` : '/search';
	}

	const searchPreserveParams = $derived({
		q: queryInput || data.query,
		section: effectiveSectionId
	});

	const terms = $derived(highlightTerms(data.query));
	const currentPage = $derived(Math.floor(data.offset / data.limit) + 1);
	const pageCount = $derived(Math.max(1, Math.ceil(data.totalCount / data.limit)));
	const firstShown = $derived(data.items.length > 0 ? data.offset + 1 : 0);
	const lastShown = $derived(data.offset + data.items.length);
	const pageHref = (pageNumber: number) =>
		buildSearchUrl({
			q: data.query,
			sectionId: data.sectionId,
			type: data.contentType,
			page: pageNumber
		});

	const currentReturnTo = $derived(
		buildSearchUrl({
			q: data.query,
			sectionId: data.sectionId,
			type: data.contentType,
			page: currentPage
		})
	);

	const activeShareFormError = $derived.by((): ShareCardFormError | null => {
		if (!form || !form.shareId) {
			return null;
		}
		if (form.formType === 'updateShare' || form.formType === 'deleteShare') {
			return {
				formType: form.formType,
				shareId: form.shareId,
				errorMessage: form.errorMessage ?? t('common.actionFailed'),
				fieldErrors: form.fieldErrors,
				values: form.values
			};
		}
		return null;
	});
</script>

<svelte:head>
	<title
		>{pageTitle(
			data.executed ? t('search.resultsTitle', { query: data.query }) : t('page.search')
		)}</title
	>
</svelte:head>

<section aria-labelledby="search-page-title" class="search-page">
	<header class="page-header">
		<h1 id="search-page-title" tabindex="-1">{t('page.search')}</h1>
		<p class="page-subtitle">
			{t('search.subtitle')}
		</p>
	</header>

	<search aria-label={t('search.panel')} class="search-panel">
		<form method="GET" action="/search" class="search-form">
			{#if data.contentType}
				<input type="hidden" name="type" value={data.contentType} />
			{/if}

			<div class="search-input-row">
				<label for="search-page-q" class="visually-hidden">{t('search.termLabel')}</label>
				<div class="search-input-wrap">
					<span class="search-input-icon" aria-hidden="true"> </span>
					<input
						id="search-page-q"
						type="search"
						name="q"
						value={queryInput}
						oninput={(event) => {
							queryInput = event.currentTarget.value;
						}}
						placeholder={t('search.placeholder')}
						autocorrect="off"
						autocapitalize="none"
						spellcheck={false}
						enterkeyhint="search"
						class="input search-input"
					/>
				</div>
				<button type="submit" class="btn btn-primary search-submit">{t('search.submit')}</button>
			</div>

			{#if data.sections.length > 0}
				<!-- The radios keep their shared name after hydration so they stay one group (F15). -->
				<fieldset class="scope-fieldset">
					<legend class="visually-hidden">{t('search.scope')}</legend>
					<div class="segmented scope-segmented">
						<label class="seg-item scope-seg" class:is-active={scopeMode === 'all'}>
							<input
								type="radio"
								name="scope"
								value="all"
								checked={scopeMode === 'all'}
								onchange={() => {
									scopeMode = 'all';
								}}
							/>
							<span>{t('search.scopeAll', { name: instanceName() })}</span>
						</label>
						<label class="seg-item scope-seg" class:is-active={scopeMode === 'section'}>
							<input
								type="radio"
								name="scope"
								value="section"
								checked={scopeMode === 'section'}
								onchange={() => {
									scopeMode = 'section';
									if (!selectedSectionId && data.sections.length > 0) {
										selectedSectionId = data.sections[0].id;
									}
								}}
							/>
							<span>{t('search.scopeSection')}</span>
						</label>
					</div>
					{#if scopeMode === 'section' || !hydrated}
						<label for="search-page-section" class="visually-hidden">
							{t('search.pickSection')}
						</label>
						<select
							id="search-page-section"
							name="section"
							value={selectedSectionId}
							onchange={(event) => {
								selectedSectionId = event.currentTarget.value;
								scopeMode = 'section';
							}}
							class="select section-select"
						>
							{#each data.sections as section (section.id)}
								<option value={section.id}>{section.name}</option>
							{/each}
						</select>
					{/if}
				</fieldset>
			{/if}
		</form>

		<div class="search-filters-row">
			<FeedFilterBar
				basePath="/search"
				activeType={data.contentType}
				preserveParams={searchPreserveParams}
			/>
		</div>
	</search>

	{#if !data.executed}
		<div class="empty-state-box search-empty">
			<h2 class="empty-heading">{t('search.emptyHeading')}</h2>
			<ul class="tips" role="list">
				<li>{t('search.tipNotes')} <code>{t('search.tipNotesExample')}</code></li>
				<li>{t('search.tipForms')} <code>{t('search.tipFormsExample')}</code></li>
				<li>{t('search.tipUrl')} <code>sveltejs/kit</code></li>
				<li>{t('search.tipQuotes')} <code>"local first" -react</code></li>
			</ul>
			<p class="kbd-hint-line kbd-hint">
				{t('search.slashHint')}
			</p>
		</div>
	{:else if data.items.length === 0}
		<div class="empty-state-box search-empty" role="status">
			<h2 class="empty-heading">{t('search.noResults')}</h2>
			<p class="empty-desc">
				{activeSectionObj
					? t('search.noMatchInSection', { query: data.query, section: activeSectionObj.name })
					: t('search.noMatch', { query: data.query })}
			</p>
			<ul class="tips" role="list">
				<li>{t('search.tipShorter')}</li>
				<li>{t('search.tipOwnerRepo')}</li>
			</ul>
			{#if activeSectionObj || data.contentType}
				<p>
					<a
						href={buildSearchUrl({ q: data.query, sectionId: null, type: null })}
						class="btn btn-subtle btn-sm"
					>
						{t('search.searchAllUnfiltered', { name: instanceName() })}
					</a>
				</p>
			{/if}
		</div>
	{:else}
		<p class="search-summary" role="status">
			<strong>{formatNumber(data.totalCount)}</strong>
			{t('search.resultsFound', { count: data.totalCount })}
			{#if pageCount > 1}<span class="range">
					{t('search.range', { from: firstShown, to: lastShown })}
				</span>{/if}
			<span class="range">
				·
				{activeSectionObj
					? t('search.inSection', { section: activeSectionObj.name })
					: t('search.scopeAll', { name: instanceName() })}
			</span>
		</p>

		<ul class="feed-list search-results" role="list">
			{#each data.items as item, index (item.id)}
				<li>
					<PostCard
						{item}
						sections={data.sections}
						currentUserId={data.user.id}
						isAdmin={data.user.role === 'admin'}
						actionBase="/search"
						returnTo={currentReturnTo}
						priorityImage={index < 2}
						activeEditShareId={data.editShareId}
						activeDeleteShareId={data.deleteShareId}
						activeFormError={activeShareFormError}
						highlightTerms={terms}
					/>
				</li>
			{/each}
		</ul>

		{#if pageCount > 1}
			<nav class="pagination-bar" aria-label={t('search.pagination')}>
				{#if currentPage > 1}
					<a href={pageHref(currentPage - 1)} class="btn btn-subtle btn-sm" rel="prev">
						{t('common.prevPage')}
					</a>
				{/if}
				<span class="page-status">
					{t('common.pageOf', { page: currentPage, pages: pageCount })}
				</span>
				{#if currentPage < pageCount}
					<a href={pageHref(currentPage + 1)} class="btn btn-subtle btn-sm" rel="next">
						{t('common.nextPage')}
					</a>
				{/if}
			</nav>
		{/if}
	{/if}
</section>

<style>
	.search-page {
		display: grid;
		gap: var(--space-5);
		max-inline-size: var(--read-w);
	}

	.page-header {
		display: grid;
		gap: var(--space-1);
	}

	.page-header h1 {
		font: var(--text-display);
		letter-spacing: -0.02em;
		color: var(--color-text);
	}

	.page-subtitle {
		font: var(--text-ui);
		font-weight: 400;
		color: var(--color-text-muted);
	}

	.search-panel {
		display: grid;
		gap: var(--space-3);
		min-inline-size: 0;
	}

	.search-form {
		display: grid;
		gap: var(--space-3);
	}

	.search-input-row {
		display: flex;
		gap: var(--space-2);
	}

	.search-input-wrap {
		position: relative;
		flex: 1;
		min-inline-size: 0;
		display: flex;
		align-items: center;
	}

	.search-input-icon {
		position: absolute;
		inset-inline-start: 12px;
		display: inline-flex;
		color: var(--color-text-muted);
		pointer-events: none;
	}

	.search-input {
		min-block-size: 42px;
		padding-inline-start: 38px;
	}

	.search-submit {
		min-block-size: 42px;
	}

	.scope-fieldset {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		border: 0;
		min-inline-size: 0;
	}

	.scope-seg {
		position: relative;
		min-block-size: 30px;
	}

	.scope-seg input {
		/* Transparent radio covering the whole segment: receives direct clicks and check() reliably. */
		position: absolute;
		inset: 0;
		inline-size: 100%;
		block-size: 100%;
		margin: 0;
		opacity: 0;
		cursor: pointer;
	}

	.section-select {
		inline-size: auto;
		min-block-size: 36px;
		padding-block: 0;
		font: var(--text-ui);
	}

	.search-filters-row {
		padding-block-start: var(--space-2);
		border-block-start: 1px solid var(--color-line);
	}

	@media (pointer: coarse) {
		.scope-seg,
		.section-select {
			min-block-size: 44px;
		}
	}

	/* Strict serif boundary: empty-state h2 stays --font-sans (--text-section). */
	.empty-heading {
		font: var(--text-section);
		color: var(--color-text);
	}

	.empty-desc {
		color: var(--color-text-secondary);
	}

	.tips {
		display: grid;
		gap: var(--space-2);
		margin: 0;
		padding-inline-start: var(--space-5);
		font: var(--text-hint);
		color: var(--color-text-secondary);
	}

	.tips code {
		padding: 1px 6px;
		font-family: var(--font-mono);
		font-size: 0.875em;
		color: var(--color-text);
		background: var(--color-surface-2);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-xs);
	}

	.kbd-hint-line {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font: var(--text-hint);
		color: var(--color-text-muted);
	}

	.search-summary {
		font: var(--text-meta);
		font-variant-numeric: tabular-nums;
		color: var(--color-text-muted);
		padding-block-end: var(--space-3);
		border-block-end: 1px solid var(--color-line);
	}

	.search-summary strong {
		color: var(--color-text);
		font-weight: 600;
	}

	.search-results {
		gap: var(--space-3);
	}

	.pagination-bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
		padding-block: var(--space-4);
		border-block-start: 1px solid var(--color-line);
	}

	.page-status {
		font: var(--text-meta);
		font-variant-numeric: tabular-nums;
		color: var(--color-text-muted);
	}

	@media (forced-colors: active) {
		.search-panel {
			box-shadow: none;
		}
	}
</style>
