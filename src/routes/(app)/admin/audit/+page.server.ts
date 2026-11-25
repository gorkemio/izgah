import { auditActionLabels, listAuditLogs, requireAdmin } from '#lib/server/admin/service.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ depends, locals, url }) => {
	depends('izgah:admin:audit');
	requireAdmin(locals);

	const action = url.searchParams.get('action')?.trim() || null;
	const cursor = url.searchParams.get('cursor')?.trim() || null;

	const result = await listAuditLogs({ action, cursor });

	return {
		items: result.items,
		nextCursor: result.nextCursor,
		availableActions: result.availableActions,
		selectedAction: action,
		hasActiveCursor: Boolean(cursor),
		actionLabels: auditActionLabels()
	};
};
