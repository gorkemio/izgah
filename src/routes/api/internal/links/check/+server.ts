import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { checkDuplicateLink, LinkServiceError } from '$lib/server/links/service';
import { logger } from '$lib/server/logger';
import type { RequestHandler } from './$types';
import { t } from '$lib/i18n';

const checkQuerySchema = z.object({
	url: z.string().trim().min(1, 'URL parametresi zorunludur.')
});

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user || locals.authChannel !== 'cookie') {
		return json(
			{
				error: {
					code: 'UNAUTHORIZED',
					message: t('auth.signInForActionAlt'),
					requestId: locals.requestId
				}
			},
			{ status: 401 }
		);
	}

	const parsed = checkQuerySchema.safeParse({
		url: url.searchParams.get('url') ?? ''
	});

	if (!parsed.success) {
		return json(
			{
				error: {
					code: 'VALIDATION_ERROR',
					message: t('api.badLinkParam'),
					details: parsed.error.flatten().fieldErrors,
					requestId: locals.requestId
				}
			},
			{ status: 422 }
		);
	}

	try {
		const result = await checkDuplicateLink(parsed.data.url);
		return json(result, {
			headers: {
				'Cache-Control': 'private, no-store'
			}
		});
	} catch (error) {
		if (error instanceof LinkServiceError) {
			return json(
				{
					error: {
						code: error.code,
						message: error.message,
						details: error.details,
						requestId: locals.requestId
					}
				},
				{ status: error.status }
			);
		}

		logger
			.child({
				channel: 'api',
				request_id: locals.requestId,
				user_id: locals.user.id
			})
			.error('Internal link duplicate check failed unexpectedly', {
				error: error instanceof Error ? error.message : String(error)
			});
		return json(
			{
				error: {
					code: 'INTERNAL_ERROR',
					message: t('link.checkFailed'),
					requestId: locals.requestId
				}
			},
			{ status: 500 }
		);
	}
};
