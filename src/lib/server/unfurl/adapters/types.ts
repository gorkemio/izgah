import { Parser } from 'htmlparser2';
import { MAX_URL_LENGTH } from '#lib/links/parse-url.ts';
import type { ProviderMeta } from '#lib/server/db/schema.ts';
import { asciiLower } from '#lib/server/links/canonicalize.ts';
import type { SafeFetchOptions } from '#lib/server/unfurl/safe-fetch.ts';

export const MAX_TITLE_LENGTH = 300;
export const MAX_DESCRIPTION_LENGTH = 600;
export const MAX_SITE_NAME_LENGTH = 120;

export interface UnfurlMetadata {
	title: string | null;
	description: string | null;
	siteName: string | null;
	providerMeta: ProviderMeta | null;
	thumbnailUrl: string | null;
	ogType: string | null;
}

export interface AdapterFetchResult {
	metadata: UnfurlMetadata;
	shortCircuited: boolean;
}

export interface AdapterOptions {
	safeFetchOptions?: SafeFetchOptions;
	githubToken?: string;
	signal?: AbortSignal;
}

export class UnfurlUpstreamError extends Error {
	readonly code: string;
	readonly statusCode?: number;

	constructor(code: string, message: string, statusCode?: number) {
		super(message);
		this.name = 'UnfurlUpstreamError';
		this.code = code;
		this.statusCode = statusCode;
	}
}

export function emptyUnfurlMetadata(): UnfurlMetadata {
	return {
		title: null,
		description: null,
		siteName: null,
		providerMeta: null,
		thumbnailUrl: null,
		ogType: null
	};
}

const IGNORED_TEXT_TAGS = new Set(['script', 'style', 'noscript', 'template']);
const BLOCK_SPACING_TAGS = new Set([
	'br',
	'p',
	'div',
	'li',
	'blockquote',
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'tr',
	'td',
	'th'
]);

/**
 * Strips all HTML tags and dangerous containers (<script>, <style>, etc.) to plain text.
 */
export function stripHtmlToPlainText(html: string): string {
	let output = '';
	let ignoredDepth = 0;

	const parser = new Parser(
		{
			onopentagname(name) {
				if (IGNORED_TEXT_TAGS.has(name)) {
					ignoredDepth += 1;
					return;
				}
				if (ignoredDepth === 0 && BLOCK_SPACING_TAGS.has(name) && output.length > 0) {
					output += ' ';
				}
			},
			ontext(text) {
				if (ignoredDepth === 0) {
					output += text;
				}
			},
			onclosetag(name) {
				if (IGNORED_TEXT_TAGS.has(name)) {
					if (ignoredDepth > 0) {
						ignoredDepth -= 1;
					}
					return;
				}
				if (ignoredDepth === 0 && BLOCK_SPACING_TAGS.has(name) && output.length > 0) {
					output += ' ';
				}
			}
		},
		{ decodeEntities: true, lowerCaseTags: true }
	);

	parser.write(html);
	parser.end();

	return output.replace(/\s+/g, ' ').trim();
}

function truncateCodePoints(value: string, maxLength: number): string {
	const chars = Array.from(value);
	if (chars.length <= maxLength) {
		return value;
	}
	return chars.slice(0, maxLength).join('').trimEnd();
}

function replaceControlCharsWithSpace(raw: string): string {
	let result = '';
	let inControlRun = false;

	for (const ch of raw) {
		const code = ch.codePointAt(0) ?? 0;
		if (code <= 0x1f || code === 0x7f) {
			if (!inControlRun) {
				result += ' ';
				inControlRun = true;
			}
		} else {
			result += ch;
			inControlRun = false;
		}
	}

	return result;
}

/**
 * Inputs reaching {@link sanitizeMetadataField} are already entity-decoded plain text (htmlparser2
 * attribute values, oEmbed/REST JSON), so a bare `<` is usually content: `Vec<T>`, `a<b`, or an
 * article about the `<dialog>` element. Only treat the value as HTML when it carries real markup:
 * a closing tag, a tag with attributes, or an element that never appears in prose.
 */
const HTML_MARKUP_PATTERN =
	/<\/[a-zA-Z][\w-]*\s*>|<[a-zA-Z][\w-]*\s[^<>]*=|<(?:script|style|iframe|img|br|hr|svg)\b|<!--/i;

/**
 * Remote values can be megabytes long, but only the first `maxLength` code points survive. Scanning
 * a small multiple of that keeps every regex and the HTML strip linear in a bounded input, so a
 * hostile page cannot stall the shared event loop (the unfurl worker runs in the web process).
 */
const METADATA_SCAN_FACTOR = 8;

export function looksLikeHtmlMarkup(value: string): boolean {
	return HTML_MARKUP_PATTERN.test(value);
}

/**
 * Normalizes untrusted metadata strings to plain text and enforces maximum length.
 */
export function sanitizeMetadataField(
	raw: string | null | undefined,
	maxLength: number
): string | null {
	if (typeof raw !== 'string') {
		return null;
	}

	const scanLimit = maxLength * METADATA_SCAN_FACTOR;
	const bounded = raw.length > scanLimit ? raw.slice(0, scanLimit) : raw;
	let cleaned = replaceControlCharsWithSpace(bounded).trim();
	if (!cleaned) {
		return null;
	}

	if (looksLikeHtmlMarkup(cleaned)) {
		cleaned = stripHtmlToPlainText(cleaned);
	} else {
		cleaned = cleaned.replace(/\s+/g, ' ').trim();
	}

	if (!cleaned) {
		return null;
	}

	return truncateCodePoints(cleaned, maxLength) || null;
}

/**
 * Resolves a possibly relative HTTP(S) asset URL (e.g. og:image) against a base URL.
 */
export function resolveHttpAssetUrl(
	rawUrl: string | null | undefined,
	baseUrl: string | URL
): string | null {
	if (typeof rawUrl !== 'string') {
		return null;
	}

	const trimmed = rawUrl.trim();
	if (!trimmed) {
		return null;
	}

	let resolved: URL;
	try {
		resolved = new URL(trimmed, baseUrl);
	} catch {
		return null;
	}

	const protocol = asciiLower(resolved.protocol);
	if (protocol !== 'http:' && protocol !== 'https:') {
		return null;
	}

	if (resolved.username !== '' || resolved.password !== '') {
		return null;
	}

	const href = resolved.toString();
	if (href.length > MAX_URL_LENGTH) {
		return null;
	}

	return href;
}
