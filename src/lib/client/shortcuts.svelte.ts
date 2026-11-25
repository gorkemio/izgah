import { getContext, setContext } from 'svelte';

const STORAGE_KEY = 'izgah:shortcuts';
const CONTEXT_KEY = Symbol('izgah.shortcut-preference');

/**
 * Per-device single-key shortcut switch (docs/designs/izgah-ui-v2.md §8.2, WCAG 2.1.4).
 * Stored in localStorage only (Karar 5) and mirrored to `html[data-shortcuts]` so CSS can hide
 * the `kbd` hints. Hints stay hidden until `load()` runs after hydration.
 */
export class ShortcutPreference {
	enabled = $state(true);

	load(): void {
		try {
			this.enabled = localStorage.getItem(STORAGE_KEY) !== 'off';
		} catch {
			this.enabled = true;
		}
		this.#apply();
	}

	set(enabled: boolean): void {
		this.enabled = enabled;
		try {
			localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
		} catch {
			// Storage unavailable (private mode, quota): the choice lasts for this page only.
		}
		this.#apply();
	}

	#apply(): void {
		document.documentElement.dataset.shortcuts = this.enabled ? 'on' : 'off';
	}
}

export function setShortcutPreference(preference: ShortcutPreference): ShortcutPreference {
	return setContext(CONTEXT_KEY, preference);
}

export function getShortcutPreference(): ShortcutPreference | undefined {
	return getContext<ShortcutPreference | undefined>(CONTEXT_KEY);
}

function readCssPx(name: string): number {
	const parsed = Number.parseFloat(
		getComputedStyle(document.documentElement).getPropertyValue(name).trim()
	);
	return Number.isFinite(parsed) ? parsed : 0;
}

/** Posts on the current page, in document order. */
export function listPosts(): HTMLElement[] {
	return Array.from(document.querySelectorAll<HTMLElement>('#main-content [data-post]'));
}

/** The post that contains focus, if any. */
export function focusedPost(): HTMLElement | null {
	const active = document.activeElement;
	return active instanceof Element ? active.closest<HTMLElement>('[data-post]') : null;
}

function focusAndReveal(element: HTMLElement): void {
	element.focus({ preventScroll: true });
	// scrollIntoView honours scroll-padding, so sticky bars never cover the target (WCAG 2.4.11).
	element.scrollIntoView({ block: 'nearest' });
}

/**
 * `j` / `k`: moves focus to the next / previous post. Without a focused post it starts at the
 * first post below the sticky bars. On the last post `j` focuses "Daha fazla yükle" and never
 * loads by itself. Returns false when the page has no posts.
 */
export function movePostFocus(direction: 1 | -1): boolean {
	const posts = listPosts();
	if (posts.length === 0) {
		return false;
	}
	const current = focusedPost();
	const index = current ? posts.indexOf(current) : -1;
	if (index === -1) {
		const top = readCssPx('--sticky-top');
		const firstVisible = posts.find((post) => post.getBoundingClientRect().bottom > top + 1);
		focusAndReveal(firstVisible ?? posts[0]);
		return true;
	}
	const next = posts[index + direction];
	if (next) {
		focusAndReveal(next);
		return true;
	}
	if (direction === 1) {
		const loadMore = document.querySelector<HTMLElement>('#main-content .load-more');
		if (loadMore) {
			focusAndReveal(loadMore);
		}
	}
	return true;
}
