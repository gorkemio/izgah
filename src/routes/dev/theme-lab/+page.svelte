<!--
	UI v5 theme lab (docs/designs/izgah-ui-v5.md §15, M1). Development only: the server load answers
	404 in production, so the sample texts below are fixtures, not user-facing strings.

	Jade in Geist, dark and light side by side. No decorative gradients: depth comes from solid
	surfaces, hairlines and short shadows; colour only where it means something (§3.0).
-->
<script lang="ts">
	import '#lib/styles/palette-lab.css';
	import Bell from '@lucide/svelte/icons/bell';
	import Check from '@lucide/svelte/icons/check';
	import Copy from '@lucide/svelte/icons/copy';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import FileText from '@lucide/svelte/icons/file-text';
	import FolderGit from '@lucide/svelte/icons/folder-git';
	import Hash from '@lucide/svelte/icons/hash';
	import Heart from '@lucide/svelte/icons/heart';
	import Inbox from '@lucide/svelte/icons/inbox';
	import Layers from '@lucide/svelte/icons/layers';
	import MessageCircle from '@lucide/svelte/icons/message-circle';
	import Plus from '@lucide/svelte/icons/plus';
	import Search from '@lucide/svelte/icons/search';
	import Settings from '@lucide/svelte/icons/settings';
	import SquarePlay from '@lucide/svelte/icons/square-play';
	import { Spring } from 'svelte/motion';
	import { Checkbox } from '#lib/components/ui/checkbox/index.ts';
	import { Switch } from '#lib/components/ui/switch/index.ts';
	import AnimatedNumber from '#lib/motion/AnimatedNumber.svelte';
	import { SPRING, effectsReduced } from '#lib/motion/index.ts';

	type ThemeName = 'lantern' | 'indigo' | 'jade';
	type Scheme = 'light' | 'dark';

	const THEMES: { name: ThemeName; label: string }[] = [
		{ name: 'lantern', label: 'Lantern' },
		{ name: 'indigo', label: 'Indigo night' },
		{ name: 'jade', label: 'Jade' }
	];

	let theme = $state<ThemeName>('jade');
	let scheme = $state<'both' | Scheme>('both');
	let effects = $state<'full' | 'reduced'>('full');
	let loading = $state(false);

	const panels = $derived<Scheme[]>(scheme === 'both' ? ['dark', 'light'] : [scheme]);
	const themeLabel = $derived(THEMES.find((t) => t.name === theme)?.label ?? theme);

	$effect(() => {
		document.documentElement.dataset.effects = effects;
	});

	interface Entry {
		id: string;
		author: string;
		initials: string;
		tone: number;
		time: string;
		section: string;
		note: string;
		domain: string;
		type: string;
		facts: string;
		title: string;
		description: string;
		image: boolean;
		likes: number;
		comments: number;
		icon: typeof FolderGit;
		selected?: boolean;
	}

	const ENTRIES: Entry[] = [
		{
			id: 'one',
			author: 'Priya Nair',
			initials: 'PN',
			tone: 1,
			time: '18:41',
			section: 'AI tools',
			note: 'Ran the new models on a laptop — surprisingly fast for summarising long PDFs.',
			domain: 'github.com',
			type: 'Repository',
			facts: 'Go · 154K stars',
			title: 'ollama/ollama',
			description: 'Get up and running with large language models locally.',
			image: true,
			likes: 5,
			comments: 2,
			icon: FolderGit,
			selected: true
		},
		{
			id: 'two',
			author: 'Jonas Weber',
			initials: 'JW',
			tone: 7,
			time: '14:02',
			section: 'Long reads',
			note: 'Worth watching before we pick a sync library.',
			domain: 'youtube.com',
			type: 'Video',
			facts: 'Strange Loop · 38 min',
			title: 'Local-first software, five years later',
			description: 'A talk on sync engines, CRDTs and what changed since the original essay.',
			image: true,
			likes: 3,
			comments: 1,
			icon: SquarePlay
		},
		{
			id: 'three',
			author: 'Maya Chen',
			initials: 'MC',
			tone: 3,
			time: '09:15',
			section: 'Frontend',
			note: 'We could drop half of our theme media queries with this.',
			domain: 'developer.mozilla.org',
			type: 'Article',
			facts: 'MDN Web Docs',
			title: 'light-dark() — CSS colour function',
			description: 'Returns one of two colours depending on the colour scheme in use.',
			image: false,
			likes: 0,
			comments: 0,
			icon: FileText
		}
	];

	// Like state per panel and entry, created up front (state must not be written while rendering).
	const likes = $state<Record<string, { liked: boolean; count: number }>>(
		Object.fromEntries(
			THEMES.flatMap((t) =>
				(['light', 'dark'] as const).flatMap((s) =>
					ENTRIES.map((entry) => [
						`${t.name}-${s}:${entry.id}`,
						{ liked: false, count: entry.likes }
					])
				)
			)
		)
	);
	const springs: Record<string, Spring<number>> = {};

	function heartSpring(key: string): Spring<number> {
		springs[key] ??= new Spring(1, SPRING.bouncy);
		return springs[key];
	}

	function toggleLike(key: string): void {
		const state = likes[key];
		state.liked = !state.liked;
		state.count += state.liked ? 1 : -1;
		if (state.liked && !effectsReduced()) {
			const spring = heartSpring(key);
			spring.set(1.25, { instant: true });
			void spring.set(1);
		}
	}

	let copied = $state<string | null>(null);
	function copy(key: string): void {
		copied = key;
		setTimeout(() => {
			if (copied === key) copied = null;
		}, 1500);
	}

	let filter = $state<Record<string, string>>({});

	const NAV = [
		{ label: 'Feed', icon: Inbox, active: true },
		{ label: 'Notifications', icon: Bell, count: 3 },
		{ label: 'Sections', icon: Layers },
		{ label: 'Settings', icon: Settings }
	];
	const SECTIONS = [
		['Frontend', 12],
		['Design', 9],
		['AI tools', 7],
		['Long reads', 4]
	] as const;
