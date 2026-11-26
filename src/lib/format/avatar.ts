/**
 * Initials avatars (docs/designs/izgah-ui-v5.md §3.6): up to two letters from a member's name and a
 * stable tone (`avatar-1` … `avatar-8`) chosen from their id, so a member keeps the same colour.
 */
export const AVATAR_TONES = 8;

/** "Priya Nair" → "PN", "maya" → "M"; locale-aware upper case so "ılgaz" → "I" in Turkish. */
export function initials(name: string, locale = 'tr'): string {
	const words = name.trim().split(/\s+/u).filter(Boolean);
	const letters =
		words.length >= 2 ? [words[0], words[words.length - 1]] : words.slice(0, 1).map((w) => w);
	return letters
		.map((word) => Array.from(word)[0] ?? '')
		.join('')
		.toLocaleUpperCase(locale);
}

/** A tone from 1 to AVATAR_TONES, stable for the same id. */
export function avatarTone(id: string): number {
	let hash = 0;
	for (const char of id) {
		hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
	}
	return (hash % AVATAR_TONES) + 1;
}
