<script lang="ts">
	import { t } from '#lib/i18n/index.ts';
	import { enhance, type SubmitFunction } from '$app/forms';
	import { goto } from '$app/navigation';
	import { toasts } from '#lib/client/toast.svelte.ts';
	import { formatDate } from '#lib/format/date.ts';
	import type { FeedShareItem } from '#lib/types/feed.ts';

	interface Props {
		item: FeedShareItem;
		actionBase: string;
		returnTo: string;
		/** Marks the card for the card → resource-detail View Transition (core §8.4). */
		onOpenDiscussion?: () => void;
	}

	let { item, actionBase, returnTo, onOpenDiscussion }: Props = $props();

	let likeSubmitting = $state(false);
	let likeOverride = $state<{ liked: boolean; count: number } | null>(null);

	const viewerLiked = $derived(likeOverride?.liked ?? Boolean(item.resource.likedByViewer));
	const likeCount = $derived(likeOverride?.count ?? item.resource.likeCount);
	const label = $derived(item.resource.title || item.resource.domain);

	// Fresh server data for this card supersedes the local (optimistic or confirmed) like state.
	$effect(() => {
		void item.resource.likeCount;
		void item.resource.likedByViewer;
		likeOverride = null;
	});

	// Likes are applied locally from the action result (no feed reload); the request carries the
	// desired state so a double click can never flip the like back (F4).
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
				const data = result.data as { liked?: unknown; likeCount?: unknown } | undefined;
				if (typeof data?.liked === 'boolean' && typeof data.likeCount === 'number') {
					likeOverride = { liked: data.liked, count: data.likeCount };
					toasts.announce(data.liked ? t('like.liked') : t('like.unliked'));
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

	async function copyLink(): Promise<void> {
		try {
			await navigator.clipboard.writeText(item.rawUrl);
			toasts.push(t('link.copied'), { tone: 'success' });
		} catch {
			toasts.push(t('link.copyFailed'), { tone: 'error' });
		}
	}
</script>

<footer class="post-foot">
	<div class="post-actions">
		<form method="POST" action="{actionBase}?/toggleLike" use:enhance={handleLikeEnhance}>
			<input type="hidden" name="resourceId" value={item.resource.id} />
			<input type="hidden" name="liked" value={String(!viewerLiked)} />
			<input type="hidden" name="returnTo" value={returnTo} />
			<button
				type="submit"
				class="action card-stat-btn"
				class:is-liked={viewerLiked}
				aria-pressed={viewerLiked}
				aria-label={t('like.label', { count: likeCount, title: label })}
				disabled={likeSubmitting}
				data-shortcut="like"
			>
				<span class="count">{likeCount}</span>
				<span>{t('like.suffix', { count: likeCount })}</span>
			</button>
		</form>

		<a
			href="/resources/{item.resource.id}#comments"
			class="action card-discussion-link"
			aria-label={t('comment.countLabel', { count: item.resource.commentCount, title: label })}
			data-shortcut="comments"
			onclick={() => onOpenDiscussion?.()}
		>
			<span class="count">{item.resource.commentCount}</span>
			<span>{t('comment.suffix', { count: item.resource.commentCount })}</span>
		</a>

		<button
			type="button"
			class="action"
			aria-label={t('link.copyLabel', { title: label })}
			onclick={copyLink}
		>
			{t('share.copyShort')}
		</button>

		<a
			href={item.rawUrl}
			target="_blank"
			rel="noopener noreferrer"
			class="action"
			aria-label={t('link.openNewTabLabel', { title: label })}
			data-shortcut="open"
		>
			{t('share.openShort')}
		</a>
	</div>

	{#if item.attribution}
		<div class="post-attribution">
			{#if item.attribution.kind === 'original-deleted'}
				<p class="attribution-notice is-deleted">{t('share.originalDeleted')}</p>
			{:else}
				<p class="attribution-notice">
					<a href="/resources/{item.resource.id}#share-{item.attribution.shareId}">
						{t('share.firstSharedBy')} <strong>{item.attribution.authorName}</strong> ·
						{formatDate(item.attribution.createdAt)}
						{#if item.attribution.sectionNames.length > 0}
							({item.attribution.sectionNames.join(', ')})
						{/if}
					</a>
				</p>
			{/if}
		</div>
	{/if}
</footer>

<style>
	/* Künye actions (izgah-ui-v4.md §4): words, not icons, on one quiet line. */
	.post-foot {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-3);
		margin-block-start: var(--space-1);
	}

	.post-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0 var(--space-4);
	}

	.post-actions form {
		display: contents;
	}

	.action {
		position: relative;
		z-index: 2;
		display: inline-flex;
		align-items: baseline;
		gap: 0.3em;
		padding: 0;
		font: var(--text-hint);
		font-variant-numeric: tabular-nums;
		color: var(--color-text-muted);
		background: transparent;
		border: 0;
		text-decoration: underline;
		text-decoration-color: transparent;
		text-underline-offset: 0.2em;
		cursor: pointer;
	}

	.action:hover {
		color: var(--color-text);
		text-decoration-color: currentColor;
	}

	.action.is-liked {
		font-weight: 650;
		color: var(--color-text);
	}

	.action:disabled {
		cursor: progress;
	}

	.post-attribution {
		min-inline-size: 0;
	}

	.attribution-notice {
		margin: 0;
		font: var(--text-hint);
		color: var(--color-text-muted);
	}

	.attribution-notice strong {
		font-weight: 600;
		color: var(--color-text-secondary);
	}

	.attribution-notice a {
		position: relative;
		z-index: 2;
		color: inherit;
		text-decoration-color: var(--color-line-strong);
	}

	.attribution-notice a:hover {
		color: var(--color-text);
		text-decoration-color: currentColor;
	}

	@media (prefers-reduced-motion: no-preference) {
		.action {
			transition:
				background-color var(--dur-fast) var(--ease),
				border-color var(--dur-fast) var(--ease),
				color var(--dur-fast) var(--ease),
				scale 90ms var(--ease);
		}

		.action:active:not(:disabled) {
			scale: 0.98;
		}

		.action[aria-pressed='true'] :global(svg) {
			animation: like-pop 280ms ease-out;
		}
	}

	@media (forced-colors: active) {
		.action.is-liked {
			background: Highlight;
			color: HighlightText;
			border-color: Highlight;
		}
	}

	@media (pointer: coarse) {
		.action {
			min-block-size: 44px;
			min-inline-size: 44px;
		}
	}
</style>
