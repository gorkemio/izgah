/**
 * Per-instance settings shared by server and browser (docs/designs/izgah-i18n-oss.md §6).
 *
 * The server registers the values from the environment once (`#lib/server/env.ts`) and writes them
 * into `src/app.html` (`<html data-tz data-source>`, `<meta name="application-name">`), so the browser reads the
 * same values back without extra page data. Defaults apply outside a configured server (tests).
 */
export const DEFAULT_INSTANCE_NAME = 'Izgah';
export const DEFAULT_TIME_ZONE = 'UTC';
export const DEFAULT_SOURCE_URL = 'https://github.com/gorkemio/izgah';

export interface InstanceConfig {
	name: string;
	timeZone: string;
	sourceUrl: string;
}

let serverConfig: InstanceConfig | null = null;

export function registerServerInstanceConfig(config: InstanceConfig): void {
	serverConfig = config;
}

function readDocument<T>(read: (doc: Document) => T | null | undefined): T | null {
	if (typeof document === 'undefined') {
		return null;
	}
	return read(document) ?? null;
}

/** Display name of this instance (wordmark, sign-in page, `<title>` suffix). */
export function instanceName(): string {
	return (
		serverConfig?.name ??
		readDocument((doc) =>
			doc.querySelector<HTMLMetaElement>('meta[name="application-name"]')?.content.trim()
		) ??
		DEFAULT_INSTANCE_NAME
	);
}

/** IANA time zone used for every user-facing date and for "today" boundaries. */
export function appTimeZone(): string {
	return (
		serverConfig?.timeZone ??
		readDocument((doc) => doc.documentElement.dataset.tz) ??
		DEFAULT_TIME_ZONE
	);
}

/** Public source code location (AGPL-3.0 §13 notice in Settings). */
export function sourceUrl(): string {
	return (
		serverConfig?.sourceUrl ??
		readDocument((doc) => doc.documentElement.dataset.source) ??
		DEFAULT_SOURCE_URL
	);
}

/** True when `zone` is an IANA time zone this runtime understands. */
export function isValidTimeZone(zone: string): boolean {
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: zone });
		return true;
	} catch {
		return false;
	}
}

/** Browser tab title: "Feed — Izgah". */
export function pageTitle(label: string): string {
	return `${label} — ${instanceName()}`;
}
