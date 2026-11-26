<script lang="ts">
	import { t } from '#lib/i18n/index.ts';
	import { instanceName } from '#lib/instance.ts';
	import { page } from '$app/state';
	import NotificationBell from '#lib/components/notifications/NotificationBell.svelte';
	import PopoverPanel from '#lib/components/ui/PopoverPanel.svelte';
	import ThemeForm from '#lib/components/shell/ThemeForm.svelte';

	interface SectionLink {
		id: string;
		slug: string;
		name: string;
	}

	interface Props {
		user: { id: string; name: string; role: 'member' | 'admin' };
		sections: SectionLink[];
		theme: 'light' | 'dark' | 'system';
		activeSection: SectionLink | null;
		headerQuery: string;
		scopeInCurrentSection: boolean;
		onQueryInput: (value: string) => void;
		onScopeChange: (checked: boolean) => void;
		onCompose: () => void;
	}

	let {
		user,
		sections,
		theme,
		activeSection,
		headerQuery,
		scopeInCurrentSection,
		onQueryInput,
		onScopeChange,
		onCompose
	}: Props = $props();

	/**
	 * Wordmark (docs/designs/izgah-ui-v4.md §5): "iz" in ink, the rest in tertiary ink. Applied only
	 * when the instance name starts with "iz"; any other name is shown as one word.
	 */
	const wordmark = $derived.by(() => {
		const name = instanceName();
		return name.toLocaleLowerCase('tr').startsWith('iz') && name.length > 2
			? { head: name.slice(0, 2), tail: name.slice(2) }
			: null;
	});

	const pathname = $derived(page.url.pathname);
	const onSearchPage = $derived(pathname === '/search');

	function handleCompose(event: MouseEvent): void {
		event.preventDefault();
		onCompose();
	}
</script>

