import { fail, type Actions } from '@sveltejs/kit';
import {
	AdminServiceError,
	getUnfurlQueueSummary,
	listFailedUnfurlJobs,
	requireAdmin,
	retryAllDeadUnfurlJobs,
	retryDeadUnfurlJob
} from '#lib/server/admin/service.ts';
import type { PageServerLoad } from './$types';
import { t } from '#lib/i18n/index.ts';

export const load: PageServerLoad = async ({ depends, locals }) => {
	depends('izgah:admin:jobs');
	requireAdmin(locals);

	const [summary, deadJobs] = await Promise.all([getUnfurlQueueSummary(), listFailedUnfurlJobs()]);

	return {
		summary,
		deadJobs
	};
};

export const actions: Actions = {
	retry: async ({ request, locals }) => {
		const admin = requireAdmin(locals);
		const formData = await request.formData();
		const jobId =
			typeof formData.get('jobId') === 'string' ? String(formData.get('jobId')).trim() : '';

		try {
			const retried = await retryDeadUnfurlJob(jobId, admin.id, locals.requestId);
			return {
				actionType: 'retry',
				success: true,
				jobId: retried.jobId,
				message: t('admin.jobRequeued')
			};
		} catch (err) {
			if (err instanceof AdminServiceError) {
				return fail(err.status, {
					actionType: 'retry',
					error: err.message,
					errorCode: err.code
				});
			}
			throw err;
		}
	},

	retryAll: async ({ locals }) => {
		const admin = requireAdmin(locals);

		try {
			const result = await retryAllDeadUnfurlJobs(admin.id, locals.requestId);
			return {
				actionType: 'retryAll',
				success: true,
				retriedCount: result.retriedCount,
				message:
					result.retriedCount > 0
						? t('admin.jobsRequeued', { count: result.retriedCount })
						: t('admin.noDeadJobs')
			};
		} catch (err) {
			if (err instanceof AdminServiceError) {
				return fail(err.status, {
					actionType: 'retryAll',
					error: err.message,
					errorCode: err.code
				});
			}
			throw err;
		}
	}
};
