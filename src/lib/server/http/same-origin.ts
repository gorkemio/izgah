import type { RequestEvent } from '@sveltejs/kit';

/**
 * Same-origin evidence for cookie-authenticated requests that SvelteKit's form CSRF check does not
 * cover (JSON endpoints, and body-less POSTs such as `/logout`, which carry no form content type).
 * Mutating methods require an explicit same-origin `Origin` or `Sec-Fetch-Site` header.
 */
export function isSameOriginRequest(event: Pick<RequestEvent, 'request' | 'url'>): boolean {
	const secFetchSite = event.request.headers.get('sec-fetch-site')?.trim().toLowerCase();
	if (secFetchSite && secFetchSite !== 'same-origin' && secFetchSite !== 'none') {
		return false;
	}

	const origin = event.request.headers.get('origin')?.trim();
	if (origin && origin !== event.url.origin) {
		return false;
	}

	const method = event.request.method.toUpperCase();
	if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
		return origin === event.url.origin || secFetchSite === 'same-origin';
	}

	return true;
}
