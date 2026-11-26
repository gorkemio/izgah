import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/client.ts';
import { resourceEnrichments } from '#lib/server/db/schema.ts';
import { loadSmartCaptureState } from '#lib/server/smart-capture/settings.ts';
import { error, fail, redirect } from '@sveltejs/kit';
import { sanitizeInternalPath } from '#lib/server/http/safe-path.ts';
import {
	addResourceComment,
	getResourceDiscussion,
	InteractionServiceError,
	softDeleteResourceComment,
	toggleResourceLike,
	updateResourceComment
} from '#lib/server/interactions/service.ts';
import {
	getResourceShareReference,
	LinkServiceError,
	softDeleteLinkShare
} from '#lib/server/links/service.ts';
import { _feedShareActions } from '../../+page.server';
import type { Actions, PageServerLoad } from './$types';
import { t } from '#lib/i18n/index.ts';

function parseDesiredLike(raw: FormDataEntryValue | null): boolean | undefined {
	if (raw === 'true') {
		return true;
	}
	if (raw === 'false') {
		return false;
	}
	return undefined;
}

function wantsJsonResponse(request: Request): boolean {
	const accept = request.headers.get('accept') ?? '';
	return accept.includes('application/json') || request.headers.has('x-sveltekit-action');
}

function sanitizeResourceReturnTo(raw: FormDataEntryValue | null, resourceId: string): string {
	return sanitizeInternalPath(raw, {
		fallback: `/resources/${resourceId}`,
		stripParams: ['compose', 'edit', 'delete', 'editComment', 'deleteComment'],
		keepHash: false
	});
}

/** The AI summary is shown while summaries are enabled (docs/designs/izgah-smart-capture.md §10). */
async function loadVisibleAiSummary(resourceId: string): Promise<string | null> {
	const state = await loadSmartCaptureState();
	if (!state.aiAllowed || !state.settings.summaries) {
		return null;
	}
	const [row] = await db
		.select({ summary: resourceEnrichments.summary })
		.from(resourceEnrichments)
		.where(eq(resourceEnrichments.resourceId, resourceId))
		.limit(1);
	return row?.summary ?? null;
}

export const load: PageServerLoad = async ({ depends, locals, params, url }) => {
	depends('app:feed');

	if (!locals.user) {
		redirect(303, '/login');
	}

	const discussion = await getResourceDiscussion({
		resourceId: params.id,
		viewerUserId: locals.user.id
	});

	if (!discussion) {
		error(404, t('resource.notFound'));
	}

	return {
		...discussion,
		aiSummary: await loadVisibleAiSummary(params.id),
		editCommentId: url.searchParams.get('editComment') || null,
		deleteCommentId: url.searchParams.get('deleteComment') || null
	};
};

