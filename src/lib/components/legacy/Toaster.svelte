<script lang="ts">
	import { t } from '#lib/i18n/index.ts';
	import { toasts, type Toast } from '#lib/client/toast.svelte.ts';

	const statusToasts = $derived(toasts.items.filter((item) => item.tone !== 'error'));
	const errorToasts = $derived(toasts.items.filter((item) => item.tone === 'error'));
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
			{t('common.close')}
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
		font: var(--k-text-ui);
		color: var(--k-color-text);
		background: var(--k-color-surface-1);
		border: 1px solid var(--k-color-line-strong);
		border-radius: var(--k-radius-md);
		box-shadow: var(--k-shadow-lg);
	}

	.toast.is-success {
		border-color: var(--k-color-ok-border);
		background: var(--k-color-surface-1);
	}

	.toast.is-error {
		background: var(--k-color-danger-soft);
		color: var(--k-color-danger);
		border-color: var(--k-color-danger-border);
	}

	.toast-message {
		min-inline-size: 0;
		overflow-wrap: anywhere;
	}

	.toast-action {
		color: var(--k-color-accent-text);
		font-weight: 600;
		white-space: nowrap;
		text-decoration-color: currentColor;
	}

	.toast.is-error .toast-action {
		color: var(--k-color-danger);
	}

	/* Close as a word (izgah-ui-v4 §1): the visible label sits inside the accessible name. */
	.toast-close {
		flex: none;
		min-block-size: 28px;
		padding: 0 var(--space-1);
		font: var(--k-text-hint);
		color: var(--k-color-text-secondary);
		background: transparent;
		border: 0;
		text-decoration: underline;
		text-decoration-color: var(--k-color-line-strong);
		text-underline-offset: 0.2em;
		cursor: pointer;
	}

	.toast-close:hover {
		color: var(--k-color-text);
		text-decoration-color: currentColor;
	}

	.toast.is-error .toast-close {
		color: var(--k-color-danger);
		text-decoration-color: currentColor;
	}

	@media (pointer: coarse) {
		.toast-close {
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
