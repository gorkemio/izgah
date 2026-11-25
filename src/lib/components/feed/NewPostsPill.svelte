<script lang="ts">
	import { t } from '$lib/i18n';
	import { toasts } from '$lib/client/toast.svelte';
	import { startVisibilityPoller, type PollOutcome } from '$lib/client/visibility-poller';
	import Icon from '$lib/components/ui/Icon.svelte';
	import type { ContentType } from '$lib/types/domain';

	interface Props {
		/** Poll only on the cursor-less first page (izgah-ui-v2 §8.5). */
		enabled: boolean;
		sectionId: string | null;
		type: ContentType | null;
		/** Newest post in the list; read at poll time. */
		newestId: string | null;
		onLoad: (count: number) => Promise<void>;
	}

	let { enabled, sectionId, type, newestId, onLoad }: Props = $props();

	const POLL_INTERVAL_MS = 60_000;
	const MIN_ELAPSED_ON_VISIBLE_MS = 15_000;

	let newCount = $state(0);
	let loading = $state(false);
	let latestNewestId: string | null = null;

	const label = $derived(
		newCount >= 100 ? t('feed.newPostsMax') : t('feed.newPosts', { count: newCount })
	);

	$effect(() => {
		// Whenever the list gains a newer head (pill click, own share, preview refresh), the old
		// count is stale; the next poll recomputes it from the new anchor.
		if (newestId !== latestNewestId) {
			latestNewestId = newestId;
			newCount = 0;
		}
	});

	async function poll(): Promise<PollOutcome> {
		const params = new URLSearchParams();
		if (latestNewestId) {
			params.set('afterId', latestNewestId);
		}
		if (sectionId) {
			params.set('section', sectionId);
		}
		if (type) {
			params.set('type', type);
		}
		const query = params.toString();
		const response = await fetch(`/api/internal/feed/updates${query ? `?${query}` : ''}`, {
			headers: { Accept: 'application/json' },
			cache: 'no-store'
		});
		if (response.status === 401 || response.status === 403 || response.status === 404) {
			return 'stop';
		}
		if (!response.ok) {
			return 'backoff';
		}
		const body = (await response.json()) as { newCount?: unknown };
		const count = typeof body.newCount === 'number' && body.newCount > 0 ? body.newCount : 0;
		const wasHidden = newCount === 0;
		newCount = count;
		if (wasHidden && count > 0) {
			toasts.announce(label);
		}
		return 'ok';
	}

	$effect(() => {
		if (!enabled) {
			newCount = 0;
			return;
		}
		// Re-subscribe when the scope changes; the anchor is read at poll time.
		void sectionId;
		void type;
		const poller = startVisibilityPoller({
			intervalMs: POLL_INTERVAL_MS,
			minElapsedOnVisibleMs: MIN_ELAPSED_ON_VISIBLE_MS,
			immediate: false,
			run: poll
		});
		return () => poller.stop();
	});

	async function handleClick(): Promise<void> {
		if (loading) {
			return;
		}
		loading = true;
		const count = newCount;
		try {
			await onLoad(count);
			newCount = 0;
		} finally {
			loading = false;
		}
	}
</script>

{#if newCount > 0}
	<div class="pill-anchor">
		<button
			type="button"
			class="new-posts-pill"
			onclick={handleClick}
			disabled={loading}
			aria-busy={loading}
		>
			<Icon name="arrowUp" size={14} />
			<span>{label}</span>
		</button>
	</div>
{/if}

<style>
	/* Zero-height sticky anchor: the pill floats over the list without shifting it. */
	.pill-anchor {
		position: sticky;
		inset-block-start: calc(var(--sticky-top) + var(--space-2));
		z-index: 20;
		display: flex;
		justify-content: center;
		block-size: 0;
		overflow: visible;
	}

	.new-posts-pill {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		min-block-size: 38px;
		padding: 0 var(--space-4);
		font: var(--text-ui);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		color: var(--btn-primary-fg);
		background: var(--btn-primary-bg);
		border: 1px solid var(--btn-primary-bg);
		border-radius: var(--radius-pill);
		box-shadow: var(--shadow-lg);
		cursor: pointer;
		transition:
			background-color var(--dur-fast) var(--ease),
			border-color var(--dur-fast) var(--ease),
			opacity var(--dur-fast) var(--ease);
	}

	.new-posts-pill:hover:not(:disabled) {
		background: color-mix(in oklab, var(--btn-primary-bg) 88%, var(--color-text));
		border-color: color-mix(in oklab, var(--btn-primary-bg) 88%, var(--color-text));
	}

	.new-posts-pill:disabled {
		opacity: 0.65;
		box-shadow: none;
		cursor: progress;
	}

	@keyframes pill-enter {
		from {
			opacity: 0;
			scale: 0.96;
			translate: 0 -6px;
		}
		to {
			opacity: 1;
			scale: 1;
			translate: 0 0;
		}
	}

	@media (prefers-reduced-motion: no-preference) {
		.new-posts-pill {
			animation: pill-enter var(--dur-base) var(--ease) backwards;
			transition:
				background-color var(--dur-fast) var(--ease),
				border-color var(--dur-fast) var(--ease),
				opacity var(--dur-fast) var(--ease),
				scale 90ms var(--ease);
		}

		.new-posts-pill:active:not(:disabled) {
			scale: 0.98;
		}
	}

	@media (forced-colors: active) {
		.new-posts-pill {
			background: Highlight;
			color: HighlightText;
			border-color: Highlight;
			box-shadow: none;
		}

		.new-posts-pill:hover:not(:disabled) {
			border-color: CanvasText;
		}
	}

	@media (pointer: coarse) {
		.new-posts-pill {
			min-block-size: 44px;
		}
	}
</style>
