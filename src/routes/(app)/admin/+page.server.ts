import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** /admin has no page of its own; members management is the first admin tab (izgah-ui-v5.md §5.10). */
export const load: PageServerLoad = () => {
	redirect(307, '/admin/users');
};
