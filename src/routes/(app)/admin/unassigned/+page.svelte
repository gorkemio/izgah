<script lang="ts">
	import { cssText, t } from '#lib/i18n/index.ts';
	import { pageTitle } from '#lib/instance.ts';
	import { formatWhen } from '#lib/format/date.ts';
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let busy = $state(false);
	let selectedShareIds = $state<string[]>([]);
	let selectedSectionIds = $state<string[]>([]);

	const visibleIds = $derived(data.items.map((item) => item.id));
	const allSelected = $derived(
		visibleIds.length > 0 && visibleIds.every((id) => selectedShareIds.includes(id))
	);

	function toggleSelectAll() {
		if (allSelected) {
			selectedShareIds = [];
		} else {
			selectedShareIds = [...visibleIds];
		}
	}

	function toggleShare(shareId: string) {
		if (selectedShareIds.includes(shareId)) {
			selectedShareIds = selectedShareIds.filter((id) => id !== shareId);
		} else {
			selectedShareIds = [...selectedShareIds, shareId];
		}
	}

	function toggleSection(sectionId: string) {
		if (selectedSectionIds.includes(sectionId)) {
			selectedSectionIds = selectedSectionIds.filter((id) => id !== sectionId);
		} else {
			selectedSectionIds = [...selectedSectionIds, sectionId];
		}
	}

	const formatDate = formatWhen;
</script>

<svelte:head>
	<title>{pageTitle(t('unassigned.title'))}</title>
</svelte:head>

