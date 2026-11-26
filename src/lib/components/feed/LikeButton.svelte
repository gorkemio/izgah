<script lang="ts">
	import { t } from '#lib/i18n/index.ts';
	import { enhance, type SubmitFunction } from '$app/forms';
	import { goto } from '$app/navigation';
	import { toasts } from '#lib/client/toast.svelte.ts';
	import type { FeedShareItem } from '#lib/types/feed.ts';

	interface Props {
		item: FeedShareItem;
		actionBase: string;
		returnTo: string;
	}

	let { item, actionBase, returnTo }: Props = $props();

	let submitting = $state(false);
	let override = $state<{ liked: boolean; count: number } | null>(null);

	const liked = $derived(override?.liked ?? Boolean(item.resource.likedByViewer));
	const count = $derived(override?.count ?? item.resource.likeCount);
	const label = $derived(item.resource.title || item.resource.domain);

	// Fresh server data for this entry supersedes the local (optimistic or confirmed) like state.
	$effect(() => {
		void item.resource.likeCount;
		void item.resource.likedByViewer;
		override = null;
	});

	// Applied locally from the action result (no feed reload); the request carries the desired
	// state so a double click can never flip the like back (F4).
	const handleEnhance: SubmitFunction = ({ cancel }) => {
		if (submitting) {
			cancel();
			return;
		}
		const previous = { liked, count };
		const desired = !previous.liked;
		submitting = true;
		override = { liked: desired, count: Math.max(0, previous.count + (desired ? 1 : -1)) };

		return async ({ result }) => {
			submitting = false;
			if (result.type === 'success') {
				const data = result.data as { liked?: unknown; likeCount?: unknown } | undefined;
				if (typeof data?.liked === 'boolean' && typeof data.likeCount === 'number') {
					override = { liked: data.liked, count: data.likeCount };
					toasts.announce(data.liked ? t('like.liked') : t('like.unliked'));
				}
				return;
			}
			override = previous;
			if (result.type === 'redirect') {
				await goto(result.location, { refreshAll: true });
				return;
			}
			toasts.push(t('like.failed'), { tone: 'error' });
		};
	};
</script>

<!--
	One control for the count and the action (izgah-ui-v4 §4): with likes it reads "4 likes" as part of
	the künye line; at zero it reads "Like" and joins the entry actions, shown on hover and focus.
-->
<span class="kunye-part like-part" class:is-idle={count === 0}>
	{#if count > 0}<span class="kunye-sep" aria-hidden="true">·</span>{/if}
	<form method="POST" action="{actionBase}?/toggleLike" use:enhance={handleEnhance}>
		<input type="hidden" name="resourceId" value={item.resource.id} />
		<input type="hidden" name="liked" value={String(!liked)} />
		<input type="hidden" name="returnTo" value={returnTo} />
		<button
			type="submit"
			class="kunye-action card-stat-btn"
			class:is-liked={liked}
			aria-pressed={liked}
			aria-label={count > 0
				? t('like.label', { count, title: label })
				: t('like.actionLabel', { title: label })}
			disabled={submitting}
			data-shortcut="like"
		>
			{count > 0 ? t('common.likes', { count }) : t('like.action')}
		</button>
	</form>
</span>

<style>
	form {
		display: contents;
	}

	.is-liked {
		font-weight: 600;
		color: var(--color-text);
	}

	.kunye-action:disabled {
		cursor: progress;
	}

	@media (forced-colors: active) {
		.is-liked {
			color: Highlight;
		}
	}
</style>
