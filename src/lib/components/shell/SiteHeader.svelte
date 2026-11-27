<!--
	App rail (≥ 768px) and mobile top bar (< 768px), docs/designs/izgah-ui-v5.md §4.

	Jade: solid surfaces and hairlines, icons with labels, the accent only on the active item and
	counts. Accessible names and E2E hooks follow izgah-ui-v2.md §12 (one "Ana gezinme" landmark at
	every width: below 768px the rail navigation is display:none and BottomTabBar takes over).
-->
<script lang="ts">
	import { t } from '#lib/i18n/index.ts';
	import { instanceName } from '#lib/instance.ts';
	import { page } from '$app/state';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import Hash from '@lucide/svelte/icons/hash';
	import Inbox from '@lucide/svelte/icons/inbox';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Layers from '@lucide/svelte/icons/layers';
	import LogOut from '@lucide/svelte/icons/log-out';
	import Plus from '@lucide/svelte/icons/plus';
	import Search from '@lucide/svelte/icons/search';
	import Settings from '@lucide/svelte/icons/settings';
	import Shield from '@lucide/svelte/icons/shield';
	import ChevronsUpDown from '@lucide/svelte/icons/chevrons-up-down';
	import NotificationBell from '#lib/components/notifications/NotificationBell.svelte';
	import ThemeForm from '#lib/components/shell/ThemeForm.svelte';
	import * as Popover from '#lib/components/ui/popover/index.ts';
	import MemberAvatar from '#lib/components/member/MemberAvatar.svelte';

	interface SectionLink {
		id: string;
		slug: string;
		name: string;
	}

	interface Props {
		user: { id: string; name: string; role: 'member' | 'admin'; avatarAssetKey?: string | null };
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
	 * Wordmark (izgah-ui-v4.md §5, kept by v5 §13): "iz" in the foreground, the rest muted. Applied
	 * only when the instance name starts with "iz"; any other name is shown as one word.
	 */
	const wordmark = $derived.by(() => {
		const name = instanceName();
		return name.toLocaleLowerCase('tr').startsWith('iz') && name.length > 2
			? { head: name.slice(0, 2), tail: name.slice(2) }
			: null;
	});

	const pathname = $derived(page.url.pathname);
	const onSearchPage = $derived(pathname === '/search');
	let accountOpen = $state(false);

	function handleCompose(event: MouseEvent): void {
		event.preventDefault();
		onCompose();
	}

	const navItem =
		'relative flex min-h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13px] tracking-[-0.005em] text-muted-foreground no-underline transition-colors before:absolute before:top-2 before:bottom-2 before:-left-2 before:hidden before:w-[2px] before:rounded-full before:bg-primary hover:bg-sidebar-accent/70 hover:text-foreground aria-[current=page]:bg-sidebar-accent aria-[current=page]:font-medium aria-[current=page]:text-sidebar-accent-foreground aria-[current=page]:before:block pointer-coarse:min-h-11';
	const menuItem =
		'flex min-h-8 w-full items-center gap-2.5 rounded-md px-2 text-[13px] text-foreground transition-colors hover:bg-accent pointer-coarse:min-h-11';
</script>

<header
	class="site-header is-rail sticky top-0 z-30 self-start border-hairline bg-sidebar max-md:flex max-md:h-(--header-h) max-md:items-center max-md:justify-between max-md:border-b max-md:px-(--gutter) md:h-dvh md:border-r"
>
	<div class="contents md:flex md:h-full md:flex-col md:gap-1 md:overflow-y-auto md:p-3">
		<!-- Brand -->
		<a
			href="/"
			class="flex items-center gap-2 rounded-lg px-1.5 py-1 text-foreground no-underline md:mb-2"
		>
			<span class="grid size-6 place-items-center rounded-[7px] bg-primary" aria-hidden="true">
				<span class="size-1.5 rounded-full bg-primary-foreground"></span>
			</span>
			<span class="text-[17px] tracking-[-0.02em]">
				{#if wordmark}
					<span class="font-semibold">{wordmark.head}</span><span class="text-muted-foreground">
						{wordmark.tail}
					</span>
				{:else}
					<span class="font-semibold">{instanceName()}</span>
				{/if}
			</span>
		</a>

		<!-- Search (hidden on /search, which has its own field) -->
		{#if !onSearchPage}
			<search class="rail-search max-md:hidden" aria-label={t('search.landmark')}>
				<form method="GET" action="/search" class="grid gap-1.5">
					<label for="rail-search-input" class="sr-only">
						{t('search.inInstance', { name: instanceName() })}
					</label>
					<div
						class="flex h-8 items-center gap-2 rounded-lg border border-hairline bg-background px-2.5 transition-shadow focus-within:halo"
					>
						<Search class="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
						<input
							id="rail-search-input"
							class="peer min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
							type="search"
							name="q"
							value={headerQuery}
							oninput={(event) => onQueryInput(event.currentTarget.value)}
							placeholder={t('search.placeholderShort')}
							autocapitalize="none"
							spellcheck={false}
						/>
						<kbd
							class="rounded border border-hairline px-1 font-sans text-[10px] text-muted-foreground peer-[:not(:placeholder-shown)]:hidden"
							aria-hidden="true"
						>
							/
						</kbd>
						<button
							type="submit"
							class="-mr-1 grid size-6 place-items-center rounded-md text-muted-foreground transition-colors peer-placeholder-shown:hidden hover:bg-accent hover:text-foreground"
							aria-label={t('search.submit')}
						>
							<ArrowRight class="size-3.5" aria-hidden="true" />
						</button>
					</div>
					{#if activeSection}
						<label
							class="scope-toggle flex items-center gap-2 px-1 text-[12px] text-muted-foreground"
						>
							<input
								type="checkbox"
								name="section"
								value={activeSection.id}
								checked={scopeInCurrentSection}
								onchange={(event) => onScopeChange(event.currentTarget.checked)}
								class="accent-primary"
							/>
							<span>{t('search.thisSection')}</span>
						</label>
					{/if}
				</form>
			</search>
		{/if}

		<!-- Primary action -->
		<form method="GET" action="/" class="rail-compose mt-1.5 max-md:hidden">
			<input type="hidden" name="compose" value="1" />
			<button
				type="submit"
				class="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-ink text-[13px] font-medium tactile transition-opacity hover:opacity-90"
				aria-label={t('nav.shareLink')}
				onclick={handleCompose}
			>
				<Plus class="size-3.5" aria-hidden="true" />
				<span>{t('nav.share')}</span>
				<kbd class="ml-1 font-sans text-[11px] opacity-60" aria-hidden="true">n</kbd>
			</button>
		</form>

		<!-- Navigation -->
		<nav aria-label={t('nav.main')} class="rail-nav mt-3 flex flex-col gap-px max-md:hidden">
			<a href="/" class={navItem} aria-current={pathname === '/' ? 'page' : undefined}>
				<Inbox class="size-[15px] shrink-0" aria-hidden="true" />
				<span>{t('nav.feed')}</span>
			</a>

			<p class="mt-4 mb-1 px-2.5 text-[11px] font-medium text-muted-foreground" aria-hidden="true">
				{t('nav.sections')}
			</p>
			<ul role="list" class="flex flex-col gap-px">
				{#each sections as section (section.id)}
					{@const sectionPath = `/sections/${section.slug}`}
					<li>
						<a
							href={sectionPath}
							class={navItem}
							aria-current={pathname === sectionPath ? 'page' : undefined}
						>
							<Hash class="size-3.5 shrink-0" aria-hidden="true" />
							<span class="truncate">{section.name}</span>
						</a>
					</li>
				{/each}
				<li>
					<a
						href="/sections"
						class={navItem}
						aria-current={pathname === '/sections' ? 'page' : undefined}
					>
						<Layers class="size-3.5 shrink-0" aria-hidden="true" />
						<span>{t('nav.allSections')}</span>
					</a>
				</li>
			</ul>

			{#if user.role === 'admin'}
				<a
					href="/admin/users"
					class="{navItem} mt-3"
					aria-current={pathname.startsWith('/admin') ? 'page' : undefined}
				>
					<Shield class="size-[15px] shrink-0" aria-hidden="true" />
					<span>{t('nav.admin')}</span>
				</a>
			{/if}
		</nav>

		<!-- Notifications: a rail row on wide screens, an icon button in the mobile top bar -->
		<div class="rail-bell md:order-none md:mt-1">
			<NotificationBell />
		</div>

		<!-- Account -->
		<div class="rail-account mt-auto pt-3 max-md:hidden">
			<Popover.Root bind:open={accountOpen}>
				<Popover.Trigger
					class="flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left transition-colors hover:bg-sidebar-accent/70 data-open:bg-sidebar-accent"
					aria-label={t('nav.accountMenu', { name: user.name })}
				>
					<MemberAvatar id={user.id} name={user.name} avatarAssetKey={user.avatarAssetKey} />
					<span class="min-w-0 flex-1 leading-tight">
						<span class="block truncate text-[13px] font-medium">{user.name}</span>
						<span class="block text-[11px] text-muted-foreground">
							{user.role === 'admin' ? t('role.admin') : t('role.member')}
						</span>
					</span>
					<ChevronsUpDown class="size-3.5 text-muted-foreground" aria-hidden="true" />
				</Popover.Trigger>
				<Popover.Content
					side="top"
					align="start"
					sideOffset={6}
					class="w-60 gap-1 rounded-xl border border-hairline p-1.5 shadow-lg ring-0"
				>
					<a href="/settings" class="{menuItem} no-underline" onclick={() => (accountOpen = false)}>
						<Settings class="size-4 text-muted-foreground" aria-hidden="true" />
						{t('nav.settings')}
					</a>
					<a
						href="/settings/api-keys"
						class="{menuItem} no-underline"
						onclick={() => (accountOpen = false)}
					>
						<KeyRound class="size-4 text-muted-foreground" aria-hidden="true" />
						{t('nav.apiKeys')}
					</a>
					<div class="my-1 h-px bg-hairline"></div>
					<ThemeForm {theme} />
					<div class="my-1 h-px bg-hairline"></div>
					<form method="POST" action="/logout">
						<button
							type="submit"
							class={menuItem}
							aria-label={t('nav.signOutLabel', { name: user.name })}
						>
							<LogOut class="size-4 text-muted-foreground" aria-hidden="true" />
							{t('nav.signOut')}
						</button>
					</form>
				</Popover.Content>
			</Popover.Root>
		</div>
	</div>
</header>
