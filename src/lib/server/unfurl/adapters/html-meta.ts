import { Parser } from 'htmlparser2';
import { asciiLower } from '#lib/server/links/canonicalize.ts';
import { isHostCircuitOpen, recordHostStatus } from '#lib/server/unfurl/circuit-breaker.ts';
import { MAX_TEXT_BYTES, safeFetchStream } from '#lib/server/unfurl/safe-fetch.ts';
import {
	emptyUnfurlMetadata,
	MAX_DESCRIPTION_LENGTH,
	MAX_SITE_NAME_LENGTH,
	MAX_TITLE_LENGTH,
	resolveHttpAssetUrl,
	sanitizeMetadataField,
	UnfurlUpstreamError,
	type AdapterFetchResult,
	type AdapterOptions
} from './types';

const CHARSET_PRESCAN_BYTES = 4096;

function normalizeCharsetLabel(rawLabel: string | null | undefined): string | null {
	if (!rawLabel) {
		return null;
	}
	const clean = asciiLower(rawLabel.trim().replace(/^["']|["']$/g, ''));
	if (!clean) {
		return null;
	}
	if (clean === 'utf8' || clean === 'utf-8') {
		return 'utf-8';
	}
	if (clean === 'windows-1254' || clean === 'win-1254' || clean === 'cp1254') {
		return 'windows-1254';
	}
	if (
		clean === 'iso-8859-9' ||
		clean === 'iso8859-9' ||
		clean === 'latin5' ||
		clean === 'latin-5' ||
		clean === 'iso_8859-9'
	) {
		return 'iso-8859-9';
	}
	return clean;
}

export function extractCharsetFromContentType(contentType: string | null): string | null {
	if (!contentType) {
		return null;
	}
	const match = /;\s*charset\s*=\s*(?:"([^"]+)"|'([^']+)'|([^;\s]+))/i.exec(contentType);
	const raw = match?.[1] ?? match?.[2] ?? match?.[3];
	return normalizeCharsetLabel(raw);
}

export function extractCharsetFromHtmlBytes(bytes: Uint8Array): string | null {
	// Callers may pass a whole network chunk (tens of KiB); the <meta> regexes below are only cheap on
	// a small window, and the charset declaration must appear early in the document anyway.
	const latin1 = Buffer.from(bytes.subarray(0, CHARSET_PRESCAN_BYTES)).toString('latin1');
	const metaCharset = /<meta\b[^>]*\bcharset\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s"'>/]+))/i.exec(
		latin1
	);
	if (metaCharset) {
		return normalizeCharsetLabel(metaCharset[1] ?? metaCharset[2] ?? metaCharset[3]);
	}

	const httpEquivRegex = /<meta\b[^>]*>/gi;
	let tagMatch: RegExpExecArray | null;
	while ((tagMatch = httpEquivRegex.exec(latin1)) !== null) {
		const tag = tagMatch[0];
		if (!/\bhttp-equiv\s*=\s*(?:"content-type"|'content-type'|content-type)\b/i.test(tag)) {
			continue;
		}
		const contentAttr = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
		const contentVal = contentAttr?.[1] ?? contentAttr?.[2] ?? null;
		const charset = extractCharsetFromContentType(contentVal);
		if (charset) {
			return charset;
		}
	}

	return null;
}

function createSafeTextDecoder(charsetLabel: string | null): TextDecoder {
	if (charsetLabel) {
		try {
			return new TextDecoder(charsetLabel, { fatal: false });
		} catch {
			// Unsupported encoding falls back to utf-8 below.
		}
	}
	return new TextDecoder('utf-8', { fatal: false });
}

function isHtmlLikeContentType(contentType: string | null): boolean {
	if (!contentType) {
		return true;
	}
	const mime = asciiLower(contentType.split(';', 1)[0]?.trim() ?? '');
	if (!mime) {
		return true;
	}
	return (
		mime === 'text/html' ||
		mime === 'application/xhtml+xml' ||
		mime === 'text/plain' ||
		mime.endsWith('+xml')
	);
}

/** Path prefixes of sign-in walls (Instagram/generic, LinkedIn, X). Matched on whole segments. */
const LOGIN_WALL_PATHS = [
	'/accounts/login',
	'/login',
	'/signin',
	// LinkedIn sends logged-out visitors of posts and profiles to its auth wall.
	'/authwall',
	'/uas/login',
	// X (Twitter) redirects to its login flow.
	'/i/flow/login'
] as const;

function isLoginPath(path: string): boolean {
	return LOGIN_WALL_PATHS.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/**
 * True when a fetch for a content page ended on a sign-in wall; such results fall back to the
 * plain domain card instead of storing the wall's generic metadata.
 */
export function isLoginWallRedirect(originalUrl: URL, finalUrl: URL): boolean {
	const origPath = asciiLower(originalUrl.pathname);
	const finalPath = asciiLower(finalUrl.pathname);
	if (origPath === finalPath) {
		return false;
	}
	return isLoginPath(finalPath) && !isLoginPath(origPath);
}

/**
 * Streams an HTML document through htmlparser2 stopping immediately at </head> or <body>,
 * honoring Content-Type / <meta charset> encodings (utf-8, windows-1254, iso-8859-9) and
 * resolving relative og:image URLs against the final fetched URL.
 */
export async function fetchHtmlMetadata(
	targetUrl: string,
	options: AdapterOptions = {}
): Promise<AdapterFetchResult> {
	const parsedTarget = new URL(targetUrl);
	const targetHost = asciiLower(parsedTarget.hostname);

	if (isHostCircuitOpen(targetHost)) {
		return { metadata: emptyUnfurlMetadata(), shortCircuited: true };
	}

	const stream = await safeFetchStream(targetUrl, {
		...options.safeFetchOptions,
		signal: options.signal ?? options.safeFetchOptions?.signal,
		maxBytes: options.safeFetchOptions?.maxBytes ?? MAX_TEXT_BYTES,
		allowEarlyStopExceedingContentLength: true,
		headers: {
			...options.safeFetchOptions?.headers,
			Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1'
		}
	});

	const finalHost = asciiLower(stream.finalUrl.hostname);
	if (finalHost && finalHost !== targetHost && isHostCircuitOpen(finalHost)) {
		await stream.close();
		return { metadata: emptyUnfurlMetadata(), shortCircuited: true };
	}

	recordHostStatus(finalHost || targetHost, stream.status);

	if (stream.status >= 500 || stream.status === 429) {
		await stream.close();
		throw new UnfurlUpstreamError(
			`HTTP_${stream.status}`,
			`The target page returned a temporary error (${stream.status}).`,
			stream.status
		);
	}

	if (stream.status < 200 || stream.status >= 300) {
		await stream.close();
		return { metadata: emptyUnfurlMetadata(), shortCircuited: false };
	}

	if (isLoginWallRedirect(parsedTarget, stream.finalUrl)) {
		await stream.close();
		return { metadata: emptyUnfurlMetadata(), shortCircuited: false };
	}

	const contentType = stream.headers.get('content-type');
	if (!isHtmlLikeContentType(contentType)) {
		await stream.close();
		return { metadata: emptyUnfurlMetadata(), shortCircuited: false };
	}

	const headerCharset = extractCharsetFromContentType(contentType);
	let decoder: TextDecoder | null = headerCharset ? createSafeTextDecoder(headerCharset) : null;
	const prescanChunks: Uint8Array[] = [];
	let prescanBytes = 0;

	let ogTitle: string | null = null;
	let twitterTitle: string | null = null;
	let docTitle = '';
	let inTitleTag = false;

	let ogDescription: string | null = null;
	let twitterDescription: string | null = null;
	let metaDescription: string | null = null;

	let ogImage: string | null = null;
	let twitterImage: string | null = null;
	let ogSiteName: string | null = null;
	let ogType: string | null = null;
	let headFinished = false;

	const parser = new Parser(
		{
			onopentag(name, attribs) {
				if (headFinished) {
					return;
				}
				if (name === 'body') {
					headFinished = true;
					return;
				}
				if (name === 'title') {
					inTitleTag = true;
					return;
				}
				if (name === 'meta') {
					const rawContent = attribs.content?.trim();
					if (!rawContent) {
						return;
					}
					const prop = asciiLower((attribs.property ?? attribs.name ?? '').trim());
					if (!prop) {
						return;
					}

					switch (prop) {
						case 'og:title':
							ogTitle ??= rawContent;
							break;
						case 'twitter:title':
							twitterTitle ??= rawContent;
							break;
						case 'og:description':
							ogDescription ??= rawContent;
							break;
						case 'twitter:description':
							twitterDescription ??= rawContent;
							break;
						case 'description':
							metaDescription ??= rawContent;
							break;
						case 'og:image':
						case 'og:image:secure_url':
						case 'og:image:url':
							ogImage ??= rawContent;
							break;
						case 'twitter:image':
						case 'twitter:image:src':
							twitterImage ??= rawContent;
							break;
						case 'og:site_name':
							ogSiteName ??= rawContent;
							break;
						case 'og:type':
							ogType ??= rawContent;
							break;
					}
				}
			},
			ontext(text) {
				if (!headFinished && inTitleTag && docTitle.length < 1024) {
					docTitle += text;
				}
			},
			onclosetag(name) {
				if (name === 'title') {
					inTitleTag = false;
				} else if (name === 'head') {
					headFinished = true;
				}
			}
		},
		{ decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true }
	);

	const feedBytesToParser = (bytes: Uint8Array, flush: boolean) => {
		if (!decoder) {
			return;
		}
		const decoded = decoder.decode(bytes, { stream: !flush });
		if (decoded) {
			parser.write(decoded);
		}
		if (flush) {
			const tail = decoder.decode();
			if (tail) {
				parser.write(tail);
			}
		}
	};

	const flushPrescanBuffer = () => {
		const combined = Buffer.concat(prescanChunks);
		prescanChunks.length = 0;
		const metaCharset = extractCharsetFromHtmlBytes(combined);
		decoder = createSafeTextDecoder(metaCharset);
		feedBytesToParser(combined, false);
	};

	try {
		await stream.readChunks((chunk) => {
			if (!decoder) {
				prescanChunks.push(chunk);
				prescanBytes += chunk.byteLength;
				const combinedPreview = Buffer.concat(prescanChunks);
				const foundCharset = extractCharsetFromHtmlBytes(combinedPreview);
				const previewStr = combinedPreview.toString('latin1');
				const sawHeadBoundary = /<\/head\s*>|<body[\s>]/i.test(previewStr);
				if (foundCharset || sawHeadBoundary || prescanBytes >= CHARSET_PRESCAN_BYTES) {
					flushPrescanBuffer();
				}
			} else {
				feedBytesToParser(chunk, false);
			}

			return !headFinished;
		});

		if (!decoder) {
			flushPrescanBuffer();
		}
		if (decoder) {
			const tail = decoder.decode();
			if (tail) {
				parser.write(tail);
			}
		}
		parser.end();
	} finally {
		await stream.close();
	}

	const title =
		sanitizeMetadataField(ogTitle, MAX_TITLE_LENGTH) ??
		sanitizeMetadataField(twitterTitle, MAX_TITLE_LENGTH) ??
		sanitizeMetadataField(docTitle, MAX_TITLE_LENGTH);

	const description =
		sanitizeMetadataField(ogDescription, MAX_DESCRIPTION_LENGTH) ??
		sanitizeMetadataField(twitterDescription, MAX_DESCRIPTION_LENGTH) ??
		sanitizeMetadataField(metaDescription, MAX_DESCRIPTION_LENGTH);

	const siteName = sanitizeMetadataField(ogSiteName, MAX_SITE_NAME_LENGTH);
	const thumbnailUrl =
		resolveHttpAssetUrl(ogImage, stream.finalUrl) ??
		resolveHttpAssetUrl(twitterImage, stream.finalUrl);
	const normalizedOgType = sanitizeMetadataField(ogType, 64);

	return {
		metadata: {
			title,
			description,
			siteName,
			providerMeta: null,
			thumbnailUrl,
			ogType: normalizedOgType ? asciiLower(normalizedOgType) : null
		},
		shortCircuited: false
	};
}
