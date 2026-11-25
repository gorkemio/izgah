<script lang="ts">
	import { t, formatNumber } from '#lib/i18n/index.ts';
	import Avatar from '#lib/components/ui/Avatar.svelte';
	import { formatDayKeyShort } from '#lib/format/date.ts';
	import type { FeedRailSummary } from '#lib/server/feed/rail-summary.ts';

	interface Props {
		summary: FeedRailSummary;
		currentUserId: string;
		/** Istanbul `YYYY-MM-DD` key from server load so SSR and hydration match. */
		todayKey: string;
	}

	let { summary, currentUserId, todayKey }: Props = $props();

	const shortTodayLabel = $derived(formatDayKeyShort(todayKey));
</script>

<aside class="context-rail" aria-label={t('rail.label')}>
	<section class="rail-card" aria-labelledby="rail-today-heading">
		<div class="rail-card-head">
			<h2 id="rail-today-heading" class="rail-card-title">{t('rail.today')}</h2>
			{#if shortTodayLabel}
				<span class="rail-card-meta">{shortTodayLabel}</span>
			{/if}
		</div>
		<dl class="mini-kpi-grid">
			<div class="mini-kpi">
				<dd class="mini-kpi-val">{formatNumber(summary.todayShares)}</dd>
				<dt class="mini-kpi-lbl">{t('rail.shares')}</dt>
			</div>
			<div class="mini-kpi">
				<dd class="mini-kpi-val">{formatNumber(summary.todayComments)}</dd>
				<dt class="mini-kpi-lbl">{t('rail.comments')}</dt>
			</div>
		</dl>
	</section>

	<section class="rail-card" aria-labelledby="rail-popular-heading">
		<div class="rail-card-head">
			<h2 id="rail-popular-heading" class="rail-card-title">{t('rail.popular')}</h2>
			<span class="rail-card-meta">{t('rail.sevenDays')}</span>
		</div>
		{#if summary.popularResources.length === 0}
			<p class="rail-empty">{t('rail.noDiscussion')}</p>
		{:else}
			<ol class="trend-list" role="list">
				{#each summary.popularResources as resource (resource.id)}
					<li class="trend-item">
						<a href="/resources/{resource.id}#comments" class="trend-link">
							<span class="trend-title">{resource.title || resource.domain}</span>
							<span class="trend-meta">
								<span class="trend-domain">{resource.domain}</span>
								<span aria-hidden="true">·</span>
								<span class="trend-stat">
									{t('common.commentCount', { count: resource.recentCommentCount })}
								</span>
								<span aria-hidden="true">·</span>
								<span class="trend-stat">
									{t('common.likeCount', { count: resource.likeCount })}
								</span>
							</span>
						</a>
					</li>
				{/each}
			</ol>
		{/if}
	</section>

	<section class="rail-card" aria-labelledby="rail-members-heading">
		<div class="rail-card-head">
			<h2 id="rail-members-heading" class="rail-card-title">{t('rail.topSharers')}</h2>
		</div>
		{#if summary.activeMembers.length === 0}
			<p class="rail-empty">{t('rail.noShares')}</p>
		{:else}
			<ol class="member-list" role="list">
				{#each summary.activeMembers as member (member.id)}
					<li class="member-row">
						<Avatar name={member.name} self={member.id === currentUserId} size={26} />
						<span class="member-name">{member.name}</span>
						<span class="member-count">
							{member.shareCount}<span class="visually-hidden">
								{t('rail.shareSuffix', { count: member.shareCount })}
							</span>
						</span>
					</li>
				{/each}
			</ol>
		{/if}
	</section>
</aside>

<style>
	.context-rail {
		display: none;
	}

	@media (min-width: 1280px) {
		.context-rail {
			position: sticky;
			inset-block-start: calc(var(--sticky-top) + var(--space-5));
			display: grid;
			gap: 14px;
			align-content: start;
			min-inline-size: 0;
		}
	}

	.rail-card {
		background: var(--card-bg);
		border: 1px solid var(--card-border);
		border-radius: var(--radius-md);
		padding: 15px 16px;
		box-shadow: var(--card-shadow);
		display: grid;
		gap: 11px;
	}

	.rail-card-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}

	.rail-card-title {
		font-family: var(--font-sans);
		font-size: 0.75rem;
		font-weight: 600;
		line-height: 1.3;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
	}

	.rail-card-meta {
		font: var(--text-meta);
		font-size: 0.75rem;
		font-variant-numeric: tabular-nums;
		color: var(--color-text-muted);
		white-space: nowrap;
	}

	.mini-kpi-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--space-2);
		margin: 0;
	}

	.mini-kpi {
		padding: 9px 10px;
		border-radius: var(--radius-sm);
		background: var(--color-surface-2);
		border: 1px solid var(--color-line);
		display: grid;
		gap: 2px;
	}

	.mini-kpi-val {
		font-family: var(--font-mono);
		font-size: 1.1875rem;
		font-weight: 700;
		line-height: 1.15;
		letter-spacing: -0.02em;
		font-variant-numeric: tabular-nums;
		color: var(--color-text);
	}

	.mini-kpi-lbl {
		font: var(--text-hint);
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.trend-list,
	.member-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
	}

	.trend-item {
		border-block-end: 1px solid var(--color-line);
	}

	.trend-item:last-child {
		border-block-end: 0;
	}

	.trend-link {
		display: grid;
		gap: 3px;
		padding-block: 8px;
		text-decoration: none;
		color: var(--color-text);
		border-radius: var(--radius-xs);
		transition: color var(--dur-fast) var(--ease);
	}

	.trend-item:first-child .trend-link {
		padding-block-start: 0;
	}

	.trend-item:last-child .trend-link {
		padding-block-end: 0;
	}

	.trend-link:hover {
		color: var(--color-accent-text);
		text-decoration: none;
	}

	/* Serif permitted on right-rail "Çok konuşulanlar" titles (izgah-ui-v3 §2.2). */
	.trend-title {
		font-family: var(--font-display);
		font-size: 0.90625rem;
		font-weight: 600;
		line-height: 1.32;
		color: inherit;
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		overflow: hidden;
	}

	.trend-meta {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		column-gap: 0.35rem;
		row-gap: 0.1rem;
		font: var(--text-meta);
		font-size: 0.75rem;
		font-variant-numeric: tabular-nums;
		color: var(--color-text-muted);
	}

	.trend-domain {
		min-inline-size: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.trend-stat {
		white-space: nowrap;
	}

	.member-list {
		gap: 9px;
	}

	.member-row {
		display: flex;
		align-items: center;
		gap: 9px;
		min-inline-size: 0;
	}

	.member-name {
		font: var(--text-ui);
		font-size: 0.8125rem;
		color: var(--color-text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.member-count {
		margin-inline-start: auto;
		font: var(--text-meta);
		font-variant-numeric: tabular-nums;
		color: var(--color-text-muted);
		flex: none;
	}

	.rail-empty {
		font: var(--text-hint);
		color: var(--color-text-muted);
	}

	@media (forced-colors: active) {
		.rail-card,
		.mini-kpi {
			box-shadow: none;
			border-color: CanvasText;
		}
	}
</style>
