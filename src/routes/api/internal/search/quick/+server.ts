import { json } from '@sveltejs/kit';
import { checkQuickSearchRateLimit } from '#lib/server/auth/rate-limit.ts';
import { searchResources } from '#lib/server/search/service.ts';
import type { RequestHandler } from './$types';
import { t } from '#lib/i18n/index.ts';

const QUICK_SEARCH_LIMIT = 6;
const QUICK_SEARCH_MIN_CHARS = 2;

function errorResponse(
	status: number,
	code: string,
	message: string,
	requestId: string,
	extraHeaders: Record<string, string> = {}
) {
	return json(
		{ error: { code, message, requestId } },
		{ status, headers: { 'Cache-Control': 'no-store', ...extraHeaders } }
	);
}

function isSameOriginRequest(request: Request, url: URL): boolean {
	const secFetchSite = request.headers.get('sec-fetch-site')?.trim().toLowerCase();
	if (secFetchSite && secFetchSite !== 'same-origin' && secFetchSite !== 'none') {
		return false;
	}

	const origin = request.headers.get('origin')?.trim();
	if (origin && origin !== url.origin) {
		return false;
	}

	return true;
}

/**
 * Typeahead archive search for the ⌘K command palette (docs/designs/izgah-ui-v3.md §7.3).
 * Uses `recordLog: false` so keystroke queries never pollute `search_logs`.
 */
export const GET: RequestHandler = async ({ locals, request, url }) => {
	if (!isSameOriginRequest(request, url)) {
		return errorResponse(403, 'FORBIDDEN', t('api.crossOrigin'), locals.requestId);
	}

	if (!locals.user || locals.authChannel !== 'cookie') {
		return errorResponse(401, 'UNAUTHORIZED', t('auth.signInForActionAlt'), locals.requestId);
	}

	const query = (url.searchParams.get('q') ?? '').trim();
	if (query.length < QUICK_SEARCH_MIN_CHARS) {
		return json(
			{ items: [], totalCount: 0, query: '' },
			{ headers: { 'Cache-Control': 'no-store' } }
		);
	}

	const rateLimit = checkQuickSearchRateLimit(locals.session?.id ?? locals.user.id);
	if (!rateLimit.allowed) {
		return errorResponse(429, 'RATE_LIMITED', t('search.rateLimited'), locals.requestId, {
			'Retry-After': String(rateLimit.retryAfterSeconds)
		});
	}

	const result = await searchResources({
		userId: locals.user.id,
		query,
		limit: QUICK_SEARCH_LIMIT,
		recordLog: false
	});

	return json(
		{
			items: result.items,
			totalCount: result.totalCount,
			query: result.query
		},
		{ headers: { 'Cache-Control': 'no-store' } }
	);
};
