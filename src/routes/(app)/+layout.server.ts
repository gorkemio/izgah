import { redirect } from '@sveltejs/kit';
import { parsePalette, parseThemePreference, THEME_COOKIE } from '$lib/server/http/theme';
import { detectModifierKey } from '$lib/platform';
import { listSections } from '$lib/server/sections/service';
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
			role: locals.user.role
		},
		sections,
		theme: parseThemePreference(cookies.get(THEME_COOKIE)),
		palette: parsePalette((name) => cookies.get(name)),
		modifierKey: detectModifierKey(request.headers),
		composeRequested: url.searchParams.get('compose') === '1',
		editShareId: url.searchParams.get('edit') || null,
		deleteShareId: url.searchParams.get('delete') || null
	};
};
