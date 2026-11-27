<script lang="ts">
	import type { Snippet } from 'svelte';
	import { watchImageError } from '#lib/client/image-error.ts';
	import Highlight from '#lib/components/ui/Highlight.svelte';
	import type { FeedShareItem } from '#lib/types/feed.ts';

	interface Props {
		item: FeedShareItem;
		titleId: string;
		/** First image-bearing post loads eagerly with high priority; the rest lazily. */
		priorityImage?: boolean;
		/** Search terms to mark in the title. */
		highlightTerms?: readonly string[];
		/** The künye line, set under the title and beside the thumbnail. */
		kunye?: Snippet;
	}

	const REPO_HOSTS = new Set(['github.com', 'gitlab.com', 'codeberg.org', 'bitbucket.org']);

	let { item, titleId, priorityImage = false, highlightTerms = [], kunye }: Props = $props();

	let imgFailed = $state(false);
	let thumbnailEl = $state<HTMLImageElement | null>(null);

	$effect(() => {
		const img = thumbnailEl;
		if (!img) {
			return;
		}
		return watchImageError(img, () => {
			imgFailed = true;
		});
	});

	let iconFailed = $state(false);
	let iconEl = $state<HTMLImageElement | null>(null);

	$effect(() => {
		const img = iconEl;
		if (!img) {
			return;
		}
		return watchImageError(img, () => {
			iconFailed = true;
		});
	});

	let lastAssetKey: string | null = null;
	$effect.pre(() => {
		if (item.resource.thumbnailAssetKey !== lastAssetKey) {
			lastAssetKey = item.resource.thumbnailAssetKey;
			imgFailed = false;
		}
	});

	function extractRepoSlug(rawUrl: string): string | null {
		try {
			const parsed = new URL(rawUrl);
			const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
			if (!REPO_HOSTS.has(host)) {
				return null;
			}
			const segments = parsed.pathname.split('/').filter(Boolean);
			if (segments.length >= 2) {
				return `${segments[0]}/${segments[1]}`;
			}
		} catch {
			return null;
		}
		return null;
	}

	/** Without a page title the address itself is the title: host and path, no scheme or "www.". */
	function displayAddress(rawUrl: string): string {
		try {
			const parsed = new URL(rawUrl);
			const path = `${parsed.pathname}${parsed.search}`.replace(/\/$/, '');
			return `${parsed.hostname.replace(/^www\./, '')}${path}`;
		} catch {
			return rawUrl;
		}
	}

	const siteInitial = $derived(
		(item.resource.domain.replace(/^www\./, '')[0] ?? '?').toLocaleUpperCase('tr')
	);
	const siteIconKey = $derived(item.resource.siteIconAssetKey ?? null);
	const showThumbnail = $derived(Boolean(item.resource.thumbnailAssetKey && !imgFailed));
	const repoSlug = $derived(extractRepoSlug(item.resource.canonicalUrl || item.rawUrl));
	const title = $derived(
		item.resource.title ||
			(item.resource.contentType === 'repo' && repoSlug ? repoSlug : null) ||
			displayAddress(item.resource.canonicalUrl || item.rawUrl)
	);
</script>

<!-- Link card (docs/designs/izgah-ui-v5.md §5.1): the facts line with a site tile, the title, a
     two-line description and an optional 16:10 thumbnail on the right. -->
<div
	class="link-attachment mt-3 flex gap-3.5 rounded-lg border border-hairline bg-background p-3 transition-colors hover:bg-accent/40"
	class:has-thumbnail={showThumbnail}
>
	<div class="attachment-text grid min-w-0 flex-1 content-start gap-1">
		<div class="flex min-w-0 items-start gap-1.5">
			{#if siteIconKey && !iconFailed}
				<img
					class="site-icon mt-px size-4 shrink-0 rounded-[4px] bg-muted object-contain"
					src={`/media/thumbnails/${encodeURIComponent(siteIconKey)}`}
					alt=""
					width="16"
					height="16"
					loading="lazy"
					decoding="async"
					bind:this={iconEl}
				/>
			{:else}
				<span
					class="mt-px grid size-4 shrink-0 place-items-center rounded-[4px] bg-muted text-[9px] font-semibold text-muted-foreground uppercase"
					aria-hidden="true"
				>
					{siteInitial}
				</span>
			{/if}
			<div class="min-w-0 flex-1">{@render kunye?.()}</div>
		</div>
		<h3
			id={titleId}
			class="attachment-title text-[14.5px] leading-snug font-medium tracking-[-0.01em] text-balance"
		>
			<a
				href={item.rawUrl}
				target="_blank"
				rel="noopener noreferrer"
				class="card-title-link content-link text-foreground no-underline decoration-1 underline-offset-2 visited:text-visited hover:underline"
			>
				<Highlight text={title} terms={highlightTerms} />
			</a>
		</h3>
		{#if item.resource.description}
			<p class="line-clamp-2 text-[13px] leading-snug text-muted-foreground">
				{item.resource.description}
			</p>
		{/if}
	</div>
	{#if showThumbnail && item.resource.thumbnailAssetKey}
		<div
			class="card-thumbnail-frame aspect-[16/10] w-24 shrink-0 self-start overflow-hidden rounded-md bg-muted ring-1 ring-hairline sm:w-28"
		>
			<img
				class="card-thumbnail size-full object-cover"
				src={`/media/thumbnails/${encodeURIComponent(item.resource.thumbnailAssetKey)}`}
				alt=""
				width={item.resource.thumbnailWidth ?? 1200}
				height={item.resource.thumbnailHeight ?? 630}
				loading={priorityImage ? 'eager' : 'lazy'}
				fetchpriority={priorityImage ? 'high' : 'auto'}
				decoding="async"
				bind:this={thumbnailEl}
			/>
		</div>
	{/if}
</div>
