<script lang="ts">
	import { t } from '#lib/i18n/index.ts';
	import { watchImageError } from '#lib/client/image-error.ts';
	import { enhance, type SubmitFunction } from '$app/forms';
	import { goto } from '$app/navigation';
	import { toasts } from '#lib/client/toast.svelte.ts';
	import { kunyeCase, resourceFacts } from '#lib/format/kunye.ts';
	import { buttonVariants } from '#lib/components/ui/button/index.ts';
	import AnimatedNumber from '#lib/motion/AnimatedNumber.svelte';
	import { SPRING, effectsReduced } from '#lib/motion/index.ts';
	import type { FeedShareItem } from '#lib/types/feed.ts';
	import Check from '@lucide/svelte/icons/check';
	import Copy from '@lucide/svelte/icons/copy';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import Heart from '@lucide/svelte/icons/heart';
	import MessageCircle from '@lucide/svelte/icons/message-circle';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import { Spring } from 'svelte/motion';

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
		| 'siteIconAssetKey'
		| 'likeCount'
		| 'likedByViewer'
		| 'commentCount'
	>;

	let {
		resource,
		originalShareDeleted = false,
		aiSummary = null,
		headingLevel = 1,
		actionBase = ''
	}: {
		resource: HeroResource;
		originalShareDeleted?: boolean;
		/** Labelled machine summary (docs/designs/izgah-smart-capture.md §10). */
		aiSummary?: string | null;
		/** The resource page uses an h1; the reading pane sits under the feed's h1. */
		headingLevel?: 1 | 2;
		/** Where the like action lives: '' on the resource page, '/' from the reading pane. */
		actionBase?: string;
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
		if (resource.thumbnailAssetKey !== lastAssetKey) {
			lastAssetKey = resource.thumbnailAssetKey;
			imgFailed = false;
		}
	});

	const showThumbnail = $derived(Boolean(resource.thumbnailAssetKey && !imgFailed));
	const facts = $derived(resourceFacts(resource));
	const siteInitial = $derived((resource.domain[0] ?? '?').toLocaleUpperCase('tr'));
	const title = $derived(resource.title || resource.canonicalUrl);

	// Optimistic, idempotent like (izgah-ui-v2 §8.6): send the desired state, apply the result.
	let likeSubmitting = $state(false);
	let likeOverride = $state<{ liked: boolean; count: number } | null>(null);
	const viewerLiked = $derived(likeOverride?.liked ?? Boolean(resource.likedByViewer));
	const likeCount = $derived(likeOverride?.count ?? resource.likeCount);
	const heart = new Spring(1, SPRING.bouncy);

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
		if (desired && !effectsReduced()) {
			heart.set(1.25, { instant: true });
			void heart.set(1);
		}
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

<!-- Resource hero (docs/designs/izgah-ui-v5.md §5.3): the facts line with the site icon, the title,
     a wide cover, the abstract, the labelled machine summary and one row of actions. The reading
     pane renders the same component with an h2. -->