<header class="site-header is-rail">
	<div class="site-header-inner">
		<div class="brand-row">
			<a href="/" class="brand">
				{#if wordmark}
					<span class="brand-iz">{wordmark.head}</span><span class="brand-gah">
						{wordmark.tail}
					</span>
				{:else}
					<span class="brand-iz">{instanceName()}</span>
				{/if}
			</a>
		</div>

		{#if !onSearchPage}
			<search class="rail-search" aria-label={t('search.landmark')}>
				<form method="GET" action="/search">
					<label for="rail-search-input" class="visually-hidden">
						{t('search.inInstance', { name: instanceName() })}
					</label>
					<div class="rail-search-bar">
						<div class="rail-search-field">
							<input
								id="rail-search-input"
								class="input rail-search-input"
								type="search"
								name="q"
								value={headerQuery}
								oninput={(event) => onQueryInput(event.currentTarget.value)}
								placeholder={t('search.placeholderShort')}
								autocapitalize="none"
								spellcheck={false}
							/>
							<kbd class="kbd kbd-hint rail-search-kbd" aria-hidden="true">/</kbd>
						</div>
						<button type="submit" class="btn btn-subtle btn-sm rail-search-submit">
							{t('search.submit')}
						</button>
					</div>
					{#if activeSection}
						<label class="scope-toggle">
							<input
								type="checkbox"
								name="section"
								value={activeSection.id}
								checked={scopeInCurrentSection}
								onchange={(event) => onScopeChange(event.currentTarget.checked)}
							/>
							<span>{t('search.thisSection')}</span>
						</label>
					{/if}
				</form>
			</search>
		{/if}

		<nav aria-label={t('nav.main')} class="rail-nav">
			<ul role="list">
				<li>
					<a href="/" class="nav-item" aria-current={pathname === '/' ? 'page' : undefined}>
						<span class="nav-label">{t('nav.feed')}</span>
					</a>
				</li>
			</ul>
			<p class="nav-group-label" aria-hidden="true">{t('nav.sections')}</p>
			<ul role="list" class="nav-sections-full">
				{#each sections as section (section.id)}
					{@const sectionPath = `/sections/${section.slug}`}
					<li>
						<a
							href={sectionPath}
							class="nav-item nav-section"
							aria-current={pathname === sectionPath ? 'page' : undefined}
						>
							<span class="nav-label">{section.name}</span>
						</a>
					</li>
				{/each}
				<li>
					<a
						href="/sections"
						class="nav-item nav-section nav-all"
						aria-current={pathname === '/sections' ? 'page' : undefined}
					>
						<span class="nav-label">{t('nav.allSections')}</span>
					</a>
				</li>
			</ul>
		</nav>

		<div class="rail-bell">
			<NotificationBell />
		</div>

		<form method="GET" action="/" class="rail-compose">
			<input type="hidden" name="compose" value="1" />
			<button
				type="submit"
				class="btn btn-primary compose-btn"
				aria-label={t('nav.shareLink')}
				onclick={handleCompose}
			>
				<span class="nav-label">{t('nav.share')}</span>
				<kbd class="kbd kbd-hint compose-kbd" aria-hidden="true">n</kbd>
			</button>
		</form>

		{#if user.role === 'admin'}
			<div class="rail-admin-group">
				<a
					href="/admin/users"
					class="nav-item rail-admin"
					aria-current={pathname.startsWith('/admin') ? 'page' : undefined}
				>
					<span class="nav-label">{t('nav.admin')}</span>
				</a>
			</div>
		{/if}

		<div class="rail-account">
			<PopoverPanel
				id="account-menu"
				triggerLabel={t('nav.accountMenu', { name: user.name })}
				iconOnly
				triggerClass="account-trigger"
				panelClass="account-panel"
			>
				{#snippet trigger()}
					<span class="nav-label account-meta">
						<span class="account-name">{user.name}</span>
						<span class="account-role">
							{user.role === 'admin' ? t('role.admin') : t('role.member')}
						</span>
					</span>
				{/snippet}
				{#snippet children({ close })}
					<div class="account-menu">
						<a href="/settings" class="menu-item" onclick={close}>
							{t('nav.settings')}
						</a>
						<a href="/settings/api-keys" class="menu-item" onclick={close}>
							{t('nav.apiKeys')}
						</a>
						<ThemeForm {theme} />
						<form method="POST" action="/logout">
							<button
								type="submit"
								class="menu-item"
								aria-label={t('nav.signOutLabel', { name: user.name })}
							>
								{t('nav.signOut')}
							</button>
						</form>
					</div>
				{/snippet}
			</PopoverPanel>
		</div>
	</div>
</header>

<style>
	/* Künye index (docs/designs/izgah-ui-v4.md §3): rules and type, no icons, no stripes. */
	.site-header {
		align-self: stretch;
		z-index: 30;
		background: var(--rail-bg);
		border-inline-end: 1px solid var(--rail-border);
	}

	.site-header-inner {
		position: sticky;
		inset-block-start: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		block-size: 100dvh;
		padding: var(--space-4) var(--space-4) var(--space-4) 22px;
		overflow-y: auto;
	}

	.brand-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.brand {
		font-size: 1.5rem;
		font-weight: 600;
		line-height: 1;
		letter-spacing: -0.015em;
		color: var(--color-text);
		text-decoration: none;
	}

	.brand:hover {
		color: var(--color-text);
		text-decoration: none;
	}

	.brand-gah {
		font-weight: 400;
		color: var(--color-text-muted);
	}

	.rail-search form {
		display: grid;
		gap: var(--space-2);
	}

	.rail-search-bar {
		display: flex;
		align-items: stretch;
		gap: var(--space-1);
	}

	.rail-search-field {
		position: relative;
		flex: 1;
		min-inline-size: 0;
	}

	.rail-search-input {
		inline-size: 100%;
		min-block-size: 36px;
		padding-inline-end: 34px;
		border-color: var(--color-line-strong);
	}

	.rail-search-kbd {
		position: absolute;
		inset-inline-end: 8px;
		inset-block-start: 50%;
		translate: 0 -50%;
		pointer-events: none;
	}

	.rail-search-field:focus-within .rail-search-kbd,
	.rail-search-field:has(input:not(:placeholder-shown)) .rail-search-kbd {
		opacity: 0;
	}

	.rail-search-submit {
		flex: none;
	}

	.scope-toggle {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		font: var(--text-hint);
		color: var(--color-text-secondary);
	}

	.rail-nav ul {
		display: grid;
		gap: 1px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.nav-group-label {
		margin: var(--space-4) 0 var(--space-1);
		font: var(--text-hint);
		color: var(--color-text-muted);
	}

	.nav-item {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		margin-inline: -8px;
		padding: 5px 8px;
		font: var(--text-ui);
		font-size: 0.9375rem;
		font-weight: 400;
		color: var(--color-text-secondary);
		text-decoration: none;
		border-radius: var(--radius-sm);
	}

	.nav-item:hover {
		color: var(--color-text);
		background: var(--color-surface-2);
		text-decoration: none;
	}

	.nav-item[aria-current='page'] {
		font-weight: 600;
		color: var(--color-text);
		background: var(--color-surface-2);
	}

	.nav-section .nav-label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.rail-compose,
	.rail-admin-group {
		display: grid;
	}

	.compose-btn {
		justify-content: space-between;
	}

	.compose-kbd {
		color: inherit;
		border-color: currentColor;
		background: transparent;
		opacity: 0.7;
	}

	.rail-account {
		margin-block-start: auto;
		padding-block-start: var(--space-3);
		border-block-start: 1px solid var(--color-line);
	}

	:global(.account-trigger) {
		display: flex !important;
		justify-content: flex-start !important;
		align-items: center;
		inline-size: 100%;
		margin-inline: -8px;
		padding: 6px 8px;
		color: var(--color-text);
		text-align: start;
		background: transparent;
		border: 0;
		border-radius: var(--radius-sm);
		cursor: pointer;
	}

	:global(.account-trigger:hover) {
		background: var(--color-surface-2);
	}

	.account-meta {
		display: grid;
		min-inline-size: 0;
	}

	.account-name {
		overflow: hidden;
		font: var(--text-ui);
		font-weight: 600;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.account-role {
		font: var(--text-hint);
		color: var(--color-text-muted);
	}

	.account-menu {
		display: grid;
		gap: 1px;
		min-inline-size: 220px;
		padding: var(--space-1);
	}

	.menu-item {
		display: flex;
		align-items: center;
		inline-size: 100%;
		min-block-size: 36px;
		padding: 0 var(--space-3);
		font: var(--text-ui);
		font-weight: 400;
		color: var(--color-text);
		text-align: start;
		text-decoration: none;
		background: transparent;
		border: 0;
		border-radius: var(--radius-sm);
		cursor: pointer;
	}

	.menu-item:hover {
		background: var(--color-surface-2);
		text-decoration: none;
	}

	/* Mobile top bar (< 768px): brand + bell only; navigation moves to the bottom tab bar. */
	@media (max-width: 767px) {
		.site-header {
			position: sticky;
			inset-block-start: 0;
			align-self: start;
			display: flex;
			flex-direction: row;
			align-items: center;
			justify-content: space-between;
			block-size: var(--header-h);
			padding: 0 var(--gutter);
			overflow: visible;
			border-inline-end: 0;
			border-block-end: 1px solid var(--color-line);
		}

		.site-header-inner {
			display: contents;
		}

		.brand {
			font-size: 1.25rem;
		}

		.rail-search,
		.rail-nav,
		.rail-compose,
		.rail-admin-group,
		.rail-admin,
		.rail-account {
			display: none;
		}
	}

	@media (pointer: coarse) {
		.scope-toggle,
		.nav-item {
			min-block-size: 44px;
			align-items: center;
		}
	}

	@media (forced-colors: active) {
		.nav-item[aria-current='page'] {
			forced-color-adjust: none;
			background: Highlight;
			color: HighlightText;
		}
	}
</style>
