<script lang="ts">
	import { formatNumber, t } from '#lib/i18n/index.ts';
	import { instanceName, pageTitle } from '#lib/instance.ts';
	import { untrack } from 'svelte';
	import FeedFilterBar from '#lib/components/feed/FeedFilterBar.svelte';
	import PostCard from '#lib/components/feed/PostCard.svelte';
	import { highlightTerms } from '#lib/search/highlight.ts';
	import type { ContentType } from '#lib/types/domain.ts';
	import { buttonVariants } from '#lib/components/ui/button/index.ts';
	import { Kbd } from '#lib/components/ui/kbd/index.ts';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import SearchIcon from '@lucide/svelte/icons/search';
	import SearchX from '@lucide/svelte/icons/search-x';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Seed the controls from `data` synchronously so the server-rendered HTML shows the submitted
	// query and scope; the effect below keeps them in sync on later navigations.
	const initialData = untrack(() => data);
	let queryInput = $state(initialData.query);
	let scopeMode = $state<'all' | 'section'>(initialData.sectionId ? 'section' : 'all');
	let selectedSectionId = $state(initialData.sectionId ?? initialData.sections[0]?.id ?? '');
	let lastSyncedKey = `${initialData.query}::${initialData.sectionId ?? ''}::${initialData.contentType ?? ''}`;

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

	const codeClass =
		'rounded-md border border-hairline bg-muted px-1.5 py-px font-mono text-[0.85em] text-foreground';
</script>

<svelte:head>
	<title
		>{pageTitle(
			data.executed ? t('search.resultsTitle', { query: data.query }) : t('page.search')
		)}</title
	>
</svelte:head>

<!-- Search (docs/designs/izgah-ui-v5.md §5.4): one large field, the scope as a segmented control,
     the content-type filter, then the summary and the highlighted results. -->
<section
	aria-labelledby="search-page-title"
	class="search-page mx-auto grid w-full max-w-[720px] gap-6"
