<script lang="ts">
	import { cssText, t } from '$lib/i18n';
	import { pageTitle } from '$lib/instance';
	import { formatDateTimeWithSeconds } from '$lib/format/date';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const formatDate = formatDateTimeWithSeconds;

	function formatMetadata(meta: Record<string, unknown> | null): string {
		if (!meta || Object.keys(meta).length === 0) {
			return '—';
		}
		return JSON.stringify(meta);
	}

	function buildPageHref(cursor: string): string {
		const params = new URLSearchParams();
		if (data.selectedAction) {
			params.set('action', data.selectedAction);
		}
		params.set('cursor', cursor);
		return `/admin/audit?${params.toString()}`;
	}
</script>

<svelte:head>
	<title>{pageTitle(t('audit.title'))}</title>
</svelte:head>

<div class="admin-page">
	<header class="page-header">
		<h1 tabindex="-1">{t('audit.title')}</h1>
		<p class="page-lead">
			{t('audit.lead')}
		</p>
	</header>

	<section class="panel" aria-labelledby="audit-filter-heading">
		<h2 id="audit-filter-heading" class="visually-hidden">{t('audit.filterHeading')}</h2>
		<form method="GET" action="/admin/audit" class="filter-form">
			<div class="field">
				<label for="audit-action-filter">{t('audit.actionType')}</label>
				<select id="audit-action-filter" name="action" value={data.selectedAction ?? ''}>
					<option value="">{t('common.all')}</option>
					{#each data.availableActions as actionName (actionName)}
						<option value={actionName}>
							{data.actionLabels[actionName] ?? actionName} ({actionName})
						</option>
					{/each}
				</select>
			</div>
			<div class="filter-actions">
				<button type="submit" class="btn btn-primary">{t('audit.filter')}</button>
				{#if data.selectedAction || data.hasActiveCursor}
					<a href="/admin/audit" class="btn btn-ghost">{t('audit.clear')}</a>
				{/if}
			</div>
		</form>
	</section>

	<section class="table-card" aria-labelledby="audit-table-heading">
		<div class="table-toolbar">
			<h2 id="audit-table-heading">{t('audit.entries', { count: data.items.length })}</h2>
			{#if data.selectedAction}
				<span class="badge">{data.selectedAction}</span>
			{/if}
		</div>

		{#if data.items.length === 0}
			<div class="empty-wrap">
				<p class="empty-state">{t('audit.empty')}</p>
			</div>
		{:else}
			<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
			<div tabindex="0" role="region" aria-labelledby="audit-table-heading" class="table-wrapper">
				<table
					class="responsive-audit-table"
					style:--label-2={cssText(t('table.action'))}
					style:--label-3={cssText(t('table.actor'))}
					style:--label-4={cssText(t('table.target'))}
					style:--label-5={cssText(t('table.detail'))}
				>
					<caption class="visually-hidden">{t('audit.caption')}</caption>
					<thead>
						<tr>
							<th scope="col">{t('table.date')}</th>
							<th scope="col">{t('table.action')}</th>
							<th scope="col">{t('table.actor')}</th>
							<th scope="col">{t('table.target')}</th>
							<th scope="col">{t('table.detail')}</th>
						</tr>
					</thead>
					<tbody>
						{#each data.items as item (item.id)}
							<tr>
								<th scope="row" class="date-cell">
									<time datetime={item.createdAt}>{formatDate(item.createdAt)}</time>
								</th>
								<td class="action-cell">
									<div class="action-stack">
										<span class="action-label">{item.actionLabel}</span>
										<code class="action-code">{item.action}</code>
									</div>
								</td>
								<td class="actor-cell">
									{#if item.actorName}
										<span class="actor-name">{item.actorName}</span>
										{#if item.actorEmail}
											<span class="sub-meta actor-email">{item.actorEmail}</span>
										{/if}
									{:else}
										<span class="actor-name">{t('audit.system')}</span>
									{/if}
								</td>
								<td class="target-cell">
									<code class="target-code">{item.targetType}</code>
									{#if item.targetId}
										<span class="sub-meta target-id">{item.targetId}</span>
									{/if}
								</td>
								<td class="meta-cell">
									<code class="meta-json">{formatMetadata(item.metadata)}</code>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			{#if data.nextCursor || data.hasActiveCursor}
				<div class="table-footer">
					<nav aria-label={t('audit.pagination')} class="pagination-row">
						{#if data.hasActiveCursor}
							<a
								href={data.selectedAction
									? `/admin/audit?action=${encodeURIComponent(data.selectedAction)}`
									: '/admin/audit'}
								class="btn btn-outline btn-sm"
							>
								{t('audit.newest')}
							</a>
						{/if}
						{#if data.nextCursor}
							<a href={buildPageHref(data.nextCursor)} class="btn btn-outline btn-sm">
								{t('audit.next')}
							</a>
						{/if}
					</nav>
				</div>
			{/if}
		{/if}
	</section>
</div>

<style>
	.admin-page {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}

	.panel {
		background: var(--color-surface-1);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-sm);
		padding: var(--space-4) var(--space-5);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.table-card {
		background: var(--color-surface-1);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-sm);
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

	.table-toolbar h2 {
		margin: 0;
		font: var(--text-section);
		letter-spacing: -0.01em;
		font-variant-numeric: tabular-nums;
	}

	.empty-wrap {
		padding: var(--space-4);
	}

	.table-footer {
		padding: var(--space-3) var(--space-4);
		border-block-start: 1px solid var(--color-line);
		background: var(--color-surface-1);
	}

	.filter-form {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: var(--space-3);
	}

	.filter-form .field {
		flex: 1 1 16rem;
	}

	.filter-actions,
	.pagination-row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
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

	.responsive-audit-table {
		width: 100%;
		border-collapse: collapse;
		text-align: start;
	}

	.responsive-audit-table th,
	.responsive-audit-table td {
		padding: 11px var(--space-4);
		border-block-end: 1px solid var(--color-line);
		text-align: start;
		vertical-align: top;
	}

	.responsive-audit-table tbody tr:last-child th,
	.responsive-audit-table tbody tr:last-child td {
		border-block-end: 0;
	}

	.responsive-audit-table thead th {
		background: var(--color-surface-2);
		font: var(--text-micro);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--color-text-muted);
		position: sticky;
		inset-block-start: 0;
		z-index: 1;
		white-space: nowrap;
		padding-block: 9px;
	}

	.responsive-audit-table tbody tr {
		transition: background-color var(--dur-fast) var(--ease);
	}

	.responsive-audit-table tbody tr:hover {
		background: var(--color-surface-2);
	}

	.date-cell {
		white-space: nowrap;
		font: var(--text-meta);
		font-variant-numeric: tabular-nums;
		color: var(--color-text-secondary);
	}

	.action-stack {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.action-label {
		font: var(--text-ui);
		font-weight: 600;
		color: var(--color-text);
	}

	.action-code,
	.target-code {
		font: var(--text-micro);
		font-variant-numeric: tabular-nums;
	}

	.action-code {
		color: var(--color-text-muted);
	}

	.target-code {
		color: var(--color-text-secondary);
	}

	.actor-name {
		display: block;
		font: var(--text-ui);
		font-weight: 500;
		color: var(--color-text);
	}

	.sub-meta {
		display: block;
		color: var(--color-text-muted);
	}

	.actor-email {
		font: var(--text-meta);
		min-inline-size: 11rem;
		word-break: normal;
		overflow-wrap: anywhere;
	}

	.target-id {
		font: var(--text-micro);
		font-variant-numeric: tabular-nums;
		max-inline-size: 14rem;
		word-break: normal;
		overflow-wrap: anywhere;
	}

	.meta-json {
		display: block;
		font-family: var(--font-mono);
		font-size: 0.75rem;
		line-height: 1.45;
		font-variant-numeric: tabular-nums;
		color: var(--color-text-muted);
		max-inline-size: 22rem;
		word-break: normal;
		overflow-wrap: anywhere;
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

	@container (width < 640px) {
		.responsive-audit-table thead {
			display: none;
		}

		.responsive-audit-table tbody,
		.responsive-audit-table tr,
		.responsive-audit-table th,
		.responsive-audit-table td {
			display: block;
			width: 100%;
		}

		.responsive-audit-table tr {
			border-block-end: 2px solid var(--color-line);
			padding: var(--space-2) 0;
		}

		.responsive-audit-table tbody th,
		.responsive-audit-table tbody td {
			border-block-end: none;
			padding: var(--space-2) var(--space-4);
		}

		.responsive-audit-table td {
			display: grid;
			grid-template-columns: 6.5rem 1fr;
			gap: var(--space-2);
			align-items: start;
		}

		.responsive-audit-table td::before {
			font: var(--text-micro);
			text-transform: uppercase;
			letter-spacing: 0.04em;
			color: var(--color-text-muted);
		}

		.responsive-audit-table td:nth-child(2)::before {
			content: var(--label-2);
		}

		.responsive-audit-table td:nth-child(3)::before {
			content: var(--label-3);
		}

		.responsive-audit-table td:nth-child(4)::before {
			content: var(--label-4);
		}

		.responsive-audit-table td:nth-child(5)::before {
			content: var(--label-5);
		}

		.actor-email {
			min-inline-size: 0;
		}

		.target-id,
		.meta-json {
			max-inline-size: none;
		}
	}

	@media (forced-colors: active) {
		.table-wrapper:focus-visible {
			outline-color: CanvasText;
		}
	}
</style>
