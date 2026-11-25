<script lang="ts">
	import { t } from '#lib/i18n/index.ts';
	import { instanceName } from '#lib/instance.ts';
	import { page } from '$app/state';
	import NotificationBell from '#lib/components/notifications/NotificationBell.svelte';
	import Avatar from '#lib/components/ui/Avatar.svelte';
	import Icon from '#lib/components/ui/Icon.svelte';
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
				<span>{instanceName()}</span>
				<span class="brand-dot" aria-hidden="true"></span>
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
		<a
			href="/search"
			class="nav-item rail-search-icon"
			aria-current={onSearchPage ? 'page' : undefined}
		>
			<Icon name="search" size={16} />
			<span class="nav-label">{t('nav.search')}</span>
		</a>

		<nav aria-label={t('nav.main')} class="rail-nav">
			<ul role="list">
				<li>
					<a href="/" class="nav-item" aria-current={pathname === '/' ? 'page' : undefined}>
						<Icon name="home" size={16} />
						<span class="nav-label">{t('nav.feed')}</span>
					</a>
				</li>
				<li class="nav-sections-compact">
					<a
						href="/sections"
						class="nav-item"
						aria-current={pathname.startsWith('/sections') ? 'page' : undefined}
					>
						<Icon name="layers" size={16} />
						<span class="nav-label">{t('nav.sections')}</span>
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
							<Icon name="hash" size={14} class="nav-hash" />
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
						<Icon name="layers" size={14} class="nav-hash" />
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
				<Icon name="plus" size={16} />
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
					<Icon name="shield" size={16} />
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
					<Avatar name={user.name} self size={30} />
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
							<Icon name="settings" size={16} />{t('nav.settings')}
						</a>
						<a href="/settings/api-keys" class="menu-item" onclick={close}>
							<Icon name="key" size={16} />{t('nav.apiKeys')}
						</a>
						<ThemeForm {theme} />
						<form method="POST" action="/logout">
							<button
								type="submit"
								class="menu-item"
								aria-label={t('nav.signOutLabel', { name: user.name })}
							>
								<Icon name="logout" size={16} />{t('nav.signOut')}
							</button>
						</form>
					</div>
				{/snippet}
			</PopoverPanel>
		</div>
	</div>
</header>

