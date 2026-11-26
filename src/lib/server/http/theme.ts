import {
	colorSchemeFor,
	DARK_THEME_VALUES,
	DEFAULT_EFFECTS,
	DEFAULT_PALETTE,
	EFFECT_VALUES,
	LIGHT_THEME_VALUES,
	pickAllowed,
	THEME_VALUES,
	type EffectLevel,
	type Palette,
	type ThemePreference
} from '#lib/types/appearance.ts';

export { EFFECT_VALUES, THEME_VALUES, type ThemePreference } from '#lib/types/appearance.ts';

export const THEME_COOKIE = 'izgah_theme';

/** Effect level cookie (docs/designs/izgah-ui-v5.md §7). */
export const EFFECTS_COOKIE = 'izgah_effects';

/** Only whitelisted values reach `<html data-effects>`. */
export function parseEffectLevel(raw: string | null | undefined): EffectLevel {
	return pickAllowed(EFFECT_VALUES, raw, DEFAULT_EFFECTS);
}

/** One cookie per palette field (docs/designs/izgah-themes.md §3). */
export const PALETTE_COOKIES = {
	lightTheme: 'izgah_theme_light',
	darkTheme: 'izgah_theme_dark'
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
		)
	};
}

/** Fills the appearance placeholders of src/app.html (first occurrence of each only). */
export function fillAppearancePlaceholders(
	html: string,
	theme: ThemePreference,
	palette: Palette,
	effects: EffectLevel = DEFAULT_EFFECTS
): string {
	return html
		.replace('%izgah.theme%', () => theme)
		.replace('%izgah.effects%', () => effects)
		.replace('%izgah.colorScheme%', () => colorSchemeFor(theme))
		.replace('%izgah.lightTheme%', () => palette.lightTheme)
		.replace('%izgah.darkTheme%', () => palette.darkTheme);
}

const PRELOADED_FONT_PATTERN = /geist-latin(?:-ext)?-wght-normal/;

/**
 * Preloads the Geist normal woff2 files Turkish pages always need (latin for ı, latin-ext for
 * ğ ş İ Ğ Ş); italic subsets load on demand through unicode-range (docs/designs/izgah-ui-v5.md §3.2).
 */
export function shouldPreload({ type, path }: { type: string; path: string }): boolean {
	if (type === 'js' || type === 'css') {
		return true;
	}
	return type === 'font' && PRELOADED_FONT_PATTERN.test(path);
}
