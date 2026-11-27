const NBSP = String.fromCharCode(0xa0);
const AUTO_DISMISS_MS = 6000;

export type ToastTone = 'neutral' | 'success' | 'error' | 'info';
/** Why a toast's auto-dismiss is on hold; each reason is released independently. */
export type ToastHoldReason = 'hover' | 'focus';

export interface Toast {
	id: number;
	message: string;
	tone: ToastTone;
	/** A link (`href`) or an in-page action such as "Undo" (`onClick`, izgah-ui-v5.md §10.3). */
	action?: { label: string; href: string } | { label: string; onClick: () => void };
}

/*
 * Client-only notification state. It is only mutated from browser event handlers, never during
 * SSR, so the module-level instance cannot leak data between server requests.
 */
class ToastState {
	items = $state<Toast[]>([]);
	/** Text for the shared polite live region (re-announced via a trailing NBSP toggle). */
	announcement = $state('');
	#nextId = 1;
	#toggle = false;
	#timers = new Map<number, ReturnType<typeof setTimeout>>();
	#holds = new Map<number, Set<ToastHoldReason>>();

	push(message: string, options: { tone?: ToastTone; action?: Toast['action'] } = {}): void {
		const id = this.#nextId++;
		const toast: Toast = {
			id,
			message,
			tone: options.tone ?? 'neutral',
			...(options.action ? { action: options.action } : {})
		};
		const next = [...this.items, toast];
		if (next.length > 3) {
			const dropped = next.shift();
			if (dropped) {
				this.#clearTimer(dropped.id);
				this.#holds.delete(dropped.id);
			}
		}
		this.items = next;
		this.#scheduleDismiss(id);
	}

	/**
	 * Holds auto-dismiss while the pointer is over the toast or keyboard focus is inside it.
	 * Hover and focus are tracked separately so leaving with the mouse never dismisses a toast that
	 * still has keyboard focus (WCAG 2.2.1), and vice versa.
	 */
	pause(id: number, reason: ToastHoldReason = 'hover'): void {
		const holds = this.#holds.get(id) ?? new Set<ToastHoldReason>();
		holds.add(reason);
		this.#holds.set(id, holds);
		this.#clearTimer(id);
	}

	resume(id: number, reason: ToastHoldReason = 'hover'): void {
		const holds = this.#holds.get(id);
		holds?.delete(reason);
		if (holds && holds.size > 0) {
			return;
		}
		this.#holds.delete(id);
		if (this.items.some((item) => item.id === id)) {
			this.#scheduleDismiss(id);
		}
	}

	dismiss(id: number): void {
		this.#clearTimer(id);
		this.#holds.delete(id);
		this.items = this.items.filter((toast) => toast.id !== id);
	}

	announce(message: string): void {
		this.#toggle = !this.#toggle;
		this.announcement = this.#toggle ? message : `${message}${NBSP}`;
	}

	#scheduleDismiss(id: number): void {
		this.#clearTimer(id);
		const timer = setTimeout(() => {
			this.dismiss(id);
		}, AUTO_DISMISS_MS);
		this.#timers.set(id, timer);
	}

	#clearTimer(id: number): void {
		const timer = this.#timers.get(id);
		if (timer !== undefined) {
			clearTimeout(timer);
			this.#timers.delete(id);
		}
	}
}

export const toasts = new ToastState();
