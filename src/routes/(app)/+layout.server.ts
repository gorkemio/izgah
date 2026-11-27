import { redirect } from '@sveltejs/kit';
import {
	EFFECTS_COOKIE,
	parseEffectLevel,
	parsePalette,
	parseThemePreference,
	THEME_COOKIE
} from '#lib/server/http/theme.ts';
import { detectModifierKey } from '#lib/platform.ts';
import { listSections } from '#lib/server/sections/service.ts';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url, cookies, request }) => {
	if (!locals.user) {
		redirect(303, '/login');
	}

	const sections = await listSections();

	return {
		user: {
			id: locals.user.id,
			name: locals.user.name,
			email: locals.user.email,
			role: locals.user.role,
			avatarAssetKey: locals.user.avatarAssetKey ?? null
		},
		sections,
		theme: parseThemePreference(cookies.get(THEME_COOKIE)),
		palette: parsePalette((name) => cookies.get(name)),
		effects: parseEffectLevel(cookies.get(EFFECTS_COOKIE)),
		modifierKey: detectModifierKey(request.headers),
		composeRequested: url.searchParams.get('compose') === '1'
	};
};