>
	<header class="grid gap-1">
		<h1
			id="search-page-title"
			tabindex="-1"
			class="text-2xl font-semibold tracking-[-0.02em] outline-none"
		>
			{t('page.search')}
		</h1>
		<p class="text-[14px] text-muted-foreground">{t('search.subtitle')}</p>
	</header>

	<search aria-label={t('search.panel')} class="search-panel grid min-w-0 gap-3">
		<form method="GET" action="/search" class="search-form grid gap-3">
			{#if data.contentType}
				<input type="hidden" name="type" value={data.contentType} />
			{/if}

			<div class="flex gap-2">
				<label for="search-page-q" class="sr-only">{t('search.termLabel')}</label>
				<div class="relative flex min-w-0 flex-1 items-center">
					<SearchIcon
						class="pointer-events-none absolute start-3 size-4 text-muted-foreground"
						aria-hidden="true"
					/>
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
						class="search-input h-11 ps-9 pointer-fine:text-[15px]"
					/>
				</div>
				<button type="submit" class="search-submit {buttonVariants({ size: 'lg' })} h-11 px-4">
					{t('search.submit')}
				</button>
			</div>

			{#if data.sections.length > 0}
				<!-- The radios keep their shared name after hydration so they stay one group (F15). -->
				<fieldset class="scope-fieldset m-0 flex min-w-0 flex-wrap items-center gap-2 border-0 p-0">
					<legend class="sr-only">{t('search.scope')}</legend>
					<div class="scope-segmented inline-flex rounded-lg bg-muted p-0.5 text-[13px]">
						<label
							class="scope-seg relative inline-flex h-8 cursor-pointer items-center rounded-md px-3 font-medium text-muted-foreground transition-colors has-checked:bg-background has-checked:text-foreground has-checked:shadow-xs has-focus-visible:ring-3 has-focus-visible:ring-ring/50 pointer-coarse:h-11"
						>
							<input
								type="radio"
								name="scope"
								value="all"
								class="absolute inset-0 m-0 size-full cursor-pointer opacity-0"
								checked={scopeMode === 'all'}
								onchange={() => {
									scopeMode = 'all';
								}}
							/>
							<span>{t('search.scopeAll', { name: instanceName() })}</span>
						</label>
						<label
							class="scope-seg relative inline-flex h-8 cursor-pointer items-center rounded-md px-3 font-medium text-muted-foreground transition-colors has-checked:bg-background has-checked:text-foreground has-checked:shadow-xs has-focus-visible:ring-3 has-focus-visible:ring-ring/50 pointer-coarse:h-11"
						>
							<input
								type="radio"
								name="scope"
								value="section"
								class="absolute inset-0 m-0 size-full cursor-pointer opacity-0"
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
					{#if scopeMode === 'section'}
						<label for="search-page-section" class="sr-only">
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
							class="section-select w-auto min-w-40 pointer-fine:text-[13px]"
						>
							{#each data.sections as section (section.id)}
								<option value={section.id}>{section.name}</option>
							{/each}
						</select>
					{/if}
				</fieldset>
			{/if}
		</form>

		<div class="search-filters-row border-t border-hairline pt-3">
			<FeedFilterBar
				basePath="/search"
				activeType={data.contentType}
				preserveParams={searchPreserveParams}
			/>
		</div>
	</search>

	{#if !data.executed}
		<div class="search-empty grid gap-4 rounded-xl border border-dashed p-6">
			<h2 class="text-[15px] font-semibold">{t('search.emptyHeading')}</h2>
			<ul class="tips grid gap-2 text-[13.5px] text-muted-foreground" role="list">
				<li>{t('search.tipNotes')} <code class={codeClass}>{t('search.tipNotesExample')}</code></li>
				<li>{t('search.tipForms')} <code class={codeClass}>{t('search.tipFormsExample')}</code></li>
				<li>{t('search.tipUrl')} <code class={codeClass}>sveltejs/kit</code></li>
				<li>{t('search.tipQuotes')} <code class={codeClass}>"local first" -react</code></li>
			</ul>
			<p class="kbd-hint inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
				<Kbd>/</Kbd>
				{t('search.slashHint')}
			</p>
		</div>
	{:else if data.items.length === 0}
		<div
			class="search-empty grid justify-items-start gap-3 rounded-xl border border-dashed p-6"
			role="status"
		>
			<SearchX class="size-5 text-muted-foreground" aria-hidden="true" />
			<h2 class="text-[15px] font-semibold">{t('search.noResults')}</h2>
			<p class="text-[14px] text-muted-foreground">
				{activeSectionObj
					? t('search.noMatchInSection', { query: data.query, section: activeSectionObj.name })
					: t('search.noMatch', { query: data.query })}
			</p>
			<ul class="tips grid list-disc gap-1.5 ps-5 text-[13.5px] text-muted-foreground" role="list">
				<li>{t('search.tipShorter')}</li>
				<li>{t('search.tipOwnerRepo')}</li>
			</ul>
			{#if activeSectionObj || data.contentType}
				<a
					href={buildSearchUrl({ q: data.query, sectionId: null, type: null })}
					class={buttonVariants({ variant: 'outline', size: 'sm' })}
				>
					{t('search.searchAllUnfiltered', { name: instanceName() })}
				</a>
			{/if}
		</div>
	{:else}
		<p
			class="search-summary flex flex-wrap items-baseline gap-x-1.5 border-b border-hairline pb-3 text-[13px] text-muted-foreground tabular-nums"
			role="status"
		>
			<span>
				<strong class="font-semibold text-foreground">{formatNumber(data.totalCount)}</strong>
				{t('search.resultsFound', { count: data.totalCount })}
			</span>
			{#if pageCount > 1}<span class="range">
					· {t('search.range', { from: firstShown, to: lastShown })}
				</span>{/if}
			<span class="range">
				·
				{activeSectionObj
					? t('search.inSection', { section: activeSectionObj.name })
					: t('search.scopeAll', { name: instanceName() })}
			</span>
		</p>

		<ul class="feed-list search-results grid gap-3" role="list">
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
						highlightTerms={terms}
					/>
				</li>
			{/each}
		</ul>

		{#if pageCount > 1}
			<nav
				class="pagination-bar flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-4"
				aria-label={t('search.pagination')}
			>
				{#if currentPage > 1}
					<a
						href={pageHref(currentPage - 1)}
						class={buttonVariants({ variant: 'outline', size: 'sm' })}
						rel="prev"
					>
						<ChevronLeft aria-hidden="true" />
						{t('common.prevPage')}
					</a>
				{:else}
					<span></span>
				{/if}
				<span class="page-status text-[12.5px] text-muted-foreground tabular-nums">
					{t('common.pageOf', { page: currentPage, pages: pageCount })}
				</span>
				{#if currentPage < pageCount}
					<a
						href={pageHref(currentPage + 1)}
						class={buttonVariants({ variant: 'outline', size: 'sm' })}
						rel="next"
					>
						{t('common.nextPage')}
						<ChevronRight aria-hidden="true" />
					</a>
				{:else}
					<span></span>
				{/if}
			</nav>
		{/if}
	{/if}
</section>
