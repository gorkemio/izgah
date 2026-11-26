<script lang="ts">
	import { t, formatNumber } from '#lib/i18n/index.ts';
	import { watchImageError } from '#lib/client/image-error.ts';
	import { enhance, type SubmitFunction } from '$app/forms';
	import { goto } from '$app/navigation';
	import { toasts } from '#lib/client/toast.svelte.ts';
	import { contentTypeLabel, type FeedShareItem } from '#lib/types/feed.ts';

	type HeroResource = Pick<
		FeedShareItem['resource'],
		| 'id'
		| 'title'
		| 'canonicalUrl'
		| 'domain'
		| 'siteName'
		| 'description'
		| 'contentType'
		| 'providerMeta'
		| 'thumbnailAssetKey'
		| 'thumbnailWidth'
		| 'thumbnailHeight'
		| 'likeCount'
		| 'likedByViewer'
		| 'commentCount'
	>;

	let {
		resource,
		originalShareDeleted = false,
		aiSummary = null
	}: {
		resource: HeroResource;
		originalShareDeleted?: boolean;
		/** Labelled machine summary (docs/designs/izgah-smart-capture.md §10). */
		aiSummary?: string | null;
	} = $props();

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
		if (resource.thumbnailAssetKey !== lastAssetKey) {
			lastAssetKey = resource.thumbnailAssetKey;
			imgFailed = false;
		}
	});

	const showThumbnail = $derived(Boolean(resource.thumbnailAssetKey && !imgFailed));
	const meta = $derived(
		[
			resource.providerMeta?.authorName
				? t('resource.author', { name: resource.providerMeta.authorName })
				: null,
			resource.providerMeta?.language
				? t('resource.language', { language: resource.providerMeta.language })
				: null,
			resource.providerMeta?.stars !== undefined
				? t('share.stars', { count: formatNumber(resource.providerMeta.stars) })
				: null
		].filter(Boolean)
	);

	// Optimistic, idempotent like (izgah-ui-v2 §8.6): send the desired state, apply the result.
	let likeSubmitting = $state(false);
	let likeOverride = $state<{ liked: boolean; count: number } | null>(null);
	const viewerLiked = $derived(likeOverride?.liked ?? Boolean(resource.likedByViewer));
	const likeCount = $derived(likeOverride?.count ?? resource.likeCount);

	$effect(() => {
		void resource.likeCount;
		void resource.likedByViewer;
		likeOverride = null;
	});

	const handleLikeEnhance: SubmitFunction = ({ cancel }) => {
		if (likeSubmitting) {
			cancel();
			return;
		}
		const previous = { liked: viewerLiked, count: likeCount };
		const desired = !previous.liked;
		likeSubmitting = true;
		likeOverride = { liked: desired, count: Math.max(0, previous.count + (desired ? 1 : -1)) };
		return async ({ result }) => {
			likeSubmitting = false;
			if (result.type === 'success') {
				const payload = result.data as { liked?: unknown; likeCount?: unknown } | undefined;
				if (typeof payload?.liked === 'boolean' && typeof payload.likeCount === 'number') {
					likeOverride = { liked: payload.liked, count: payload.likeCount };
					toasts.announce(payload.liked ? t('like.liked') : t('like.unliked'));
				}
				return;
			}
			likeOverride = previous;
			if (result.type === 'redirect') {
				await goto(result.location, { refreshAll: true });
				return;
			}
			toasts.push(t('like.failed'), { tone: 'error' });
		};
	};

	let copied = $state(false);
	let copyTimer: number | null = null;

	$effect(() => {
		return () => {
			if (copyTimer !== null) {
				window.clearTimeout(copyTimer);
			}
		};
	});

	async function copyResourceUrl(): Promise<void> {
		if (copyTimer !== null) {
			window.clearTimeout(copyTimer);
			copyTimer = null;
		}
		try {
			await navigator.clipboard.writeText(resource.canonicalUrl);
			copied = true;
			toasts.push(t('link.copied'), { tone: 'success' });
			copyTimer = window.setTimeout(() => {
				copied = false;
				copyTimer = null;
			}, 1800);
		} catch {
			toasts.push(t('link.copyFailed'), { tone: 'error' });
		}
	}
</script>

