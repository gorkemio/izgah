<script lang="ts">
	import { t } from '$lib/i18n';
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
		border-block-end: 1px solid var(--color-line);
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
		border-radius: var(--radius-sm) var(--radius-sm) 0 0;
		color: var(--color-text-muted);
		text-decoration: none;
		font: var(--text-ui);
		white-space: nowrap;
		transition:
			background-color var(--dur-fast) var(--ease),
			color var(--dur-fast) var(--ease);
	}

	.admin-subnav-link:not([aria-current='page']):hover {
		color: var(--color-text);
		background: var(--color-surface-2);
		text-decoration: none;
	}

	.admin-subnav-link[aria-current='page'],
	.admin-subnav-link[aria-current='page']:hover {
		color: var(--color-text);
		font-weight: 600;
		text-decoration: none;
	}

	/* Border-based underline survives forced-colors mode (WCAG 1.4.1). */
	.admin-subnav-link[aria-current='page']::after {
		content: '';
		position: absolute;
		inset-inline: 0;
		inset-block-end: -1px;
		border-block-end: 2px solid var(--color-accent);
	}

	.subnav-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-inline-size: 1.25rem;
		min-block-size: 18px;
		padding: 0 6px;
		border-radius: var(--radius-pill);
		font: var(--text-micro);
		font-variant-numeric: tabular-nums;
		background: var(--color-surface-2);
		color: var(--color-text-secondary);
		border: 1px solid var(--color-line);
	}

	.admin-subnav-link[aria-current='page'] .subnav-badge {
		background: var(--color-accent-soft);
		color: var(--color-accent-text);
		border-color: var(--color-accent-border);
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

		.admin-subnav-link[aria-current='page']::after {
			border-block-end-width: 3px;
			border-block-end-color: Highlight;
		}

		.subnav-badge {
			border-color: CanvasText;
		}

		.admin-subnav-link[aria-current='page'] .subnav-badge {
			background: Highlight;
			color: HighlightText;
			border-color: Highlight;
		}
	}
</style>
