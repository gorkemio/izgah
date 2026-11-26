import { countSharesBySection } from '#lib/server/sections/service.ts';
import type { PageServerLoad } from './$types';

// The section list comes from the (app) layout loader (izgah-ui-v2 Karar 6); only the counts are
// queried here (izgah-ui-v4 §5).
export const load: PageServerLoad = async ({ parent }) => {
	const [{ sections, user }, counts] = await Promise.all([parent(), countSharesBySection()]);
	return {
		sections: sections.map((section) => ({ ...section, shareCount: counts.get(section.id) ?? 0 })),
		user
	};
};
