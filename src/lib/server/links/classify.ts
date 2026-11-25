import type { ContentType } from '#lib/server/db/schema.ts';
import { asciiLower, matchesDomain, splitPathSegments } from './canonicalize';

const ARTICLE_DOMAINS = ['medium.com', 'substack.com', 'dev.to', 'hashnode.dev'] as const;

const ARTICLE_PATH_SEGMENTS = new Set([
	'blog',
	'post',
	'posts',
	'article',
	'articles',
	'news',
	'writing'
]);

/**
 * Classifies a URL (and optional og:type hint) into one of the 5 Izgah content types.
 */
export function classifyContentType(inputUrl: string | URL, ogType?: string | null): ContentType {
	let parsed: URL;
	try {
		parsed = typeof inputUrl === 'string' ? new URL(inputUrl) : inputUrl;
	} catch {
		return 'web';
	}

	const hostname = asciiLower(parsed.hostname);
	const segments = splitPathSegments(parsed.pathname);
	const lowerSegments = segments.map((segment) => asciiLower(segment));

	// 1. video
	if (
		matchesDomain(hostname, 'youtube.com') &&
		(lowerSegments[0] === 'watch' || lowerSegments[0] === 'shorts')
	) {
		return 'video';
	}
	if (matchesDomain(hostname, 'youtu.be') && lowerSegments.length >= 1) {
		return 'video';
	}
	if (matchesDomain(hostname, 'vimeo.com') && lowerSegments.length >= 1) {
		return 'video';
	}
	if (
		matchesDomain(hostname, 'instagram.com') &&
		lowerSegments[0] === 'reel' &&
		lowerSegments.length >= 2
	) {
		return 'video';
	}

	// 2. repo (strictly two-segment repository roots on GitHub/GitLab)
	if (
		(hostname === 'github.com' ||
			hostname === 'www.github.com' ||
			hostname === 'gitlab.com' ||
			hostname === 'www.gitlab.com') &&
		lowerSegments.length === 2
	) {
		return 'repo';
	}

	// 3. social
	if (
		(matchesDomain(hostname, 'x.com') || matchesDomain(hostname, 'twitter.com')) &&
		lowerSegments.length >= 3 &&
		lowerSegments[1] === 'status'
	) {
		return 'social';
	}
	if (
		matchesDomain(hostname, 'instagram.com') &&
		lowerSegments[0] === 'p' &&
		lowerSegments.length >= 2
	) {
		return 'social';
	}
	if (
		matchesDomain(hostname, 'bsky.app') &&
		lowerSegments.length >= 4 &&
		lowerSegments[0] === 'profile' &&
		lowerSegments[2] === 'post'
	) {
		return 'social';
	}
	if (
		matchesDomain(hostname, 'linkedin.com') &&
		lowerSegments[0] === 'posts' &&
		lowerSegments.length >= 2
	) {
		return 'social';
	}

	// 4. article
	if (ARTICLE_DOMAINS.some((domain) => matchesDomain(hostname, domain))) {
		return 'article';
	}
	if (lowerSegments.slice(0, -1).some((segment) => ARTICLE_PATH_SEGMENTS.has(segment))) {
		return 'article';
	}
	if (typeof ogType === 'string' && asciiLower(ogType.trim()) === 'article') {
		return 'article';
	}

	// 5. web
	return 'web';
}
