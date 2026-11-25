/**
 * Platform-aware keyboard modifier labels shared by SSR and the client.
 *
 * The label is derived on the server from the request (`Sec-CH-UA-Platform` when the browser sends
 * it, otherwise the User-Agent) so the first paint already shows `⌘` on Apple platforms and `Ctrl`
 * everywhere else, without a hydration flicker.
 */
export type ModifierKey = 'meta' | 'ctrl';

const APPLE_PLATFORM_PATTERN = /mac|iphone|ipad|ipod/i;

export function detectModifierKey(headers: { get(name: string): string | null }): ModifierKey {
	const hintPlatform = headers.get('sec-ch-ua-platform')?.replace(/"/g, '').trim();
	if (hintPlatform) {
		return APPLE_PLATFORM_PATTERN.test(hintPlatform) ? 'meta' : 'ctrl';
	}
	const userAgent = headers.get('user-agent') ?? '';
	return APPLE_PLATFORM_PATTERN.test(userAgent) ? 'meta' : 'ctrl';
}

/** Visible label for the platform's primary modifier (`⌘` or `Ctrl`). */
export function modifierLabel(key: ModifierKey): string {
	return key === 'meta' ? '⌘' : 'Ctrl';
}

/** Visible chord such as `⌘K` or `Ctrl+K`. */
export function shortcutLabel(key: ModifierKey, letter: string): string {
	return key === 'meta' ? `⌘${letter}` : `Ctrl+${letter}`;
}
