import { error, fail } from '@sveltejs/kit';
import { recordAuditLog } from '#lib/server/audit.ts';
import {
	ApiKeyLimitError,
	ApiKeyValidationError,
	createApiKey,
	listUserApiKeys,
	MAX_ACTIVE_API_KEYS_PER_USER,
	revokeApiKey
} from '#lib/server/auth/api-keys.ts';
import { setHeadersOnce } from '#lib/server/http/headers.ts';
import type { Actions, PageServerLoad } from './$types';
import { t } from '#lib/i18n/index.ts';

export const load: PageServerLoad = async ({ locals, request, setHeaders }) => {
	setHeadersOnce({ request, setHeaders }, { 'Cache-Control': 'no-store' });

	if (!locals.user || !locals.session) {
		error(401, t('auth.signInRequired'), { requestId: locals.requestId });
	}

	const apiKeys = await listUserApiKeys(locals.user.id);

	return {
		user: locals.user,
		apiKeys,
		maxKeys: MAX_ACTIVE_API_KEYS_PER_USER
	};
};

export const actions: Actions = {
	create: async ({ locals, request, setHeaders }) => {
		setHeadersOnce({ request, setHeaders }, { 'Cache-Control': 'no-store' });

		if (!locals.user || !locals.session) {
			error(401, t('auth.signInRequired'), { requestId: locals.requestId });
		}

		const formData = await request.formData();
		const name = String(formData.get('name') ?? '');

		try {
			const created = await createApiKey(locals.user.id, name);

			await recordAuditLog({
				actorUserId: locals.user.id,
				action: 'api_key.created',
				targetType: 'api_key',
				targetId: created.id,
				metadata: {
					name: created.name,
					keyPrefix: created.keyPrefix
				},
				requestId: locals.requestId
			});

			return {
				createdKey: {
					id: created.id,
					name: created.name,
					keyPrefix: created.keyPrefix,
					rawKey: created.rawKey
				}
			};
		} catch (err) {
			if (err instanceof ApiKeyValidationError) {
				return fail(422, {
					name,
					createError: err.message
				});
			}
			if (err instanceof ApiKeyLimitError) {
				return fail(409, {
					name,
					createError: err.message
				});
			}
			throw err;
		}
	},

	revoke: async ({ locals, request, setHeaders }) => {
		setHeadersOnce({ request, setHeaders }, { 'Cache-Control': 'no-store' });

		if (!locals.user || !locals.session) {
			error(401, t('auth.signInRequired'), { requestId: locals.requestId });
		}

		const formData = await request.formData();
		const keyId = String(formData.get('keyId') ?? '').trim();
		if (!keyId) {
			return fail(400, {
				revokeError: t('apiKey.idInvalid')
			});
		}

		const revoked = await revokeApiKey(keyId, locals.user.id);
		if (!revoked) {
			return fail(404, {
				revokeError: t('apiKey.notFound')
			});
		}

		await recordAuditLog({
			actorUserId: locals.user.id,
			action: 'api_key.revoked',
			targetType: 'api_key',
			targetId: keyId,
			requestId: locals.requestId
		});

		return {
			revokedKeyId: keyId
		};
	}
};
