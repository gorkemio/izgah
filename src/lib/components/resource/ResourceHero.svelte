<script lang="ts">
	import { t, formatNumber } from '#lib/i18n/index.ts';
	import { watchImageError } from '#lib/client/image-error.ts';
	import { enhance, type SubmitFunction } from '$app/forms';
	import { goto } from '$app/navigation';
	import AvatarStack, { type AvatarStackItem } from '#lib/components/ui/AvatarStack.svelte';
	import Icon from '#lib/components/ui/Icon.svelte';
	import Tooltip from '#lib/components/ui/Tooltip.svelte';
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
		sharers = [],
		aiSummary = null
	}: {
		resource: HeroResource;
		originalShareDeleted?: boolean;
		sharers?: ReadonlyArray<AvatarStackItem>;
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
				? `★ ${formatNumber(resource.providerMeta.stars)}`
				: null
		].filter(Boolean)
	);
	const sharersLabel = $derived(
		sharers.length > 0
			? t('resource.sharers', { names: sharers.map((item) => item.name).join(', ') })
			: undefined
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
			<span class="tag tag-accent">{contentTypeLabel(resource.contentType)}</span>
			<span class="hero-domain">{resource.siteName || resource.domain}</span>
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
				<Icon name="external" size={15} />
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
					<Icon name="heart" size={16} filled={viewerLiked} />
					<span>{t('common.likeCount', { count: likeCount })}</span>
				</button>
			</form>

			<Tooltip text={copied ? t('resource.copied') : t('resource.copyTooltip')}>
				{#snippet children()}
					<button
						type="button"
						class="btn btn-ghost hero-copy-btn"
						aria-label={t('link.copyLabel', { title: resource.title || resource.domain })}
						onclick={copyResourceUrl}
					>
						<Icon name={copied ? 'check' : 'copy'} size={15} />
						<span>{copied ? t('resource.copied') : t('resource.copy')}</span>
					</button>
				{/snippet}
			</Tooltip>

			<a href="#comments" class="btn btn-ghost hero-comment-count">
				<Icon name="message" size={15} />
				<span>{t('common.commentCount', { count: resource.commentCount })}</span>
			</a>

			{#if sharers.length > 0}
				<div class="hero-sharers">
					<AvatarStack items={sharers} max={4} size={26} label={sharersLabel} />
				</div>
			{/if}
		</div>
	</div>
</article>

<style>
	.resource-hero {
		display: grid;
		background: var(--color-surface-1);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-sm);
		overflow: hidden;
	}

	.hero-media {
		background: var(--color-surface-2);
		border-block-end: 1px solid var(--color-line);
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
		padding: var(--space-4);
	}

	@media (min-width: 640px) {
		.hero-body {
			padding: var(--space-5) 26px;
		}
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
		letter-spacing: -0.02em;
		line-height: 1.18;
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

	@media (prefers-reduced-motion: no-preference) {
		.hero-like-btn[aria-pressed='true'] :global(svg) {
			animation: like-pop 280ms ease-out;
		}
	}

	.hero-comment-count {
		font-variant-numeric: tabular-nums;
	}

	.hero-sharers {
		display: inline-flex;
		align-items: center;
		margin-inline-start: auto;
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
