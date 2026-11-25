import { fail, redirect } from '@sveltejs/kit';
import { applyResponseSetCookies, auth, sanitizeNextPath } from '$lib/server/auth/better-auth';
import { checkLoginRateLimit, extractClientIp } from '$lib/server/auth/rate-limit';
import { setHeadersOnce } from '$lib/server/http/headers';
import type { Actions, PageServerLoad } from './$types';
import { t } from '$lib/i18n';

export const load: PageServerLoad = async ({ locals, url, request, setHeaders }) => {
	setHeadersOnce({ request, setHeaders }, { 'Cache-Control': 'no-store' });

	const next = sanitizeNextPath(url.searchParams.get('next'));
	if (locals.user) {
		redirect(303, next);
	}

	return {
		next,
		resetSuccess: url.searchParams.get('reset') === '1'
	};
};

export const actions: Actions = {
	default: async (event) => {
		setHeadersOnce(event, { 'Cache-Control': 'no-store' });

		const formData = await event.request.formData();
		const emailRaw = String(formData.get('email') ?? '');
		const password = String(formData.get('password') ?? '');
		const next = sanitizeNextPath(
			String(formData.get('next') ?? '') || event.url.searchParams.get('next')
		);

		const ip = extractClientIp(event);
		const rateLimit = checkLoginRateLimit(ip, emailRaw, event.request);
		if (!rateLimit.allowed) {
			setHeadersOnce(event, {
				'Retry-After': String(rateLimit.retryAfterSeconds),
				'Cache-Control': 'no-store'
			});
			return fail(429, {
				email: emailRaw.trim(),
				next,
				error: t('auth.tooManyLogins15')
			});
		}

		const normalizedEmail = emailRaw.trim().toLowerCase();
		if (!normalizedEmail || password.length === 0) {
			return fail(400, {
				email: normalizedEmail,
				next,
				error: t('login.required')
			});
		}

		let signInResponse: Response;
		try {
			signInResponse = await auth.api.signInEmail({
				body: {
					email: normalizedEmail,
					password
				},
				headers: event.request.headers,
				asResponse: true
			});
		} catch {
			return fail(401, {
				email: normalizedEmail,
				next,
				error: t('auth.badCredentials')
			});
		}

		if (!signInResponse.ok) {
			return fail(401, {
				email: normalizedEmail,
				next,
				error: t('auth.badCredentials')
			});
		}

		applyResponseSetCookies(signInResponse.headers, event.cookies);
		redirect(303, next);
	}
};
