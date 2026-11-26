<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		id?: string;
		triggerLabel: string;
		iconOnly?: boolean;
		triggerClass?: string;
		panelClass?: string;
		trigger?: Snippet;
		children: Snippet<[{ close: () => void }]>;
	}

	let {
		id,
		triggerLabel,
		iconOnly = false,
		triggerClass = '',
		panelClass = '',
		trigger,
		children
	}: Props = $props();

	const rawUid = $props.id();
	const safeUid = rawUid.replace(/[^a-zA-Z0-9_-]/g, '-');
	const panelId = $derived(id ?? `popover-panel-${safeUid}`);
	const safePanelId = $derived(panelId.replace(/[^a-zA-Z0-9_-]/g, '-'));
	const anchorName = $derived(`--anchor-${safePanelId}`);

	let triggerEl = $state<HTMLButtonElement | null>(null);
	let panelEl = $state<HTMLDivElement | null>(null);
	let detachOpenListeners: (() => void) | null = null;

	function closePopover(): void {
		if (panelEl && typeof panelEl.hidePopover === 'function') {
			try {
				panelEl.hidePopover();
			} catch {
				// Popover already closed
			}
		}
	}

	function positionFallbackPanel(): void {
		if (!triggerEl || !panelEl || typeof CSS === 'undefined') {
			return;
		}
		if (CSS.supports('position-area', 'block-end')) {
			panelEl.style.left = '';
			panelEl.style.top = '';
			return;
		}

		const viewportPadding = 8;
		const offset = 6;
		const triggerRect = triggerEl.getBoundingClientRect();
		const panelRect = panelEl.getBoundingClientRect();

		const maxLeft = Math.max(
			viewportPadding,
			window.innerWidth - panelRect.width - viewportPadding
		);
		let left = triggerRect.right - panelRect.width;
		if (left < viewportPadding) {
			left = triggerRect.left;
		}
		left = Math.min(Math.max(viewportPadding, left), maxLeft);

		let top = triggerRect.bottom + offset;
		if (top + panelRect.height > window.innerHeight - viewportPadding) {
			const flippedTop = triggerRect.top - panelRect.height - offset;
			if (flippedTop >= viewportPadding) {
				top = flippedTop;
			} else {
				const maxTop = Math.max(
					viewportPadding,
					window.innerHeight - panelRect.height - viewportPadding
				);
				top = Math.min(Math.max(viewportPadding, top), maxTop);
			}
		}

		panelEl.style.left = `${Math.round(left)}px`;
		panelEl.style.top = `${Math.round(top)}px`;
	}

	function clearOpenListeners(): void {
		if (detachOpenListeners) {
			detachOpenListeners();
			detachOpenListeners = null;
		}
	}

	function armOpenListeners(): void {
		if (detachOpenListeners || !panelEl) {
			return;
		}
		const currentPanel = panelEl;
		const handleScroll = (event: Event) => {
			if (event.target instanceof Node && currentPanel.contains(event.target)) {
				return;
			}
			closePopover();
		};
		const handleResize = () => {
			positionFallbackPanel();
		};

		window.addEventListener('scroll', handleScroll, { passive: true, capture: true });
		window.addEventListener('resize', handleResize, { passive: true });
		detachOpenListeners = () => {
			window.removeEventListener('scroll', handleScroll, true);
			window.removeEventListener('resize', handleResize);
		};
	}

	function handleBeforeToggle(event: Event): void {
		const toggleEvent = event as ToggleEvent;
		if (toggleEvent.newState === 'open') {
			armOpenListeners();
		} else {
			clearOpenListeners();
		}
	}

	function handleToggle(event: Event): void {
		const toggleEvent = event as ToggleEvent;
		if (toggleEvent.newState === 'open') {
			armOpenListeners();
			positionFallbackPanel();
		} else {
			clearOpenListeners();
			if (panelEl) {
				panelEl.style.left = '';
				panelEl.style.top = '';
			}
		}
	}

	$effect(() => {
		return () => {
			clearOpenListeners();
		};
	});
</script>

<button
	bind:this={triggerEl}
	type="button"
	popovertarget={panelId}
	class="popover-trigger {triggerClass}"
	aria-label={iconOnly ? triggerLabel : undefined}
	style="--popover-anchor: {anchorName};"
>
	{#if trigger}
		{@render trigger()}
	{:else}
		{triggerLabel}
	{/if}
</button>

<div
	bind:this={panelEl}
	id={panelId}
	popover="auto"
	class="popover-panel {panelClass}"
	style="--popover-anchor: {anchorName};"
	onbeforetoggle={handleBeforeToggle}
	ontoggle={handleToggle}
>
	{@render children({ close: closePopover })}
</div>

<style>
	/* Zero-specificity defaults so a caller's triggerClass always wins. */
	:where(.popover-trigger) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		min-inline-size: 36px;
		min-block-size: 36px;
		padding: 0 var(--space-2);
		font: var(--k-text-ui);
		color: var(--k-color-text);
		background: transparent;
		border: 1px solid var(--k-color-line-strong);
		border-radius: var(--k-radius-sm);
		cursor: pointer;
		transition:
			background-color var(--dur-fast) var(--ease),
			border-color var(--dur-fast) var(--ease);
	}

	:where(.popover-trigger):hover {
		background: var(--k-color-surface-2);
	}

	@media (pointer: coarse) {
		:where(.popover-trigger) {
			min-inline-size: 44px;
			min-block-size: 44px;
		}
	}

	@supports (position-area: block-end) {
		.popover-trigger {
			anchor-name: var(--popover-anchor);
		}
	}
</style>
