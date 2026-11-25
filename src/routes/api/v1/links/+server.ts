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
} from '$lib/server/api/response';
import { contentTypeEnum } from '$lib/server/db/schema';
import { createLinkShare } from '$lib/server/links/service';
import { t } from '$lib/i18n';

/** Built per request so validation messages use the request locale. */
function createLinkBodySchema() {
	return z
		.object({
			url: z
				.string({ required_error: t('api.urlRequired') })
				.trim()
				.min(1, t('api.urlEmpty')),
			note: z.string().nullable().optional(),
			sectionIds: z.array(z.string().min(1, t('api.sectionIdEmpty'))).optional(),
			contentType: z.enum(contentTypeEnum.enumValues).optional(),
			isFeedVisible: z.boolean().optional()
		})
		.strict();
}

export const OPTIONS: RequestHandler = async (event) => {
	return apiPreflight(getRequestId(event));
};

export const POST: RequestHandler = async (event) => {
	const auth = requireApiV1User(event);
	if (!auth.ok) {
		return auth.response;
	}

	const requestId = getRequestId(event);
	let rawBody: unknown;
	try {
		rawBody = await event.request.json();
	} catch {
		return apiError(400, 'BAD_REQUEST', t('api.badJson'), requestId);
	}

	if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
		return apiError(400, 'BAD_REQUEST', t('api.bodyObject'), requestId);
	}

	const parsedBody = createLinkBodySchema().safeParse(rawBody);
	if (!parsedBody.success) {
		return apiError(
			422,
			'VALIDATION_ERROR',
			t('api.validationFailed'),
			requestId,
			formatZodDetails(parsedBody.error)
		);
	}

	try {
		const result = await createLinkShare({
			actor: {
				id: auth.user.id,
				role: auth.user.role
			},
			url: parsedBody.data.url,
			note: parsedBody.data.note,
			sectionIds: parsedBody.data.sectionIds,
			contentType: parsedBody.data.contentType,
			isFeedVisible: parsedBody.data.isFeedVisible,
			sourceChannel: 'api'
		});

		const { log, clientName } = createApiRequestLogger(event);
		log.info('Created link share via API v1', {
			share_id: result.share.id,
			resource_id: result.share.resourceId,
			duplicate: result.duplicate,
			is_feed_visible: result.share.isFeedVisible,
			...(clientName ? { client_name: clientName } : {})
		});

		return apiJson(
			{
				share: {
					id: result.share.id,
					resourceId: result.share.resourceId,
					canonicalUrl: result.share.canonicalUrl,
					rawUrl: result.share.rawUrl,
					isFeedVisible: result.share.isFeedVisible,
					createdAt: result.share.createdAt.toISOString()
				},
				unfurlStatus: result.unfurlStatus,
				duplicate: result.duplicate
			},
			requestId,
			201
		);
	} catch (error) {
		return handleApiV1Error(error, event);
	}
};
