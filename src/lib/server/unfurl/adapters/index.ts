import { fetchGitHubRepoMetadata, parseGitHubRepoTarget } from './github';
import { fetchHtmlMetadata } from './html-meta';
import type { AdapterFetchResult, AdapterOptions } from './types';
import { fetchXMetadata, isXStatusUnfurlTarget } from './x';
import { fetchYouTubeMetadata, isYouTubeUnfurlTarget } from './youtube';

export * from './types';
export { fetchYouTubeMetadata, isYouTubeUnfurlTarget } from './youtube';
export { extractTweetPlainTextFromBlockquote, fetchXMetadata, isXStatusUnfurlTarget } from './x';
export { fetchGitHubRepoMetadata, parseGitHubRepoTarget } from './github';
export {
	extractCharsetFromContentType,
	extractCharsetFromHtmlBytes,
	fetchHtmlMetadata
} from './html-meta';

/**
 * Dispatches unfurl metadata retrieval using the §5 adapter precedence:
 * 1. YouTube oEmbed
 * 2. X oEmbed
 * 3. GitHub REST API (with HTML Open Graph fallback)
 * 4. General Web streaming HTML Open Graph / Twitter Card parser
 */
export async function unfurlTargetUrl(
	targetUrl: string,
	options: AdapterOptions = {}
): Promise<AdapterFetchResult> {
	const parsed = new URL(targetUrl);

	if (isYouTubeUnfurlTarget(parsed)) {
		return fetchYouTubeMetadata(targetUrl, options);
	}

	if (isXStatusUnfurlTarget(parsed)) {
		return fetchXMetadata(targetUrl, options);
	}

	if (parseGitHubRepoTarget(parsed)) {
		return fetchGitHubRepoMetadata(targetUrl, options);
	}

	return fetchHtmlMetadata(targetUrl, options);
}
