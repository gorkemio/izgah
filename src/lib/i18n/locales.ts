/**
 * Supported UI locales (docs/designs/izgah-i18n-oss.md). English is the base locale: every key
 * must exist in `messages/en.ts`, and the type system forces every other locale to match it.
 */
export const LOCALES = ['en', 'tr'] as const;
export type Locale = (typeof LOCALES)[number];
export const BASE_LOCALE: Locale = 'en';
/** Cookie that stores a member's explicit language choice (same pattern as the theme cookie). */
export const LOCALE_COOKIE = 'izgah_locale';

/** BCP 47 tags passed to `Intl` formatters. */
export const INTL_LOCALE: Record<Locale, string> = {
	en: 'en-US',
	tr: 'tr-TR'
};

/** Native names shown in the language picker, so each option is readable by its speakers. */
export const LOCALE_NATIVE_NAMES: Record<Locale, string> = {
	en: 'English',
	tr: 'Türkçe'
};

export function isLocale(value: unknown): value is Locale {
	return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** Resolves a raw value (cookie, env, `<html lang>`) to a supported locale or `fallback`. */
export function toLocale(value: unknown, fallback: Locale = BASE_LOCALE): Locale {
	if (typeof value !== 'string') {
		return fallback;
	}
	const normalized = value.trim().toLowerCase().split(/[-_]/)[0];
	return isLocale(normalized) ? normalized : fallback;
}
