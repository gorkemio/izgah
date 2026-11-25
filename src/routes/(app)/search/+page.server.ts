import { redirect, type Actions } from '@sveltejs/kit';
import {
	DEFAULT_SEARCH_LIMIT,
	MAX_SEARCH_OFFSET,
	searchResources
} from '#lib/server/search/service.ts';
import { _feedShareActions } from '../+page.server';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ depends, locals, url }) => {
	// Not app:feed: preview polling and likes elsewhere must not re-run (and re-log) searches (C2).
	depends('app:search');

	if (!locals.user) {
		redirect(303, '/login');
	}

	const rawQuery = url.searchParams.get('q') ?? '';
	const rawScope = url.searchParams.get('scope');
	const rawSectionId = rawScope === 'all' ? null : url.searchParams.get('section') || null;
	const rawType = url.searchParams.get('type') || null;
	const rawPage = Number.parseInt(url.searchParams.get('page') ?? '1', 10);
	const maxPage = Math.floor(MAX_SEARCH_OFFSET / DEFAULT_SEARCH_LIMIT) + 1;
	const pageNumber = Number.isFinite(rawPage) ? Math.min(Math.max(rawPage, 1), maxPage) : 1;

	const searchResult = await searchResources({
		userId: locals.user.id,
		query: rawQuery,
		sectionId: rawSectionId,
		contentType: rawType,
		offset: (pageNumber - 1) * DEFAULT_SEARCH_LIMIT
	});

	return {
		...searchResult,
		editShareId: url.searchParams.get('edit') || null,
		deleteShareId: url.searchParams.get('delete') || null
	};
};

export const actions: Actions = _feedShareActions;
