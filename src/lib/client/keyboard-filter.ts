export const SHORTCUT_KEYS = ['j', 'k', 'o', 'Enter', 'l', 'c', '/', 'n', '?'] as const;
export type ShortcutKey = (typeof SHORTCUT_KEYS)[number];

export interface ShortcutEventLike {
	key: string;
	ctrlKey: boolean;
	metaKey: boolean;
	altKey: boolean;
	shiftKey: boolean;
	isComposing?: boolean;
	keyCode?: number;
	defaultPrevented: boolean;
	target: EventTarget | null;
}

export interface ShortcutContext {
	enabled: boolean;
	/** A modal dialog or an open popover is present. */
	overlayOpen: boolean;
}

const LETTER_SHORTCUTS = new Set(['j', 'k', 'o', 'l', 'c', 'n']);

function isEditableTarget(target: EventTarget | null): boolean {
	if (!target || typeof (target as Element).closest !== 'function') {
		return false;
	}
	const element = target as HTMLElement;
	if (element.isContentEditable) {
		return true;
	}
	return Boolean(
		element.closest(
			'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"]), textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"]'
		)
	);
}

/**
 * Normalizes a keydown into an app shortcut (docs/designs/izgah-ui-v2.md §8.2) or null.
 * Matches on `event.key` so Turkish Q/F layouts work; Shift is allowed because `/` (Shift+7) and
 * `?` (Shift+*) need it on Turkish Q, but letters typed with Shift are ignored. Caps Lock letters
 * (uppercase without Shift) are lowered.
 */
export function resolveShortcut(
	event: ShortcutEventLike,
	context: ShortcutContext
): ShortcutKey | null {
	if (!context.enabled || context.overlayOpen) {
		return null;
	}
	if (event.defaultPrevented || event.isComposing || event.keyCode === 229) {
		return null;
	}
	if (event.ctrlKey || event.metaKey || event.altKey) {
		return null;
	}
	if (isEditableTarget(event.target)) {
		return null;
	}

	let key = event.key;
	if (key.length === 1 && key !== key.toLowerCase()) {
		// Uppercase letter: with Shift it is a different key; without Shift it is Caps Lock.
		if (event.shiftKey) {
			return null;
		}
		key = key.toLowerCase();
	}
	if (LETTER_SHORTCUTS.has(key) && event.shiftKey) {
		return null;
	}
	return (SHORTCUT_KEYS as readonly string[]).includes(key) ? (key as ShortcutKey) : null;
}
