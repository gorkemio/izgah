<script lang="ts">
	import { t, intlLocale, formatCompactNumber, formatNumber } from '$lib/i18n';
	import { watchImageError } from '$lib/client/image-error';
	import Highlight from '$lib/components/ui/Highlight.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
	import { contentTypeLabel, type FeedShareItem } from '$lib/types/feed';

	interface Props {
		item: FeedShareItem;
		titleId: string;
		/** First image-bearing post loads eagerly with high priority; the rest lazily. */
		priorityImage?: boolean;
		/** Search terms to mark in the title and description. */
		highlightTerms?: readonly string[];
	}

	const LANGUAGE_COLORS: Record<string, string> = {
		typescript: '#3178C6',
		javascript: '#EAB308',
		rust: '#DEA584',
		go: '#00ADD8',
		python: '#3572A5',
		svelte: '#FF3E00',
		css: '#663399',
		html: '#E34C26',
		swift: '#F05138',
		kotlin: '#A97BFF',
		java: '#B07219',
		ruby: '#701516',
		php: '#4F5D95',
		shell: '#89E051',
		c: '#555555',
		'c++': '#F34B7D'
	};

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

	function extractDomainBadge(domain: string): string {
		const clean = domain.replace(/^www\./i, '').trim();
		const letters = clean.replace(/[^a-zA-Z0-9çğıöşüÇĞİÖŞÜ]/g, '');
		const badge = Array.from(letters).slice(0, 2).join('');
		return (badge || 'WW').toLocaleUpperCase(intlLocale());
	}

	function formatCompactStars(stars: number): string {
		return stars >= 1000 ? formatCompactNumber(stars) : formatNumber(stars);
	}

	const showThumbnail = $derived(Boolean(item.resource.thumbnailAssetKey && !imgFailed));
	const isPendingUnfurl = $derived(
		item.resource.unfurlStatus === 'queued' || item.resource.unfurlStatus === 'running'
	);
	const variant = $derived.by(() => {
		if (showThumbnail) {
			return item.resource.contentType === 'video' ? 'video-media' : 'media-split';
		}
		if (item.resource.contentType === 'repo') {
			return 'repo';
		}
		if (item.resource.contentType === 'social') {
			return 'social';
		}
		return 'compact';
	});

	const repoSlug = $derived(extractRepoSlug(item.resource.canonicalUrl || item.rawUrl));
	const title = $derived(
		item.resource.title ||
			(variant === 'repo' && repoSlug ? repoSlug : null) ||
			item.resource.siteName ||
			item.resource.domain
	);
	const repoShowsSlugSeparately = $derived(
		Boolean(repoSlug && title.toLowerCase() !== repoSlug.toLowerCase())
	);
	const languageColor = $derived.by(() => {
		const lang = item.resource.providerMeta?.language?.toLowerCase().trim();
		return lang ? (LANGUAGE_COLORS[lang] ?? 'var(--color-accent)') : 'var(--color-accent)';
	});
	const domainBadge = $derived(extractDomainBadge(item.resource.domain));
	const metaParts = $derived(
		[
			item.resource.siteName || item.resource.domain,
			contentTypeLabel(item.resource.contentType),
			item.resource.providerMeta?.stars !== undefined && variant !== 'repo'
				? `★ ${formatCompactStars(item.resource.providerMeta.stars)}`
				: null,
			item.resource.providerMeta?.language && variant !== 'repo'
				? item.resource.providerMeta.language
				: null,
			item.resource.providerMeta?.authorName ?? null
		].filter(Boolean)
	);
</script>

