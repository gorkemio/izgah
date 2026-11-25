<script lang="ts">
	import { t } from '$lib/i18n';
	import { instanceName } from '$lib/instance';
	import { page } from '$app/state';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Tooltip from '$lib/components/ui/Tooltip.svelte';
	import { shortcutLabel, type ModifierKey } from '$lib/platform';

	interface SectionRef {
		id: string;
		slug: string;
		name: string;
	}

	interface Props {
		activeSection: SectionRef | null;
		hydrated: boolean;
		onOpenCommandPalette: () => void;
		onOpenHelp: () => void;
	}

	let { activeSection, hydrated, onOpenCommandPalette, onOpenHelp }: Props = $props();

	const paletteShortcut = $derived(
		shortcutLabel((page.data as { modifierKey?: ModifierKey }).modifierKey ?? 'meta', 'K')
	);

	interface BreadcrumbPart {
		label: string;
		href?: string;
	}

	const breadcrumb = $derived.by((): BreadcrumbPart[] => {
		const pathname = page.url.pathname;

		if (pathname === '/') {
			return [{ label: t('page.feed') }];
		}
		if (pathname === '/sections') {
			return [{ label: t('nav.sections') }];
		}
		if (pathname.startsWith('/sections/')) {
			return [
				{ label: t('nav.sections'), href: '/sections' },
				{ label: activeSection?.name ?? t('page.section') }
			];
		}
		if (pathname.startsWith('/resources/')) {
			return [{ label: t('page.resource') }];
		}
		if (pathname === '/search') {
			const q = page.url.searchParams.get('q')?.trim();
			return q
				? [{ label: t('page.search'), href: '/search' }, { label: `“${q}”` }]
				: [{ label: t('page.search') }];
		}
		if (pathname === '/settings') {
			return [{ label: t('page.settings') }];
		}
		if (pathname === '/settings/api-keys') {
			return [{ label: t('page.settings'), href: '/settings' }, { label: t('page.apiKeys') }];
		}
		if (pathname.startsWith('/admin')) {
			const adminLabels: Record<string, string> = {
				'/admin/users': t('admin.tab.members'),
				'/admin/sections': t('admin.tab.sections'),
				'/admin/unassigned': t('admin.tab.unassigned'),
				'/admin/jobs': t('admin.tab.jobs'),
				'/admin/metrics': t('admin.tab.metrics'),
				'/admin/audit': t('admin.tab.audit')
			};
			const sub = adminLabels[pathname];
			return sub
				? [{ label: t('page.admin'), href: '/admin/users' }, { label: sub }]
				: [{ label: t('page.admin') }];
		}

		return [{ label: instanceName() }];
	});
</script>

<div class="top-context-bar">
	<nav class="breadcrumb" aria-label={t('topbar.location')}>
		<ol role="list">
			<li><a href="/" class="crumb-link">{instanceName()}</a></li>
			{#each breadcrumb as part, index (part.label + index)}
				<li>
					{#if part.href && index < breadcrumb.length - 1}
						<a href={part.href} class="crumb-link">{part.label}</a>
					{:else}
						<a
							href={`${page.url.pathname}${page.url.search}`}
							class="crumb-current"
							aria-current="page">{part.label}</a
						>
					{/if}
				</li>
			{/each}
		</ol>
	</nav>

	<div class="topbar-actions">
		{#if hydrated}
			<button
				type="button"
				class="cmdk-trigger"
				onclick={onOpenCommandPalette}
				aria-label={t('palette.open')}
				aria-keyshortcuts="Meta+K Control+K"
			>
				<Icon name="search" size={14} />
				<span class="cmdk-trigger-label">{t('palette.trigger')}</span>
				<kbd class="kbd cmdk-trigger-kbd" aria-hidden="true">{paletteShortcut}</kbd>
			</button>
			<Tooltip text={t('help.title')} shortcut="?" placement="left">
				{#snippet children()}
					<button
						type="button"
						class="btn btn-ghost btn-icon btn-sm help-trigger"
						onclick={onOpenHelp}
						aria-label={t('help.title')}
						aria-keyshortcuts="Shift+?"
					>
						<Icon name="keyboard" size={16} />
					</button>
				{/snippet}
			</Tooltip>
		{:else}
			<a href="/search" class="cmdk-trigger" aria-label={t('palette.goToSearch')}>
				<Icon name="search" size={14} />
				<span class="cmdk-trigger-label">{t('palette.trigger')}</span>
				<kbd class="kbd cmdk-trigger-kbd" aria-hidden="true">{paletteShortcut}</kbd>
			</a>
		{/if}
	</div>
</div>

<style>
	.top-context-bar {
		display: none;
	}

	@media (min-width: 768px) {
		.top-context-bar {
			position: sticky;
			inset-block-start: 0;
			z-index: 25;
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: var(--space-3);
			block-size: var(--topbar-h);
			padding: 0 var(--gutter);
			background: color-mix(in oklab, var(--color-bg) 90%, transparent);
			backdrop-filter: blur(8px);
			border-block-end: 1px solid var(--color-line);
		}
	}

	:global(:is([data-light-theme='contrast'], [data-dark-theme='contrast'])) .top-context-bar {
		background: var(--color-bg);
		backdrop-filter: none;
	}

	.breadcrumb {
		min-inline-size: 0;
	}

	.breadcrumb > ol {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-inline-size: 0;
		margin: 0;
		padding: 0;
		list-style: none;
		font: var(--text-ui);
		color: var(--color-text-muted);
	}

	.breadcrumb li {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-inline-size: 0;
	}

	/* Decorative divider with empty alt text so screen readers skip it. */
	.breadcrumb li + li::before {
		content: '/' / '';
		color: var(--color-line-strong);
	}

	.crumb-link {
		color: var(--color-text-muted);
		text-decoration: none;
		white-space: nowrap;
		transition: color var(--dur-fast) var(--ease);
	}

	.crumb-link:hover {
		color: var(--color-text);
		text-decoration: underline;
	}

	.crumb-current {
		color: var(--color-text);
		font-weight: 600;
		text-decoration: none;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	@media (forced-colors: active) {
		.crumb-current {
			text-decoration: underline;
		}
	}

	.topbar-actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex: none;
	}

	.cmdk-trigger {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		min-block-size: 30px;
		min-inline-size: 11.5rem;
		padding: 0 var(--space-2) 0 var(--space-3);
		font: var(--text-ui);
		font-weight: 400;
		color: var(--color-text-muted);
		background: var(--color-surface-1);
		border: 1px solid var(--color-line-strong);
		border-radius: var(--radius-sm);
		text-decoration: none;
		cursor: pointer;
		transition:
			background-color var(--dur-fast) var(--ease),
			border-color var(--dur-fast) var(--ease),
			color var(--dur-fast) var(--ease);
	}

	.cmdk-trigger:hover {
		background: var(--color-surface-2);
		border-color: var(--color-line-strong);
		color: var(--color-text);
		text-decoration: none;
	}

	.cmdk-trigger-label {
		margin-inline-end: auto;
	}

	.cmdk-trigger-kbd {
		flex: none;
	}

	.help-trigger {
		color: var(--color-text-muted);
	}

	@media (prefers-contrast: more), (forced-colors: active) {
		.top-context-bar {
			background: var(--color-bg);
			backdrop-filter: none;
		}
	}
</style>
