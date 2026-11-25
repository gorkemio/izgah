import {
	ACCENT_VALUES,
	colorSchemeFor,
	DARK_THEME_VALUES,
	DEFAULT_PALETTE,
	LIGHT_THEME_VALUES,
	pickAllowed,
	THEME_VALUES,
	type Palette,
	type ThemePreference
} from '#lib/types/appearance.ts';

export { THEME_VALUES, type ThemePreference } from '#lib/types/appearance.ts';

export const THEME_COOKIE = 'izgah_theme';

/** One cookie per palette field (docs/designs/izgah-themes.md §3). */
export const PALETTE_COOKIES = {
	lightTheme: 'izgah_theme_light',
	darkTheme: 'izgah_theme_dark',
	accent: 'izgah_accent'
} as const satisfies Record<keyof Palette, string>;

/** Only whitelisted values ever reach the HTML (the cookie value is written into `<html>`). */
export function parseThemePreference(raw: string | null | undefined): ThemePreference {
	return pickAllowed(THEME_VALUES, raw, 'system');
}

/** Reads the palette cookies; missing or unknown values fall back to the defaults. */
export function parsePalette(getCookie: (name: string) => string | undefined): Palette {
	return {
		lightTheme: pickAllowed(
			LIGHT_THEME_VALUES,
			getCookie(PALETTE_COOKIES.lightTheme),
			DEFAULT_PALETTE.lightTheme
		),
		darkTheme: pickAllowed(
			DARK_THEME_VALUES,
			getCookie(PALETTE_COOKIES.darkTheme),
			DEFAULT_PALETTE.darkTheme
		),
		accent: pickAllowed(ACCENT_VALUES, getCookie(PALETTE_COOKIES.accent), DEFAULT_PALETTE.accent)
	};
}

/** Fills the appearance placeholders of src/app.html (first occurrence of each only). */
export function fillAppearancePlaceholders(
	html: string,
	theme: ThemePreference,
	palette: Palette
): string {
	return html
		.replace('%izgah.theme%', () => theme)
		.replace('%izgah.colorScheme%', () => colorSchemeFor(theme))
		.replace('%izgah.lightTheme%', () => palette.lightTheme)
		.replace('%izgah.darkTheme%', () => palette.darkTheme)
		.replace('%izgah.accent%', () => palette.accent);
}

const PRELOADED_FONT_PATTERN =
	/geist-latin(?:-ext)?-wght-normal|newsreader-latin(?:-ext)?-opsz-normal/;

/**
 * Preloads the Geist and Newsreader normal woff2 files Turkish pages always need (latin for ı,
 * latin-ext for ğ ş İ Ğ Ş); mono and italic subsets load on demand through unicode-range.
 */
export function shouldPreload({ type, path }: { type: string; path: string }): boolean {
	if (type === 'js' || type === 'css') {
		return true;
	}
	return type === 'font' && PRELOADED_FONT_PATTERN.test(path);
}
