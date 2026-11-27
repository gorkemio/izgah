import { error, fail, redirect, type Cookies } from '@sveltejs/kit';
import { recordAuditLog } from '#lib/server/audit.ts';
import {
	changeUserPassword,
	PasswordChangeError,
	useSecureCookies
} from '#lib/server/auth/better-auth.ts';
import {
	checkAvatarUploadRateLimit,
	checkPasswordChangeRateLimit
} from '#lib/server/auth/rate-limit.ts';
import {
	AvatarError,
	MAX_AVATAR_BYTES,
	removeUserAvatar,
	setUserAvatar,
	type AvatarErrorCode
} from '#lib/server/media/avatars.ts';
import type { MessageKey } from '#lib/i18n/messages/en.ts';
import { isLocale, LOCALE_COOKIE, t } from '#lib/i18n/index.ts';
import { setHeadersOnce } from '#lib/server/http/headers.ts';
import { sanitizeInternalPath } from '#lib/server/http/safe-path.ts';
import {
	EFFECT_VALUES,
	EFFECTS_COOKIE,
	PALETTE_COOKIES,
	THEME_COOKIE,
	THEME_VALUES
} from '#lib/server/http/theme.ts';
import {
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

function avatarErrorKey(code: AvatarErrorCode): MessageKey {
	switch (code) {
		case 'empty':
			return 'settings.avatarEmpty';
		case 'too_large':
			return 'settings.avatarTooLarge';
		case 'low_disk':
			return 'settings.avatarLowDisk';
		default:
			return 'settings.avatarUnsupported';
	}
}

export const load: PageServerLoad = async ({ locals, request, setHeaders }) => {
	setHeadersOnce({ request, setHeaders }, { 'Cache-Control': 'no-store' });

	if (!locals.user || !locals.session) {
		error(401, t('auth.signInRequired'), { requestId: locals.requestId });
	}

	return {
		user: { ...locals.user, avatarAssetKey: locals.user.avatarAssetKey ?? null }
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
	 * Stores the effect level in the `izgah_effects` cookie (docs/designs/izgah-ui-v5.md §7); the
	 * client has already applied it to `<html data-effects>`.
	 */
	setEffects: async ({ locals, request, cookies }) => {
		if (!locals.user) {
			error(401, t('auth.signInRequired'), { requestId: locals.requestId });
		}
		const formData = await request.formData();
		const effects = parseAllowed(EFFECT_VALUES, formData.get('effects'));
		if (!effects) {
			return fail(400, { formType: 'setEffects' as const, error: t('settings.invalidEffects') });
		}
		setAppearanceCookie(cookies, EFFECTS_COOKIE, effects);
		if (request.headers.has('x-sveltekit-action')) {
			return { formType: 'setEffects' as const, effects };
		}
		redirect(303, sanitizeInternalPath(formData.get('returnTo'), { fallback: '/settings' }));
	},

	/**
	 * Stores the light/dark palette in their cookies (docs/designs/izgah-themes.md §3).
	 * Same contract as `setTheme`: 303 back without JS, the values back for enhanced submissions.
	 */
	setPalette: async ({ locals, request, cookies }) => {
		if (!locals.user) {
			error(401, t('auth.signInRequired'), { requestId: locals.requestId });
		}
		const formData = await request.formData();
		const lightTheme = parseAllowed(LIGHT_THEME_VALUES, formData.get('lightTheme'));
		const darkTheme = parseAllowed(DARK_THEME_VALUES, formData.get('darkTheme'));
		if (!lightTheme || !darkTheme) {
			return fail(400, { formType: 'setPalette' as const, error: t('settings.invalidTheme') });
		}
		const palette: Palette = { lightTheme, darkTheme };
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

	/** Uploads a profile photo (docs/designs/izgah-ui-v5.md §10.2). */
	setAvatar: async ({ locals, request, setHeaders }) => {
		if (!locals.user || !locals.session) {
			error(401, t('auth.signInRequired'), { requestId: locals.requestId });
		}
		const rateLimit = checkAvatarUploadRateLimit(locals.user.id);
		if (!rateLimit.allowed) {
			setHeadersOnce(
				{ request, setHeaders },
				{ 'Retry-After': String(rateLimit.retryAfterSeconds) }
			);
			return fail(429, {
				formType: 'avatar' as const,
				error: t('settings.tooManyAvatarChanges')
			});
		}

		const declaredLength = Number(request.headers.get('content-length') ?? 0);
		if (declaredLength > MAX_AVATAR_BYTES + 64 * 1024) {
			return fail(413, { formType: 'avatar' as const, error: t('settings.avatarTooLarge') });
		}
		const formData = await request.formData();
		const file = formData.get('avatar');
		if (!(file instanceof File) || file.size === 0) {
			return fail(400, { formType: 'avatar' as const, error: t('settings.avatarEmpty') });
		}
		if (file.size > MAX_AVATAR_BYTES) {
			return fail(413, { formType: 'avatar' as const, error: t('settings.avatarTooLarge') });
		}

		try {
			const assetKey = await setUserAvatar(
				locals.user.id,
				new Uint8Array(await file.arrayBuffer())
			);
			await recordAuditLog({
				actorUserId: locals.user.id,
				action: 'user.avatar_updated',
				targetType: 'user',
				targetId: locals.user.id,
				metadata: { assetKey },
				requestId: locals.requestId
			});
			return {
				formType: 'avatar' as const,
				avatarAssetKey: assetKey,
				message: t('settings.avatarUpdated')
			};
		} catch (err) {
			if (err instanceof AvatarError) {
				return fail(err.code === 'too_large' ? 413 : err.code === 'low_disk' ? 507 : 400, {
					formType: 'avatar' as const,
					error: t(avatarErrorKey(err.code))
				});
			}
			throw err;
		}
	},

	removeAvatar: async ({ locals }) => {
		if (!locals.user || !locals.session) {
			error(401, t('auth.signInRequired'), { requestId: locals.requestId });
		}
		const rateLimit = checkAvatarUploadRateLimit(locals.user.id);
		if (!rateLimit.allowed) {
			return fail(429, {
				formType: 'avatar' as const,
				error: t('settings.tooManyAvatarChanges')
			});
		}
		const removed = await removeUserAvatar(locals.user.id);
		if (removed) {
			await recordAuditLog({
				actorUserId: locals.user.id,
				action: 'user.avatar_removed',
				targetType: 'user',
				targetId: locals.user.id,
				requestId: locals.requestId
			});
		}
		return {
			formType: 'avatar' as const,
			avatarAssetKey: null,
			message: t('settings.avatarRemoved')
		};
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
