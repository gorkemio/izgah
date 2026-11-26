import { fail, type Actions } from '@sveltejs/kit';
import { requireAdmin } from '#lib/server/admin/service.ts';
import {
	fetchSmartCaptureModels,
	loadSmartCaptureAdminView,
	purgeAiData,
	readSmartCaptureForm,
	retryFailedEnrichmentJobs,
	saveSmartCaptureSettings,
	SmartCaptureFormError,
	startEnrichmentBackfill,
	testSmartCaptureConnection,
	type FieldErrors
} from '#lib/server/smart-capture/admin.ts';
import { t, type MessageKey } from '#lib/i18n/index.ts';
import type { PageServerLoad } from './$types';

/** Smart capture settings (docs/designs/izgah-smart-capture.md §9). */
export const load: PageServerLoad = async ({ depends, locals }) => {
	depends('izgah:admin:ai');
	requireAdmin(locals);
	return { view: await loadSmartCaptureAdminView() };
};

function translateFieldErrors(errors: FieldErrors): Record<string, string> {
	return Object.fromEntries(
		Object.entries(errors).map(([field, key]) => [field, t(key as MessageKey)])
	);
}

function formFailure(actionType: string, error: unknown) {
	if (error instanceof SmartCaptureFormError) {
		return fail(422, {
			actionType,
			error: t('ai.error.form'),
			fieldErrors: translateFieldErrors(error.fieldErrors)
		});
	}
	throw error;
}

export const actions: Actions = {
	save: async ({ request, locals }) => {
		const admin = requireAdmin(locals);
		const input = readSmartCaptureForm(await request.formData());
		try {
			await saveSmartCaptureSettings(input, admin, locals.requestId);
		} catch (error) {
			return formFailure('save', error);
		}
		return { actionType: 'save', success: true, message: t('ai.saved') };
	},

	test: async ({ request, locals }) => {
		requireAdmin(locals);
		const input = readSmartCaptureForm(await request.formData());
		try {
			const result = await testSmartCaptureConnection(input);
			if (!result.ok) {
				return fail(502, {
					actionType: 'test',
					error: t('ai.testFailed', { reason: result.message })
				});
			}
		} catch (error) {
			return formFailure('test', error);
		}
		return { actionType: 'test', success: true, message: t('ai.testOk') };
	},

	models: async ({ request, locals }) => {
		requireAdmin(locals);
		const input = readSmartCaptureForm(await request.formData());
		try {
			const result = await fetchSmartCaptureModels(input);
			if (!result.ok) {
				return fail(502, {
					actionType: 'models',
					error: t('ai.modelsFailed', { reason: result.message })
				});
			}
			return {
				actionType: 'models',
				success: true,
				message: t('ai.modelsFetched', { count: result.count })
			};
		} catch (error) {
			return formFailure('models', error);
		}
	},

	retry: async ({ locals }) => {
		const admin = requireAdmin(locals);
		const count = await retryFailedEnrichmentJobs(admin, locals.requestId);
		return { actionType: 'retry', success: true, message: t('ai.retried', { count }) };
	},

	backfill: async ({ locals }) => {
		const admin = requireAdmin(locals);
		const count = await startEnrichmentBackfill(admin, locals.requestId);
		return { actionType: 'backfill', success: true, message: t('ai.backfillStarted', { count }) };
	},

	purge: async ({ request, locals }) => {
		const admin = requireAdmin(locals);
		const form = await request.formData();
		if (form.get('confirm') !== 'on') {
			return fail(422, { actionType: 'purge', error: t('ai.purgeConfirmRequired') });
		}
		const result = await purgeAiData(admin, locals.requestId);
		return {
			actionType: 'purge',
			success: true,
			message: t('ai.purged', { count: result.enrichments })
		};
	}
};
