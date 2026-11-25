import { msg } from './i18n';
interface CommandLikeEvent extends Event {
	command?: string;
	source?: HTMLElement | null;
}

export interface WireRequestIdCopyOptions {
	feedbackDurationMs?: number;
}

/**
 * Wires requestId clipboard copy buttons inside a container using native Invoker Commands
 * (`command="--copy"` + `commandfor`) with a fallback click handler when `CommandEvent` is absent.
 */
export function wireRequestIdCopy(
	container: HTMLElement,
	options: WireRequestIdCopyOptions = {}
): () => void {
	const feedbackDurationMs = options.feedbackDurationMs ?? 2200;
	const doc = container.ownerDocument;
	const win = doc.defaultView;
	const supportsCommandEvent = Boolean(win && 'CommandEvent' in win);

	let lastMessage = '';
	let hideTimer: ReturnType<typeof globalThis.setTimeout> | null = null;

	function findFeedbackEl(button: HTMLElement): HTMLElement | null {
		return (
			button.parentElement?.querySelector<HTMLElement>('[role="status"]') ??
			container.querySelector<HTMLElement>('.copy-feedback')
		);
	}

	async function performCopy(button: HTMLElement, sourceEl: HTMLElement) {
		const text = sourceEl.textContent?.trim() ?? '';
		if (text === '') {
			return;
		}

		let copied = false;
		try {
			const clipboard = globalThis.navigator?.clipboard;
			if (!clipboard?.writeText) {
				throw new Error('Clipboard API is unavailable.');
			}
			await clipboard.writeText(text);
			copied = true;
		} catch {
			copied = false;
		}

		if (hideTimer !== null) {
			globalThis.clearTimeout(hideTimer);
			hideTimer = null;
		}

		button.removeAttribute('data-copied');
		button.removeAttribute('data-failed');
		button.setAttribute(copied ? 'data-copied' : 'data-failed', '');

		let nextMessage = copied ? msg('copied') : msg('copyFailed');
		if (nextMessage === lastMessage) {
			nextMessage = `${nextMessage}\u00A0`;
		}
		lastMessage = nextMessage;

		const feedbackEl = findFeedbackEl(button);
		if (feedbackEl) {
			feedbackEl.textContent = nextMessage;
			feedbackEl.classList.add('is-visible');
		}

		hideTimer = globalThis.setTimeout(() => {
			hideTimer = null;
			button.removeAttribute('data-copied');
			button.removeAttribute('data-failed');
			if (feedbackEl) {
				feedbackEl.classList.remove('is-visible');
				feedbackEl.textContent = '';
			}
		}, feedbackDurationMs);
	}

	if (supportsCommandEvent) {
		const handleCommand = (event: Event) => {
			const cmdEvent = event as CommandLikeEvent;
			if (cmdEvent.command !== '--copy') {
				return;
			}

			const targetEl = event.target as HTMLElement | null;
			if (!targetEl) {
				return;
			}

			const button =
				cmdEvent.source ??
				(targetEl.id
					? container.querySelector<HTMLButtonElement>(
							`button[command="--copy"][commandfor="${targetEl.id}"]`
						)
					: null);
			if (!button) {
				return;
			}

			event.stopImmediatePropagation();
			void performCopy(button, targetEl);
		};

		container.addEventListener('command', handleCommand, true);
		return () => {
			if (hideTimer !== null) {
				globalThis.clearTimeout(hideTimer);
			}
			container.removeEventListener('command', handleCommand, true);
		};
	}

	const handleFallbackClick = (event: MouseEvent) => {
		const target = event.target as HTMLElement | null;
		const button = target?.closest<HTMLButtonElement>('button[command="--copy"]');
		if (!button || !container.contains(button)) {
			return;
		}

		const sourceId = button.getAttribute('commandfor')?.trim() ?? '';
		if (sourceId === '') {
			return;
		}

		const sourceEl = doc.getElementById(sourceId);
		if (sourceEl) {
			void performCopy(button, sourceEl);
		}
	};

	container.addEventListener('click', handleFallbackClick);
	return () => {
		if (hideTimer !== null) {
			globalThis.clearTimeout(hideTimer);
		}
		container.removeEventListener('click', handleFallbackClick);
	};
}
