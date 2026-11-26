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

	const showThumbnail = $derived(Boolean(item.resource.thumbnailAssetKey && !imgFailed));
	const repoSlug = $derived(extractRepoSlug(item.resource.canonicalUrl || item.rawUrl));
	const title = $derived(
		item.resource.title ||
			(item.resource.contentType === 'repo' && repoSlug ? repoSlug : null) ||
			displayAddress(item.resource.canonicalUrl || item.rawUrl)
	);
</script>

<!-- Künye (docs/designs/izgah-ui-v4.md §4): no box around the link; a title in link blue, one künye
     line under it and an optional small cover on the right. -->
<div class="link-attachment" class:has-thumbnail={showThumbnail}>
	<div class="attachment-text">
		<h3 id={titleId} class="attachment-title">
			<a
				href={item.rawUrl}
				target="_blank"
				rel="noopener noreferrer"
				class="card-title-link content-link"
			>
				<Highlight text={title} terms={highlightTerms} />
			</a>
		</h3>
		{@render kunye?.()}
	</div>
	{#if showThumbnail && item.resource.thumbnailAssetKey}
		<div class="card-thumbnail-frame">
			<img
				class="card-thumbnail"
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

<style>
	.link-attachment {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-4);
		align-items: start;
		margin-block-start: var(--space-2);
	}

	.link-attachment.has-thumbnail {
		grid-template-columns: minmax(0, 1fr) 112px;
	}

	.attachment-text {
		display: grid;
		gap: 2px;
		min-inline-size: 0;
	}

	.attachment-title {
		margin: 0;
		font: var(--k-text-title);
		overflow-wrap: anywhere;
	}

	.card-thumbnail-frame {
		overflow: hidden;
		aspect-ratio: 16 / 10;
		background: var(--k-color-surface-2);
		border-radius: var(--k-radius-xs);
	}

	.card-thumbnail {
		display: block;
		inline-size: 100%;
		block-size: 100%;
		object-fit: cover;
	}

	@media (max-width: 479px) {
		.link-attachment.has-thumbnail {
			grid-template-columns: minmax(0, 1fr) 88px;
		}
	}
</style>