<div class="admin-page">
	<header class="page-header">
		<h1 tabindex="-1">{t('unassigned.titleCount', { count: data.totalUnassignedCount })}</h1>
		<p class="page-lead">
			{t('unassigned.lead')}
		</p>
	</header>

	{#if form?.success && form?.message}
		<div class="banner banner-success" role="status">
			<span>{form.message}</span>
		</div>
	{/if}

	{#if form?.error}
		<div class="banner banner-error" role="alert">
			<span>{form.error}</span>
		</div>
	{/if}

	{#if data.items.length === 0}
		<section class="panel">
			<p class="empty-state">{t('unassigned.empty')}</p>
			{#if data.hasActiveCursor}
				<p class="empty-actions">
					<a href="/admin/unassigned" class="btn btn-outline">{t('unassigned.firstPage')}</a>
				</p>
			{/if}
		</section>
	{:else}
		<form
			method="POST"
			action="?/assign"
			class="assign-shell"
			use:enhance={() => {
				busy = true;
				return async ({ result, update }) => {
					await update();
					if (result.type === 'success') {
						selectedShareIds = [];
						selectedSectionIds = [];
					}
					busy = false;
				};
			}}
		>
			<section class="panel" aria-labelledby="target-sections-heading">
				<h2 id="target-sections-heading">{t('unassigned.targets')}</h2>
				{#if data.sections.length === 0}
					<p class="empty-state">
						<a href="/admin/sections">{t('unassigned.createFirst')}</a>
					</p>
				{:else}
					<fieldset class="sections-fieldset">
						<legend class="visually-hidden">{t('unassigned.pickSections')}</legend>
						<div class="checkbox-grid">
							{#each data.sections as section (section.id)}
								<label class="checkbox-pill" for="assign-sec-{section.id}">
									<input
										id="assign-sec-{section.id}"
										type="checkbox"
										name="sectionIds"
										value={section.id}
										checked={selectedSectionIds.includes(section.id)}
										onchange={() => toggleSection(section.id)}
									/>
									<span>{section.name}</span>
								</label>
							{/each}
						</div>
					</fieldset>

					<div class="bulk-toolbar">
						<button type="button" class="btn btn-subtle" onclick={toggleSelectAll}>
							{allSelected ? t('unassigned.clearPage') : t('unassigned.selectPage')}
						</button>
						<button
							type="submit"
							class="btn btn-primary"
							disabled={busy || data.sections.length === 0}
						>
							{busy ? t('unassigned.assigning') : t('unassigned.assign')}
						</button>
						{#if Object.keys(data.suggestions).length > 0}
							<button
								type="submit"
								class="btn btn-outline"
								formaction="?/acceptAll"
								disabled={busy}
							>
								{t('suggest.acceptAll')}
							</button>
						{/if}
					</div>
				{/if}
			</section>

			<section class="table-card" aria-labelledby="unassigned-table-heading">
				<div class="table-toolbar">
					<h2 id="unassigned-table-heading">
						{t('unassigned.list', { count: data.items.length })}
					</h2>
					{#if selectedShareIds.length > 0}
						<span class="table-summary">
							{t('unassigned.selected', { count: selectedShareIds.length })}
						</span>
					{/if}
				</div>

				<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
				<div
					tabindex="0"
					role="region"
					aria-labelledby="unassigned-table-heading"
					class="table-wrapper"
				>
					<table
						class="responsive-unassigned-table"
						style:--label-1={cssText(t('table.select'))}
						style:--label-3={cssText(t('table.sharer'))}
						style:--label-4={cssText(t('table.channel'))}
						style:--label-5={cssText(t('table.date'))}
					>
						<caption class="visually-hidden">{t('unassigned.caption')}</caption>
						<thead>
							<tr>
								<th scope="col">{t('table.select')}</th>
								<th scope="col">{t('unassigned.colLink')}</th>
								<th scope="col">{t('table.sharer')}</th>
								<th scope="col">{t('table.channel')}</th>
								<th scope="col" class="num-col">{t('table.date')}</th>
							</tr>
						</thead>
						<tbody>
							{#each data.items as item (item.id)}
								<tr>
									<td class="check-cell">
										<label class="share-check-label" for="share-{item.id}">
											<input
												id="share-{item.id}"
												type="checkbox"
												name="shareIds"
												value={item.id}
												checked={selectedShareIds.includes(item.id)}
												onchange={() => toggleShare(item.id)}
											/>
											<span class="visually-hidden">
												{t('unassigned.selectShare', { title: item.title ?? item.canonicalUrl })}
											</span>
										</label>
									</td>
									<th scope="row" class="share-title-cell">
										<div class="share-title-stack">
											<span class="share-title">{item.title ?? item.domain}</span>
											<a href="/resources/{item.resourceId}" class="resource-link">
												{item.canonicalUrl}
											</a>
											{#if item.note}
												<p class="share-note">{item.note}</p>
											{/if}
											<input type="hidden" name="pageShareIds" value={item.id} />
											{#if data.suggestions[item.id]?.length}
												<p class="share-suggestions">
													<span>{t('suggest.label')}</span>
													{#each data.suggestions[item.id] as suggestion (suggestion.sectionId)}
														<button
															type="submit"
															class="suggestion-add"
															formaction="?/acceptOne"
															name="suggestion"
															value="{item.id}:{suggestion.sectionId}"
															disabled={busy}
															aria-label={t('suggest.addAria', { section: suggestion.name })}
														>
															+ {suggestion.name}
														</button>
													{/each}
												</p>
											{/if}
										</div>
									</th>
									<td class="author-cell">{item.authorName}</td>
									<td>
										<span class="channel-badge">
											{item.sourceChannel === 'api' ? t('channel.api') : t('channel.web')}
										</span>
									</td>
									<td class="num-col date-cell">
										<time datetime={item.createdAt}>{formatDate(item.createdAt)}</time>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>

				{#if data.nextCursor || data.hasActiveCursor}
					<div class="table-footer">
						<nav aria-label={t('unassigned.pagination')} class="pagination-row">
							{#if data.hasActiveCursor}
								<a href="/admin/unassigned" class="btn btn-outline btn-sm">
									{t('common.backToStart')}
								</a>
							{/if}
							{#if data.nextCursor}
								<a
									href="/admin/unassigned?cursor={encodeURIComponent(data.nextCursor)}"
									class="btn btn-outline btn-sm"
								>
									{t('common.nextPageTitle')}
								</a>
							{/if}
						</nav>
					</div>
				{/if}
			</section>
		</form>
	{/if}
</div>

<style>
	.admin-page,
	.assign-shell {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}

	.panel {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-4) 0 0;
		background: none;
		border: 0;
		border-block-start: 1px solid var(--color-text);
		border-radius: 0;
	}

	.panel h2,
	.table-toolbar h2 {
		margin: 0;
		font: var(--text-section);
		letter-spacing: -0.01em;
		font-variant-numeric: tabular-nums;
	}

	.sections-fieldset {
		border: 0;
		margin: 0;
		padding: 0;
	}

	.checkbox-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
		gap: 0 var(--space-4);
	}

	.checkbox-pill {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		min-block-size: 32px;
		font: var(--text-ui);
		font-weight: 400;
		color: var(--color-text);
		cursor: pointer;
	}

	.checkbox-pill:hover {
		color: var(--color-text);
	}

	.checkbox-pill:has(input:checked) {
		font-weight: 600;
	}

	.checkbox-pill input,
	.share-check-label input {
		inline-size: 1rem;
		block-size: 1rem;
	}

	.share-check-label {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-inline-size: 36px;
		min-block-size: 36px;
		cursor: pointer;
	}

	.bulk-toolbar {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.table-card {
		border-block-start: 1px solid var(--color-text);
		overflow: hidden;
	}

	.table-toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2) var(--space-3);
		padding: var(--space-3) var(--space-4);
		border-block-end: 1px solid var(--color-line);
	}

	.table-summary {
		font: var(--text-meta);
		font-variant-numeric: tabular-nums;
		color: var(--color-accent-text);
	}

	.table-wrapper {
		container-type: inline-size;
		overflow-x: auto;
		max-inline-size: 100%;
	}

	.table-wrapper:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: -2px;
		box-shadow: none;
	}

	.table-footer {
		padding: var(--space-3) var(--space-4);
		border-block-start: 1px solid var(--color-line);
		background: var(--color-surface-1);
	}

	.responsive-unassigned-table {
		width: 100%;
		border-collapse: collapse;
		text-align: start;
	}

	.responsive-unassigned-table th,
	.responsive-unassigned-table td {
		padding: 11px var(--space-4);
		border-block-end: 1px solid var(--color-line);
		text-align: start;
		vertical-align: top;
	}

	.responsive-unassigned-table tbody tr:last-child th,
	.responsive-unassigned-table tbody tr:last-child td {
		border-block-end: 0;
	}

	.responsive-unassigned-table thead th {
		background: var(--color-surface-2);
		font: var(--text-micro);
		font-weight: 600;
		color: var(--color-text-muted);
		position: sticky;
		inset-block-start: 0;
		z-index: 1;
		white-space: nowrap;
		padding-block: 9px;
	}

	.responsive-unassigned-table tbody tr {
		transition: background-color var(--dur-fast) var(--ease);
	}

	.responsive-unassigned-table tbody tr:hover {
		background: var(--color-surface-2);
	}

	.share-title-stack {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.share-title {
		font: var(--text-ui);
		font-weight: 600;
		color: var(--color-text);
	}

	.resource-link {
		font: var(--text-meta);
		color: var(--color-text-muted);
		word-break: normal;
		overflow-wrap: anywhere;
	}

	.share-note {
		margin: var(--space-1) 0 0;
		font: var(--text-hint);
		color: var(--color-text-secondary);
	}

	.author-cell {
		font: var(--text-ui);
		white-space: nowrap;
	}

	.channel-badge {
		font: var(--text-hint);
		color: var(--color-text-secondary);
	}

	.responsive-unassigned-table th.num-col,
	.responsive-unassigned-table td.num-col {
		text-align: end;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.date-cell {
		font: var(--text-meta);
		font-variant-numeric: tabular-nums;
		color: var(--color-text-muted);
	}

	.pagination-row,
	.empty-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin: 0;
	}

	.empty-state {
		margin: 0;
		padding: var(--space-5) var(--space-4);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-sm);
		background: var(--color-surface-2);
		font: var(--text-ui);
		color: var(--color-text-muted);
	}

	@media (pointer: coarse) {
		.checkbox-pill {
			min-block-size: 44px;
		}

		.share-check-label {
			min-inline-size: 44px;
			min-block-size: 44px;
		}
	}

	@container (width < 640px) {
		.responsive-unassigned-table thead {
			display: none;
		}

		.responsive-unassigned-table tbody,
		.responsive-unassigned-table tr,
		.responsive-unassigned-table th,
		.responsive-unassigned-table td {
			display: block;
			width: 100%;
		}

		.responsive-unassigned-table tr {
			border-block-end: 2px solid var(--color-line);
			padding: var(--space-2) 0;
		}

		.responsive-unassigned-table tbody th,
		.responsive-unassigned-table tbody td {
			border-block-end: none;
			padding: var(--space-2) var(--space-4);
		}

		.responsive-unassigned-table td {
			display: grid;
			grid-template-columns: 7.5rem 1fr;
			gap: var(--space-2);
			align-items: center;
		}

		.responsive-unassigned-table td.num-col {
			text-align: start;
		}

		.responsive-unassigned-table td::before {
			font: var(--text-micro);
			color: var(--color-text-muted);
		}

		.responsive-unassigned-table td:nth-child(1)::before {
			content: var(--label-1);
		}

		.responsive-unassigned-table td:nth-child(3)::before {
			content: var(--label-3);
		}

		.responsive-unassigned-table td:nth-child(4)::before {
			content: var(--label-4);
		}

		.responsive-unassigned-table td:nth-child(5)::before {
			content: var(--label-5);
		}
	}

	@media (forced-colors: active) {
		.table-wrapper:focus-visible {
			outline-color: CanvasText;
		}
	}
	.share-suggestions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-2);
		margin: var(--space-1) 0 0;
		font: var(--text-hint);
		color: var(--color-text-muted);
	}

	.suggestion-add {
		padding: 0;
		font: inherit;
		font-weight: 600;
		color: var(--color-accent-text);
		background: none;
		border: 0;
		text-decoration: underline;
		text-underline-offset: 0.2em;
		cursor: pointer;
	}
</style>
