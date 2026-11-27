import { countSharesBySection, listSectionActivity } from '#lib/server/sections/service.ts';
import type { PageServerLoad } from './$types';

// The section list comes from the (app) layout loader (izgah-ui-v2 Karar 6); the counts and the
// recent contributors are queried here (izgah-ui-v5.md §5.4).
export const load: PageServerLoad = async ({ parent }) => {
	const [{ sections, user }, counts, activity] = await Promise.all([
		parent(),
		countSharesBySection(),
		listSectionActivity()
	]);
	return {
		sections: sections.map((section) => ({
			...section,
			shareCount: counts.get(section.id) ?? 0,
			contributors: activity.get(section.id)?.contributors ?? [],
			lastSharedAt: activity.get(section.id)?.lastSharedAt ?? null
		})),
		user
	};
};
