import { domainToASCII } from 'node:url';
import { MAX_URL_LENGTH } from '#lib/links/parse-url.ts';
import { t } from '#lib/i18n/index.ts';

export type UrlCanonicalizeErrorCode =
	| 'EMPTY_URL'
	| 'URL_TOO_LONG'
	| 'INVALID_URL'
	| 'UNSUPPORTED_SCHEME'
	| 'CREDENTIALS_NOT_ALLOWED'
	| 'INVALID_HOSTNAME';

export class UrlCanonicalizeError extends Error {
	readonly status = 422 as const;
	readonly code: UrlCanonicalizeErrorCode;

	constructor(code: UrlCanonicalizeErrorCode, message: string) {
		super(message);
		this.name = 'UrlCanonicalizeError';
		this.code = code;
	}
}

export interface CanonicalizedUrl {
	rawUrl: string;
	canonicalUrl: string;
	domain: string;
}

const GLOBAL_TRACKING_PARAMS = new Set([
	'fbclid',
	'gclid',
	'igshid',
	'mc_cid',
	'mc_eid',
	'ref_src',
	'ref_url'
]);

const YOUTUBE_CANONICAL_HOSTS = new Set([
	'youtube.com',
	'www.youtube.com',
	'm.youtube.com',
	'youtu.be',
	'www.youtu.be'
]);

const X_CANONICAL_HOSTS = new Set([
	'twitter.com',
	'www.twitter.com',
	'mobile.twitter.com',
	'x.com',
	'www.x.com',
	'mobile.x.com'
]);

const GITHUB_CANONICAL_HOSTS = new Set(['github.com', 'www.github.com']);

export function asciiLower(value: string): string {
	return value.replace(/[A-Z]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 32));
}

export function matchesDomain(hostname: string, rootDomain: string): boolean {
	const host = asciiLower(hostname);
	const root = asciiLower(rootDomain);
	return host === root || host.endsWith(`.${root}`);
}

export function splitPathSegments(pathname: string): string[] {
	return pathname.split('/').filter((segment) => segment.length > 0);
}

function stripSingleTrailingSlash(pathname: string): string {
	if (pathname.length > 1 && pathname.endsWith('/') && !pathname.endsWith('//')) {
		return pathname.slice(0, -1);
	}
	return pathname;
}

function shouldStripTrackingParam(lowerKey: string, hostname: string): boolean {
	if (lowerKey.startsWith('utm_') || GLOBAL_TRACKING_PARAMS.has(lowerKey)) {
		return true;
	}

	if (
		lowerKey === 'si' &&
		(matchesDomain(hostname, 'youtube.com') ||
			matchesDomain(hostname, 'youtu.be') ||
			matchesDomain(hostname, 'open.spotify.com'))
	) {
		return true;
	}

	if (
		(lowerKey === 's' || lowerKey === 't') &&
		(matchesDomain(hostname, 'x.com') || matchesDomain(hostname, 'twitter.com'))
	) {
		return true;
	}

	return false;
}

function stripTrackingParams(url: URL, hostname: string): void {
	for (const key of new Set(url.searchParams.keys())) {
		if (shouldStripTrackingParam(asciiLower(key), hostname)) {
			url.searchParams.delete(key);
		}
	}
}

function deleteSearchParamsCaseInsensitive(url: URL, keysToDelete: ReadonlySet<string>): void {
	for (const key of new Set(url.searchParams.keys())) {
		if (keysToDelete.has(asciiLower(key))) {
			url.searchParams.delete(key);
		}
	}
}

function normalizeYouTubeCanonical(canon: URL): void {
	const host = asciiLower(canon.hostname);
	if (!YOUTUBE_CANONICAL_HOSTS.has(host)) {
		return;
	}

	const segments = splitPathSegments(canon.pathname);
	const youtubeTimeParams = new Set(['t', 'start']);

	if ((host === 'youtu.be' || host === 'www.youtu.be') && segments.length === 1) {
		canon.protocol = 'https:';
		canon.hostname = 'www.youtube.com';
		canon.port = '';
		canon.pathname = '/watch';
		canon.searchParams.set('v', segments[0]);
		deleteSearchParamsCaseInsensitive(canon, youtubeTimeParams);
		return;
	}

	if (host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com') {
		canon.protocol = 'https:';
		canon.hostname = 'www.youtube.com';
		canon.port = '';

		if (segments[0] === 'shorts' && segments.length >= 2 && segments[1]) {
			canon.pathname = '/watch';
			canon.searchParams.set('v', segments[1]);
			deleteSearchParamsCaseInsensitive(canon, youtubeTimeParams);
			return;
		}

		if (canon.pathname === '/watch' && canon.searchParams.get('v')) {
			deleteSearchParamsCaseInsensitive(canon, youtubeTimeParams);
		}
	}
}

