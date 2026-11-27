<script lang="ts">
	import { cssText, t } from '#lib/i18n/index.ts';
	import { pageTitle } from '#lib/instance.ts';
	import { formatWhen } from '#lib/format/date.ts';
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let busy = $state(false);

	const formatDate = formatWhen;
</script>

<svelte:head>
	<title>{pageTitle(t('jobs.title'))}</title>
</svelte:head>

<div class="admin-page">
	<header class="page-header">
		<h1 tabindex="-1">{t('jobs.heading')}</h1>
		<p class="page-lead">
			{t('jobs.lead')}
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

	<section class="kpi-strip kpi-strip-4" aria-label={t('jobs.summary')}>
		<article class="kpi-box">
			<h2>{t('jobs.queued')}</h2>
			<p class="kpi-value">{data.summary.queued}</p>
		</article>
		<article class="kpi-box">
			<h2>{t('jobs.running')}</h2>
			<p class="kpi-value">{data.summary.running}</p>
		</article>
		<article class="kpi-box">
			<h2>{t('jobs.done')}</h2>
			<p class="kpi-value">{data.summary.completed}</p>
		</article>
		<article class="kpi-box" class:has-dead={data.summary.dead > 0}>
			<h2>{t('jobs.dead')}</h2>
			<p class="kpi-value">{data.summary.dead}</p>
		</article>
	</section>

	<section class="table-card" aria-labelledby="dead-jobs-heading">
		<div class="table-toolbar">
			<h2 id="dead-jobs-heading">{t('jobs.failedTitle', { count: data.deadJobs.length })}</h2>
			{#if data.deadJobs.length > 0}
				<form
					method="POST"
					action="?/retryAll"
					use:enhance={() => {
						busy = true;
						return async ({ update }) => {
							await update();
							busy = false;
						};
					}}
				>
					<button type="submit" class="btn btn-primary btn-sm" disabled={busy}>
						{busy ? t('jobs.requeueing') : t('jobs.retryAll')}
					</button>
				</form>
			{/if}
		</div>

		{#if data.deadJobs.length === 0}
			<div class="empty-wrap">
				<p class="empty-state">{t('jobs.empty')}</p>
			</div>
		{:else}
			<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
			<div tabindex="0" role="region" aria-labelledby="dead-jobs-heading" class="table-wrapper">
				<table
					class="responsive-jobs-table"
					style:--label-2={cssText(t('table.attempts'))}
					style:--label-3={cssText(t('table.error'))}
					style:--label-4={cssText(t('table.updated'))}
					style:--label-5={cssText(t('table.action'))}
				>
					<caption class="visually-hidden">{t('jobs.caption')}</caption>
					<thead>
						<tr>
							<th scope="col">{t('jobs.colTarget')}</th>
							<th scope="col" class="num-col">{t('table.attempts')}</th>
							<th scope="col">{t('table.error')}</th>
							<th scope="col">{t('table.updated')}</th>
							<th scope="col" class="actions-col">{t('table.action')}</th>
						</tr>
					</thead>
					<tbody>
						{#each data.deadJobs as job (job.id)}
							<tr>
								<th scope="row" class="job-url-cell">
									<div class="job-url-stack">
										<span class="job-domain">{job.title ?? job.domain}</span>
										<a href="/resources/{job.resourceId}" class="job-link">{job.targetUrl}</a>
									</div>
								</th>
								<td class="num-col">{job.attempts}</td>
								<td class="error-cell">
									<div class="error-stack">
										<code class="error-code">{job.lastErrorCode ?? 'UNKNOWN'}</code>
										{#if job.lastErrorMessage}
											<span class="error-detail">{job.lastErrorMessage}</span>
										{/if}
									</div>
								</td>
								<td class="date-cell">
									<time datetime={job.updatedAt}>{formatDate(job.updatedAt)}</time>
								</td>
								<td>
									<div class="row-actions">
										<form
											method="POST"
											action="?/retry"
											use:enhance={() => {
												busy = true;
												return async ({ update }) => {
													await update();
													busy = false;
												};
											}}
										>
											<input type="hidden" name="jobId" value={job.id} />
											<button type="submit" class="btn btn-subtle btn-sm" disabled={busy}>
												{t('jobs.retry')} <span class="visually-hidden">({job.domain})</span>
											</button>
										</form>
									</div>
								</td>
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

	.kpi-box.has-dead {
		color: var(--destructive);
	}

	.kpi-box.has-dead h2 {
		color: var(--destructive);
	}

	.kpi-box.has-dead .kpi-value {
		color: var(--destructive);
	}

	.table-card {
		overflow: hidden;
		background: var(--card);
		border: 1px solid var(--border);
		border-radius: 12px;
		box-shadow: var(--elevation-sm);
	}

	.table-toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		border-block-end: 1px solid var(--border);
	}

	.table-toolbar h2 {
		margin: 0;
		font: var(--type-section);
		letter-spacing: -0.01em;
		font-variant-numeric: tabular-nums;
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
		outline: 2px solid var(--primary);
		outline-offset: -2px;
		box-shadow: none;
	}

	.responsive-jobs-table {
		width: 100%;
		border-collapse: collapse;
		text-align: start;
	}

	.responsive-jobs-table th,
	.responsive-jobs-table td {
		padding: 11px var(--space-4);
		border-block-end: 1px solid var(--border);
		text-align: start;
		vertical-align: top;
	}

	.responsive-jobs-table tbody tr:last-child th,
	.responsive-jobs-table tbody tr:last-child td {
		border-block-end: 0;
	}

	.responsive-jobs-table thead th {
		background: var(--muted);
		font: var(--type-micro);
		font-weight: 600;
		color: var(--muted-foreground);
		position: sticky;
		inset-block-start: 0;
		z-index: 1;
		white-space: nowrap;
		padding-block: 9px;
	}

	.responsive-jobs-table tbody tr {
		transition: background-color var(--dur-fast) var(--ease);
	}

	.responsive-jobs-table tbody tr:hover {
		background: var(--muted);
	}

	.job-url-stack {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.error-stack {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.job-domain {
		font: var(--type-ui);
		font-weight: 600;
		color: var(--foreground);
	}

	.job-link {
		font: var(--type-meta);
		color: var(--muted-foreground);
		word-break: normal;
		overflow-wrap: anywhere;
	}

	.responsive-jobs-table th.num-col,
	.responsive-jobs-table td.num-col {
		text-align: end;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.responsive-jobs-table tbody td.num-col {
		font: var(--type-meta);
		font-variant-numeric: tabular-nums;
	}

	.responsive-jobs-table th.actions-col {
		text-align: end;
	}

	.row-actions {
		display: flex;
		justify-content: flex-end;
	}

	.date-cell {
		font: var(--type-meta);
		font-variant-numeric: tabular-nums;
		color: var(--muted-foreground);
		white-space: nowrap;
	}

	.error-code {
		align-self: flex-start;
		display: inline-flex;
		align-items: center;
		padding: 2px 9px;
		border-radius: 9999px;
		border: 1px solid color-mix(in oklab, var(--destructive) 40%, transparent);
		background: color-mix(in oklab, var(--destructive) 10%, transparent);
		font: var(--type-micro);
		font-variant-numeric: tabular-nums;
		letter-spacing: 0.02em;
		color: var(--destructive);
		white-space: nowrap;
	}

	.error-detail {
		font: var(--type-hint);
		color: var(--muted-foreground);
	}

	.empty-state {
		margin: 0;
		padding: var(--space-5) var(--space-4);
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--muted);
		font: var(--type-ui);
		color: var(--muted-foreground);
	}

	@container (width < 640px) {
		.responsive-jobs-table thead {
			display: none;
		}

		.responsive-jobs-table tbody,
		.responsive-jobs-table tr,
		.responsive-jobs-table th,
		.responsive-jobs-table td {
			display: block;
			width: 100%;
		}

		.responsive-jobs-table tr {
			border-block-end: 2px solid var(--border);
			padding: var(--space-2) 0;
		}

		.responsive-jobs-table tbody th,
		.responsive-jobs-table tbody td {
			border-block-end: none;
			padding: var(--space-2) var(--space-4);
		}

		.responsive-jobs-table td {
			display: grid;
			grid-template-columns: 7.5rem 1fr;
			gap: var(--space-2);
			align-items: center;
		}

		.responsive-jobs-table td.num-col {
			text-align: start;
		}

		.responsive-jobs-table td::before {
			font: var(--type-micro);
			color: var(--muted-foreground);
		}

		.responsive-jobs-table td:nth-child(2)::before {
			content: var(--label-2);
		}

		.responsive-jobs-table td:nth-child(3)::before {
			content: var(--label-3);
		}

		.responsive-jobs-table td:nth-child(4)::before {
			content: var(--label-4);
		}

		.responsive-jobs-table td:nth-child(5)::before {
			content: var(--label-5);
		}

		.row-actions {
			justify-content: flex-start;
		}
	}

	@media (forced-colors: active) {
		.table-wrapper:focus-visible {
			outline-color: CanvasText;
		}
	}
</style>
