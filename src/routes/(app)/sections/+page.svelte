<script lang="ts">
	import { t } from '#lib/i18n/index.ts';
	import { pageTitle } from '#lib/instance.ts';
	import { formatWhen } from '#lib/format/date.ts';
	import MemberAvatar from '#lib/components/member/MemberAvatar.svelte';
	import { buttonVariants } from '#lib/components/ui/button/index.ts';
	import FolderOpen from '@lucide/svelte/icons/folder-open';
	import Hash from '@lucide/svelte/icons/hash';
	import Settings2 from '@lucide/svelte/icons/settings-2';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>{pageTitle(t('nav.sections'))}</title>
</svelte:head>

<!-- Sections (docs/designs/izgah-ui-v5.md §5.4): one card per section with its count, the latest
     share and the people who shared there most recently. The whole card opens the section. -->
<section
	class="sections-index mx-auto grid w-full max-w-[880px] gap-6"
	aria-labelledby="sections-heading"
>
	<header class="flex flex-wrap items-end justify-between gap-4">
		<div class="grid gap-1">
			<h1
				id="sections-heading"
				tabindex="-1"
				class="text-2xl font-semibold tracking-[-0.02em] outline-none"
			>
				{t('nav.sections')}
			</h1>
			<p class="text-[14px] text-muted-foreground">{t('sections.subtitle')}</p>
		</div>
		{#if data.user.role === 'admin' && data.sections.length > 0}
			<a class={buttonVariants({ variant: 'outline', size: 'sm' })} href="/admin/sections">
				<Settings2 aria-hidden="true" />
				<span>{t('sections.manage')}</span>
			</a>
		{/if}
	</header>

	{#if data.sections.length === 0}
		<div class="grid justify-items-start gap-3 rounded-xl border border-dashed p-6">
			<FolderOpen class="size-5 text-muted-foreground" aria-hidden="true" />
			<p class="text-[15px] font-semibold">{t('sections.emptyTitle')}</p>
			<p class="text-[14px] text-muted-foreground">
				{#if data.user.role === 'admin'}
					{t('sections.emptyAdmin')}
				{:else}
					{t('sections.emptyMember')}
				{/if}
			</p>
			{#if data.user.role === 'admin'}
				<a class={buttonVariants({ size: 'sm' })} href="/admin/sections">{t('sections.manage')}</a>
			{/if}
		</div>
	{:else}
		<ul class="section-list grid gap-3 sm:grid-cols-2" role="list">
			{#each data.sections as section (section.id)}
				<li
					class="section-row group/section relative grid content-start gap-3 rounded-xl border bg-card p-4 shadow-sm transition-colors focus-within:halo hover:border-[color-mix(in_oklab,var(--foreground)_18%,transparent)]"
				>
					<div class="flex min-w-0 items-start gap-2.5">
						<span
							class="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"
							aria-hidden="true"
						>
							<Hash class="size-4" />
						</span>
						<div class="grid min-w-0 flex-1 gap-0.5">
							<!-- The whole card opens the section; the link keeps its own accessible name. -->
							<a
								class="section-link truncate text-[15px] font-semibold text-foreground no-underline outline-none after:absolute after:inset-0 after:rounded-xl after:content-['']"
								href="/sections/{section.slug}"
							>
								{section.name}
							</a>
							<span class="section-count text-[12.5px] text-muted-foreground tabular-nums">
								{t('sections.count', { count: section.shareCount })}
							</span>
						</div>
					</div>
					{#if section.description}
						<p
							class="section-desc line-clamp-2 text-[13.5px] leading-relaxed text-muted-foreground"
						>
							{section.description}
						</p>
					{/if}
					{#if section.contributors.length > 0}
						<div class="flex items-center justify-between gap-3 border-t border-hairline pt-3">
							<div class="flex -space-x-1.5">
								{#each section.contributors as person (person.id)}
									<MemberAvatar
										id={person.id}
										name={person.name}
										avatarAssetKey={person.avatarAssetKey}
										class="size-6 text-[10px] ring-2 ring-card"
									/>
								{/each}
								<span class="sr-only">
									{section.contributors.map((person) => person.name).join(', ')}
								</span>
							</div>
							{#if section.lastSharedAt}
								<time
									class="text-[12px] text-muted-foreground tabular-nums"
									datetime={section.lastSharedAt}
								>
									{formatWhen(section.lastSharedAt)}
								</time>
							{/if}
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>
