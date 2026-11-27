import { fail, type Actions } from '@sveltejs/kit';
import { env } from '#lib/server/env.ts';
import {
	AdminServiceError,
	changeAdminUserRole,
	disableAdminUser,
	inviteAdminUser,
	issuePasswordResetLink,
	listAdminUsers,
	regenerateUserInvite,
	removeMemberAvatar,
	requireAdmin
} from '#lib/server/admin/service.ts';
import type { UserRole } from '#lib/server/db/schema.ts';
import type { PageServerLoad } from './$types';
import { t } from '#lib/i18n/index.ts';

export const load: PageServerLoad = async ({ depends, locals }) => {
	depends('izgah:admin:users');
	const admin = requireAdmin(locals);
	const users = await listAdminUsers();

	return {
		users,
		currentAdminId: admin.id
	};
};

function readFormText(data: FormData, key: string): string {
	const value = data.get(key);
	return typeof value === 'string' ? value : '';
}

function handleAdminError(err: unknown, actionType: string, values?: Record<string, string>) {
	if (err instanceof AdminServiceError) {
		return fail(err.status, {
			actionType,
			error: err.message,
			errorCode: err.code,
			values
		});
	}
	throw err;
}

export const actions: Actions = {
	invite: async ({ request, locals, url }) => {
		const admin = requireAdmin(locals);
		const formData = await request.formData();
		const name = readFormText(formData, 'name');
		const email = readFormText(formData, 'email');
		const rawRole = readFormText(formData, 'role') || 'member';
		const role: UserRole = rawRole === 'admin' ? 'admin' : 'member';

		try {
			const result = await inviteAdminUser(
				{
					name,
					email,
					role: rawRole as UserRole,
					originOverride: env.ORIGIN || url.origin
				},
				admin.id,
				locals.requestId
			);

			return {
				actionType: 'invite',
				success: true,
				message: t('admin.inviteCreated', { name: result.user.name, email: result.user.email }),
				issuedLink: {
					kind: 'invite' as const,
					url: result.invite.url,
					expiresAt: result.invite.expiresAt,
					userId: result.user.id,
					userName: result.user.name,
					userEmail: result.user.email
				}
			};
		} catch (err) {
			return handleAdminError(err, 'invite', { name, email, role });
		}
	},

	regenerateInvite: async ({ request, locals, url }) => {
		const admin = requireAdmin(locals);
		const formData = await request.formData();
		const userId = readFormText(formData, 'userId').trim();

		try {
			const result = await regenerateUserInvite(
				userId,
				admin.id,
				locals.requestId,
				env.ORIGIN || url.origin
			);
			return {
				actionType: 'regenerateInvite',
				success: true,
				message: t('admin.inviteRenewed', { name: result.user.name }),
				issuedLink: {
					kind: 'invite' as const,
					url: result.invite.url,
					expiresAt: result.invite.expiresAt,
					userId: result.user.id,
					userName: result.user.name,
					userEmail: result.user.email
				}
			};
		} catch (err) {
			return handleAdminError(err, 'regenerateInvite');
		}
	},

	resetPassword: async ({ request, locals, url }) => {
		const admin = requireAdmin(locals);
		const formData = await request.formData();
		const userId = readFormText(formData, 'userId').trim();

		try {
			const result = await issuePasswordResetLink(
				userId,
				admin.id,
				locals.requestId,
				env.ORIGIN || url.origin
			);
			return {
				actionType: 'resetPassword',
				success: true,
				message: t('admin.resetCreated', { name: result.user.name }),
				issuedLink: {
					kind: 'password_reset' as const,
					url: result.reset.url,
					expiresAt: result.reset.expiresAt,
					userId: result.user.id,
					userName: result.user.name,
					userEmail: result.user.email
				}
			};
		} catch (err) {
			return handleAdminError(err, 'resetPassword');
		}
	},

	changeRole: async ({ request, locals }) => {
		const admin = requireAdmin(locals);
		const formData = await request.formData();
		const userId = readFormText(formData, 'userId').trim();
		const rawRole = readFormText(formData, 'role');

		try {
			const result = await changeAdminUserRole(
				{ targetUserId: userId, newRole: rawRole as UserRole },
				admin.id,
				locals.requestId
			);
			return {
				actionType: 'changeRole',
				success: true,
				targetUserId: userId,
				message: result.changed
					? t('admin.roleUpdated', {
							name: result.user.name,
							role: result.user.role === 'admin' ? t('role.admin') : t('role.member')
						})
					: t('admin.roleUnchanged', { name: result.user.name })
			};
		} catch (err) {
			return handleAdminError(err, 'changeRole');
		}
	},

	disable: async ({ request, locals }) => {
		const admin = requireAdmin(locals);
		const formData = await request.formData();
		const userId = readFormText(formData, 'userId').trim();

		try {
			const result = await disableAdminUser(userId, admin.id, locals.requestId);
			return {
				actionType: 'disable',
				success: true,
				targetUserId: userId,
				message: t('admin.userDisabledMsg', { name: result.user.name })
			};
		} catch (err) {
			return handleAdminError(err, 'disable');
		}
	},

	removeAvatar: async ({ request, locals }) => {
		const admin = requireAdmin(locals);
		const formData = await request.formData();
		const userId = readFormText(formData, 'userId').trim();

		try {
			const result = await removeMemberAvatar(userId, admin.id, locals.requestId);
			return {
				actionType: 'removeAvatar',
				success: true,
				targetUserId: userId,
				message: result.removed
					? t('admin.avatarRemoved', { name: result.user.name })
					: t('admin.avatarNone', { name: result.user.name })
			};
		} catch (err) {
			return handleAdminError(err, 'removeAvatar');
		}
	}
};
