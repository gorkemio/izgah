<script lang="ts">
	import { t } from '#lib/i18n/index.ts';
	import { enhance, type SubmitFunction } from '$app/forms';
	import { goto } from '$app/navigation';
	import { toasts } from '#lib/client/toast.svelte.ts';
	import AvatarStack, { type AvatarStackItem } from '#lib/components/ui/AvatarStack.svelte';
	import Icon from '#lib/components/ui/Icon.svelte';
	import Tooltip from '#lib/components/ui/Tooltip.svelte';
	import { formatDate } from '#lib/format/date.ts';
	import type { FeedShareItem } from '#lib/types/feed.ts';

	interface Props {
		item: FeedShareItem;
		actionBase: string;
		returnTo: string;
		currentUserId?: string;
		/** Marks the card for the card → resource-detail View Transition (core §8.4). */
		onOpenDiscussion?: () => void;
	}

	let { item, actionBase, returnTo, currentUserId, onOpenDiscussion }: Props = $props();

	let likeSubmitting = $state(false);
	let likeOverride = $state<{ liked: boolean; count: number } | null>(null);

	const viewerLiked = $derived(likeOverride?.liked ?? Boolean(item.resource.likedByViewer));
	const likeCount = $derived(likeOverride?.count ?? item.resource.likeCount);
	const label = $derived(item.resource.title || item.resource.domain);

	const attributionAvatars = $derived.by((): AvatarStackItem[] => {
		if (!item.attribution || item.attribution.kind !== 'first-share') {
			return [];
		}
		const firstAuthor = item.attribution.authorName;
		const list: AvatarStackItem[] = [{ name: firstAuthor }];
		if (item.author.name !== firstAuthor) {
			list.push({ name: item.author.name, self: item.author.id === currentUserId });
		}
		return list;
	});

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
				<Icon name="heart" size={15} filled={viewerLiked} />
				<span class="count">{likeCount}</span>
				<span class="visually-hidden"> {t('like.suffix', { count: likeCount })}</span>
			</button>
		</form>

		<a
			href="/resources/{item.resource.id}#comments"
			class="action card-discussion-link"
			aria-label={t('comment.countLabel', { count: item.resource.commentCount, title: label })}
			data-shortcut="comments"
			onclick={() => onOpenDiscussion?.()}
		>
			<Icon name="message" size={15} />
			<span class="count">{item.resource.commentCount}</span>
			<span class="visually-hidden">
				{t('comment.suffix', { count: item.resource.commentCount })}
			</span>
		</a>

		<Tooltip text={t('link.copy')}>
			{#snippet children()}
				<button
					type="button"
					class="action is-icon"
					aria-label={t('link.copyLabel', { title: label })}
					onclick={copyLink}
				>
					<Icon name="copy" size={15} />
				</button>
			{/snippet}
		</Tooltip>

		<Tooltip text={t('link.openNewTab')} shortcut="o">
			{#snippet children()}
				<a
					href={item.rawUrl}
					target="_blank"
					rel="noopener noreferrer"
					class="action is-icon"
					aria-label={t('link.openNewTabLabel', { title: label })}
					data-shortcut="open"
				>
					<Icon name="external" size={15} />
				</a>
			{/snippet}
		</Tooltip>
	</div>

	{#if item.attribution}
		<div class="post-attribution">
			{#if item.attribution.kind === 'original-deleted'}
				<p class="attribution-notice is-deleted">{t('share.originalDeleted')}</p>
			{:else}
				{#if attributionAvatars.length > 0}
					<AvatarStack items={attributionAvatars} max={3} size={22} />
				{/if}
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
	.post-foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: var(--space-2) var(--space-3);
		padding-block-start: var(--space-2);
		border-block-start: 1px solid var(--color-line);
	}

	.post-actions {
		display: flex;
		align-items: center;
		gap: 5px;
	}

	.post-actions form {
		display: contents;
	}

	.action {
		position: relative;
		z-index: 2;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 5px;
		min-block-size: 29px;
		padding: 0 9px;
		font: var(--text-meta);
		font-variant-numeric: tabular-nums;
		color: var(--color-text-muted);
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		text-decoration: none;
		cursor: pointer;
		transition:
			background-color var(--dur-fast) var(--ease),
			border-color var(--dur-fast) var(--ease),
			color var(--dur-fast) var(--ease);
	}

	.action.is-icon {
		min-inline-size: 29px;
		padding: 0 7px;
	}

	.action:hover {
		background: var(--color-surface-2);
		border-color: var(--color-line);
		color: var(--color-text);
		text-decoration: none;
	}

	.action.is-liked {
		background: var(--color-accent-soft);
		color: var(--color-accent-text);
		border-color: var(--color-accent-border);
		font-weight: 600;
	}

	.action.is-liked:hover {
		background: var(--color-accent-soft);
		color: var(--color-accent-text);
		border-color: var(--color-accent);
	}

	.action:disabled {
		cursor: progress;
	}

	.post-attribution {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		min-inline-size: 0;
		margin-inline-start: auto;
	}

	.attribution-notice {
		font: var(--text-hint);
		font-size: 0.75rem;
		font-variant-numeric: tabular-nums;
		color: var(--color-text-muted);
	}

	.attribution-notice strong {
		color: var(--color-text-secondary);
		font-weight: 600;
	}

	.attribution-notice a {
		position: relative;
		z-index: 2;
		color: inherit;
		text-decoration-line: underline;
		text-decoration-color: var(--color-line);
		text-underline-offset: 0.2em;
	}

	.attribution-notice a:hover {
		color: var(--color-accent-text);
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
