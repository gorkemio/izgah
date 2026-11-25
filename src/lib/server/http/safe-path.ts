const PARSE_BASE = 'http://izgah.local';
const PARSE_ORIGIN = new URL(PARSE_BASE).origin;

export interface SanitizeInternalPathOptions {
	/** Returned whenever the input is not a safe same-origin path. Defaults to `/`. */
	fallback?: string;
	/** Query parameters removed from the result (e.g. one-shot UI state like `edit`). */
	stripParams?: readonly string[];
	/** Exact pathnames that must never be used as a redirect target. */
	disallowPaths?: readonly string[];
	/** Keep the `#fragment`. Defaults to `true`. */
	keepHash?: boolean;
}

function hasControlChar(value: string): boolean {
	for (let i = 0; i < value.length; i += 1) {
		const code = value.charCodeAt(i);
		if (code <= 0x1f || code === 0x7f) {
			return true;
		}
	}
	return false;
}

function isProtocolRelative(pathname: string): boolean {
	return pathname.startsWith('//') || pathname.startsWith('/\\');
}

/**
 * Normalizes an untrusted redirect target into a same-origin application path.
 *
 * Both the raw input and the parsed result are validated: the WHATWG URL parser
 * collapses dot segments, so inputs such as `/.//evil.com` or `/%2e//evil.com`
 * parse to the protocol-relative path `//evil.com` even though the raw string
 * starts with a single slash.
 */
export function sanitizeInternalPath(
	raw: unknown,
	options: SanitizeInternalPathOptions = {}
): string {
	const fallback = options.fallback ?? '/';
	if (typeof raw !== 'string') {
		return fallback;
	}

	const trimmed = raw.trim();
	if (!trimmed.startsWith('/') || isProtocolRelative(trimmed) || hasControlChar(trimmed)) {
		return fallback;
	}

	let parsed: URL;
	try {
		parsed = new URL(trimmed, PARSE_BASE);
	} catch {
		return fallback;
	}

	if (
		parsed.origin !== PARSE_ORIGIN ||
		!parsed.pathname.startsWith('/') ||
		isProtocolRelative(parsed.pathname)
	) {
		return fallback;
	}

	if (options.disallowPaths?.includes(parsed.pathname)) {
		return fallback;
	}

	let search = parsed.search;
	if (options.stripParams && options.stripParams.length > 0) {
		for (const name of options.stripParams) {
			parsed.searchParams.delete(name);
		}
		const encoded = parsed.searchParams.toString();
		search = encoded ? `?${encoded}` : '';
	}

	const hash = options.keepHash === false ? '' : parsed.hash;
	return `${parsed.pathname}${search}${hash}`;
}
