/**
 * Minimal typed i18n for the web app (docs/designs/izgah-i18n-oss.md).
 *
 * - Messages are flat `key → template` maps in `messages/<locale>.ts`; `en` is the source of truth
 *   and `tr` is typed against it, so a missing key fails `pnpm check`.
 * - The active locale is resolved per request on the server (AsyncLocalStorage, registered by
 *   `hooks.server.ts`) and read from `<html lang>` in the browser. A locale change always reloads
 *   the page, so client code never needs reactive message lookups.
 */
import { formatMessage, type MessageParams } from './format';
import { BASE_LOCALE, INTL_LOCALE, toLocale, type Locale } from './locales';
import { en, type MessageKey } from './messages/en';
import { tr } from './messages/tr';

export * from './locales';
export type { MessageKey, MessageParams };

const CATALOGS: Record<Locale, Record<MessageKey, string>> = { en, tr };

type LocaleResolver = () => Locale | undefined;
let serverResolver: LocaleResolver | null = null;

/** Called once by `hooks.server.ts` to read the request-scoped locale. */
export function registerServerLocaleResolver(resolver: LocaleResolver): void {
	serverResolver = resolver;
}

let fallbackLocale: Locale = BASE_LOCALE;

/** Locale used outside a request (CLI, background worker, tests): the instance default. */
export function setFallbackLocale(locale: Locale): void {
	fallbackLocale = locale;
}

export function getLocale(): Locale {
	const fromServer = serverResolver?.();
	if (fromServer) {
		return fromServer;
	}
	if (typeof document !== 'undefined') {
		return toLocale(document.documentElement.lang, fallbackLocale);
	}
	return fallbackLocale;
}

/** BCP 47 tag of the active locale for `Intl` APIs and `toLocale*String` calls. */
export function intlLocale(locale: Locale = getLocale()): string {
	return INTL_LOCALE[locale];
}

/** Translates `key` in the active locale (or `options.locale`). */
export function t(key: MessageKey, params?: MessageParams, options?: { locale?: Locale }): string {
	const locale = options?.locale ?? getLocale();
	const template = CATALOGS[locale][key] ?? en[key] ?? key;
	return formatMessage(locale, template, params);
}

/** Locale-aware integer/decimal formatting (`1,234` / `1.234`). */
export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
	return value.toLocaleString(intlLocale(), options);
}

/** Compact counts such as `19.8K` / `19,8B` (repo stars, large counters). */
export function formatCompactNumber(value: number): string {
	return new Intl.NumberFormat(intlLocale(), {
		notation: 'compact',
		maximumFractionDigits: 1
	}).format(value);
}

/** Locale-aware, case-insensitive comparison for sorting names. */
export function compareText(a: string, b: string): number {
	return a.localeCompare(b, intlLocale(), { sensitivity: 'base' });
}

/** Quotes text for a CSS `content` custom property (`style:--label={cssText(t('…'))}`). */
export function cssText(text: string): string {
	return JSON.stringify(text);
}
