<script lang="ts">
	import { cssText, formatNumber, t } from '#lib/i18n/index.ts';
	import { pageTitle } from '#lib/instance.ts';
	import { formatDateTime } from '#lib/format/date.ts';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	function formatPercent(ratio: number): string {
		return formatNumber(ratio, { style: 'percent', maximumFractionDigits: 1 });
	}

	const formatDate = formatDateTime;
</script>

<svelte:head>
	<title>{pageTitle(t('metrics.title'))}</title>
</svelte:head>

<div class="admin-page">
	<header class="page-header">
		<h1 tabindex="-1">{t('metrics.heading')}</h1>
		<p class="page-lead">
			{t('metrics.lead')}
			<time datetime={data.metrics.generatedAt}>{formatDate(data.metrics.generatedAt)}</time>.
		</p>
	</header>

	<section class="kpi-strip" aria-label={t('metrics.totals')}>
		<article class="kpi-box">
			<h2>{t('metrics.activeMembers')}</h2>
			<div class="kpi-value-row">
				<p class="kpi-value">{data.metrics.totals.activeUsers}</p>
				<p class="kpi-sub">
					{t('metrics.deactivated', { count: data.metrics.totals.disabledUsers })}
				</p>
			</div>
		</article>
		<article class="kpi-box">
			<h2>{t('metrics.activeShares')}</h2>
			<div class="kpi-value-row">
				<p class="kpi-value">{data.metrics.totals.activeShares}</p>
				<p class="kpi-sub">
					{t('metrics.unassigned', { count: data.metrics.totals.unassignedActiveShares })}
				</p>
			</div>
		</article>
		<article class="kpi-box">
			<h2>{t('metrics.resources')}</h2>
			<div class="kpi-value-row">
				<p class="kpi-value">{data.metrics.totals.canonicalResources}</p>
				<p class="kpi-sub">
					{t('metrics.failedJobs', { count: data.metrics.totals.deadUnfurlJobs })}
				</p>
			</div>
		</article>
	</section>

	<section class="table-card" aria-labelledby="rolling-windows-heading">
		<div class="table-toolbar">
			<h2 id="rolling-windows-heading">{t('metrics.rolling')}</h2>
		</div>

		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<div tabindex="0" role="region" aria-labelledby="rolling-windows-heading" class="table-wrapper">
			<table
				class="responsive-metrics-table"
				style:--label-2={cssText(t('table.last7'))}
				style:--label-3={cssText(t('table.last30'))}
			>
				<caption class="visually-hidden">{t('metrics.rollingCaption')}</caption>
				<thead>
					<tr>
						<th scope="col">{t('metrics.metric')}</th>
						<th scope="col" class="num-col">{t('table.last7')}</th>
						<th scope="col" class="num-col">{t('table.last30')}</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<th scope="row">{t('metrics.sharers')}</th>
						<td class="num-col">
							{data.metrics.windows.days7.activeSharingUsers} / {data.metrics.windows.days7
								.totalActiveUsers}
						</td>
						<td class="num-col">
							{data.metrics.windows.days30.activeSharingUsers} / {data.metrics.windows.days30
								.totalActiveUsers}
						</td>
					</tr>
					<tr>
						<th scope="row">{t('metrics.searchers')}</th>
						<td class="num-col">
							{data.metrics.windows.days7.activeSearchingUsers} / {data.metrics.windows.days7
								.totalActiveUsers}
						</td>
						<td class="num-col">
							{data.metrics.windows.days30.activeSearchingUsers} / {data.metrics.windows.days30
								.totalActiveUsers}
						</td>
					</tr>
					<tr>
						<th scope="row">{t('metrics.combined')}</th>
						<td class="num-col">
							{data.metrics.windows.days7.activeUnionUsers} / {data.metrics.windows.days7
								.totalActiveUsers}
						</td>
						<td class="num-col">
							{data.metrics.windows.days30.activeUnionUsers} / {data.metrics.windows.days30
								.totalActiveUsers}
						</td>
					</tr>
					<tr>
						<th scope="row">{t('metrics.totalShares')}</th>
						<td class="num-col">{data.metrics.windows.days7.totalShares}</td>
						<td class="num-col">{data.metrics.windows.days30.totalShares}</td>
					</tr>
					<tr>
						<th scope="row">{t('metrics.webShares')}</th>
						<td class="num-col">
							{data.metrics.windows.days7.webShares}
							({formatPercent(data.metrics.windows.days7.webShareRatio)})
						</td>
						<td class="num-col">
							{data.metrics.windows.days30.webShares}
							({formatPercent(data.metrics.windows.days30.webShareRatio)})
						</td>
					</tr>
					<tr>
						<th scope="row">{t('metrics.apiShares')}</th>
						<td class="num-col">
							{data.metrics.windows.days7.apiShares}
							({formatPercent(data.metrics.windows.days7.apiShareRatio)})
						</td>
						<td class="num-col">
							{data.metrics.windows.days30.apiShares}
							({formatPercent(data.metrics.windows.days30.apiShareRatio)})
						</td>
					</tr>
					<tr>
						<th scope="row">{t('metrics.totalSearches')}</th>
						<td class="num-col">{data.metrics.windows.days7.totalSearches}</td>
						<td class="num-col">{data.metrics.windows.days30.totalSearches}</td>
					</tr>
					<tr>
						<th scope="row">{t('metrics.zeroRate')}</th>
						<td class="num-col">
							{data.metrics.windows.days7.zeroResultSearches}
							({formatPercent(data.metrics.windows.days7.zeroResultSearchRate)})
						</td>
						<td class="num-col">
							{data.metrics.windows.days30.zeroResultSearches}
							({formatPercent(data.metrics.windows.days30.zeroResultSearchRate)})
						</td>
					</tr>
				</tbody>
			</table>
		</div>
	</section>

	<section class="table-card" aria-labelledby="section-usage-heading">
		<div class="table-toolbar">
			<h2 id="section-usage-heading">{t('metrics.bySection')}</h2>
		</div>

		{#if data.metrics.sectionUsage.length === 0}
			<div class="empty-wrap">
				<p class="empty-state">{t('share.noSections')}</p>
			</div>
		{:else}
			<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
			<div tabindex="0" role="region" aria-labelledby="section-usage-heading" class="table-wrapper">
				<table
					class="responsive-sections-stats-table"
					style:--label-2={cssText(t('table.slug'))}
					style:--label-3={cssText(t('table.last30'))}
					style:--label-4={cssText(t('table.totalActiveShares'))}
				>
					<caption class="visually-hidden">{t('metrics.sectionCaption')}</caption>
					<thead>
						<tr>
							<th scope="col">{t('sectionsAdmin.colSection')}</th>
							<th scope="col">{t('table.slug')}</th>
							<th scope="col" class="num-col">{t('table.last30')}</th>
							<th scope="col" class="num-col">{t('table.totalActiveShares')}</th>
						</tr>
					</thead>
					<tbody>
						{#each data.metrics.sectionUsage as stat (stat.id)}
							<tr>
								<th scope="row">{stat.name}</th>
								<td><code class="slug-code">/{stat.slug}</code></td>
								<td class="num-col">{stat.sharesLast30Days}</td>
								<td class="num-col">{stat.totalShares}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>
</div>

<style>
	.admin-page {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}

	.page-lead time {
		font: var(--text-meta);
		font-variant-numeric: tabular-nums;
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
	}

	.empty-wrap {
		padding: var(--space-4);
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

	.responsive-metrics-table,
	.responsive-sections-stats-table {
		width: 100%;
		border-collapse: collapse;
		text-align: start;
	}

	.responsive-metrics-table th,
	.responsive-metrics-table td,
	.responsive-sections-stats-table th,
	.responsive-sections-stats-table td {
		padding: 11px var(--space-4);
		border-block-end: 1px solid var(--color-line);
		text-align: start;
		vertical-align: middle;
	}

	.responsive-metrics-table tbody tr:last-child th,
	.responsive-metrics-table tbody tr:last-child td,
	.responsive-sections-stats-table tbody tr:last-child th,
	.responsive-sections-stats-table tbody tr:last-child td {
		border-block-end: 0;
	}

	.responsive-metrics-table thead th,
	.responsive-sections-stats-table thead th {
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

	.responsive-metrics-table tbody tr,
	.responsive-sections-stats-table tbody tr {
		transition: background-color var(--dur-fast) var(--ease);
	}

	.responsive-metrics-table tbody tr:hover,
	.responsive-sections-stats-table tbody tr:hover {
		background: var(--color-surface-2);
	}

	.responsive-metrics-table tbody th,
	.responsive-sections-stats-table tbody th {
		font: var(--text-ui);
		font-weight: 600;
		color: var(--color-text);
	}

	.responsive-metrics-table th.num-col,
	.responsive-metrics-table td.num-col,
	.responsive-sections-stats-table th.num-col,
	.responsive-sections-stats-table td.num-col {
		text-align: end;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.responsive-metrics-table tbody td.num-col,
	.responsive-sections-stats-table tbody td.num-col {
		font: var(--text-meta);
		font-variant-numeric: tabular-nums;
		color: var(--color-text);
	}

	.slug-code {
		font: var(--text-meta);
		font-variant-numeric: tabular-nums;
		color: var(--color-text-secondary);
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
		.responsive-metrics-table thead,
		.responsive-sections-stats-table thead {
			display: none;
		}

		.responsive-metrics-table tbody,
		.responsive-metrics-table tr,
		.responsive-metrics-table th,
		.responsive-metrics-table td,
		.responsive-sections-stats-table tbody,
		.responsive-sections-stats-table tr,
		.responsive-sections-stats-table th,
		.responsive-sections-stats-table td {
			display: block;
			width: 100%;
		}

		.responsive-metrics-table tr,
		.responsive-sections-stats-table tr {
			border-block-end: 2px solid var(--color-line);
			padding: var(--space-2) 0;
		}

		.responsive-metrics-table tbody th,
		.responsive-metrics-table tbody td,
		.responsive-sections-stats-table tbody th,
		.responsive-sections-stats-table tbody td {
			border-block-end: none;
			padding: var(--space-2) var(--space-4);
		}

		.responsive-metrics-table td,
		.responsive-sections-stats-table td {
			display: grid;
			grid-template-columns: 9.5rem 1fr;
			gap: var(--space-2);
			align-items: center;
		}

		.responsive-metrics-table td.num-col,
		.responsive-sections-stats-table td.num-col {
			text-align: start;
		}

		.responsive-metrics-table td::before,
		.responsive-sections-stats-table td::before {
			font: var(--text-micro);
			text-transform: uppercase;
			letter-spacing: 0.04em;
			color: var(--color-text-muted);
		}

		.responsive-metrics-table td:nth-child(2)::before,
		.responsive-sections-stats-table td:nth-child(2)::before {
			content: var(--label-2);
		}

		.responsive-metrics-table td:nth-child(3)::before,
		.responsive-sections-stats-table td:nth-child(3)::before {
			content: var(--label-3);
		}

		.responsive-sections-stats-table td:nth-child(4)::before {
			content: var(--label-4);
		}
	}

	@media (forced-colors: active) {
		.table-wrapper:focus-visible {
			outline-color: CanvasText;
		}
	}
</style>
