<script lang="ts">
	import { t } from '#lib/i18n/index.ts';
	import { preloadData } from '$app/navigation';
	import { MediaQuery } from 'svelte/reactivity';
	import { watchImageError } from '#lib/client/image-error.ts';
	import { toasts } from '#lib/client/toast.svelte.ts';
	import Skeleton from '#lib/components/ui/Skeleton.svelte';
	import { formatDateTime } from '#lib/format/date.ts';
	import type { ContentType, ProviderMeta, UnfurlStatus } from '#lib/types/domain.ts';
	import { contentTypeLabel, type FeedShareItem } from '#lib/types/feed.ts';

	interface PeekShareItem {
		id: string;
		note: string | null;
		createdAt: string;
		author: {
			id: string;
			name: string;
		};
		sections: Array<{
			id: string;
			slug: string;
			name: string;
		}>;
	}

	interface PeekCommentItem {
		id: string;
		body: string;
		createdAt: string;
		author: {
			id: string;
			name: string;
		};
	}

	interface PeekResourceData {
		resource: {
			id: string;
			canonicalUrl: string;
			domain: string;
			contentType: ContentType;
			unfurlStatus: UnfurlStatus;
			title: string | null;
			description: string | null;
			siteName: string | null;
			providerMeta: ProviderMeta | null;
			thumbnailAssetKey: string | null;
			thumbnailWidth: number | null;
			thumbnailHeight: number | null;
			likeCount: number;
			commentCount: number;
			likedByViewer: boolean;
		};
		originalShareDeleted: boolean;
		aiSummary?: string | null;
		shares: PeekShareItem[];
		comments: PeekCommentItem[];
	}

	interface Props {
		item: FeedShareItem | null;
		onClose: () => void;
	}

	let { item, onClose }: Props = $props();

	/*
	 * Reading pane (docs/designs/izgah-ui-v4.md §3): from 1280px the dialog opens non-modally as a
	 * docked column beside the register, so the feed stays usable and j/k move the selection; below
	 * that it is a modal side drawer. The mode is fixed when the pane opens.
	 */
	const wide = new MediaQuery('min-width: 1280px', false);
	let docked = $state(false);

	let dialogEl = $state<HTMLDialogElement | null>(null);
	let coverImgEl = $state<HTMLImageElement | null>(null);
	let imgFailed = $state(false);

	let status = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
	let detail = $state<PeekResourceData | null>(null);
	let errorMessage = $state<string | null>(null);
	let requestSeq = 0;

	const titleId = 'side-peek-dialog-title';
	const resource = $derived(detail?.resource ?? item?.resource ?? null);
	const displayTitle = $derived(
		resource ? resource.title || resource.siteName || resource.domain : t('peek.fallbackTitle')
	);
	const showThumbnail = $derived(Boolean(resource?.thumbnailAssetKey && !imgFailed));
	const recentComments = $derived(detail ? detail.comments.slice(-5) : []);
	const hasHiddenComments = $derived(detail ? detail.comments.length > 5 : false);

	$effect(() => {
		const img = coverImgEl;
		if (!img) {
			return;
		}
		return watchImageError(img, () => {
			imgFailed = true;
		});
	});

	$effect(() => {
		const el = dialogEl;
		const currentItem = item;
		if (!el) {
			return;
		}

		if (!currentItem) {
			if (el.open) {
				el.close();
			}
			status = 'idle';
			detail = null;
			errorMessage = null;
			imgFailed = false;
			return;
		}

		imgFailed = false;
		if (!el.open) {
			docked = wide.current;
			if (docked) {
				el.show();
			} else {
				el.showModal();
			}
		}

		const seq = ++requestSeq;
		status = 'loading';
		detail = null;
		errorMessage = null;

		const targetHref = `/resources/${currentItem.resource.id}`;
		void preloadData(targetHref)
			.then((result) => {
				if (seq !== requestSeq) {
					return;
				}
				if (result.type === 'loaded' && result.status === 200 && result.data) {
					const loaded = result.data as Partial<PeekResourceData>;
					if (loaded.resource && Array.isArray(loaded.shares) && Array.isArray(loaded.comments)) {
						detail = loaded as PeekResourceData;
						status = 'ready';
						return;
					}
				}
				status = 'error';
				errorMessage = t('peek.loadFailed');
			})
			.catch(() => {
				if (seq !== requestSeq) {
					return;
				}
				status = 'error';
				errorMessage = t('peek.loadError');
			});
	});

	// A non-modal dialog gets no close request from Escape, so the docked pane listens itself.
	$effect(() => {
		const el = dialogEl;
		if (!el || !docked || !item) {
			return;
		}
		const onKeydown = (event: KeyboardEvent) => {
			if (
				event.key !== 'Escape' ||
				event.defaultPrevented ||
				document.querySelector('dialog:modal') ||
				document.querySelector(':popover-open')
			) {
				return;
			}
			event.preventDefault();
			el.close('close');
		};
		document.addEventListener('keydown', onKeydown);
		return () => document.removeEventListener('keydown', onKeydown);
	});

	// Fallback light-dismiss for Safari where `<dialog closedby="any">` is unsupported (modal only).
	$effect(() => {
		const el = dialogEl;
		if (!el || docked || 'closedBy' in HTMLDialogElement.prototype) {
			return;
		}

		let pressedOutside = false;

		const isOutside = (event: PointerEvent): boolean => {
			const rect = el.getBoundingClientRect();
			return (
				event.clientX < rect.left ||
				event.clientX > rect.right ||
				event.clientY < rect.top ||
				event.clientY > rect.bottom
			);
		};

		const onPointerDown = (event: PointerEvent) => {
			pressedOutside = event.target === el && isOutside(event);
		};

		const onPointerUp = (event: PointerEvent) => {
			if (pressedOutside && event.target === el && isOutside(event)) {
				el.close('dismiss');
			}
			pressedOutside = false;
		};

		el.addEventListener('pointerdown', onPointerDown);
		el.addEventListener('pointerup', onPointerUp);
		return () => {
			el.removeEventListener('pointerdown', onPointerDown);
			el.removeEventListener('pointerup', onPointerUp);
		};
	});

	function handleClose(): void {
		if (dialogEl) {
			dialogEl.returnValue = '';
		}
		requestSeq += 1;
		docked = false;
		onClose();
	}

	async function copyUrl(): Promise<void> {
		const url = item?.rawUrl ?? resource?.canonicalUrl;
		if (!url) {
			return;
		}
		try {
			await navigator.clipboard.writeText(url);
			toasts.push(t('link.copied'), { tone: 'success' });
		} catch {
			toasts.push(t('link.copyFailed'), { tone: 'error' });
		}
	}
