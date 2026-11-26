import { dev } from '$app/env';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * UI v5 theme lab (docs/designs/izgah-ui-v5.md §15, M1): a development-only page where the
 * maintainer compares the theme and font candidates. Production answers 404.
 */
export const load: PageServerLoad = () => {
	if (!dev) {
		error(404, 'Not found');
	}
	return {};
};