export const actions: Actions = {
	toggleLike: async ({ request, locals, params }) => {
		if (!locals.user) {
			return fail(401, {
				formType: 'toggleLike' as const,
				errorMessage: t('auth.signInForActionAlt')
			});
		}

		const resourceId = params.id;
		const formData = await request.formData();
		const returnTo = sanitizeResourceReturnTo(formData.get('returnTo'), resourceId);

		try {
			const result = await toggleResourceLike({
				actorId: locals.user.id,
				resourceId,
				desired: parseDesiredLike(formData.get('liked'))
			});

			if (!wantsJsonResponse(request)) {
				redirect(303, returnTo);
			}

			return {
				success: true,
				formType: 'toggleLike' as const,
				resourceId: result.resourceId,
				liked: result.liked,
				likeCount: result.likeCount
			};
		} catch (err) {
			if (err instanceof InteractionServiceError) {
				return fail(err.status === 403 || err.status === 404 ? err.status : 422, {
					formType: 'toggleLike' as const,
					resourceId,
					errorMessage: err.message
				});
			}
			throw err;
		}
	},

	addComment: async ({ request, locals, params }) => {
		if (!locals.user) {
			return fail(401, {
				formType: 'addComment' as const,
				errorMessage: t('auth.signInForActionAlt')
			});
		}

		const formData = await request.formData();
		const body = String(formData.get('body') ?? '');
		const returnTo = sanitizeResourceReturnTo(formData.get('returnTo'), params.id);

		try {
			const created = await addResourceComment({
				actorId: locals.user.id,
				resourceId: params.id,
				body
			});

			if (!wantsJsonResponse(request)) {
				redirect(303, returnTo);
			}

			return {
				success: true,
				formType: 'addComment' as const,
				comment: created.comment,
				commentCount: created.commentCount
			};
		} catch (err) {
			if (err instanceof InteractionServiceError) {
				return fail(err.status === 403 || err.status === 404 ? err.status : 422, {
					formType: 'addComment' as const,
					errorMessage: err.message,
					fieldErrors: err.details ?? {},
					values: { body }
				});
			}
			throw err;
		}
	},

	updateComment: async ({ request, locals, params }) => {
		if (!locals.user) {
			return fail(401, {
				formType: 'updateComment' as const,
				errorMessage: t('auth.signInForActionAlt')
			});
		}

		const formData = await request.formData();
		const commentId = String(formData.get('commentId') ?? '').trim();
		const body = String(formData.get('body') ?? '');
		const returnTo = sanitizeResourceReturnTo(formData.get('returnTo'), params.id);

		if (!commentId) {
			return fail(422, {
				formType: 'updateComment' as const,
				commentId,
				errorMessage: t('comment.idMissing'),
				values: { body }
			});
		}

		try {
			const updated = await updateResourceComment({
				actor: { id: locals.user.id, role: locals.user.role },
				commentId,
				body,
				expectedResourceId: params.id
			});

			if (!wantsJsonResponse(request)) {
				redirect(303, returnTo);
			}

			return {
				success: true,
				formType: 'updateComment' as const,
				comment: updated
			};
		} catch (err) {
			if (err instanceof InteractionServiceError) {
				return fail(err.status === 403 || err.status === 404 ? err.status : 422, {
					formType: 'updateComment' as const,
					commentId,
					errorMessage: err.message,
					fieldErrors: err.details ?? {},
					values: { body }
				});
			}
			throw err;
		}
	},

	deleteComment: async ({ request, locals, params }) => {
		if (!locals.user) {
			return fail(401, {
				formType: 'deleteComment' as const,
				errorMessage: t('auth.signInForActionAlt')
			});
		}

		const formData = await request.formData();
		const commentId = String(formData.get('commentId') ?? '').trim();
		const returnTo = sanitizeResourceReturnTo(formData.get('returnTo'), params.id);

		if (!commentId) {
			return fail(422, {
				formType: 'deleteComment' as const,
				commentId,
				errorMessage: t('comment.idMissing')
			});
		}

		try {
			const result = await softDeleteResourceComment({
				actor: { id: locals.user.id, role: locals.user.role },
				commentId,
				expectedResourceId: params.id
			});

			if (!wantsJsonResponse(request)) {
				redirect(303, returnTo);
			}

			return {
				success: true,
				formType: 'deleteComment' as const,
				commentId: result.id,
				commentCount: result.commentCount
			};
		} catch (err) {
			if (err instanceof InteractionServiceError) {
				return fail(err.status === 403 || err.status === 404 ? err.status : 422, {
					formType: 'deleteComment' as const,
					commentId,
					errorMessage: err.message
				});
			}
			throw err;
		}
	},

	updateShare: _feedShareActions.updateShare,

	deleteShare: async ({ request, locals, params }) => {
		if (!locals.user) {
			return fail(401, {
				formType: 'deleteShare' as const,
				errorMessage: t('auth.signInForActionAlt')
			});
		}

		const formData = await request.formData();
		const shareId = String(formData.get('shareId') ?? '').trim();
		const returnTo = sanitizeResourceReturnTo(formData.get('returnTo'), params.id);

		if (!shareId) {
			return fail(422, {
				formType: 'deleteShare' as const,
				shareId,
				errorMessage: t('share.idMissing')
			});
		}

		try {
			await softDeleteLinkShare({
				actor: { id: locals.user.id, role: locals.user.role },
				shareId
			});

			const remaining = await getResourceShareReference(params.id);
			if (remaining.totalActiveCount === 0) {
				redirect(303, '/');
			}

			if (!wantsJsonResponse(request)) {
				redirect(303, returnTo);
			}

			return {
				success: true,
				formType: 'deleteShare' as const,
				shareId
			};
		} catch (err) {
			if (err instanceof LinkServiceError) {
				return fail(
					err.status === 403 || err.status === 404 || err.status === 409 ? err.status : 422,
					{
						formType: 'deleteShare' as const,
						shareId,
						errorMessage: err.message
					}
				);
			}
			throw err;
		}
	}
};