</script>

<dialog
	bind:this={dialogEl}
	class="side-peek-dialog"
	class:is-docked={docked}
	closedby={docked ? 'none' : 'any'}
	aria-labelledby={titleId}
	onclose={handleClose}
>
	{#if item && resource}
		<header class="peek-header">
			<div class="peek-kicker">
				<span class="peek-domain">{resource.siteName || resource.domain}</span>
				<span aria-hidden="true">·</span>
				<span>{contentTypeLabel(resource.contentType)}</span>
			</div>
			<div class="peek-header-actions">
				<a href="/resources/{resource.id}" class="peek-full-link">{t('peek.openFull')}</a>
				<!-- The docked pane keeps focus in the register; the modal drawer takes it. -->
				<!-- svelte-ignore a11y_autofocus -->
				<button
					type="button"
					class="peek-close"
					aria-label={t('peek.close')}
					autofocus={!wide.current}
					onclick={() => dialogEl?.close('close')}
				>
					{t('common.close')}
				</button>
			</div>
		</header>

		<div class="peek-body">
			<section class="peek-hero">
				<h2 id={titleId} class="peek-title">{displayTitle}</h2>

				{#if showThumbnail && resource.thumbnailAssetKey}
					<div class="peek-cover">
						<img
							bind:this={coverImgEl}
							src="/media/thumbnails/{encodeURIComponent(resource.thumbnailAssetKey)}"
							alt=""
							width={resource.thumbnailWidth ?? 1200}
							height={resource.thumbnailHeight ?? 630}
							decoding="async"
						/>
					</div>
				{/if}

				{#if resource.description}
					<p class="peek-desc">{resource.description}</p>
				{/if}

				{#if detail?.aiSummary}
					<div class="ai-summary">
						<span class="ai-summary-label">{t('resource.aiSummary')}</span>
						<p>{detail.aiSummary}</p>
					</div>
				{/if}

				<div class="peek-cta-row">
					<a
						href={item.rawUrl}
						target="_blank"
						rel="noopener noreferrer"
						class="btn btn-primary btn-sm"
					>
						{t('resource.visit')}
					</a>
					<button
						type="button"
						class="btn btn-outline btn-sm"
						aria-label={t('link.copyLabel', { title: displayTitle })}
						onclick={copyUrl}
					>
						{t('share.copyShort')}
					</button>
					<div class="peek-stats">
						<span>{t('common.likeCount', { count: resource.likeCount })}</span>
						<span aria-hidden="true">·</span>
						<span>{t('common.commentCount', { count: resource.commentCount })}</span>
					</div>
				</div>
			</section>

			{#if status === 'loading'}
				<div class="peek-section" aria-busy="true" aria-label={t('peek.loading')}>
					<p class="peek-section-title">{t('resource.shareHistory')}</p>
					<Skeleton variant="line" lines={3} />
				</div>
				<div class="peek-section" aria-busy="true">
					<p class="peek-section-title">{t('peek.recentComments')}</p>
					<Skeleton variant="line" lines={3} />
				</div>
			{:else if status === 'error'}
				<div class="peek-error" role="alert">
					<p>{errorMessage}</p>
					<a href="/resources/{resource.id}" class="btn btn-outline btn-sm">
						{t('peek.openFullArrow')}
					</a>
				</div>
			{:else if status === 'ready' && detail}
				<section class="peek-section" aria-labelledby="peek-shares-heading">
					<div class="peek-section-head">
						<h3 id="peek-shares-heading" class="peek-section-title">
							{t('resource.shareHistoryCount', { count: detail.shares.length })}
						</h3>
					</div>

					{#if detail.originalShareDeleted}
						<p class="peek-muted-note">{t('peek.originalDeleted')}</p>
					{/if}

					<ol class="peek-timeline" role="list">
						{#each detail.shares as share (share.id)}
							<li class="peek-timeline-item">
								<div class="peek-row-head">
									<strong class="peek-author">{share.author.name}</strong>
									<time class="peek-time" datetime={share.createdAt}>
										{formatDateTime(share.createdAt)}
									</time>
								</div>
								{#if share.note}
									<p class="peek-note">{share.note}</p>
								{/if}
								{#if share.sections.length > 0}
									<div class="peek-tags">
										{#each share.sections as section (section.id)}
											<a href="/sections/{section.slug}" class="tag">{section.name}</a>
										{/each}
									</div>
								{/if}
							</li>
						{/each}
					</ol>
				</section>

				<section class="peek-section" aria-labelledby="peek-comments-heading">
					<div class="peek-section-head">
						<h3 id="peek-comments-heading" class="peek-section-title">
							{t('comment.headingShort', { count: detail.comments.length })}
						</h3>
						{#if hasHiddenComments}
							<a href="/resources/{resource.id}#comments" class="peek-inline-link">
								{t('peek.seeAll')}
							</a>
						{/if}
					</div>

					{#if recentComments.length === 0}
						<p class="peek-muted-note">{t('peek.noComments')}</p>
					{:else}
						<ol class="peek-comments" role="list">
							{#each recentComments as comment (comment.id)}
								<li class="peek-comment-item">
									<div class="peek-row-head">
										<strong class="peek-author">{comment.author.name}</strong>
										<time class="peek-time" datetime={comment.createdAt}>
											{formatDateTime(comment.createdAt)}
										</time>
									</div>
									<p class="peek-note">{comment.body}</p>
								</li>
							{/each}
						</ol>
					{/if}

					<div class="peek-section-foot">
						<a href="/resources/{resource.id}#comments" class="btn btn-outline btn-sm">
							{detail.comments.length > 0 ? t('peek.join') : t('peek.firstComment')}
						</a>
					</div>
				</section>
			{/if}
		</div>
	{/if}
</dialog>

<style>
	dialog.side-peek-dialog {
		margin: 0;
		margin-inline-start: auto;
		inset-block: 0;
		inset-inline-end: 0;
		inset-inline-start: auto;
		inline-size: min(480px, 100dvw);
		max-inline-size: 100dvw;
		block-size: 100dvh;
		max-block-size: 100dvh;
		padding: 0;
		border: 0;
		border-inline-start: 1px solid var(--color-line);
		border-radius: 0;
		background: var(--color-bg);
		color: var(--color-text);
		box-shadow: var(--shadow-lg);
		overflow: hidden;
	}

	/* Docked: a column on the right edge, ruled off, without shadow or backdrop. */
	dialog.side-peek-dialog.is-docked {
		position: fixed;
		z-index: 20;
		inline-size: var(--pane-w);
		box-shadow: none;
	}

	dialog.side-peek-dialog[open] {
		display: grid;
		grid-template-rows: auto minmax(0, 1fr);
		opacity: 1;
		translate: 0 0;
		transition:
			opacity var(--dur-panel) var(--ease),
			translate var(--dur-panel) var(--ease);
	}

	dialog.side-peek-dialog:modal {
		overscroll-behavior: contain;
	}

	dialog.side-peek-dialog::backdrop {
		background: var(--color-backdrop);
		overflow: hidden;
		overscroll-behavior: contain;
	}

	dialog.side-peek-dialog[open]::backdrop {
		opacity: 1;
		transition: opacity var(--dur-panel) var(--ease);
	}

	@starting-style {
		dialog.side-peek-dialog[open] {
			opacity: 0;
			translate: 16px 0;
		}

		dialog.side-peek-dialog[open]::backdrop {
			opacity: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		dialog.side-peek-dialog[open],
		dialog.side-peek-dialog[open]::backdrop {
			transition-duration: 0ms;
			translate: 0 0;
		}
	}

	.peek-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		border-block-end: 1px solid var(--color-line);
	}

	.peek-full-link {
		font: var(--text-ui);
		font-size: 0.875rem;
		color: var(--color-link);
	}

	.peek-close {
		min-block-size: 28px;
		padding: 0 4px;
		font: var(--text-ui);
		font-size: 0.875rem;
		color: var(--color-text-secondary);
		background: transparent;
		border: 0;
		border-radius: var(--radius-sm);
		cursor: pointer;
	}

	.peek-close:hover {
		color: var(--color-text);
		text-decoration: underline;
		text-underline-offset: 0.3em;
	}

	.peek-kicker {
		display: flex;
		align-items: center;
		gap: 6px;
		min-inline-size: 0;
		font: var(--text-meta);
		color: var(--color-text-muted);
	}

	.peek-domain {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.peek-header-actions {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		flex: none;
	}

	.peek-body {
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: var(--space-5);
		display: grid;
		gap: var(--space-5);
		align-content: start;
	}

	.peek-hero {
		display: grid;
		gap: var(--space-3);
	}

	.peek-title {
		font-size: 1.25rem;
		font-weight: 600;
		line-height: 1.3;
		color: var(--color-text);
	}

	.peek-cover {
		overflow: hidden;
		border-radius: var(--radius-sm);
		background: var(--color-surface-2);
	}

	.peek-cover img {
		inline-size: 100%;
		block-size: auto;
		aspect-ratio: 1200 / 630;
		object-fit: cover;
	}

	.peek-desc {
		font: var(--text-body);
		font-size: 0.90625rem;
		color: var(--color-text-secondary);
	}

	.peek-cta-row {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-2);
		padding-block-start: var(--space-1);
	}

	.peek-stats {
		margin-inline-start: auto;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font: var(--text-meta);
		font-variant-numeric: tabular-nums;
		color: var(--color-text-muted);
	}

	.peek-section {
		display: grid;
		gap: var(--space-3);
		padding-block-start: var(--space-4);
		border-block-start: 1px solid var(--color-line);
	}

	.peek-section-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}

	.peek-section-title {
		font: var(--text-section);
		font-size: 0.9375rem;
		color: var(--color-text);
	}

	.peek-inline-link {
		font: var(--text-ui);
		font-size: 0.8125rem;
		color: var(--color-link);
	}

	.peek-timeline {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--space-4);
	}

	.peek-timeline-item {
		display: grid;
		gap: 6px;
	}

	.peek-comments {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
	}

	.peek-comment-item {
		display: grid;
		gap: 6px;
		padding-block: var(--space-3);
		border-block-end: 1px solid var(--color-line);
	}

	.peek-comment-item:first-child {
		padding-block-start: 0;
	}

	.peek-comment-item:last-child {
		border-block-end: 0;
		padding-block-end: 0;
	}

	.peek-row-head {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.peek-author {
		font: var(--text-ui);
		font-weight: 600;
		color: var(--color-text);
	}

	.peek-time {
		font: var(--text-meta);
		font-variant-numeric: tabular-nums;
		color: var(--color-text-muted);
	}

	.peek-note {
		font: var(--text-body);
		font-size: 0.90625rem;
		white-space: pre-line;
		overflow-wrap: anywhere;
		color: var(--color-text);
	}

	.peek-tags {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.peek-muted-note {
		font: var(--text-hint);
		color: var(--color-text-muted);
	}

	.peek-section-foot {
		display: flex;
		justify-content: flex-start;
	}

	.peek-error {
		display: grid;
		justify-items: start;
		gap: var(--space-3);
		padding: var(--space-3) 0;
		border-block: 1px solid var(--color-danger);
		color: var(--color-danger);
		font: var(--text-ui);
	}

	@media (forced-colors: active) {
		dialog.side-peek-dialog {
			border-inline-start: 2px solid CanvasText;
			box-shadow: none;
		}
	}
</style>
