import { Parser } from 'htmlparser2';
import { asciiLower, matchesDomain, splitPathSegments } from '#lib/server/links/canonicalize.ts';
import {
	isHostCircuitOpen,
	PROVIDER_BREAKER_KEYS,
	recordHostStatus
} from '#lib/server/unfurl/circuit-breaker.ts';
import { MAX_TEXT_BYTES, safeFetchText } from '#lib/server/unfurl/safe-fetch.ts';
import {
	emptyUnfurlMetadata,
	MAX_DESCRIPTION_LENGTH,
	MAX_SITE_NAME_LENGTH,
	MAX_TITLE_LENGTH,
	resolveHttpAssetUrl,
	sanitizeMetadataField,
	stripHtmlToPlainText,
	UnfurlUpstreamError,
	type AdapterFetchResult,
	type AdapterOptions
} from './types';

export function isXStatusUnfurlTarget(parsedUrl: URL): boolean {
	const hostname = asciiLower(parsedUrl.hostname);
	if (!matchesDomain(hostname, 'x.com') && !matchesDomain(hostname, 'twitter.com')) {
		return false;
	}

	const segments = splitPathSegments(parsedUrl.pathname).map((segment) => asciiLower(segment));
	return segments.length >= 3 && segments[1] === 'status';
}

const IGNORED_TAGS = new Set(['script', 'style', 'noscript', 'template']);
const BLOCK_SPACING_TAGS = new Set(['br', 'p', 'div', 'li', 'blockquote']);

/**
 * Strips all HTML tags from an X oEmbed <blockquote> snippet into safe plain text.
 * Prefers the tweet <p> body inside <blockquote> when present so author/date footer isn't duplicated.
 */
export function extractTweetPlainTextFromBlockquote(html: string): string {
	let blockquoteDepth = 0;
	let paragraphDepth = 0;
	let ignoredDepth = 0;
	let paragraphText = '';
	let blockquoteText = '';

	const parser = new Parser(
		{
			onopentagname(name) {
				if (IGNORED_TAGS.has(name)) {
					ignoredDepth += 1;
					return;
				}
				if (name === 'blockquote') {
					blockquoteDepth += 1;
				} else if (name === 'p' && blockquoteDepth > 0) {
					paragraphDepth += 1;
					if (paragraphText.length > 0) {
						paragraphText += ' ';
					}
				}
				if (ignoredDepth === 0 && blockquoteDepth > 0 && BLOCK_SPACING_TAGS.has(name)) {
					if (blockquoteText.length > 0) {
						blockquoteText += ' ';
					}
					if (paragraphDepth > 0 && name === 'br' && paragraphText.length > 0) {
						paragraphText += ' ';
					}
				}
			},
			ontext(text) {
				if (ignoredDepth > 0) {
					return;
				}
				if (blockquoteDepth > 0) {
					blockquoteText += text;
				}
				if (paragraphDepth > 0) {
					paragraphText += text;
				}
			},
			onclosetag(name) {
				if (IGNORED_TAGS.has(name)) {
					if (ignoredDepth > 0) {
						ignoredDepth -= 1;
					}
					return;
				}
				if (name === 'p' && paragraphDepth > 0) {
					paragraphDepth -= 1;
					if (paragraphText.length > 0) {
						paragraphText += ' ';
					}
				} else if (name === 'blockquote' && blockquoteDepth > 0) {
					blockquoteDepth -= 1;
				}
				if (ignoredDepth === 0 && BLOCK_SPACING_TAGS.has(name) && blockquoteText.length > 0) {
					blockquoteText += ' ';
				}
			}
		},
		{ decodeEntities: true, lowerCaseTags: true }
	);

	parser.write(html);
	parser.end();

	const normalizedParagraph = paragraphText.replace(/\s+/g, ' ').trim();
	if (normalizedParagraph) {
		return normalizedParagraph;
	}

	const normalizedBlockquote = blockquoteText.replace(/\s+/g, ' ').trim();
	if (normalizedBlockquote) {
		return normalizedBlockquote;
	}

	return stripHtmlToPlainText(html);
}

interface XOEmbedResponse {
	html?: unknown;
	author_name?: unknown;
	provider_name?: unknown;
	thumbnail_url?: unknown;
}

/**
 * Fetches X / Twitter post metadata via publish.twitter.com oEmbed endpoint.
 */
export async function fetchXMetadata(
	targetUrl: string,
	options: AdapterOptions = {}
): Promise<AdapterFetchResult> {
	if (isHostCircuitOpen(PROVIDER_BREAKER_KEYS.xOembed)) {
		return { metadata: emptyUnfurlMetadata(), shortCircuited: true };
	}

	const oembedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(targetUrl)}&omit_script=true&dnt=true`;
	const response = await safeFetchText(oembedUrl, {
		...options.safeFetchOptions,
		signal: options.signal ?? options.safeFetchOptions?.signal,
		maxBytes: MAX_TEXT_BYTES,
		headers: {
			...options.safeFetchOptions?.headers,
			Accept: 'application/json'
		}
	});

	// 401/403 from oEmbed describe one item (private or not embeddable), not the provider's health.
	if (response.status !== 401 && response.status !== 403) {
		recordHostStatus(PROVIDER_BREAKER_KEYS.xOembed, response.status);
	}

	if (response.status >= 500 || response.status === 429) {
		throw new UnfurlUpstreamError(
			`HTTP_${response.status}`,
			`X oEmbed returned a temporary error (${response.status}).`,
			response.status
		);
	}

	if (response.status < 200 || response.status >= 300) {
		return { metadata: emptyUnfurlMetadata(), shortCircuited: false };
	}

	let parsed: XOEmbedResponse;
	try {
		parsed = JSON.parse(response.text) as XOEmbedResponse;
	} catch {
		return { metadata: emptyUnfurlMetadata(), shortCircuited: false };
	}

	const authorName = sanitizeMetadataField(
		typeof parsed.author_name === 'string' ? parsed.author_name : null,
		MAX_SITE_NAME_LENGTH
	);
	const rawPlainText =
		typeof parsed.html === 'string' ? extractTweetPlainTextFromBlockquote(parsed.html) : '';
	const description = sanitizeMetadataField(rawPlainText, MAX_DESCRIPTION_LENGTH);
	const title =
		sanitizeMetadataField(rawPlainText, MAX_TITLE_LENGTH) ??
		(authorName ? sanitizeMetadataField(`${authorName} (@X)`, MAX_TITLE_LENGTH) : null);
	const thumbnailUrl = resolveHttpAssetUrl(
		typeof parsed.thumbnail_url === 'string' ? parsed.thumbnail_url : null,
		targetUrl
	);

	return {
		metadata: {
			title,
			description,
			siteName: 'X',
			providerMeta: authorName ? { authorName } : null,
			thumbnailUrl,
			ogType: null
		},
		shortCircuited: false
	};
}
