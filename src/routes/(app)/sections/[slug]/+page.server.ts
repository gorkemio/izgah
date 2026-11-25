import { error, type Actions } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/client.ts';
import { sections } from '#lib/server/db/schema.ts';
import { _feedShareActions, _loadFeedPage } from '../../+page.server';
import type { PageServerLoad } from './$types';
import { t } from '#lib/i18n/index.ts';

export const load: PageServerLoad = async ({ depends, locals, params, url }) => {
	const [section] = await db
		.select({
			id: sections.id,
			slug: sections.slug,
			name: sections.name,
			description: sections.description,
			sortOrder: sections.sortOrder
		})
		.from(sections)
		.where(eq(sections.slug, params.slug))
		.limit(1);

	if (!section) {
		error(404, t('section.notFound'));
	}

	const feed = await _loadFeedPage({
		depends,
		url,
		sectionId: section.id,
		viewerUserId: locals.user?.id
	});

	return {
		section,
		...feed
	};
};

export const actions: Actions = _feedShareActions;
