import { fail, type Actions } from '@sveltejs/kit';
import {
	AdminServiceError,
	bulkAssignSharesToSections,
	listUnassignedShares,
	requireAdmin
} from '#lib/server/admin/service.ts';
import { listSections } from '#lib/server/sections/service.ts';
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

	return {
		items: unassigned.items,
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
