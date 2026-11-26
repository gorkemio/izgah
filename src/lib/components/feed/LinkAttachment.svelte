<script lang="ts">
	import { t, formatCompactNumber, formatNumber } from '#lib/i18n/index.ts';
	import { watchImageError } from '#lib/client/image-error.ts';
	import Highlight from '#lib/components/ui/Highlight.svelte';
	import Skeleton from '#lib/components/ui/Skeleton.svelte';
	import { contentTypeLabel, type FeedShareItem } from '#lib/types/feed.ts';

	interface Props {
		item: FeedShareItem;
		titleId: string;
		/** First image-bearing post loads eagerly with high priority; the rest lazily. */
		priorityImage?: boolean;
		/** Search terms to mark in the title and description. */
		highlightTerms?: readonly string[];
	}

	const REPO_HOSTS = new Set(['github.com', 'gitlab.com', 'codeberg.org', 'bitbucket.org']);

	let { item, titleId, priorityImage = false, highlightTerms = [] }: Props = $props();

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

	function formatCompactStars(stars: number): string {
		return stars >= 1000 ? formatCompactNumber(stars) : formatNumber(stars);
	}

	const showThumbnail = $derived(Boolean(item.resource.thumbnailAssetKey && !imgFailed));
	const isPendingUnfurl = $derived(
		item.resource.unfurlStatus === 'queued' || item.resource.unfurlStatus === 'running'
	);
	const repoSlug = $derived(extractRepoSlug(item.resource.canonicalUrl || item.rawUrl));
	const title = $derived(
		item.resource.title ||
			(item.resource.contentType === 'repo' && repoSlug ? repoSlug : null) ||
			item.resource.siteName ||
			item.resource.domain
	);
	// One künye line (docs/designs/izgah-ui-v4.md §4): site · type · language · stars · author.
	const metaParts = $derived(
		[
			item.resource.siteName || item.resource.domain,
			contentTypeLabel(item.resource.contentType),
			item.resource.providerMeta?.language ?? null,
			item.resource.providerMeta?.stars !== undefined
				? t('share.stars', { count: formatCompactStars(item.resource.providerMeta.stars) })
				: null,
			item.resource.providerMeta?.authorName ?? null,
			repoSlug && title.toLowerCase() !== repoSlug.toLowerCase() ? repoSlug : null
		].filter(Boolean)
	);
</script>

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
		<p class="attachment-meta">{metaParts.join(' · ')}</p>
		{#if item.resource.description}
			<p class="attachment-desc">
				<Highlight text={item.resource.description} terms={highlightTerms} />
			</p>
		{/if}
		{#if isPendingUnfurl}
			<Skeleton variant="line" width="55%" />
		{/if}
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
	/* Künye: no box around the link; a title in link blue, one künye line, an optional small cover. */
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
		gap: 3px;
		min-inline-size: 0;
	}

	.attachment-title {
		margin: 0;
		font: var(--text-title);
		overflow-wrap: anywhere;
	}

	.attachment-meta {
		margin: 0;
		font: var(--text-hint);
		color: var(--color-text-muted);
		overflow-wrap: anywhere;
	}

	.attachment-desc {
		display: -webkit-box;
		margin: 0;
		overflow: hidden;
		font: var(--text-hint);
		color: var(--color-text-secondary);
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
	}

	.card-thumbnail-frame {
		overflow: hidden;
		aspect-ratio: 16 / 10;
		background: var(--color-surface-2);
		border-radius: var(--radius-xs);
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
