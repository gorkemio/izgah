<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		text: string;
		shortcut?: string;
		placement?: 'top' | 'bottom' | 'left' | 'right';
		id?: string;
		class?: string;
		/**
		 * Receives `{ tooltipId }` so the trigger can wire `aria-describedby={tooltipId}` when the
		 * tooltip carries supplemental info (skip `aria-describedby` if the text repeats the trigger's
		 * own `aria-label`, to avoid duplicate screen-reader announcements).
		 */
		children: Snippet<[{ tooltipId: string }]>;
	}

	let { text, shortcut, placement = 'top', id, class: className = '', children }: Props = $props();

	const rawUid = $props.id();
	const safeUid = rawUid.replace(/[^a-zA-Z0-9_-]/g, '-');
	const tooltipId = $derived(id ?? `tooltip-${safeUid}`);

	// WCAG 1.4.13 Dismissible: Escape closes the tooltip without moving pointer or focus.
	let dismissed = $state(false);

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			dismissed = true;
		}
	}

	function resetDismissed(): void {
		dismissed = false;
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<span
	class="tooltip-wrap is-{placement} {className}"
	class:is-dismissed={dismissed}
	onkeydown={handleKeydown}
	onpointerleave={resetDismissed}
	onfocusout={resetDismissed}
>
	{@render children({ tooltipId })}
	<span id={tooltipId} role="tooltip" class="tooltip-bubble">
		<span>{text}</span>
		{#if shortcut}
			<kbd class="tooltip-kbd">{shortcut}</kbd>
		{/if}
	</span>
</span>

<style>
	.tooltip-wrap {
		position: relative;
		display: inline-flex;
		align-items: center;
	}

	.tooltip-bubble {
		position: absolute;
		z-index: 70;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		max-inline-size: 16rem;
		padding: 5px 9px;
		font: var(--text-hint);
		font-size: 0.75rem;
		font-weight: 500;
		line-height: 1.3;
		white-space: nowrap;
		color: var(--color-text);
		background: var(--color-surface-1);
		border: 1px solid var(--color-line-strong);
		border-radius: var(--radius-sm);
		box-shadow: var(--shadow-lg);
		opacity: 0;
		visibility: hidden;
		pointer-events: none;
		transition:
			opacity var(--dur-fast) var(--ease),
			visibility var(--dur-fast) var(--ease);
	}

	/* Invisible hover bridge so moving the pointer onto the tooltip keeps it open (WCAG 1.4.13). */
	.tooltip-bubble::before {
		content: '';
		position: absolute;
		inset: -6px;
	}

	.tooltip-wrap.is-top .tooltip-bubble {
		inset-block-end: calc(100% + 6px);
		inset-inline-start: 50%;
		translate: -50% 0;
	}

	.tooltip-wrap.is-bottom .tooltip-bubble {
		inset-block-start: calc(100% + 6px);
		inset-inline-start: 50%;
		translate: -50% 0;
	}

	.tooltip-wrap.is-left .tooltip-bubble {
		inset-inline-end: calc(100% + 6px);
		inset-block-start: 50%;
		translate: 0 -50%;
	}

	.tooltip-wrap.is-right .tooltip-bubble {
		inset-inline-start: calc(100% + 6px);
		inset-block-start: 50%;
		translate: 0 -50%;
	}

	.tooltip-wrap:not(.is-dismissed):where(:hover, :has(:focus-visible)) .tooltip-bubble {
		opacity: 1;
		visibility: visible;
		pointer-events: auto;
	}

	.tooltip-kbd {
		display: inline-flex;
		align-items: center;
		padding: 1px 4px;
		font: var(--text-micro);
		font-size: 0.75rem;
		color: var(--color-text-muted);
		background: var(--color-surface-2);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-xs);
		line-height: 1.1;
	}

	/* Hidden on touch / coarse pointer devices (izgah-ui-v3 §7.2). */
	@media (pointer: coarse), (hover: none) {
		.tooltip-bubble {
			display: none;
		}
	}

	@media (forced-colors: active) {
		.tooltip-bubble {
			border: 2px solid CanvasText;
			box-shadow: none;
		}
	}
</style>
