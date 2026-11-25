import { getAdminUsageMetrics, requireAdmin } from '#lib/server/admin/service.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ depends, locals }) => {
	depends('izgah:admin:metrics');
	requireAdmin(locals);

	const metrics = await getAdminUsageMetrics();

	return {
		metrics
	};
};
