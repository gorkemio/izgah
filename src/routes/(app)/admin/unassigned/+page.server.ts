import { fail, type Actions } from '@sveltejs/kit';
import {
	AdminServiceError,
	bulkAssignSharesToSections,
	listUnassignedShares,
	requireAdmin
} from '#lib/server/admin/service.ts';
import { listSections } from '#lib/server/sections/service.ts';
import { pendingSuggestionsForShares } from '#lib/server/smart-capture/admin.ts';
import {
	acceptAllSuggestions,
	acceptSuggestion,
	SuggestionError
} from '#lib/server/smart-capture/suggestions.ts';
import type { PageServerLoad } from './$types';
import { t } from '#lib/i18n/index.ts';

export const load: PageServerLoad = async ({ depends, locals, url }) => {
	depends('izgah:admin:unassigned');
	requireAdmin(locals);

	const cursor = url.searchParams.get('cursor');
	const [unassigned, sections] = await Promise.all([
		listUnassignedShares({ cursor }),
		listSections()
	]);

	const names = new Map(sections.map((section) => [section.id, section.name]));
	const suggestionRows = await pendingSuggestionsForShares(unassigned.items.map((item) => item.id));
	const suggestions: Record<
		string,
		Array<{ sectionId: string; name: string; source: string }>
	> = {};
	for (const row of suggestionRows) {
		const name = names.get(row.sectionId);
		if (name) {
			(suggestions[row.shareId] ??= []).push({
				sectionId: row.sectionId,
				name,
				source: row.source
			});
		}
	}

	return {
		items: unassigned.items,
		suggestions,
		nextCursor: unassigned.nextCursor,
		totalUnassignedCount: unassigned.totalUnassignedCount,
		hasActiveCursor: Boolean(cursor),
		sections
	};
};

function readStringList(formData: FormData, key: string): string[] {
	return formData
		.getAll(key)
		.filter((entry): entry is string => typeof entry === 'string')
		.map((entry) => entry.trim())
		.filter(Boolean);
}

export const actions: Actions = {
	acceptOne: async ({ request, locals }) => {
		const admin = requireAdmin(locals);
		const formData = await request.formData();
		const [shareId = '', sectionId = ''] = String(formData.get('suggestion') ?? '').split(':');
		try {
			await acceptSuggestion({ actor: admin, shareId, sectionId });
		} catch (err) {
			if (err instanceof SuggestionError) {
				return fail(err.status, { actionType: 'acceptOne', error: t('suggest.failed') });
			}
			throw err;
		}
		return { actionType: 'acceptOne', success: true, message: t('suggest.accepted') };
	},

	acceptAll: async ({ request, locals }) => {
		const admin = requireAdmin(locals);
		const formData = await request.formData();
		const count = await acceptAllSuggestions({
			actor: admin,
			shareIds: readStringList(formData, 'pageShareIds')
		});
		return {
			actionType: 'acceptAll',
			success: true,
			message: t('suggest.acceptedAll', { count })
		};
	},

	assign: async ({ request, locals }) => {
		const admin = requireAdmin(locals);
		const formData = await request.formData();
		const shareIds = readStringList(formData, 'shareIds');
		const sectionIds = readStringList(formData, 'sectionIds');

		try {
			const result = await bulkAssignSharesToSections(
				{ shareIds, sectionIds },
				admin.id,
				locals.requestId
			);
			return {
				actionType: 'assign',
				success: true,
				assignedShareCount: result.assignedShareCount,
				message: t('admin.assigned', {
					shares: result.assignedShareCount,
					sections: result.sectionCount
				})
			};
		} catch (err) {
			if (err instanceof AdminServiceError) {
				return fail(err.status, {
					actionType: 'assign',
					error: err.message,
					errorCode: err.code
				});
			}
			throw err;
		}
	}
};
