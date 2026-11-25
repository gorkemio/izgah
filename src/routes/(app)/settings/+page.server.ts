import { error, fail, redirect, type Cookies } from '@sveltejs/kit';
import { recordAuditLog } from '#lib/server/audit.ts';
import {
	changeUserPassword,
	PasswordChangeError,
	useSecureCookies
} from '#lib/server/auth/better-auth.ts';
import { checkPasswordChangeRateLimit } from '#lib/server/auth/rate-limit.ts';
import { isLocale, LOCALE_COOKIE, t } from '#lib/i18n/index.ts';
import { setHeadersOnce } from '#lib/server/http/headers.ts';
import { sanitizeInternalPath } from '#lib/server/http/safe-path.ts';
import { PALETTE_COOKIES, THEME_COOKIE, THEME_VALUES } from '#lib/server/http/theme.ts';
import {
	ACCENT_VALUES,
	DARK_THEME_VALUES,
	LIGHT_THEME_VALUES,
	parseAllowed,
	type Palette
} from '#lib/types/appearance.ts';
import type { Actions, PageServerLoad } from './$types';

/** Shared flags of the appearance cookies (docs/designs/izgah-ui-v2.md §9, izgah-themes.md §3). */
function setAppearanceCookie(cookies: Cookies, name: string, value: string): void {
	cookies.set(name, value, {
		path: '/',
		maxAge: 60 * 60 * 24 * 365,
		sameSite: 'lax',
		httpOnly: true,
		secure: useSecureCookies
	});
}

export const load: PageServerLoad = async ({ locals, request, setHeaders }) => {
	setHeadersOnce({ request, setHeaders }, { 'Cache-Control': 'no-store' });

	if (!locals.user || !locals.session) {
		error(401, t('auth.signInRequired'), { requestId: locals.requestId });
	}

	return {
		user: locals.user
	};
};

export const actions: Actions = {
	/**
	 * Stores the theme preference in the `izgah_theme` cookie (docs/designs/izgah-ui-v2.md §9).
	 * Works without JS (303 back to the page); enhanced submissions get the value back so the
	 * client can update `<html data-theme>` without reloading.
	 */
	setTheme: async ({ locals, request, cookies }) => {
		if (!locals.user) {
			error(401, t('auth.signInRequired'), { requestId: locals.requestId });
		}
		const formData = await request.formData();
		const theme = parseAllowed(THEME_VALUES, formData.get('theme'));
		if (!theme) {
			return fail(400, { formType: 'setTheme' as const, error: t('settings.invalidTheme') });
		}
		setAppearanceCookie(cookies, THEME_COOKIE, theme);
		if (request.headers.has('x-sveltekit-action')) {
			return { formType: 'setTheme' as const, theme };
		}
		redirect(303, sanitizeInternalPath(formData.get('returnTo'), { fallback: '/settings' }));
	},

	/**
	 * Stores the light/dark palette and accent in their cookies (docs/designs/izgah-themes.md §3).
	 * Same contract as `setTheme`: 303 back without JS, the values back for enhanced submissions.
	 */
	setPalette: async ({ locals, request, cookies }) => {
		if (!locals.user) {
			error(401, t('auth.signInRequired'), { requestId: locals.requestId });
		}
		const formData = await request.formData();
		const lightTheme = parseAllowed(LIGHT_THEME_VALUES, formData.get('lightTheme'));
		const darkTheme = parseAllowed(DARK_THEME_VALUES, formData.get('darkTheme'));
		const accent = parseAllowed(ACCENT_VALUES, formData.get('accent'));
		if (!lightTheme || !darkTheme || !accent) {
			return fail(400, { formType: 'setPalette' as const, error: t('settings.invalidTheme') });
		}
		const palette: Palette = { lightTheme, darkTheme, accent };
		for (const key of Object.keys(PALETTE_COOKIES) as Array<keyof Palette>) {
			setAppearanceCookie(cookies, PALETTE_COOKIES[key], palette[key]);
		}
		if (request.headers.has('x-sveltekit-action')) {
			return { formType: 'setPalette' as const, palette };
		}
		redirect(303, sanitizeInternalPath(formData.get('returnTo'), { fallback: '/settings' }));
	},

	/**
	 * Stores the member's interface language in the `izgah_locale` cookie
	 * (docs/designs/izgah-i18n-oss.md §2). Always answers with a 303 so the page reloads in the new
	 * language, with or without JavaScript.
	 */
	setLocale: async ({ locals, request, cookies }) => {
		if (!locals.user) {
			error(401, t('error.unauthorized'), { requestId: locals.requestId });
		}
		const formData = await request.formData();
		const locale = formData.get('locale');
		if (!isLocale(locale)) {
			return fail(400, { formType: 'setLocale' as const, error: t('settings.invalidLocale') });
		}
		setAppearanceCookie(cookies, LOCALE_COOKIE, locale);
		redirect(303, sanitizeInternalPath(formData.get('returnTo'), { fallback: '/settings' }));
	},

	changePassword: async ({ locals, request, setHeaders }) => {
		setHeadersOnce({ request, setHeaders }, { 'Cache-Control': 'no-store' });

		if (!locals.user || !locals.session) {
			error(401, t('auth.signInRequired'), { requestId: locals.requestId });
		}

		const rateLimit = checkPasswordChangeRateLimit(locals.user.id);
		if (!rateLimit.allowed) {
			setHeadersOnce(
				{ request, setHeaders },
				{ 'Retry-After': String(rateLimit.retryAfterSeconds) }
			);
			return fail(429, {
				error: t('settings.tooManyPasswordChanges')
			});
		}

		const formData = await request.formData();
		const currentPassword = String(formData.get('currentPassword') ?? '');
		const newPassword = String(formData.get('newPassword') ?? '');

		try {
			await changeUserPassword({
				userId: locals.user.id,
				currentSessionId: locals.session.id,
				currentPassword,
				newPassword
			});

			await recordAuditLog({
				actorUserId: locals.user.id,
				action: 'user.password_changed',
				targetType: 'user',
				targetId: locals.user.id,
				metadata: { email: locals.user.email },
				requestId: locals.requestId
			});

			return {
				passwordChanged: true,
				message: t('settings.passwordUpdated')
			};
		} catch (err) {
			if (err instanceof PasswordChangeError) {
				return fail(err.status, {
					error: err.message
				});
			}
			throw err;
		}
	}
};
