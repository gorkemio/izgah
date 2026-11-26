import { getAdminSidebarCounts, requireAdmin } from '#lib/server/admin/service.ts';
import { smartCaptureAttentionCount } from '#lib/server/smart-capture/admin.ts';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ depends, locals }) => {
	depends('izgah:admin');
	const admin = requireAdmin(locals);
	const [counts, aiAttentionCount] = await Promise.all([
		getAdminSidebarCounts(),
		smartCaptureAttentionCount()
	]);

	return {
		admin,
		unassignedCount: counts.unassignedCount,
		deadJobsCount: counts.deadJobsCount,
		aiAttentionCount
	};
};
