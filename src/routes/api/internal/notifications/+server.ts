import { json } from '@sveltejs/kit';
import { z } from 'zod';
import {
	listUnreadNotifications,
	markNotificationsRead
} from '#lib/server/interactions/service.ts';
import { logger } from '#lib/server/logger.ts';
import type { RequestHandler } from './$types';
import { t } from '#lib/i18n/index.ts';

/** Built per request so validation messages use the request locale. */
function markReadBodySchema() {
	return z
		.object({
			notificationIds: z.array(z.string().trim().min(1)).max(100).optional(),
			markAll: z.boolean().optional()
		})
		.refine(
			(data) =>
				data.markAll === true ||
				(data.notificationIds !== undefined && data.notificationIds.length > 0),
			{
				message: t('notif.markNeedsTarget')
			}
		);
}

function unauthorizedCookieResponse(requestId: string) {
	return json(
		{
			error: {
				code: 'UNAUTHORIZED',
				message: t('auth.signInForActionAlt'),
				requestId
			}
		},
		{ status: 401 }
	);
}

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user || locals.authChannel !== 'cookie') {
		return unauthorizedCookieResponse(locals.requestId);
	}

	try {
		const result = await listUnreadNotifications(locals.user.id);
		return json(result, {
			headers: {
				'Cache-Control': 'private, no-store'
			}
		});
	} catch (error) {
		logger
			.child({
				channel: 'api',
				request_id: locals.requestId,
				user_id: locals.user.id
			})
			.error('Internal unread notifications fetch failed unexpectedly', {
				error: error instanceof Error ? error.message : String(error)
			});
		return json(
			{
				error: {
					code: 'INTERNAL_ERROR',
					message: t('notif.fetchFailed'),
					requestId: locals.requestId
				}
			},
			{ status: 500 }
		);
	}
};

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user || locals.authChannel !== 'cookie') {
		return unauthorizedCookieResponse(locals.requestId);
	}

	let rawBody: unknown;
	try {
		rawBody = await request.json();
	} catch {
		return json(
			{
				error: {
					code: 'BAD_REQUEST',
					message: t('api.badJson'),
					requestId: locals.requestId
				}
			},
			{ status: 400 }
		);
	}

	const parsed = markReadBodySchema().safeParse(rawBody);
	if (!parsed.success) {
		return json(
			{
				error: {
					code: 'VALIDATION_ERROR',
					message: t('notif.markInvalid'),
					details: parsed.error.flatten().fieldErrors,
					requestId: locals.requestId
				}
			},
			{ status: 422 }
		);
	}

	try {
		const result = await markNotificationsRead(locals.user.id, parsed.data);
		return json(result, {
			headers: {
				'Cache-Control': 'private, no-store'
			}
		});
	} catch (error) {
		logger
			.child({
				channel: 'api',
				request_id: locals.requestId,
				user_id: locals.user.id
			})
			.error('Internal notifications mark-read failed unexpectedly', {
				error: error instanceof Error ? error.message : String(error)
			});
		return json(
			{
				error: {
					code: 'INTERNAL_ERROR',
					message: t('notif.updateFailed'),
					requestId: locals.requestId
				}
			},
			{ status: 500 }
		);
	}
};
