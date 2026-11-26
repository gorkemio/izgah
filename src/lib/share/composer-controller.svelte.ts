import { getContext, setContext } from 'svelte';

export interface ComposerPrefill {
	url: string;
	note: string | null;
}

export interface InlineComposerHandle {
	element: HTMLElement;
	focus(): void;
	fill(prefill: ComposerPrefill): void;
}

const CONTEXT_KEY = Symbol('izgah.composer-controller');

function readCssPx(name: string): number {
	const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
	const parsed = Number.parseFloat(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Routes every share trigger (rail and tab bar "Add a link", `n`, paste, drop) to one target
 * (docs/designs/izgah-ui-v2.md §8.1, Karar 1): the feed's inline form when it is completely inside
 * the visible area, otherwise the <dialog>. Visibility is measured synchronously at trigger time.
 */
export class ComposerController {
	#inline: InlineComposerHandle | null = null;
	dialogOpen = $state(false);
	dialogPrefill = $state<(ComposerPrefill & { seq: number }) | null>(null);
	#seq = 0;

	registerInline(handle: InlineComposerHandle): () => void {
		this.#inline = handle;
		return () => {
			if (this.#inline === handle) {
				this.#inline = null;
			}
		};
	}

	#inlineFullyVisible(): boolean {
		if (!this.#inline || !this.#inline.element.isConnected) {
			return false;
		}
		const rect = this.#inline.element.getBoundingClientRect();
		const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
		const top = readCssPx('--sticky-top');
		const bottom = viewportHeight - readCssPx('--tab-bar-h');
		return rect.height > 0 && rect.top >= top && rect.bottom <= bottom;
	}

	open(prefill?: ComposerPrefill): 'inline' | 'dialog' {
		if (this.#inline && this.#inlineFullyVisible()) {
			if (prefill) {
				this.#inline.fill(prefill);
			} else {
				this.#inline.focus();
			}
			return 'inline';
		}
		if (prefill) {
			this.#seq += 1;
			this.dialogPrefill = { ...prefill, seq: this.#seq };
		}
		this.dialogOpen = true;
		return 'dialog';
	}
}

export function setComposerController(controller: ComposerController): ComposerController {
	return setContext(CONTEXT_KEY, controller);
}

export function getComposerController(): ComposerController | undefined {
	return getContext<ComposerController | undefined>(CONTEXT_KEY);
}