function normalizeXCanonical(canon: URL): void {
	const host = asciiLower(canon.hostname);
	if (!X_CANONICAL_HOSTS.has(host)) {
		return;
	}

	canon.hostname = 'x.com';
	const segments = splitPathSegments(canon.pathname);
	if (
		segments.length >= 4 &&
		asciiLower(segments[1]) === 'status' &&
		(asciiLower(segments[3]) === 'photo' || asciiLower(segments[3]) === 'video')
	) {
		canon.pathname = `/${segments[0]}/status/${segments[2]}`;
	} else if (segments.length === 3 && asciiLower(segments[1]) === 'status') {
		canon.pathname = `/${segments[0]}/status/${segments[2]}`;
	}
}

function normalizeGitHubCanonical(canon: URL): void {
	const host = asciiLower(canon.hostname);
	if (!GITHUB_CANONICAL_HOSTS.has(host)) {
		return;
	}

	canon.hostname = 'github.com';
	const segments = splitPathSegments(canon.pathname);
	if (segments.length === 2 && asciiLower(segments[1]).endsWith('.git') && segments[1].length > 4) {
		canon.pathname = `/${segments[0]}/${segments[1].slice(0, -4)}`;
	}
}

/**
 * Pure, locale-independent URL normalizer and canonicalizer.
 * Converts hosts to Punycode/ASCII without relying on locale casing so Turkish İ/ı never corrupts hosts.
 */
export function canonicalizeUrl(inputUrl: string): CanonicalizedUrl {
	if (typeof inputUrl !== 'string') {
		throw new UrlCanonicalizeError('EMPTY_URL', t('link.urlInvalid'));
	}

	const trimmed = inputUrl.trim();
	if (trimmed.length === 0) {
		throw new UrlCanonicalizeError('EMPTY_URL', t('link.urlEmpty'));
	}
	if (trimmed.length > MAX_URL_LENGTH) {
		throw new UrlCanonicalizeError(
			'URL_TOO_LONG',
			`URL en fazla ${MAX_URL_LENGTH} karakter olabilir.`
		);
	}

	const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(trimmed);
	if (schemeMatch) {
		const lowerScheme = asciiLower(schemeMatch[1]);
		if (lowerScheme !== 'http' && lowerScheme !== 'https') {
			throw new UrlCanonicalizeError('UNSUPPORTED_SCHEME', t('link.httpOnly'));
		}
	}

	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		throw new UrlCanonicalizeError('INVALID_URL', t('link.webInvalid'));
	}

	const protocol = asciiLower(parsed.protocol);
	if (protocol !== 'http:' && protocol !== 'https:') {
		throw new UrlCanonicalizeError('UNSUPPORTED_SCHEME', t('link.httpOnly'));
	}

	if (parsed.username !== '' || parsed.password !== '' || /^https?:\/\/[^/?#]*@/i.test(trimmed)) {
		throw new UrlCanonicalizeError('CREDENTIALS_NOT_ALLOWED', t('link.credentials'));
	}

	if (!parsed.hostname) {
		throw new UrlCanonicalizeError('INVALID_HOSTNAME', t('link.noHost'));
	}

	if (!parsed.hostname.startsWith('[')) {
		const asciiHost = domainToASCII(parsed.hostname);
		if (!asciiHost) {
			throw new UrlCanonicalizeError('INVALID_HOSTNAME', t('link.hostAscii'));
		}
		parsed.hostname = asciiLower(asciiHost);
	} else {
		parsed.hostname = asciiLower(parsed.hostname);
	}

	stripTrackingParams(parsed, parsed.hostname);
	parsed.pathname = stripSingleTrailingSlash(parsed.pathname);

	const canon = new URL(parsed.toString());
	canon.hash = '';

	normalizeYouTubeCanonical(canon);
	normalizeXCanonical(canon);
	normalizeGitHubCanonical(canon);

	canon.pathname = stripSingleTrailingSlash(canon.pathname);
	canon.searchParams.sort();

	const rawUrl = parsed.toString();
	const canonicalUrl = canon.toString();

	if (rawUrl.length > MAX_URL_LENGTH || canonicalUrl.length > MAX_URL_LENGTH) {
		throw new UrlCanonicalizeError(
			'URL_TOO_LONG',
			`URL en fazla ${MAX_URL_LENGTH} karakter olabilir.`
		);
	}

	const domain =
		canon.hostname.startsWith('www.') && canon.hostname.length > 4
			? canon.hostname.slice(4)
			: canon.hostname;

	return {
		rawUrl,
		canonicalUrl,
		domain
	};
}
