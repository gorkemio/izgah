import { browser } from 'wxt/browser';
import enMessages from '../../public/_locales/en/messages.json';
import trMessages from '../../public/_locales/tr/messages.json';

/**
 * WebExtension i18n (docs/designs/izgah-i18n-oss.md §7). Strings live in
 * `public/_locales/<locale>/messages.json`; the browser picks the language. The bundled catalogs are
 * only a fallback for environments without `browser.i18n` (unit tests, some Safari contexts).
 */
type Catalog = Record<string, { message: string }>;

const CATALOGS: Record<string, Catalog> = { en: enMessages, tr: trMessages };

declare global {
	// Unit tests set this to run against a specific catalog.
	var __IZGAH_EXTENSION_LOCALE__: string | undefined;
}

function fallbackLocale(): string {
	return globalThis.__IZGAH_EXTENSION_LOCALE__ ?? 'en';
}

function substitute(template: string, substitutions: readonly string[]): string {
	return template.replace(
		/\$(\d)/g,
		(match, index: string) => substitutions[Number(index) - 1] ?? match
	);
}

/** Localized message for `key`; `$1`…`$9` are replaced with `substitutions`. */
export function msg(key: string, ...substitutions: Array<string | number>): string {
	const subs = substitutions.map(String);
	if (globalThis.__IZGAH_EXTENSION_LOCALE__ === undefined) {
		try {
			// Keys are checked at build time by the catalogs; the API types only know a fixed list.
			const value = browser.i18n?.getMessage(
				key as Parameters<typeof browser.i18n.getMessage>[0],
				subs
			);
			if (value) {
				return value;
			}
		} catch {
			// Fall through to the bundled catalog.
		}
	}
	const english: Catalog = enMessages;
	const catalog: Catalog = CATALOGS[fallbackLocale()] ?? english;
	const entry = catalog[key] ?? english[key];
	return entry ? substitute(entry.message, subs) : key;
}

/** UI language code (`en`, `tr`, …) for `<html lang>` and `Intl` formatting. */
export function uiLanguage(): string {
	if (globalThis.__IZGAH_EXTENSION_LOCALE__ !== undefined) {
		return globalThis.__IZGAH_EXTENSION_LOCALE__;
	}
	try {
		return browser.i18n?.getUILanguage?.() || 'en';
	} catch {
		return 'en';
	}
}

/**
 * Translates static markup: `data-i18n="key"` sets the text, and
 * `data-i18n-attr="placeholder:key aria-label:key"` sets attributes.
 */
export function localizeDocument(doc: Document): void {
	doc.documentElement.lang = uiLanguage().split('-')[0] || 'en';
	for (const el of doc.querySelectorAll<HTMLElement>('[data-i18n]')) {
		el.textContent = msg(el.dataset.i18n ?? '');
	}
	for (const el of doc.querySelectorAll<HTMLElement>('[data-i18n-attr]')) {
		for (const pair of (el.dataset.i18nAttr ?? '').split(/\s+/).filter(Boolean)) {
			const [attr, key] = pair.split(':');
			if (attr && key) {
				el.setAttribute(attr, msg(key));
			}
		}
	}
	const title = doc.querySelector<HTMLTitleElement>('title[data-i18n-title]');
	if (title) {
		doc.title = msg(title.dataset.i18nTitle ?? '');
	}
}