<article class="resource-hero">
	{#if showThumbnail && resource.thumbnailAssetKey}
		<div class="hero-media">
			<img
				class="hero-thumbnail"
				src={`/media/thumbnails/${encodeURIComponent(resource.thumbnailAssetKey)}`}
				alt={resource.title
					? t('resource.imageAlt', { title: resource.title })
					: t('resource.imageAlt', { title: resource.domain })}
				width={resource.thumbnailWidth ?? 1200}
				height={resource.thumbnailHeight ?? 630}
				loading="eager"
				fetchpriority="high"
				decoding="async"
				bind:this={thumbnailEl}
			/>
		</div>
	{/if}

	<div class="hero-body">
		<div class="hero-meta">
			<span class="hero-domain">
				{resource.siteName || resource.domain} · {contentTypeLabel(resource.contentType)}
			</span>
			{#if originalShareDeleted}
				<span class="status-pill status-pending">
					<span class="status-dot" aria-hidden="true"></span>
					<span>{t('resource.originalDeleted')}</span>
				</span>
			{/if}
		</div>

		<h1 tabindex="-1" class="resource-title">{resource.title || resource.canonicalUrl}</h1>

		{#if resource.description}
			<p class="resource-description">{resource.description}</p>
		{/if}

		{#if aiSummary}
			<div class="ai-summary">
				<span class="ai-summary-label">{t('resource.aiSummary')}</span>
				<p>{aiSummary}</p>
			</div>
		{/if}

		{#if meta.length > 0}
			<p class="provider-meta">{meta.join(' · ')}</p>
		{/if}

		<div class="hero-actions">
			<a
				href={resource.canonicalUrl}
				target="_blank"
				rel="noopener noreferrer"
				class="btn btn-primary external-resource-link"
				aria-label={t('resource.visitLabel', { domain: resource.domain })}
			>
				<span>{t('resource.visit')}</span>
			</a>

			<form method="POST" action="?/toggleLike" use:enhance={handleLikeEnhance}>
				<input type="hidden" name="returnTo" value={`/resources/${resource.id}`} />
				<input type="hidden" name="liked" value={String(!viewerLiked)} />
				<button
					type="submit"
					class="btn btn-subtle hero-like-btn"
					class:is-liked={viewerLiked}
					aria-pressed={viewerLiked}
					disabled={likeSubmitting}
				>
					<span>{t('common.likeCount', { count: likeCount })}</span>
				</button>
			</form>

			<button
				type="button"
				class="btn btn-ghost hero-copy-btn"
				aria-label={t('link.copyLabel', { title: resource.title || resource.domain })}
				onclick={copyResourceUrl}
			>
				<span>{copied ? t('resource.copied') : t('resource.copy')}</span>
			</button>

			<a href="#comments" class="btn btn-ghost hero-comment-count">
				<span>{t('common.commentCount', { count: resource.commentCount })}</span>
			</a>
		</div>
	</div>
</article>

<style>
	/* Künye: the resource reads like a page, not a card (izgah-ui-v4.md §1, principle 3). */
	.resource-hero {
		display: grid;
		gap: var(--space-4);
	}

	.hero-media {
		overflow: hidden;
		background: var(--color-surface-2);
		border-radius: var(--radius-xs);
	}

	.hero-thumbnail {
		inline-size: 100%;
		block-size: auto;
		aspect-ratio: 1200 / 630;
		object-fit: cover;
	}

	.hero-body {
		display: grid;
		gap: var(--space-3);
		min-inline-size: 0;
	}

	.hero-meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}

	.hero-domain {
		font: var(--text-meta);
		font-variant-numeric: tabular-nums;
		color: var(--color-text-muted);
	}

	.resource-title {
		font: var(--text-display);
		font-size: 1.625rem;
		letter-spacing: -0.01em;
		line-height: 1.22;
		overflow-wrap: anywhere;
		color: var(--color-text);
	}

	.resource-description {
		font: var(--text-body);
		color: var(--color-text-secondary);
		line-height: 1.62;
	}

	.provider-meta {
		font: var(--text-meta);
		font-variant-numeric: tabular-nums;
		color: var(--color-text-muted);
	}

	.hero-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		padding-block-start: var(--space-3);
		border-block-start: 1px solid var(--color-line);
	}

	.hero-actions form {
		display: contents;
	}

	.hero-like-btn {
		font-variant-numeric: tabular-nums;
	}

	.hero-like-btn.is-liked {
		background: var(--color-accent-soft);
		color: var(--color-accent-text);
		border-color: var(--color-accent-border);
		font-weight: 600;
	}

	.hero-like-btn.is-liked:hover:not(:disabled) {
		background: var(--color-accent-soft);
		border-color: var(--color-accent);
		color: var(--color-accent-text);
	}

	.hero-comment-count {
		font-variant-numeric: tabular-nums;
	}

	@media (forced-colors: active) {
		.resource-hero {
			box-shadow: none;
		}

		.hero-like-btn.is-liked {
			background: Highlight;
			color: HighlightText;
			border-color: Highlight;
		}
	}
</style>
