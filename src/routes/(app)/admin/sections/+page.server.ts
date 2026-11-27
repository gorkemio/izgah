import { fail, type Actions } from '@sveltejs/kit';
import {
	AdminServiceError,
	createAdminSection,
	deleteAdminSection,
	listAdminSections,
	moveAdminSection,
	requireAdmin,
	resolveSectionSilentShares,
	updateAdminSection
} from '#lib/server/admin/service.ts';
import type { PageServerLoad } from './$types';
import { t } from '#lib/i18n/index.ts';

export const load: PageServerLoad = async ({ depends, locals }) => {
	depends('izgah:admin:sections');
	requireAdmin(locals);
	const sections = await listAdminSections();

	return { sections };
};

function readText(data: FormData, key: string): string {
	const value = data.get(key);
	return typeof value === 'string' ? value : '';
}

function handleSectionError(err: unknown, actionType: string, extra: Record<string, unknown> = {}) {
	if (err instanceof AdminServiceError) {
		return fail(err.status, {
			actionType,
			error: err.message,
			errorCode: err.code,
			...extra
		});
	}
	throw err;
}

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const admin = requireAdmin(locals);
		const formData = await request.formData();
		const name = readText(formData, 'name');
		const slug = readText(formData, 'slug');
		const description = readText(formData, 'description');

		try {
			const created = await createAdminSection(
				{ name, slug, description },
				admin.id,
				locals.requestId
			);
			return {
				actionType: 'create',
				success: true,
				message: t('admin.sectionCreatedMsg', { name: created.name })
			};
		} catch (err) {
			return handleSectionError(err, 'create', {
				values: { name, slug, description }
			});
		}
	},

	update: async ({ request, locals }) => {
		const admin = requireAdmin(locals);
		const formData = await request.formData();
		const sectionId = readText(formData, 'sectionId').trim();
		const name = readText(formData, 'name');
		const slug = readText(formData, 'slug');
		const description = readText(formData, 'description');

		try {
			const updated = await updateAdminSection(
				sectionId,
				{ name, slug, description },
				admin.id,
				locals.requestId
			);
			return {
				actionType: 'update',
				success: true,
				message: t('admin.sectionUpdatedMsg', { name: updated.name })
			};
		} catch (err) {
			return handleSectionError(err, 'update', {
				sectionId,
				values: { name, slug, description }
			});
		}
	},

	move: async ({ request, locals }) => {
		const admin = requireAdmin(locals);
		const formData = await request.formData();
		const sectionId = readText(formData, 'sectionId').trim();
		const direction = readText(formData, 'direction') === 'up' ? 'up' : 'down';

		try {
			const result = await moveAdminSection(sectionId, direction, admin.id, locals.requestId);
			return {
				actionType: 'move',
				success: true,
				moved: result.moved,
				orderedSectionIds: result.orderedSectionIds,
				message: result.moved ? t('admin.sectionOrderUpdated') : t('admin.sectionAtEdge')
			};
		} catch (err) {
			return handleSectionError(err, 'move');
		}
	},

	delete: async ({ request, locals }) => {
		const admin = requireAdmin(locals);
		const formData = await request.formData();
		const sectionId = readText(formData, 'sectionId').trim();

		try {
			const deleted = await deleteAdminSection(sectionId, admin.id, locals.requestId);
			return {
				actionType: 'delete',
				success: true,
				deletedSectionId: deleted.deletedSectionId,
				message: t('admin.sectionDeletedMsg', { name: deleted.sectionName })
			};
		} catch (err) {
			if (err instanceof AdminServiceError && err.code === 'SECTION_HAS_EXCLUSIVE_SILENT_SHARES') {
				return fail(409, {
					actionType: 'delete',
					error: err.message,
					errorCode: err.code,
					conflictSectionId: sectionId,
					exclusiveSilentShareCount: Number(err.details?.exclusiveSilentShareCount ?? 0)
				});
			}
			return handleSectionError(err, 'delete');
		}
	},

	resolveSilentShares: async ({ request, locals }) => {
		const admin = requireAdmin(locals);
		const formData = await request.formData();
		const sourceSectionId = readText(formData, 'sourceSectionId').trim();
		const rawMode = readText(formData, 'mode');
		const mode = rawMode === 'move' ? 'move' : rawMode === 'publish' ? 'publish' : null;
		const targetSectionId = readText(formData, 'targetSectionId').trim() || null;

		if (!mode) {
			return fail(422, {
				actionType: 'resolveSilentShares',
				error: t('admin.resolvePick')
			});
		}

		try {
			const resolved = await resolveSectionSilentShares(
				{ sourceSectionId, mode, targetSectionId },
				admin.id,
				locals.requestId
			);
			return {
				actionType: 'resolveSilentShares',
				success: true,
				resolvedSectionId: sourceSectionId,
				affectedShareCount: resolved.affectedShareCount,
				message:
					mode === 'move'
						? t('admin.silentMoved', { count: resolved.affectedShareCount })
						: t('admin.silentPublished', { count: resolved.affectedShareCount })
			};
		} catch (err) {
			return handleSectionError(err, 'resolveSilentShares', {
				conflictSectionId: sourceSectionId
			});
		}
	}
};
