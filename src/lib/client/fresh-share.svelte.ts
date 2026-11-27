/**
 * The share the viewer just posted (docs/designs/izgah-ui-v5.md §6, "Own new share"): its card
 * briefly takes the accent border when the feed refreshes. Client-only state, set from the
 * composer's success handler.
 */
const FRESH_MS = 2400;

class FreshShare {
	id = $state<string | null>(null);
	#timer: ReturnType<typeof setTimeout> | null = null;

	mark(shareId: string): void {
		this.id = shareId;
		if (this.#timer) {
			clearTimeout(this.#timer);
		}
		this.#timer = setTimeout(() => {
			this.id = null;
			this.#timer = null;
		}, FRESH_MS);
	}
}

export const freshShare = new FreshShare();
