import { MAX_URL_LENGTH } from './types';
import { msg } from './i18n';

export type UrlResult = { ok: true; value: string } | { ok: false; message: string };

const LOCAL_HTTP_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Validates and strips path, query, and hash from a configured Izgah server URL.
 * Allows plain http:// only on loopback hostnames for local development/testing.
 */
export function normalizeServerOrigin(rawInput: string): UrlResult {
	const trimmed = rawInput.trim();
	if (trimmed === '') {
		return {
			ok: false,
			message: msg('originEmpty')
		};
	}

	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		return {
			ok: false,
			message: msg('originInvalid')
		};
	}

	if (parsed.username !== '' || parsed.password !== '') {
		return {
			ok: false,
			message: msg('originCredentials')
		};
	}

	const protocol = parsed.protocol.toLowerCase();
	const hostname = parsed.hostname.toLowerCase();
	const isHttps = protocol === 'https:';
	const isLocalHttp = protocol === 'http:' && LOCAL_HTTP_HOSTNAMES.has(hostname);

	if (!isHttps && !isLocalHttp) {
		if (protocol === 'http:') {
			return {
				ok: false,
				message: msg('originHttps')
			};
		}
		return {
			ok: false,
			message: msg('originScheme')
		};
	}

	return {
		ok: true,
		value: parsed.origin
	};
}

/**
 * Validates an active tab or user-edited link URL before pre-check or submission.
 */
export function validateShareableUrl(rawUrl: string | undefined | null): UrlResult {
	const trimmed = typeof rawUrl === 'string' ? rawUrl.trim() : '';
	if (trimmed === '') {
		return {
			ok: false,
			message: msg('tabUrlRestricted')
		};
	}

	if (trimmed.length > MAX_URL_LENGTH) {
		return {
			ok: false,
			message: msg('urlTooLong', MAX_URL_LENGTH)
		};
	}

	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		return {
			ok: false,
			message: msg('urlInvalid')
		};
	}

	const protocol = parsed.protocol.toLowerCase();
	if (protocol !== 'http:' && protocol !== 'https:') {
		return {
			ok: false,
			message: msg('urlScheme')
		};
	}

	if (parsed.username !== '' || parsed.password !== '') {
		return {
			ok: false,
			message: msg('urlCredentials')
		};
	}

	return {
		ok: true,
		value: trimmed
	};
}