<article class="resource-hero grid gap-4" class:has-thumbnail={showThumbnail}>
	<div class="grid min-w-0 gap-2.5">
		<p class="hero-kunye flex min-w-0 items-center gap-2 text-[12.5px] text-muted-foreground">
			{#if resource.siteIconAssetKey && !iconFailed}
				<img
					class="size-4 shrink-0 rounded-[4px] bg-muted object-contain"
					src={`/media/thumbnails/${encodeURIComponent(resource.siteIconAssetKey)}`}
					alt=""
					width="16"
					height="16"
					decoding="async"
					bind:this={iconEl}
				/>
			{:else}
				<span
					class="grid size-4 shrink-0 place-items-center rounded-[4px] bg-muted text-[9px] font-semibold uppercase"
					aria-hidden="true"
				>
					{siteInitial}
				</span>
			{/if}
			<span class="min-w-0 truncate tabular-nums">
				{facts.join(' · ')}
				{#if originalShareDeleted}
					<span class="hero-deleted italic">· {kunyeCase(t('resource.originalDeleted'))}</span>
				{/if}
			</span>
		</p>
		<svelte:element
			this={headingLevel === 1 ? 'h1' : 'h2'}
			tabindex="-1"
			class="resource-title text-[1.625rem] leading-tight font-semibold tracking-[-0.02em] text-balance [overflow-wrap:anywhere] outline-none max-sm:text-[1.375rem]"
		>
			{title}
		</svelte:element>
	</div>

	{#if showThumbnail && resource.thumbnailAssetKey}
		<div
			class="hero-media aspect-[1200/630] overflow-hidden rounded-xl bg-muted ring-1 ring-hairline"
			style="view-transition-name: resource-cover-{resource.id}"
		>
			<img
				class="hero-thumbnail size-full object-cover"
				src={`/media/thumbnails/${encodeURIComponent(resource.thumbnailAssetKey)}`}
				alt={t('resource.imageAlt', { title: resource.title || resource.domain })}
				width={resource.thumbnailWidth ?? 1200}
				height={resource.thumbnailHeight ?? 630}
				loading="eager"
				fetchpriority="high"
				decoding="async"
				bind:this={thumbnailEl}
			/>
		</div>
	{/if}

	{#if resource.description}
		<p class="resource-description max-w-[68ch] text-[15px] leading-relaxed text-muted-foreground">
			{resource.description}
		</p>
	{/if}

	{#if aiSummary}
		<div class="ai-summary grid gap-1.5 rounded-lg border border-hairline bg-muted/50 p-3.5">
			<span
				class="ai-summary-label inline-flex items-center gap-1.5 text-[11.5px] font-medium tracking-wide text-muted-foreground uppercase"
			>
				<Sparkles class="size-3.5" aria-hidden="true" />
				{t('resource.aiSummary')}
			</span>
			<p class="text-[14px] leading-relaxed">{aiSummary}</p>
		</div>
	{/if}

	<div class="hero-actions flex flex-wrap items-center gap-2 border-t border-hairline pt-4">
		<a
			href={resource.canonicalUrl}
			target="_blank"
			rel="noopener noreferrer"
			class="external-resource-link {buttonVariants({ variant: 'default' })}"
			aria-label={t('resource.visitLabel', { domain: resource.domain })}
		>
			<ExternalLink aria-hidden="true" />
			<span>{t('resource.visit')}</span>
		</a>

		<form
			method="POST"
			action="{actionBase}?/toggleLike"
			use:enhance={handleLikeEnhance}
			class="contents"
		>
			<input type="hidden" name="resourceId" value={resource.id} />
			<input type="hidden" name="returnTo" value={`/resources/${resource.id}`} />
			<input type="hidden" name="liked" value={String(!viewerLiked)} />
			<button
				type="submit"
				class="hero-like-btn {buttonVariants({ variant: 'outline' })} tabular-nums"
				class:is-liked={viewerLiked}
				aria-pressed={viewerLiked}
				aria-label={t('common.likeCount', { count: likeCount })}
				disabled={likeSubmitting}
			>
				<span class="inline-flex" style="transform: scale({heart.current})">
					<Heart class={viewerLiked ? 'fill-current' : ''} aria-hidden="true" />
				</span>
				<AnimatedNumber value={likeCount} />
			</button>
		</form>

		<button
			type="button"
			class="hero-copy-btn {buttonVariants({ variant: 'ghost' })}"
			aria-label={t('link.copyLabel', { title: resource.title || resource.domain })}
			onclick={copyResourceUrl}
		>
			{#if copied}
				<Check aria-hidden="true" />
			{:else}
				<Copy aria-hidden="true" />
			{/if}
			<span>{copied ? t('resource.copied') : t('resource.copy')}</span>
		</button>

		<a
			href="#comments"
			class="hero-comment-count {buttonVariants({ variant: 'ghost' })} tabular-nums"
			aria-label={t('common.commentCount', { count: resource.commentCount })}
		>
			<MessageCircle aria-hidden="true" />
			<span>{resource.commentCount}</span>
		</a>
	</div>
</article>

<style>
	.hero-like-btn.is-liked {
		color: var(--primary);
		border-color: color-mix(in oklab, var(--primary) 40%, transparent);
	}

	@media (forced-colors: active) {
		.hero-like-btn.is-liked {
			color: Highlight;
			border-color: Highlight;
		}
	}
</style>
