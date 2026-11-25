import { asciiLower, matchesDomain, splitPathSegments } from '#lib/server/links/canonicalize.ts';
import { isHostCircuitOpen, recordHostStatus } from '#lib/server/unfurl/circuit-breaker.ts';
import { MAX_TEXT_BYTES, safeFetchText } from '#lib/server/unfurl/safe-fetch.ts';
import {
	emptyUnfurlMetadata,
	MAX_SITE_NAME_LENGTH,
	MAX_TITLE_LENGTH,
	resolveHttpAssetUrl,
	sanitizeMetadataField,
	UnfurlUpstreamError,
	type AdapterFetchResult,
	type AdapterOptions
} from './types';

const YOUTUBE_OEMBED_HOST = 'www.youtube.com';

export function isYouTubeUnfurlTarget(parsedUrl: URL): boolean {
	const hostname = asciiLower(parsedUrl.hostname);
	const segments = splitPathSegments(parsedUrl.pathname).map((segment) => asciiLower(segment));

	if (
		matchesDomain(hostname, 'youtube.com') &&
		(segments[0] === 'watch' || segments[0] === 'shorts')
	) {
		return true;
	}

	if (matchesDomain(hostname, 'youtu.be') && segments.length >= 1) {
		return true;
	}

	return false;
}

interface YouTubeOEmbedResponse {
	title?: unknown;
	author_name?: unknown;
	thumbnail_url?: unknown;
	provider_name?: unknown;
}

/**
 * Fetches YouTube metadata via official oEmbed JSON endpoint without scraping HTML.
 */
export async function fetchYouTubeMetadata(
	targetUrl: string,
	options: AdapterOptions = {}
): Promise<AdapterFetchResult> {
	if (isHostCircuitOpen(YOUTUBE_OEMBED_HOST)) {
		return { metadata: emptyUnfurlMetadata(), shortCircuited: true };
	}

	const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(targetUrl)}&format=json`;
	const response = await safeFetchText(oembedUrl, {
		...options.safeFetchOptions,
		signal: options.signal ?? options.safeFetchOptions?.signal,
		maxBytes: MAX_TEXT_BYTES,
		headers: {
			...options.safeFetchOptions?.headers,
			Accept: 'application/json'
		}
	});

	recordHostStatus(YOUTUBE_OEMBED_HOST, response.status);

	if (response.status >= 500 || response.status === 429) {
		throw new UnfurlUpstreamError(
			`HTTP_${response.status}`,
			`YouTube oEmbed returned a temporary error (${response.status}).`,
			response.status
		);
	}

	if (response.status < 200 || response.status >= 300) {
		return { metadata: emptyUnfurlMetadata(), shortCircuited: false };
	}

	let parsed: YouTubeOEmbedResponse;
	try {
		parsed = JSON.parse(response.text) as YouTubeOEmbedResponse;
	} catch {
		return { metadata: emptyUnfurlMetadata(), shortCircuited: false };
	}

	const title = sanitizeMetadataField(
		typeof parsed.title === 'string' ? parsed.title : null,
		MAX_TITLE_LENGTH
	);
	const authorName = sanitizeMetadataField(
		typeof parsed.author_name === 'string' ? parsed.author_name : null,
		MAX_SITE_NAME_LENGTH
	);
	const siteName =
		sanitizeMetadataField(
			typeof parsed.provider_name === 'string' ? parsed.provider_name : null,
			MAX_SITE_NAME_LENGTH
		) ?? 'YouTube';
	const thumbnailUrl = resolveHttpAssetUrl(
		typeof parsed.thumbnail_url === 'string' ? parsed.thumbnail_url : null,
		targetUrl
	);

	return {
		metadata: {
			title,
			description: null,
			siteName,
			providerMeta: authorName ? { authorName } : null,
			thumbnailUrl,
			ogType: null
		},
		shortCircuited: false
	};
}