</script>

<svelte:head>
	<title>Theme lab — Izgah v5</title>
</svelte:head>

<div class="lab min-h-dvh bg-[#e4e4e7] font-sans text-[#17171a]">
	<header
		class="sticky top-0 z-20 flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-black/10 bg-white/90 px-6 py-3 backdrop-blur"
	>
		<div class="mr-auto">
			<h1 class="text-[15px] font-semibold tracking-tight">Izgah v5 · theme lab</h1>
			<p class="text-xs text-black/50">Development only · {themeLabel} in Geist</p>
		</div>
		<label class="flex items-center gap-2 text-[13px]">
			<span class="text-black/50">Theme</span>
			<select bind:value={theme} class="rounded-md border border-black/15 bg-white px-2 py-1">
				{#each THEMES as t (t.name)}<option value={t.name}>{t.label}</option>{/each}
			</select>
		</label>
		<label class="flex items-center gap-2 text-[13px]">
			<span class="text-black/50">Scheme</span>
			<select bind:value={scheme} class="rounded-md border border-black/15 bg-white px-2 py-1">
				<option value="both">Dark and light</option>
				<option value="dark">Dark</option>
				<option value="light">Light</option>
			</select>
		</label>
		<label class="flex items-center gap-2 text-[13px]">
			<span class="text-black/50">Effects</span>
			<select bind:value={effects} class="rounded-md border border-black/15 bg-white px-2 py-1">
				<option value="full">Full</option>
				<option value="reduced">Reduced</option>
			</select>
		</label>
		<label class="flex items-center gap-2 text-[13px]">
			<input type="checkbox" bind:checked={loading} /> Loading bar
		</label>
	</header>

	<div class="grid grid-cols-[repeat(auto-fit,minmax(min(100%,620px),1fr))] gap-6 p-6">
		{#each panels as currentScheme (currentScheme)}
			{@const panel = `${theme}-${currentScheme}`}
			<section
				data-v5-theme={theme}
				data-scheme={currentScheme}
				class="relative overflow-hidden rounded-2xl border border-hairline bg-background text-foreground shadow-xl"
				aria-label="{themeLabel}, {currentScheme}"
			>
				{#if loading}
					<div class="absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden">
						<div class="h-full w-1/3 animate-progress trail"></div>
					</div>
				{/if}

				<p class="px-5 pt-4 text-[12px] font-medium text-muted-foreground capitalize">
					{currentScheme}
				</p>

				<div class="grid grid-cols-[184px_1fr] gap-3 p-3 pt-2">
					<!-- Rail -->
					<nav
						class="flex flex-col gap-0.5 rounded-xl border border-hairline bg-sidebar p-2"
						aria-label="Sample navigation"
					>
						<div class="flex items-center gap-2 px-1.5 pt-1 pb-3">
							<span class="grid size-6 place-items-center rounded-[7px] bg-primary">
								<span class="size-1.5 rounded-full bg-primary-foreground"></span>
							</span>
							<span class="text-[16px] tracking-[-0.02em]">
								<span class="font-semibold">iz</span><span class="text-muted-foreground">gah</span>
							</span>
						</div>
						<button
							class="flex items-center gap-2 rounded-lg border border-hairline bg-background px-2.5 py-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
						>
							<Search class="size-3.5" /> Search
							<kbd
								class="ml-auto rounded border border-hairline px-1 font-sans text-[10px] text-muted-foreground"
							>
								⌘K
							</kbd>
						</button>
						<button
							class="mt-1.5 flex items-center justify-center gap-1.5 rounded-lg bg-ink px-2.5 py-1.5 text-[13px] font-medium tactile transition-opacity hover:opacity-90"
						>
							<Plus class="size-3.5" /> Add a link
						</button>
						<div class="mt-3 flex flex-col gap-px">
							{#each NAV as item (item.label)}
								<a
									href="#top"
									class="relative flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13px] tracking-[-0.005em] transition-colors {item.active
										? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
										: 'text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground'}"
								>
									{#if item.active}
										<span class="absolute top-2 bottom-2 -left-2 w-[2px] rounded-full bg-primary"
										></span>
									{/if}
									<item.icon class="size-[15px] shrink-0" />
									{item.label}
									{#if item.count}
										<span class="ml-auto text-[11px] font-medium text-primary tabular-nums">
											{item.count}
										</span>
									{/if}
								</a>
							{/each}
						</div>
						<p class="mt-4 mb-1 px-2.5 text-[11px] font-medium text-muted-foreground">Sections</p>
						{#each SECTIONS as [name, count] (name)}
							<a
								href="#top"
								class="flex items-center gap-2.5 rounded-lg px-2.5 py-[5px] text-[13px] text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground"
							>
								<Hash class="size-3.5 shrink-0" />
								{name}
								<span class="ml-auto text-[11px] tabular-nums">{count}</span>
							</a>
						{/each}
					</nav>

					<!-- Feed -->
					<div class="flex min-w-0 flex-col gap-3 px-1">
						<div class="flex items-end justify-between gap-3 pt-1">
							<div>
								<h2 class="text-[26px] leading-none font-semibold tracking-[-0.03em]">Feed</h2>
								<p class="mt-1.5 text-[13px] text-muted-foreground">
									What your team found this week
								</p>
							</div>
							<div
								class="flex rounded-lg border border-hairline bg-muted p-0.5 text-[12px]"
								role="radiogroup"
								aria-label="Type"
							>
								{#each ['All', 'Repos', 'Videos', 'Articles'] as option (option)}
									{@const active = (filter[panel] ?? 'All') === option}
									<button
										role="radio"
										aria-checked={active}
										onclick={() => (filter[panel] = option)}
										class="rounded-md px-2.5 py-1 transition-all {active
											? 'bg-card font-medium text-foreground shadow-sm'
											: 'text-muted-foreground hover:text-foreground'}"
									>
										{option}
									</button>
								{/each}
							</div>
						</div>

						<!-- Composer -->
						<div
							class="rounded-xl border border-hairline bg-card p-1.5 shadow-sm transition-shadow focus-within:halo"
						>
							<input
								class="w-full bg-transparent px-2.5 py-2 text-[14px] outline-none placeholder:text-muted-foreground"
								placeholder="Paste a link or drop a chat message…"
							/>
							<div class="flex items-center gap-2 border-t border-hairline px-1.5 pt-1.5">
								<span
									class="rounded-md border border-hairline px-1.5 py-0.5 text-[11px] text-muted-foreground"
								>
									#frontend
								</span>
								<label class="flex items-center gap-1.5 text-[11px] text-muted-foreground">
									<Switch class="scale-90" /> Sections only
								</label>
								<button class="ml-auto rounded-md bg-ink px-3 py-1 text-[12px] font-medium tactile">
									Share
								</button>
							</div>
						</div>

						<!-- Day -->
						<div class="flex items-center gap-3 pt-2 text-[12px]">
							<span class="font-medium">Today</span>
							<span class="text-muted-foreground">Thursday, 27 November</span>
							<span class="h-px flex-1 bg-hairline"></span>
							<span class="text-muted-foreground tabular-nums">3 links</span>
						</div>

						{#each ENTRIES as entry (entry.id)}
							{@const key = `${panel}:${entry.id}`}
							{@const like = likes[key]}
							<article
								class="group/entry rounded-xl border bg-card p-4 shadow-sm transition-colors {entry.selected
									? 'border-[color-mix(in_oklab,var(--primary)_45%,transparent)]'
									: 'border-hairline hover:border-[color-mix(in_oklab,var(--foreground)_16%,transparent)]'}"
							>
								<div class="flex items-center gap-2.5">
									<span
										class="grid size-7 place-items-center rounded-full text-[11px] font-semibold text-avatar-foreground"
										style="background: var(--avatar-{entry.tone})"
									>
										{entry.initials}
									</span>
									<p class="min-w-0 text-[13px] leading-tight">
										<span class="font-medium">{entry.author}</span>
										<span class="text-muted-foreground">&ensp;{entry.time} · {entry.section}</span>
									</p>
									<button
										class="ml-auto rounded-md p-1 text-muted-foreground opacity-0 transition-opacity group-hover/entry:opacity-100 hover:bg-accent focus-visible:opacity-100"
										aria-label="Actions"
									>
										<Ellipsis class="size-4" />
									</button>
								</div>
								<p class="mt-2.5 text-[15px] leading-[1.55] tracking-[-0.006em]">{entry.note}</p>

								<a
									href="#top"
									class="mt-3 flex items-center gap-3.5 rounded-lg border border-hairline bg-background p-3 transition-colors hover:bg-accent/50"
								>
									<div class="min-w-0 flex-1">
										<p class="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
											<entry.icon class="size-3.5" />
											{entry.domain}<span class="opacity-50">·</span>{entry.type}<span
												class="opacity-50"
											>
												·
											</span>{entry.facts}
										</p>
										<p class="mt-1 truncate text-[14.5px] font-medium tracking-[-0.01em]">
											{entry.title}
										</p>
										<p class="mt-0.5 line-clamp-2 text-[13px] leading-snug text-muted-foreground">
											{entry.description}
										</p>
									</div>
									{#if entry.image}
										<div
											class="aspect-[16/10] w-[104px] shrink-0 rounded-md bg-muted ring-1 ring-hairline"
											aria-hidden="true"
										></div>
									{/if}
								</a>

								<div class="mt-3 flex items-center gap-0.5 text-[12.5px] text-muted-foreground">
									<button
										class="flex items-center gap-1.5 rounded-md px-2 py-1 transition-colors hover:bg-accent hover:text-foreground {like.liked
											? 'text-primary hover:text-primary'
											: ''}"
										aria-pressed={like.liked}
										onclick={() => toggleLike(key)}
									>
										<span class="inline-flex" style="transform: scale({heartSpring(key).current})">
											<Heart class="size-[15px] {like.liked ? 'fill-current' : ''}" />
										</span>
										<AnimatedNumber value={like.count} />
									</button>
									<button
										class="flex items-center gap-1.5 rounded-md px-2 py-1 hover:bg-accent hover:text-foreground"
									>
										<MessageCircle class="size-[15px]" />
										{entry.comments}
									</button>
									<button
										class="flex items-center gap-1.5 rounded-md px-2 py-1 hover:bg-accent hover:text-foreground"
									>
										<ExternalLink class="size-[15px]" /> Open
									</button>
									<button
										class="flex items-center gap-1.5 rounded-md px-2 py-1 hover:bg-accent hover:text-foreground"
										onclick={() => copy(key)}
									>
										{#if copied === key}<Check class="size-[15px] text-success" />{:else}<Copy
												class="size-[15px]"
											/>{/if}
										Copy
									</button>
								</div>
							</article>
						{/each}

						<div class="rounded-xl border border-hairline bg-card p-4">
							<p class="text-[11.5px] text-muted-foreground">Preparing preview…</p>
							<div class="mt-2.5 h-3.5 w-2/3 animate-pulse rounded bg-muted"></div>
							<div class="mt-2 h-3 w-1/2 animate-pulse rounded bg-muted"></div>
						</div>
					</div>
				</div>

				<!-- Type and controls -->
				<div class="grid gap-5 border-t border-hairline bg-sidebar px-6 py-6">
					<div>
						<p class="text-[36px] leading-[1.05] font-semibold tracking-[-0.035em]">
							Keep what your team finds.
						</p>
						<p class="mt-2 max-w-[48ch] text-[14px] leading-relaxed text-muted-foreground">
							Hierarchy from size and weight; colour only where it means something.
						</p>
					</div>

					<div class="flex flex-wrap items-center gap-2">
						<button class="rounded-lg bg-ink px-3.5 py-2 text-[13px] font-medium tactile">
							Primary
						</button>
						<button
							class="rounded-lg bg-primary px-3.5 py-2 text-[13px] font-medium text-primary-foreground"
						>
							Accent
						</button>
						<button
							class="rounded-lg bg-secondary px-3.5 py-2 text-[13px] font-medium text-secondary-foreground"
						>
							Secondary
						</button>
						<button
							class="rounded-lg border border-hairline bg-background px-3.5 py-2 text-[13px] font-medium hover:bg-accent"
						>
							Outline
						</button>
						<button
							class="rounded-lg px-3.5 py-2 text-[13px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
						>
							Ghost
						</button>
						<button
							class="rounded-lg px-3.5 py-2 text-[13px] font-medium text-destructive hover:bg-destructive/10"
						>
							Delete
						</button>
						<span class="mx-1 h-5 w-px bg-hairline"></span>
						<label class="flex items-center gap-2 text-[13px]"><Checkbox checked /> Remember</label>
						<label class="flex items-center gap-2 text-[13px]"><Switch checked /> Digest</label>
					</div>

					<div class="flex flex-wrap items-center gap-2 text-[12px]">
						<span class="rounded-full border border-hairline px-2.5 py-0.5">Frontend</span>
						<span class="rounded-full border border-hairline px-2.5 py-0.5 text-muted-foreground">
							Silent
						</span>
						<span class="rounded-full bg-primary/12 px-2.5 py-0.5 text-primary">New</span>
						<span class="rounded-full bg-success-soft px-2.5 py-0.5 text-success">Ready</span>
						<span class="rounded-full bg-warning-soft px-2.5 py-0.5 text-warning">Queued</span>
						<span class="ml-2 text-link underline decoration-1 underline-offset-4">A link</span>
						<span class="text-visited">visited</span>
						<mark class="rounded-sm bg-highlight px-1 text-highlight-foreground">search hit</mark>
						<span class="ml-auto flex -space-x-1.5">
							{#each [1, 4, 6, 8] as tone (tone)}
								<span
									class="grid size-6 place-items-center rounded-full text-[9px] font-semibold text-avatar-foreground ring-2 ring-sidebar"
									style="background: var(--avatar-{tone})"
								>
									{String.fromCharCode(64 + tone)}
								</span>
							{/each}
						</span>
					</div>

					<div class="flex flex-wrap items-start gap-4">
						<div
							class="flex items-center gap-4 rounded-xl border border-hairline bg-popover px-4 py-2.5 text-[13px] text-popover-foreground shadow-lg"
						>
							Link deleted
							<button class="font-medium text-primary">Undo</button>
						</div>
						<div
							class="min-w-[260px] flex-1 rounded-2xl border border-hairline bg-popover p-5 text-popover-foreground shadow-xl"
						>
							<p class="text-[17px] font-semibold tracking-[-0.02em]">Delete this share?</p>
							<p class="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
								The link stays in the library while others have shared it.
							</p>
							<div class="mt-4 flex justify-end gap-2">
								<button
									class="rounded-lg border border-hairline px-3 py-1.5 text-[13px] font-medium hover:bg-accent"
								>
									Cancel
								</button>
								<button
									class="rounded-lg bg-destructive px-3 py-1.5 text-[13px] font-medium text-destructive-foreground"
								>
									Delete
								</button>
							</div>
						</div>
					</div>
				</div>
			</section>
		{/each}
	</div>
</div>

<style>
	.lab {
		-webkit-font-smoothing: antialiased;
	}

	/* The Künye base styles underline every link; v5 screens style links themselves. Layered, so
	   utilities such as text-link still win. */
	@layer components {
		:global(.lab a) {
			color: inherit;
			text-decoration: none;
		}
	}
</style>
