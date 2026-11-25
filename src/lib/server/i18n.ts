import { AsyncLocalStorage } from 'node:async_hooks';
import {
	LOCALE_COOKIE,
	registerServerLocaleResolver,
	setFallbackLocale,
	toLocale,
	type Locale
} from '#lib/i18n/index.ts';
import { env } from '#lib/server/env.ts';

/**
 * Request-scoped locale (docs/designs/izgah-i18n-oss.md §2): `hooks.server.ts` runs each request
 * inside `runWithLocale`, so `t()` anywhere on the server — form actions, services, API errors,
 * SSR — uses the member's language without passing it around.
 */
const localeStore = new AsyncLocalStorage<Locale>();

registerServerLocaleResolver(() => localeStore.getStore());
setFallbackLocale(env.DEFAULT_LOCALE);

export function runWithLocale<T>(locale: Locale, fn: () => T): T {
	return localeStore.run(locale, fn);
}

/** Member choice from the `izgah_locale` cookie, otherwise the instance default. */
export function resolveRequestLocale(cookies: { get(name: string): string | undefined }): Locale {
	return toLocale(cookies.get(LOCALE_COOKIE), env.DEFAULT_LOCALE);
}
