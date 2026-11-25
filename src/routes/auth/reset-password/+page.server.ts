import { error, fail, redirect } from '@sveltejs/kit';
import { recordAuditLog } from '#lib/server/audit.ts';
import { clearSessionCookies } from '#lib/server/auth/better-auth.ts';
import {
	checkAuthTokenPostRateLimit,
	checkAuthTokenRateLimit,
	extractClientIp
} from '#lib/server/auth/rate-limit.ts';
import {
	consumeInviteToken,
	inspectInviteToken,
	InviteTokenGoneError,
	InviteTokenValidationError
} from '#lib/server/auth/tokens.ts';
import { setHeadersOnce } from '#lib/server/http/headers.ts';
import type { Actions, PageServerLoad } from './$types';
import { t } from '#lib/i18n/index.ts';

const AUTH_SECURITY_HEADERS = {
	'Referrer-Policy': 'no-referrer',
	'Cache-Control': 'no-store'
} as const;

export const load: PageServerLoad = async (event) => {
	setHeadersOnce(event, AUTH_SECURITY_HEADERS);

	const token = event.url.searchParams.get('token') ?? '';
	const rateLimit = checkAuthTokenRateLimit(extractClientIp(event), token, event.request);
	if (!rateLimit.allowed) {
		setHeadersOnce(event, {
			...AUTH_SECURITY_HEADERS,
			'Retry-After': String(rateLimit.retryAfterSeconds)
		});
		error(429, t('auth.tooManyAttempts'), { requestId: event.locals.requestId });
	}

	const inspected = await inspectInviteToken(token, 'password_reset');
	if (!inspected) {
		error(410, t('auth.resetInvalid'), { requestId: event.locals.requestId });
	}

	return {
		token,
		email: inspected.user.email
	};
};

export const actions: Actions = {
	default: async (event) => {
		setHeadersOnce(event, AUTH_SECURITY_HEADERS);

		const formData = await event.request.formData();
		const token = String(formData.get('token') ?? event.url.searchParams.get('token') ?? '');
		const password = String(formData.get('password') ?? '');

		const ip = extractClientIp(event);
		const rateLimit = checkAuthTokenPostRateLimit(ip, token, event.request);
		if (!rateLimit.allowed) {
			setHeadersOnce(event, {
				...AUTH_SECURITY_HEADERS,
				'Retry-After': String(rateLimit.retryAfterSeconds)
			});
			return fail(429, {
				error: t('auth.tooManyAttempts')
			});
		}

		try {
			const result = await consumeInviteToken(token, 'password_reset', password);
			clearSessionCookies(event.cookies);

			await recordAuditLog({
				actorUserId: result.user.id,
				action: 'user.password_reset_completed',
				targetType: 'user',
				targetId: result.user.id,
				metadata: { email: result.user.email },
				requestId: event.locals.requestId
			});
		} catch (err) {
			if (err instanceof InviteTokenValidationError) {
				return fail(422, {
					error: err.message
				});
			}
			if (err instanceof InviteTokenGoneError) {
				return fail(410, {
					tokenGone: true,
					error: t('auth.resetInvalid')
				});
			}
			throw err;
		}

		redirect(303, '/login?reset=1');
	}
};