<style>
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
		gap: var(--space-3);
		block-size: 100dvh;
		padding: var(--space-4) var(--space-3) 14px;
		overflow-y: auto;
	}

	.brand-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 2px var(--space-2);
	}

	/* Strict serif boundary (§2.2): Newsreader Variable ONLY on the brand wordmark. */
	.brand {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-family: var(--font-display);
		font-size: 1.375rem;
		font-weight: 600;
		line-height: 1.1;
		letter-spacing: -0.02em;
		color: var(--color-text);
		text-decoration: none;
	}

	.brand:hover {
		color: var(--color-text);
		text-decoration: none;
	}

	.brand-dot {
		display: inline-block;
		inline-size: 7px;
		block-size: 7px;
		border-radius: var(--radius-pill);
		background: var(--color-accent);
		flex: none;
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
		flex: 1 1 auto;
		min-inline-size: 0;
	}

	.rail-search-input {
		min-block-size: 34px;
		padding: 0 var(--space-2);
		font: var(--text-ui);
		font-weight: 400;
		background: var(--color-surface-2);
		/* Interactive control boundary: line-strong keeps ≥ 3:1 (WCAG 1.4.11, ui-v3 §1). */
		border: 1px solid var(--color-line-strong);
		border-radius: var(--radius-sm);
		transition:
			border-color var(--dur-fast) var(--ease),
			background-color var(--dur-fast) var(--ease);
	}

	.rail-search-field:hover .rail-search-input:not(:focus) {
		border-color: var(--color-text-muted);
	}

	.rail-search-field:focus-within .rail-search-input {
		background: var(--input-bg);
		border-color: var(--color-accent);
	}

	:global(html[data-shortcuts='on']) .rail-search-input {
		padding-inline-end: 1.75rem;
	}

	:global(html[data-shortcuts='on']) .rail-search-input:focus,
	:global(html[data-shortcuts='on']) .rail-search-input:not(:placeholder-shown) {
		padding-inline-end: var(--space-2);
	}

	.rail-search-kbd {
		position: absolute;
		inset-inline-end: var(--space-2);
		inset-block-start: 50%;
		transform: translateY(-50%);
		pointer-events: none;
		transition: opacity var(--dur-fast) var(--ease);
	}

	.rail-search-field:focus-within .rail-search-kbd,
	.rail-search-field:has(input:not(:placeholder-shown)) .rail-search-kbd {
		opacity: 0;
	}

	.rail-search-submit {
		flex: none;
		min-block-size: 34px;
		padding: 0 10px;
	}

	.scope-toggle {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		min-block-size: 28px;
		padding-inline: 2px;
		font: var(--text-hint);
		color: var(--color-text-muted);
		cursor: pointer;
	}

	.rail-nav ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 2px;
	}

	.nav-group-label {
		margin-block: var(--space-3) var(--space-1);
		padding-inline: 9px;
		font-family: var(--font-sans);
		font-size: 0.75rem;
		font-weight: 600;
		line-height: 1.2;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--color-text-muted);
	}

	.nav-item {
		position: relative;
		display: flex;
		align-items: center;
		gap: 9px;
		min-block-size: 34px;
		padding: 0 9px;
		font: var(--text-ui);
		color: var(--color-text-secondary);
		text-decoration: none;
		border-radius: var(--radius-sm);
		transition:
			background-color var(--dur-fast) var(--ease),
			color var(--dur-fast) var(--ease),
			box-shadow var(--dur-fast) var(--ease),
			opacity var(--dur-fast) var(--ease);
	}

	.nav-item:not([aria-current='page']):hover {
		background: var(--color-surface-2);
		color: var(--color-text);
		text-decoration: none;
	}

	.nav-item:active {
		opacity: 0.88;
	}

	/* Calm Studio active nav (§4): surface-2 + 1px line + 3px left accent bar (no neon blocks). */
	.nav-item[aria-current='page'] {
		background: var(--color-surface-2);
		color: var(--color-text);
		font-weight: 600;
		box-shadow: inset 0 0 0 1px var(--color-line);
	}

	.nav-item[aria-current='page']::before {
		content: '';
		position: absolute;
		inset-inline-start: 0;
		inset-block-start: 50%;
		transform: translateY(-50%);
		inline-size: 3px;
		block-size: 16px;
		border-radius: 0 3px 3px 0;
		background: var(--color-accent);
	}

	.nav-item[aria-current='page']:hover {
		color: var(--color-text);
		text-decoration: none;
	}

	.nav-item :global(.nav-hash) {
		color: var(--color-text-muted);
		flex: none;
	}

	.nav-item[aria-current='page'] :global(.nav-hash) {
		color: var(--color-accent-text);
	}

	.nav-section {
		font-weight: 500;
	}

	.nav-section .nav-label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.nav-all {
		color: var(--color-text-muted);
	}

	.rail-compose {
		padding-block-start: var(--space-3);
		border-block-start: 1px solid var(--color-line);
	}

	.rail-admin-group {
		padding-block-start: var(--space-2);
		border-block-start: 1px solid var(--color-line);
	}

	.compose-kbd {
		margin-inline-start: auto;
		font-weight: 500;
		color: var(--color-on-accent);
		background: color-mix(in oklab, var(--color-on-accent) 16%, transparent);
		border-color: transparent;
	}

	.compose-btn {
		inline-size: 100%;
	}

	.rail-account {
		margin-block-start: auto;
		padding-block-start: var(--space-3);
		border-block-start: 1px solid var(--color-line);
	}

	:global(.account-trigger) {
		display: flex;
		align-items: center;
		justify-content: flex-start;
		gap: 9px;
		inline-size: 100%;
		min-block-size: 42px;
		padding: 4px var(--space-2);
		font: var(--text-ui);
		color: var(--color-text);
		background: transparent;
		border: 0;
		border-radius: var(--radius-sm);
		cursor: pointer;
		text-align: start;
		transition:
			background-color var(--dur-fast) var(--ease),
			color var(--dur-fast) var(--ease),
			opacity var(--dur-fast) var(--ease);
	}

	:global(.account-trigger:hover) {
		background: var(--color-surface-2);
	}

	:global(.account-trigger:active) {
		opacity: 0.88;
	}

	.account-meta {
		display: grid;
		min-inline-size: 0;
		line-height: 1.25;
	}

	.account-name {
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--color-text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.account-role {
		font-size: 0.75rem;
		font-weight: 400;
		color: var(--color-text-muted);
	}

	.account-menu {
		display: grid;
		gap: 2px;
		min-inline-size: 14rem;
		padding: 2px;
	}

	.menu-item {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		inline-size: 100%;
		min-block-size: 34px;
		padding: 0 var(--space-2);
		font: var(--text-ui);
		color: var(--color-text);
		text-decoration: none;
		background: transparent;
		border: 0;
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition:
			background-color var(--dur-fast) var(--ease),
			color var(--dur-fast) var(--ease),
			opacity var(--dur-fast) var(--ease);
	}

	.menu-item:hover {
		background: var(--color-surface-2);
		color: var(--color-text);
		text-decoration: none;
	}

	.menu-item:active {
		opacity: 0.88;
	}

	@media (prefers-reduced-motion: no-preference) {
		.nav-item {
			transition:
				background-color var(--dur-fast) var(--ease),
				color var(--dur-fast) var(--ease),
				box-shadow var(--dur-fast) var(--ease),
				opacity var(--dur-fast) var(--ease),
				scale 90ms var(--ease);
		}

		:global(.account-trigger),
		.menu-item {
			transition:
				background-color var(--dur-fast) var(--ease),
				color var(--dur-fast) var(--ease),
				opacity var(--dur-fast) var(--ease),
				scale 90ms var(--ease);
		}

		.nav-item:active,
		:global(.account-trigger:active),
		.menu-item:active {
			scale: 0.98;
		}
	}

	/* Icon rail (768–1023px): icons only, accessible names stay. */
	.rail-search-icon,
	.nav-sections-compact {
		display: none;
	}

	@media (min-width: 768px) and (max-width: 1023px) {
		.site-header-inner {
			align-items: center;
			padding-inline: var(--space-2);
		}

		.brand-row {
			padding-inline: 0;
		}

		.brand {
			font-size: 1rem;
			gap: 4px;
		}

		.brand-dot {
			inline-size: 5px;
			block-size: 5px;
		}

		.rail-search,
		.nav-group-label,
		.nav-sections-full,
		.compose-kbd {
			display: none;
		}

		.rail-search-icon,
		.nav-sections-compact {
			display: flex;
		}

		.nav-label {
			position: absolute;
			clip-path: inset(50%);
			overflow: hidden;
			inline-size: 1px;
			block-size: 1px;
			white-space: nowrap;
		}

		.nav-item,
		.compose-btn {
			justify-content: center;
			inline-size: 44px;
			min-block-size: 40px;
			padding: 0;
		}

		.rail-nav,
		.rail-compose,
		.rail-admin-group,
		.rail-account,
		.rail-bell {
			inline-size: auto;
		}

		:global(.account-trigger) {
			justify-content: center;
			inline-size: 44px;
			padding: 0;
		}
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

		.brand-row {
			padding: 0;
		}

		.brand {
			font-size: 1.25rem;
		}

		.rail-search,
		.rail-search-icon,
		.rail-nav,
		.rail-compose,
		.rail-admin-group,
		.rail-admin,
		.rail-account {
			display: none;
		}
	}

	@media (pointer: coarse) {
		.scope-toggle {
			min-block-size: 44px;
		}
	}

	@media (forced-colors: active) {
		.nav-item:active,
		:global(.account-trigger:active),
		.menu-item:active {
			opacity: 1;
		}

		.nav-item[aria-current='page'] {
			forced-color-adjust: none;
			background: Highlight;
			color: HighlightText;
			box-shadow: none;
		}

		.nav-item[aria-current='page']::before {
			background: HighlightText;
		}
	}
</style>
