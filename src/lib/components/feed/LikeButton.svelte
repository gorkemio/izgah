<script lang="ts">
	import { t } from '#lib/i18n/index.ts';
	import { enhance, type SubmitFunction } from '$app/forms';
	import { goto } from '$app/navigation';
	import { toasts } from '#lib/client/toast.svelte.ts';
	import type { FeedShareItem } from '#lib/types/feed.ts';
	import Heart from '@lucide/svelte/icons/heart';
	import { Spring } from 'svelte/motion';
	import AnimatedNumber from '#lib/motion/AnimatedNumber.svelte';
	import { SPRING, effectsReduced } from '#lib/motion/index.ts';

	interface Props {
		item: FeedShareItem;
		actionBase: string;
		returnTo: string;
	}

	let { item, actionBase, returnTo }: Props = $props();

	let submitting = $state(false);
	const heart = new Spring(1, SPRING.bouncy);
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
		if (desired && !effectsReduced()) {
			heart.set(1.25, { instant: true });
			void heart.set(1);
		}

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

<!-- Like (izgah-ui-v5.md §6): the heart fills with the accent and the count rolls. -->
<form method="POST" action="{actionBase}?/toggleLike" use:enhance={handleEnhance} class="contents">
	<input type="hidden" name="resourceId" value={item.resource.id} />
	<input type="hidden" name="liked" value={String(!liked)} />
	<input type="hidden" name="returnTo" value={returnTo} />
	<button
		type="submit"
		class="card-stat-btn card-action like-button"
		class:is-liked={liked}
		aria-pressed={liked}
		aria-label={count > 0
			? t('like.label', { count, title: label })
			: t('like.actionLabel', { title: label })}
		disabled={submitting}
		data-shortcut="like"
	>
		<span class="inline-flex" style="transform: scale({heart.current})">
			<Heart class="size-[15px] {liked ? 'fill-current' : ''}" aria-hidden="true" />
		</span>
		{#if count > 0}
			<AnimatedNumber value={count} />
		{:else}
			<span class="max-sm:sr-only">{t('like.action')}</span>
		{/if}
	</button>
</form>

<style>
	.like-button.is-liked {
		color: var(--primary);
	}

	.like-button:disabled {
		cursor: progress;
	}

	@media (forced-colors: active) {
		.like-button.is-liked {
			color: Highlight;
		}
	}
</style>