{#if variant === 'video-media' && item.resource.thumbnailAssetKey}
	<div class="link-attachment has-thumbnail is-video-media">
		<div class="card-thumbnail-frame is-video-frame">
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
			<span class="video-play-badge" aria-hidden="true">
				<Icon name="play" size={11} filled />
				<span>{t('contentType.video')}</span>
			</span>
		</div>
		<div class="attachment-media-body">
			<p class="attachment-meta">{metaParts.join(' · ')}</p>
			<h3 id={titleId} class="attachment-title">
				<a href={item.rawUrl} target="_blank" rel="noopener noreferrer" class="card-title-link">
					<Highlight text={title} terms={highlightTerms} />
				</a>
			</h3>
			{#if item.resource.description}
				<p class="attachment-desc">
					<Highlight text={item.resource.description} terms={highlightTerms} />
				</p>
			{/if}
			{#if isPendingUnfurl}
				<Skeleton variant="line" width="55%" />
			{/if}
		</div>
	</div>
{:else if variant === 'media-split' && item.resource.thumbnailAssetKey}
	<div class="link-attachment has-thumbnail is-media-split">
		<div class="attachment-text">
			<h3 id={titleId} class="attachment-title">
				<a href={item.rawUrl} target="_blank" rel="noopener noreferrer" class="card-title-link">
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
	</div>
{:else if variant === 'repo'}
	<div class="link-attachment is-repo">
		<div class="repo-layout">
			<div class="repo-main">
				{#if repoShowsSlugSeparately && repoSlug}
					<p class="repo-slug">
						<Icon name="gitBranch" size={14} />
						<span>{repoSlug}</span>
					</p>
				{/if}
				<h3 id={titleId} class="attachment-title" class:is-repo-slug={!repoShowsSlugSeparately}>
					<a href={item.rawUrl} target="_blank" rel="noopener noreferrer" class="card-title-link">
						{#if !repoShowsSlugSeparately}
							<Icon name="gitBranch" size={15} class="repo-inline-icon" />
						{/if}
						<Highlight text={title} terms={highlightTerms} />
					</a>
				</h3>
				{#if item.resource.description}
					<p class="attachment-desc">
						<Highlight text={item.resource.description} terms={highlightTerms} />
					</p>
				{/if}
				{#if isPendingUnfurl}
					<Skeleton variant="line" width="55%" />
				{/if}
			</div>

			<div class="repo-stats">
				{#if item.resource.providerMeta?.language}
					<span class="repo-stat">
						<span class="lang-dot" style:background={languageColor} aria-hidden="true"></span>
						<span>{item.resource.providerMeta.language}</span>
					</span>
				{/if}
				{#if item.resource.providerMeta?.stars !== undefined}
					<span class="repo-stat">★ {formatCompactStars(item.resource.providerMeta.stars)}</span>
				{/if}
				{#if !item.resource.providerMeta?.language && item.resource.providerMeta?.stars === undefined}
					<span class="repo-stat">{item.resource.domain}</span>
				{/if}
			</div>
		</div>
	</div>
{:else if variant === 'social'}
	<div class="link-attachment is-social">
		<div class="social-body">
			<p class="attachment-meta">{metaParts.join(' · ')}</p>
			<h3 id={titleId} class="attachment-title">
				<a href={item.rawUrl} target="_blank" rel="noopener noreferrer" class="card-title-link">
					<Highlight text={title} terms={highlightTerms} />
				</a>
			</h3>
			{#if item.resource.description}
				<p class="attachment-desc is-social-desc">
					<Highlight text={item.resource.description} terms={highlightTerms} />
				</p>
			{/if}
			{#if isPendingUnfurl}
				<Skeleton variant="line" width="60%" />
			{/if}
		</div>
	</div>
{:else}
	<div class="link-attachment is-compact">
		<div class="compact-strip">
			<span class="domain-badge" aria-hidden="true">{domainBadge}</span>
			<div class="compact-text">
				<h3 id={titleId} class="attachment-title is-compact-title">
					<a href={item.rawUrl} target="_blank" rel="noopener noreferrer" class="card-title-link">
						<Highlight text={title} terms={highlightTerms} />
					</a>
				</h3>
				<p class="attachment-meta">{metaParts.join(' · ')}</p>
				{#if item.resource.description}
					<p class="attachment-desc is-compact-desc">
						<Highlight text={item.resource.description} terms={highlightTerms} />
					</p>
				{/if}
				{#if isPendingUnfurl}
					<Skeleton variant="line" width="55%" />
				{/if}
			</div>
			<span class="compact-external" aria-hidden="true">
				<Icon name="external" size={15} />
			</span>
		</div>
	</div>
{/if}

<style>
	/* Stretched link: the whole attachment box activates the external URL, accessible name is title. */
	.link-attachment {
		position: relative;
		container-type: inline-size;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-3);
		padding: 14px 16px;
		border: 1px solid var(--color-line);
		border-radius: var(--radius-md);
		background: var(--attach-bg);
		box-shadow: var(--specular-top);
		transition:
			background-color var(--dur-fast) var(--ease),
			border-color var(--dur-fast) var(--ease);
	}

	.link-attachment:hover {
		background: var(--color-surface-2);
		border-color: var(--color-line-strong);
	}

	.link-attachment:focus-within {
		border-color: var(--color-accent);
		box-shadow:
			0 0 0 2px var(--color-bg),
			0 0 0 4px var(--color-accent);
	}

	/* Video full-bleed cover media card */
	.link-attachment.is-video-media {
		padding: 0;
		gap: 0;
		overflow: hidden;
	}

	.attachment-media-body {
		padding: 14px 16px;
		display: grid;
		gap: 5px;
	}

	.attachment-text {
		display: grid;
		gap: 5px;
		min-inline-size: 0;
	}

	.attachment-title {
		font: var(--text-title);
		letter-spacing: -0.01em;
		color: var(--color-text);
	}

	.attachment-title.is-repo-slug {
		font-family: var(--font-mono);
		font-size: 0.9375rem;
		font-weight: 600;
		line-height: 1.35;
		letter-spacing: -0.01em;
	}

	.attachment-title.is-compact-title {
		font-size: 0.96875rem;
		line-height: 1.32;
	}

	.card-title-link {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		text-decoration: none;
		color: var(--color-text);
	}

	.card-title-link:hover {
		color: var(--color-text);
		text-decoration: none;
	}

	.card-title-link:focus-visible {
		box-shadow: none;
		outline: none;
	}

	.card-title-link::after {
		content: '';
		position: absolute;
		inset: 0;
		z-index: 1;
	}

	.attachment-meta {
		font: var(--text-meta);
		font-variant-numeric: tabular-nums;
		color: var(--color-text-muted);
	}

	.attachment-desc {
		font: var(--text-body);
		font-size: 0.84375rem;
		line-height: 1.5;
		color: var(--color-text-secondary);
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		overflow: hidden;
	}

	.attachment-desc.is-social-desc {
		-webkit-line-clamp: 3;
		line-clamp: 3;
	}

	.attachment-desc.is-compact-desc {
		-webkit-line-clamp: 1;
		line-clamp: 1;
		margin-block-start: 2px;
	}

	.card-thumbnail-frame {
		position: relative;
		order: -1;
		overflow: hidden;
		background: var(--color-surface-2);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-sm);
	}

	.card-thumbnail-frame.is-video-frame {
		order: 0;
		border: 0;
		border-block-end: 1px solid var(--color-line);
		border-radius: 0;
	}

	.card-thumbnail {
		inline-size: 100%;
		block-size: auto;
		aspect-ratio: 1200 / 630;
		object-fit: cover;
	}

	.video-play-badge {
		position: absolute;
		inset-block-end: 10px;
		inset-inline-end: 10px;
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 3px 9px;
		border-radius: var(--radius-pill);
		font: var(--text-micro);
		font-variant-numeric: tabular-nums;
		color: #ffffff;
		background: rgb(20 20 19 / 0.78);
		border: 1px solid rgb(255 255 255 / 0.16);
	}

	/* Imageless Repo variant */
	.repo-layout {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-3);
	}

	.repo-main {
		display: grid;
		gap: 5px;
		flex: 1 1 240px;
		min-inline-size: 0;
	}

	.repo-slug {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font: var(--text-meta);
		font-weight: 500;
		color: var(--color-text-secondary);
	}

	.repo-stats {
		display: inline-flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-3);
		font: var(--text-meta);
		font-variant-numeric: tabular-nums;
		color: var(--color-text-muted);
		padding-block-start: 2px;
	}

	.repo-stat {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		white-space: nowrap;
	}

	.lang-dot {
		inline-size: 9px;
		block-size: 9px;
		border-radius: var(--radius-pill);
		flex: none;
	}

	/* Imageless Social / Quote variant */
	.link-attachment.is-social {
		border-inline-start: 3px solid var(--color-accent-border);
	}

	.social-body {
		display: grid;
		gap: 5px;
		min-inline-size: 0;
	}

	/* Imageless Compact strip variant */
	.link-attachment.is-compact {
		padding: 12px 14px;
	}

	.compact-strip {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-inline-size: 0;
	}

	.domain-badge {
		display: inline-grid;
		place-items: center;
		flex: none;
		inline-size: 36px;
		block-size: 36px;
		border-radius: var(--radius-sm);
		background: var(--color-surface-2);
		border: 1px solid var(--color-line);
		font: var(--text-micro);
		font-weight: 600;
		color: var(--color-text-secondary);
		user-select: none;
	}

	.compact-text {
		flex: 1;
		min-inline-size: 0;
		display: grid;
		gap: 2px;
	}

	.compact-external {
		flex: none;
		color: var(--color-text-muted);
		display: inline-flex;
		align-items: center;
	}

	@container (min-width: 480px) {
		.link-attachment.is-media-split:has(.card-thumbnail),
		.link-attachment.is-media-split.has-thumbnail {
			grid-template-columns: minmax(0, 1fr) 186px;
			gap: var(--space-4);
			align-items: center;
		}

		.link-attachment.is-media-split .card-thumbnail-frame {
			order: 0;
		}
	}

	@media (forced-colors: active) {
		.link-attachment {
			box-shadow: none;
			border-color: CanvasText;
		}

		.link-attachment:focus-within {
			outline: 2px solid CanvasText;
			outline-offset: 2px;
			box-shadow: none;
		}

		.video-play-badge {
			background: Canvas;
			color: CanvasText;
			border-color: CanvasText;
		}
	}
</style>
