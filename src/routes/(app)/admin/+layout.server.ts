import { getAdminSidebarCounts, requireAdmin } from '#lib/server/admin/service.ts';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ depends, locals }) => {
	depends('izgah:admin');
	const admin = requireAdmin(locals);
	const counts = await getAdminSidebarCounts();

	return {
		admin,
		unassignedCount: counts.unassignedCount,
		deadJobsCount: counts.deadJobsCount
	};
};
