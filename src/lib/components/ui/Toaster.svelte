<script lang="ts">
	import { t } from '$lib/i18n';
	import { toasts, type Toast } from '$lib/client/toast.svelte';
	import Icon from './Icon.svelte';

	const statusToasts = $derived(toasts.items.filter((item) => item.tone !== 'error'));
	const errorToasts = $derived(toasts.items.filter((item) => item.tone === 'error'));

	function iconFor(tone: Toast['tone']): 'alert' | 'check' {
		return tone === 'error' ? 'alert' : 'check';
	}
</script>

{#snippet toastItem(toast: Toast)}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="toast"
		class:is-success={toast.tone === 'success'}
		class:is-error={toast.tone === 'error'}
		onmouseenter={() => toasts.pause(toast.id, 'hover')}
		onmouseleave={() => toasts.resume(toast.id, 'hover')}
		onfocusin={() => toasts.pause(toast.id, 'focus')}
		onfocusout={(event) => {
			const next = event.relatedTarget;
			if (next instanceof Node && event.currentTarget.contains(next)) {
				return;
			}
			toasts.resume(toast.id, 'focus');
		}}
	>
		<span class="toast-icon" aria-hidden="true">
			<Icon name={iconFor(toast.tone)} size={16} />
		</span>
		<span class="toast-message">{toast.message}</span>
		{#if toast.action}
			<a href={toast.action.href} class="toast-action">{toast.action.label}</a>
		{/if}
		<button
			type="button"
			class="toast-close"
			aria-label={t('toast.close')}
			onclick={() => toasts.dismiss(toast.id)}
		>
			<Icon name="close" size={14} />
		</button>
	</div>
{/snippet}

<div class="toaster">
	<div class="toaster-group" role="status" aria-live="polite" aria-atomic="false">
		{#each statusToasts as toast (toast.id)}
			{@render toastItem(toast)}
		{/each}
	</div>
	<div class="toaster-group" role="alert" aria-live="assertive" aria-atomic="true">
		{#each errorToasts as toast (toast.id)}
			{@render toastItem(toast)}
		{/each}
	</div>
</div>
<p class="visually-hidden" aria-live="polite">{toasts.announcement}</p>

<style>
	.toaster {
		position: fixed;
		inset-inline: var(--gutter);
		inset-block-end: calc(var(--tab-bar-h) + var(--space-4) + env(safe-area-inset-bottom, 0px));
		z-index: 60;
		display: grid;
		justify-items: center;
		gap: var(--space-2);
		pointer-events: none;
	}

	.toaster-group {
		display: grid;
		justify-items: center;
		gap: var(--space-2);
	}

	.toaster-group:empty {
		display: none;
	}

	.toast {
		pointer-events: auto;
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		max-inline-size: min(28rem, calc(100dvw - 2 * var(--gutter)));
		padding: var(--space-2) var(--space-2) var(--space-2) var(--space-3);
		font: var(--text-ui);
		color: var(--color-text);
		background: var(--color-surface-1);
		border: 1px solid var(--color-line-strong);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-lg);
	}

	.toast-icon {
		display: inline-flex;
		align-items: center;
		color: var(--color-text-secondary);
		flex: none;
	}

	.toast.is-success {
		border-color: var(--color-ok-border);
		background: var(--color-surface-1);
	}

	.toast.is-success .toast-icon {
		color: var(--color-ok-text);
	}

	.toast.is-error {
		background: var(--color-danger-soft);
		color: var(--color-danger);
		border-color: var(--color-danger-border);
	}

	.toast.is-error .toast-icon {
		color: var(--color-danger);
	}

	.toast-message {
		min-inline-size: 0;
		overflow-wrap: anywhere;
	}

	.toast-action {
		color: var(--color-accent-text);
		font-weight: 600;
		white-space: nowrap;
		text-decoration-color: currentColor;
	}

	.toast.is-error .toast-action {
		color: var(--color-danger);
	}

	.toast-close {
		display: inline-grid;
		place-items: center;
		min-inline-size: 28px;
		min-block-size: 28px;
		padding: 0;
		color: var(--color-text-muted);
		background: transparent;
		border: 0;
		border-radius: var(--radius-xs);
		cursor: pointer;
		flex: none;
		transition:
			background-color var(--dur-fast) var(--ease),
			color var(--dur-fast) var(--ease);
	}

	.toast-close:hover {
		background: var(--color-surface-2);
		color: var(--color-text);
	}

	.toast.is-error .toast-close {
		color: var(--color-danger);
	}

	.toast.is-error .toast-close:hover {
		background: var(--color-danger);
		color: var(--color-on-danger);
	}

	@media (prefers-reduced-motion: no-preference) {
		.toast {
			animation: izgah-toast-enter var(--dur-base) var(--ease);
		}
	}

	@keyframes izgah-toast-enter {
		from {
			opacity: 0;
			translate: 0 6px;
		}
		to {
			opacity: 1;
			translate: 0 0;
		}
	}

	@media (pointer: coarse) {
		.toast-close {
			min-inline-size: 44px;
			min-block-size: 44px;
		}
	}

	@media (forced-colors: active) {
		.toast {
			border: 2px solid CanvasText;
			box-shadow: none;
		}
	}
</style>
