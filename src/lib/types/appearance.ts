/*
 * Client-safe appearance values (docs/designs/izgah-themes.md). The server whitelists cookie values
 * against these lists before writing them into <html>; the settings UI renders the same options.
 */
export const THEME_VALUES = ['light', 'dark', 'system'] as const;
export type ThemePreference = (typeof THEME_VALUES)[number];

/** `<meta name="color-scheme">` content for a mode: tells the browser the canvas colour early. */
export function colorSchemeFor(theme: ThemePreference): string {
	return theme === 'system' ? 'light dark' : theme;
}

export const LIGHT_THEME_VALUES = ['default', 'contrast'] as const;
export type LightTheme = (typeof LIGHT_THEME_VALUES)[number];

/**
 * Künye (docs/designs/izgah-ui-v4.md §1, §8): one accent (link blue) and no "dim" palette. Old
 * `dim` and accent cookies fall back to the defaults through `pickAllowed`.
 */
export const DARK_THEME_VALUES = ['default', 'contrast'] as const;
export type DarkTheme = (typeof DARK_THEME_VALUES)[number];

export interface Palette {
	lightTheme: LightTheme;
	darkTheme: DarkTheme;
}

export const DEFAULT_PALETTE: Palette = {
	lightTheme: 'default',
	darkTheme: 'default'
};

/**
 * Effect level (docs/designs/izgah-ui-v5.md §7): "reduced" turns off glass, glow, particles and
 * motion. System settings (reduced motion, transparency, contrast) reduce effects regardless.
 */
export const EFFECT_VALUES = ['full', 'reduced'] as const;
export type EffectLevel = (typeof EFFECT_VALUES)[number];
export const DEFAULT_EFFECTS: EffectLevel = 'full';

/** Returns `raw` when it is one of `values`, otherwise `fallback`. */
export function pickAllowed<T extends string>(values: readonly T[], raw: unknown, fallback: T): T {
	return typeof raw === 'string' && (values as readonly string[]).includes(raw)
		? (raw as T)
		: fallback;
}

/** Strict variant for form input: `null` when the value is missing or not whitelisted. */
export function parseAllowed<T extends string>(values: readonly T[], raw: unknown): T | null {
	return typeof raw === 'string' && (values as readonly string[]).includes(raw) ? (raw as T) : null;
}
