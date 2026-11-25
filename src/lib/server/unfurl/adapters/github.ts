import { env } from '#lib/server/env.ts';
import { asciiLower, splitPathSegments } from '#lib/server/links/canonicalize.ts';
import {
	isHostCircuitOpen,
	PROVIDER_BREAKER_KEYS,
	recordHostStatus
} from '#lib/server/unfurl/circuit-breaker.ts';
import { MAX_TEXT_BYTES, SafeFetchError, safeFetchText } from '#lib/server/unfurl/safe-fetch.ts';
import { fetchHtmlMetadata } from './html-meta';
import {
	emptyUnfurlMetadata,
	MAX_DESCRIPTION_LENGTH,
	MAX_SITE_NAME_LENGTH,
	MAX_TITLE_LENGTH,
	sanitizeMetadataField,
	type AdapterFetchResult,
	type AdapterOptions
} from './types';

export function parseGitHubRepoTarget(parsedUrl: URL): { owner: string; repo: string } | null {
	const hostname = asciiLower(parsedUrl.hostname);
	if (hostname !== 'github.com' && hostname !== 'www.github.com') {
		return null;
	}
	const segments = splitPathSegments(parsedUrl.pathname);
	if (segments.length !== 2) {
		return null;
	}
	const owner = segments[0];
	const rawRepo = segments[1];
	const repo =
		asciiLower(rawRepo).endsWith('.git') && rawRepo.length > 4 ? rawRepo.slice(0, -4) : rawRepo;
	if (!owner || !repo) {
		return null;
	}
	return { owner, repo };
}

interface GitHubRepoApiResponse {
	full_name?: unknown;
	name?: unknown;
	description?: unknown;
	stargazers_count?: unknown;
	language?: unknown;
	owner?: {
		login?: unknown;
	} | null;
}

/**
 * Fetches GitHub repository metadata via GitHub REST API (with optional GITHUB_TOKEN) plus
 * repository page Open Graph image (opengraph.githubassets.com), falling back to HTML Open Graph
 * on 401/403/429 rate limits or open circuit.
 */
export async function fetchGitHubRepoMetadata(
	targetUrl: string,
	options: AdapterOptions = {}
): Promise<AdapterFetchResult> {
	const parsed = new URL(targetUrl);
	const repoTarget = parseGitHubRepoTarget(parsed);
	if (!repoTarget) {
		return fetchHtmlMetadata(targetUrl, options);
	}

	const htmlPageUrl = `https://github.com/${encodeURIComponent(repoTarget.owner)}/${encodeURIComponent(repoTarget.repo)}`;
	const token = options.githubToken ?? env.GITHUB_TOKEN;

	if (!token || isHostCircuitOpen(PROVIDER_BREAKER_KEYS.githubApi)) {
		return fetchHtmlMetadata(htmlPageUrl, options);
	}

	const apiUrl = `https://api.github.com/repos/${encodeURIComponent(repoTarget.owner)}/${encodeURIComponent(repoTarget.repo)}`;
	const headers: Record<string, string> = {
		...options.safeFetchOptions?.headers,
		Accept: 'application/vnd.github+json',
		'X-GitHub-Api-Version': '2022-11-28',
		Authorization: `Bearer ${token}`
	};

	let apiResponse: Awaited<ReturnType<typeof safeFetchText>> | null = null;
	try {
		apiResponse = await safeFetchText(apiUrl, {
			...options.safeFetchOptions,
			signal: options.signal ?? options.safeFetchOptions?.signal,
			maxBytes: MAX_TEXT_BYTES,
			headers
		});
	} catch (error) {
		if (options.signal?.aborted) {
			throw error;
		}
		if (error instanceof SafeFetchError && error.code === 'BLOCKED_IP') {
			throw error;
		}
		return fetchHtmlMetadata(htmlPageUrl, options);
	}

	recordHostStatus(PROVIDER_BREAKER_KEYS.githubApi, apiResponse.status);

	if (
		apiResponse.status === 401 ||
		apiResponse.status === 403 ||
		apiResponse.status === 429 ||
		apiResponse.status >= 500
	) {
		return fetchHtmlMetadata(htmlPageUrl, options);
	}

	if (apiResponse.status === 404) {
		return { metadata: emptyUnfurlMetadata(), shortCircuited: false };
	}

	if (apiResponse.status < 200 || apiResponse.status >= 300) {
		return fetchHtmlMetadata(htmlPageUrl, options);
	}

	let repoData: GitHubRepoApiResponse;
	try {
		repoData = JSON.parse(apiResponse.text) as GitHubRepoApiResponse;
	} catch {
		return fetchHtmlMetadata(htmlPageUrl, options);
	}

	const title =
		sanitizeMetadataField(
			typeof repoData.full_name === 'string'
				? repoData.full_name
				: typeof repoData.name === 'string'
					? repoData.name
					: `${repoTarget.owner}/${repoTarget.repo}`,
			MAX_TITLE_LENGTH
		) ?? `${repoTarget.owner}/${repoTarget.repo}`;

	const description = sanitizeMetadataField(
		typeof repoData.description === 'string' ? repoData.description : null,
		MAX_DESCRIPTION_LENGTH
	);

	const language = sanitizeMetadataField(
		typeof repoData.language === 'string' ? repoData.language : null,
		64
	);
	const authorName = sanitizeMetadataField(
		typeof repoData.owner?.login === 'string' ? repoData.owner.login : repoTarget.owner,
		MAX_SITE_NAME_LENGTH
	);
	const stars =
		typeof repoData.stargazers_count === 'number' && Number.isFinite(repoData.stargazers_count)
			? Math.max(0, Math.floor(repoData.stargazers_count))
			: undefined;

	let thumbnailUrl: string | null = null;
	try {
		const ogResult = await fetchHtmlMetadata(htmlPageUrl, options);
		thumbnailUrl = ogResult.metadata.thumbnailUrl;
	} catch {
		// Keep API metadata even if GitHub HTML og:image fetch fails.
		thumbnailUrl = null;
	}

	const providerMeta = {
		...(stars !== undefined ? { stars } : {}),
		...(language ? { language } : {}),
		...(authorName ? { authorName } : {})
	};

	return {
		metadata: {
			title,
			description,
			siteName: 'GitHub',
			providerMeta: Object.keys(providerMeta).length > 0 ? providerMeta : null,
			thumbnailUrl,
			ogType: null
		},
		shortCircuited: false
	};
}
