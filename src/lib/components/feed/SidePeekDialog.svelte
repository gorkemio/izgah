<script lang="ts">
	import { t } from '#lib/i18n/index.ts';
	import { preloadData } from '$app/navigation';
	import { MediaQuery } from 'svelte/reactivity';
	import { watchImageError } from '#lib/client/image-error.ts';
	import { toasts } from '#lib/client/toast.svelte.ts';
	import MemberAvatar from '#lib/components/member/MemberAvatar.svelte';
	import { buttonVariants } from '#lib/components/ui/button/index.ts';
	import { Skeleton } from '#lib/components/ui/skeleton/index.ts';
	import Copy from '@lucide/svelte/icons/copy';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import Heart from '@lucide/svelte/icons/heart';
	import Maximize2 from '@lucide/svelte/icons/maximize-2';
	import MessageCircle from '@lucide/svelte/icons/message-circle';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import X from '@lucide/svelte/icons/x';
	import { formatWhen } from '#lib/format/date.ts';
	import type { ContentType, ProviderMeta, UnfurlStatus } from '#lib/types/domain.ts';
	import { resourceFacts } from '#lib/format/kunye.ts';
	import type { FeedShareItem } from '#lib/types/feed.ts';

	interface PeekShareItem {
		id: string;
		note: string | null;
		createdAt: string;
		author: {
			id: string;
			name: string;
			avatarAssetKey?: string | null;
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
			avatarAssetKey?: string | null;
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
			siteIconAssetKey?: string | null;
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
	class="side-peek-dialog bg-background text-foreground"
	class:is-docked={docked}
	closedby={docked ? 'none' : 'any'}
	aria-labelledby={titleId}
	onclose={handleClose}
>
	{#if item && resource}
		<header class="flex items-center justify-end gap-1 border-b border-hairline px-3 py-2">
			<a
				href="/resources/{resource.id}"
				class="peek-full-link {buttonVariants({ variant: 'ghost', size: 'sm' })}"
			>
				<Maximize2 aria-hidden="true" />
				{t('peek.openFull')}
			</a>
			<!-- The docked pane keeps focus in the register; the modal drawer takes it. -->
			<!-- svelte-ignore a11y_autofocus -->
			<button
				type="button"
				class="peek-close {buttonVariants({ variant: 'ghost', size: 'icon-sm' })}"
				aria-label={t('peek.close')}
				autofocus={!wide.current}
				onclick={() => dialogEl?.close('close')}
			>
				<X aria-hidden="true" />
			</button>
		</header>

		<div class="peek-body grid content-start gap-6 overflow-y-auto overscroll-contain p-5">
			<!-- Same order as the resource hero (izgah-ui-v5.md §5.3). -->
			<section class="grid gap-3.5">
				<p class="flex min-w-0 items-center gap-2 text-[12.5px] text-muted-foreground">
					<span class="min-w-0 truncate tabular-nums">{resourceFacts(resource).join(' · ')}</span>
				</p>
				<h2 id={titleId} class="peek-title text-xl leading-snug font-semibold tracking-[-0.015em]">
					{displayTitle}
				</h2>

				{#if showThumbnail && resource.thumbnailAssetKey}
					<div class="aspect-[1200/630] overflow-hidden rounded-lg bg-muted ring-1 ring-hairline">
						<img
							bind:this={coverImgEl}
							class="size-full object-cover"
							src="/media/thumbnails/{encodeURIComponent(resource.thumbnailAssetKey)}"
							alt=""
							width={resource.thumbnailWidth ?? 1200}
							height={resource.thumbnailHeight ?? 630}
							decoding="async"
						/>
					</div>
				{/if}

				{#if resource.description}
					<p class="text-[14px] leading-relaxed text-muted-foreground">{resource.description}</p>
				{/if}

				{#if detail?.aiSummary}
					<div class="ai-summary grid gap-1.5 rounded-lg border border-hairline bg-muted/50 p-3">
						<span
							class="inline-flex items-center gap-1.5 text-[11.5px] font-medium tracking-wide text-muted-foreground uppercase"
						>
							<Sparkles class="size-3.5" aria-hidden="true" />
							{t('resource.aiSummary')}
						</span>
						<p class="text-[13.5px] leading-relaxed">{detail.aiSummary}</p>
					</div>
				{/if}

				<div class="flex flex-wrap items-center gap-2">
					<a
						href={item.rawUrl}
						target="_blank"
						rel="noopener noreferrer"
						class={buttonVariants({ size: 'sm' })}
					>
						<ExternalLink aria-hidden="true" />
						{t('resource.visit')}
					</a>
					<button
						type="button"
						class={buttonVariants({ variant: 'outline', size: 'sm' })}
						aria-label={t('link.copyLabel', { title: displayTitle })}
						onclick={copyUrl}
					>
						<Copy aria-hidden="true" />
						{t('share.copyShort')}
					</button>
					<div
						class="ms-auto inline-flex items-center gap-3 text-[12.5px] text-muted-foreground tabular-nums"
					>
						<span
							class="inline-flex items-center gap-1"
							title={t('common.likeCount', { count: resource.likeCount })}
						>
							<Heart class="size-3.5" aria-hidden="true" />
							<span class="sr-only">{t('common.likeCount', { count: resource.likeCount })}</span>
							<span aria-hidden="true">{resource.likeCount}</span>
						</span>
						<span
							class="inline-flex items-center gap-1"
							title={t('common.commentCount', { count: resource.commentCount })}
						>
							<MessageCircle class="size-3.5" aria-hidden="true" />
							<span class="sr-only">
								{t('common.commentCount', { count: resource.commentCount })}
							</span>
							<span aria-hidden="true">{resource.commentCount}</span>
						</span>
					</div>
				</div>
			</section>

			{#if status === 'loading'}
				<div
					class="grid gap-3 border-t border-hairline pt-5"
					aria-busy="true"
					aria-label={t('peek.loading')}
				>
					<p class="text-[13px] font-medium">{t('resource.shareHistory')}</p>
					<Skeleton class="h-3.5 w-full" />
					<Skeleton class="h-3.5 w-4/5" />
					<Skeleton class="h-3.5 w-3/5" />
				</div>
				<div class="grid gap-3 border-t border-hairline pt-5" aria-busy="true">
					<p class="text-[13px] font-medium">{t('peek.recentComments')}</p>
					<Skeleton class="h-3.5 w-full" />
					<Skeleton class="h-3.5 w-2/3" />
				</div>
			{:else if status === 'error'}
				<div
					class="grid justify-items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-[13.5px] text-destructive"
					role="alert"
				>
					<p>{errorMessage}</p>
					<a
						href="/resources/{resource.id}"
						class={buttonVariants({ variant: 'outline', size: 'sm' })}
					>
						{t('peek.openFullArrow')}
					</a>
				</div>
			{:else if status === 'ready' && detail}
				<section
					class="grid gap-3 border-t border-hairline pt-5"
					aria-labelledby="peek-shares-heading"
				>
					<h3 id="peek-shares-heading" class="text-[13px] font-medium">
						{t('resource.shareHistoryCount', { count: detail.shares.length })}
					</h3>

					{#if detail.originalShareDeleted}
						<p class="text-[12.5px] text-muted-foreground">{t('peek.originalDeleted')}</p>
					{/if}

					<ol class="grid gap-4" role="list">
						{#each detail.shares as share (share.id)}
							<li class="flex gap-2.5">
								<MemberAvatar
									id={share.author.id}
									name={share.author.name}
									avatarAssetKey={share.author.avatarAssetKey}
									class="size-6 text-[10px]"
								/>
								<div class="grid min-w-0 flex-1 gap-1">
									<p class="flex flex-wrap items-baseline gap-x-2 text-[13px]">
										<strong class="font-medium">{share.author.name}</strong>
										<time
											class="text-[12px] text-muted-foreground tabular-nums"
											datetime={share.createdAt}
										>
											{formatWhen(share.createdAt)}
										</time>
									</p>
									{#if share.note}
										<p
											class="text-[13.5px] leading-relaxed [overflow-wrap:anywhere] whitespace-pre-line"
										>
											{share.note}
										</p>
									{/if}
									{#if share.sections.length > 0}
										<div class="flex flex-wrap gap-1.5">
											{#each share.sections as section (section.id)}
												<a
													href="/sections/{section.slug}"
													class="rounded-full border border-hairline px-2 py-0.5 text-[12px] text-muted-foreground no-underline hover:bg-accent hover:text-foreground"
												>
													{section.name}
												</a>
											{/each}
										</div>
									{/if}
								</div>
							</li>
						{/each}
					</ol>
				</section>

				<section
					class="grid gap-3 border-t border-hairline pt-5"
					aria-labelledby="peek-comments-heading"
				>
					<div class="flex items-center justify-between gap-2">
						<h3 id="peek-comments-heading" class="text-[13px] font-medium">
							{t('comment.headingShort', { count: detail.comments.length })}
						</h3>
						{#if hasHiddenComments}
							<a href="/resources/{resource.id}#comments" class="text-[12.5px] text-link">
								{t('peek.seeAll')}
							</a>
						{/if}
					</div>

					{#if recentComments.length === 0}
						<p class="text-[12.5px] text-muted-foreground">{t('peek.noComments')}</p>
					{:else}
						<ol class="grid gap-4" role="list">
							{#each recentComments as comment (comment.id)}
								<li class="flex gap-2.5">
									<MemberAvatar
										id={comment.author.id}
										name={comment.author.name}
										avatarAssetKey={comment.author.avatarAssetKey}
										class="size-6 text-[10px]"
									/>
									<div class="grid min-w-0 flex-1 gap-1">
										<p class="flex flex-wrap items-baseline gap-x-2 text-[13px]">
											<strong class="font-medium">{comment.author.name}</strong>
											<time
												class="text-[12px] text-muted-foreground tabular-nums"
												datetime={comment.createdAt}
											>
												{formatWhen(comment.createdAt)}
											</time>
										</p>
										<p
											class="text-[13.5px] leading-relaxed [overflow-wrap:anywhere] whitespace-pre-line"
										>
											{comment.body}
										</p>
									</div>
								</li>
							{/each}
						</ol>
					{/if}

					<div>
						<a
							href="/resources/{resource.id}#comments"
							class={buttonVariants({ variant: 'outline', size: 'sm' })}
						>
							<MessageCircle aria-hidden="true" />
							{detail.comments.length > 0 ? t('peek.join') : t('peek.firstComment')}
						</a>
					</div>
				</section>
			{/if}
		</div>
	{/if}
</dialog>

<style>
	/* Placement only; the look comes from utilities (izgah-ui-v5.md §5.3). */
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
		border-inline-start: 1px solid var(--hairline);
		border-radius: 0;
		box-shadow: var(--elevation-xl);
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
	}

	dialog.side-peek-dialog:modal {
		overscroll-behavior: contain;
	}

	dialog.side-peek-dialog::backdrop {
		background: var(--backdrop);
		overflow: hidden;
		overscroll-behavior: contain;
	}

	@media (forced-colors: active) {
		dialog.side-peek-dialog {
			border-inline-start: 2px solid CanvasText;
			box-shadow: none;
		}
	}
</style>
