import { z } from 'zod';
import type { RequestHandler } from './$types';
import {
	apiError,
	apiJson,
	apiPreflight,
	createApiRequestLogger,
	formatZodDetails,
	getRequestId,
	handleApiV1Error,
	requireApiV1User
} from '#lib/server/api/response.ts';
import { checkDuplicateLink } from '#lib/server/links/service.ts';
import { t } from '#lib/i18n/index.ts';

/** Built per request so validation messages use the request locale. */
function checkQuerySchema() {
	return z.object({
		url: z
			.string({
				error: (issue) => (issue.input === undefined ? t('api.urlQueryMissing') : undefined)
			})
			.trim()
			.min(1, t('api.urlQueryEmpty'))
	});
}

export const OPTIONS: RequestHandler = async (event) => {
	return apiPreflight(getRequestId(event));
};

export const GET: RequestHandler = async (event) => {
	const auth = requireApiV1User(event);
	if (!auth.ok) {
		return auth.response;
	}

	const requestId = getRequestId(event);
	const parsedQuery = checkQuerySchema().safeParse({
		url: event.url.searchParams.get('url') ?? undefined
	});

	if (!parsedQuery.success) {
		return apiError(
			422,
			'VALIDATION_ERROR',
			t('api.urlQueryRequired'),
			requestId,
			formatZodDetails(parsedQuery.error)
		);
	}

	try {
		const result = await checkDuplicateLink(parsedQuery.data.url);
		const { log, clientName } = createApiRequestLogger(event);
		log.info('Checked link duplicate status via API v1', {
			exists: result.exists,
			...(clientName ? { client_name: clientName } : {})
		});

		if (!result.exists) {
			return apiJson(
				{
					exists: false,
					canonicalUrl: result.canonicalUrl,
					rawUrl: result.rawUrl,
					suggestedContentType: result.suggestedContentType
				},
				requestId
			);
		}

		return apiJson(
			{
				exists: true,
				canonicalUrl: result.canonicalUrl,
				rawUrl: result.rawUrl,
				suggestedContentType: result.suggestedContentType,
				resource: result.resource,
				sharesSummary: result.sharesSummary
			},
			requestId
		);
	} catch (error) {
		return handleApiV1Error(error, event);
	}
};
