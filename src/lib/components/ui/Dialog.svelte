<script lang="ts">
	import { t } from '#lib/i18n/index.ts';
	import { tick, type Snippet } from 'svelte';

	interface Props {
		open?: boolean;
		id?: string;
		titleId: string;
		dirty?: boolean;
		guardUnsaved?: boolean;
		closedby?: 'any' | 'closerequest' | 'none';
		class?: string;
		onClose?: (reason: string) => void;
		onDiscard?: () => void;
		children: Snippet<
			[{ requestClose: (reason?: string) => void; closeNow: (reason?: string) => void }]
		>;
	}

	let {
		open = $bindable(false),
		id,
		titleId,
		dirty = false,
		guardUnsaved = false,
		closedby = 'closerequest',
		class: className = '',
		onClose,
		onDiscard,
		children
	}: Props = $props();

	const rawInstanceId = $props.id();
	const instanceId = rawInstanceId.replace(/[^a-zA-Z0-9_-]/g, '-');
	const discardMessageId = $derived(`${id ?? `dialog-${instanceId}`}-discard-msg`);

	let dialogEl = $state<HTMLDialogElement | null>(null);
	let continueButtonEl = $state<HTMLButtonElement | null>(null);
	let confirmingDiscard = $state(false);

	const effectiveClosedBy = $derived<'any' | 'closerequest' | 'none'>(
		confirmingDiscard ? 'none' : dirty && closedby === 'any' ? 'closerequest' : closedby
	);

	function closeNow(reason = ''): void {
		confirmingDiscard = false;
		if (dialogEl?.open) {
			dialogEl.close(reason);
		} else {
			open = false;
		}
	}

	function revealDiscardConfirmation(): void {
		confirmingDiscard = true;
		void tick().then(() => {
			continueButtonEl?.focus();
		});
	}

	function requestClose(reason = 'cancel'): void {
		if (dirty && !confirmingDiscard) {
			revealDiscardConfirmation();
			return;
		}
		if (confirmingDiscard && dirty) {
			onDiscard?.();
		}
		closeNow(reason);
	}

	function handleCancel(event: Event): void {
		if (dirty && !confirmingDiscard) {
			event.preventDefault();
			revealDiscardConfirmation();
		}
	}

	function handleClose(): void {
		const el = dialogEl;
		const reason = el?.returnValue ?? '';
		if (el) {
			el.returnValue = '';
		}
		confirmingDiscard = false;
		open = false;
		onClose?.(reason);
	}

	function handleContinueEditing(): void {
		confirmingDiscard = false;
	}

	function handleConfirmDiscard(): void {
		confirmingDiscard = false;
		onDiscard?.();
		closeNow('discard');
	}

	$effect(() => {
		const el = dialogEl;
		if (!el) {
			return;
		}

		if (open && !el.open) {
			confirmingDiscard = false;
			el.showModal();
		} else if (!open && el.open) {
			confirmingDiscard = false;
			el.close();
		}
	});

	$effect(() => {
		const el = dialogEl;
		// Hide the discard prompt once the form is clean again (or the dialog closed). F12: the old
		// condition reset it whenever the form was dirty, i.e. the opposite case.
		if (!el || !open || !dirty) {
			confirmingDiscard = false;
			return;
		}
	});

	$effect(() => {
		const el = dialogEl;
		if (!el || effectiveClosedBy !== 'any' || 'closedBy' in HTMLDialogElement.prototype) {
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
				requestClose('dismiss');
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
</script>

<dialog
	bind:this={dialogEl}
	{id}
	class="izgah-dialog {className}"
	closedby={effectiveClosedBy}
	aria-labelledby={titleId}
	oncancel={handleCancel}
	onclose={handleClose}
>
	{@render children({ requestClose, closeNow })}

	{#if guardUnsaved}
		<div
			class="discard-guard"
			class:is-visible={confirmingDiscard}
			aria-hidden={!confirmingDiscard}
			inert={!confirmingDiscard}
		>
			<p id={discardMessageId} class="discard-warning">
				{t('dialog.unsaved')}
			</p>
			<div class="discard-actions">
				<button type="button" class="discard-confirm-btn" onclick={handleConfirmDiscard}>
					{t('dialog.discard')}
				</button>
				<button
					bind:this={continueButtonEl}
					type="button"
					class="discard-cancel-btn"
					aria-describedby={discardMessageId}
					onclick={handleContinueEditing}
				>
					{t('dialog.keepEditing')}
				</button>
			</div>
		</div>
	{/if}
</dialog>

<style>
	.discard-guard {
		display: none;
		margin-block-start: var(--space-4);
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--k-color-warn-border);
		border-radius: var(--k-radius-md);
		background: var(--k-color-warn-soft);
		color: var(--k-color-warn-text);
		gap: var(--space-3);
	}

	.discard-guard.is-visible {
		display: grid;
	}

	.discard-warning {
		margin: 0;
		font: var(--k-text-ui);
		font-weight: 600;
	}

	.discard-actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: var(--space-2);
	}

	.discard-confirm-btn,
	.discard-cancel-btn {
		font: var(--k-text-ui);
		font-weight: 600;
		min-block-size: 36px;
		padding: 0 var(--space-4);
		border-radius: var(--k-radius-sm);
		cursor: pointer;
	}

	.discard-confirm-btn {
		border: 1px solid var(--k-color-danger);
		background: var(--k-color-danger);
		color: var(--k-color-on-danger);
	}

	.discard-cancel-btn {
		border: 1px solid var(--k-color-line-strong);
		background: var(--k-color-surface-1);
		color: var(--k-color-text);
	}

	@media (pointer: coarse) {
		.discard-confirm-btn,
		.discard-cancel-btn {
			min-block-size: 44px;
		}
	}
</style>
