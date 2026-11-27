<script lang="ts">
	import { t } from '#lib/i18n/index.ts';
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: Snippet } = $props();

	const navItems = $derived([
		{ href: '/admin/users', label: t('admin.tab.members'), badge: null },
		{ href: '/admin/sections', label: t('admin.tab.sections'), badge: null },
		{
			href: '/admin/unassigned',
			label: t('admin.tab.unassigned'),
			badge: data.unassignedCount > 0 ? data.unassignedCount : null
		},
		{
			href: '/admin/jobs',
			label: t('admin.tab.jobs'),
			badge: data.deadJobsCount > 0 ? data.deadJobsCount : null
		},
		{
			href: '/admin/ai',
			label: t('admin.tab.ai'),
			badge: data.aiAttentionCount > 0 ? data.aiAttentionCount : null
		},
		{ href: '/admin/audit', label: t('admin.tab.audit'), badge: null },
		{ href: '/admin/metrics', label: t('admin.tab.metrics'), badge: null }
	]);

	function isActive(href: string): boolean {
		return page.url.pathname === href || page.url.pathname.startsWith(`${href}/`);
	}
</script>

<div class="admin-container">
	<nav aria-label={t('admin.tabs')} class="admin-subnav">
		<ul class="admin-subnav-list">
			{#each navItems as item (item.href)}
				<li class="admin-subnav-item">
					<a
						href={item.href}
						class="admin-subnav-link"
						aria-current={isActive(item.href) ? 'page' : undefined}
					>
						<span>{item.label}</span>
						{#if item.badge !== null}
							<span
								class="subnav-badge"
								aria-label={t('admin.pendingCount', { count: item.badge })}
							>
								{item.badge}
							</span>
						{/if}
					</a>
				</li>
			{/each}
		</ul>
	</nav>

	{@render children()}
</div>

<style>
	.admin-container {
		inline-size: 100%;
		max-inline-size: var(--wide-w);
		margin-inline: auto;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}

	.admin-subnav {
		border-block-end: 1px solid var(--border);
	}

	.admin-subnav-list {
		list-style: none;
		margin: -5px -5px -6px;
		padding: 5px 5px 6px;
		display: flex;
		flex-wrap: nowrap;
		align-items: stretch;
		gap: var(--space-1);
		overflow-x: auto;
		scrollbar-width: none;
		overscroll-behavior-inline: contain;
		scroll-snap-type: inline proximity;
	}

	.admin-subnav-list::-webkit-scrollbar {
		display: none;
	}

	.admin-subnav-item {
		flex: none;
		scroll-snap-align: start;
	}

	.admin-subnav-link {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-block-size: 38px;
		padding: var(--space-2) var(--space-3);
		border-radius: 6px 6px 0 0;
		border-block-end: 2px solid transparent;
		color: var(--muted-foreground);
		text-decoration: none;
		font: var(--type-ui);
		white-space: nowrap;
		transition:
			background-color var(--dur-fast) var(--ease),
			color var(--dur-fast) var(--ease);
	}

	.admin-subnav-link:not([aria-current='page']):hover {
		color: var(--foreground);
		background: var(--muted);
		text-decoration: none;
	}

	/* The active tab sits on the rule with a 2px ink line (izgah-ui-v5.md §5.6); a border, so it
	   survives forced-colors mode (WCAG 1.4.1). */
	.admin-subnav-link[aria-current='page'],
	.admin-subnav-link[aria-current='page']:hover {
		color: var(--foreground);
		text-decoration: none;
		border-block-end: 2px solid var(--foreground);
		margin-block-end: -1px;
	}

	.subnav-badge {
		padding: 0 6px;
		font: var(--type-micro);
		font-variant-numeric: tabular-nums;
		color: var(--muted-foreground);
		background: var(--muted);
		border-radius: 9999px;
	}

	@media (pointer: coarse) {
		.admin-subnav-link {
			min-block-size: 44px;
		}
	}

	@media (forced-colors: active) {
		.admin-subnav-link[aria-current='page'] {
			color: Highlight;
		}
	}
</style>
