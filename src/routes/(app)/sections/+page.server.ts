import type { PageServerLoad } from './$types';

// The section list comes from the (app) layout loader; no extra query (izgah-ui-v2 Karar 6).
export const load: PageServerLoad = async ({ parent }) => {
	const { sections, user } = await parent();
	return { sections, user };
};
