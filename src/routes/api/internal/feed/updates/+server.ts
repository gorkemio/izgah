import { json } from '@sveltejs/kit';
import { and, eq, ne, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/client.ts';
import {
	canonicalResources,
	contentTypeEnum,
	linkShares,
	sections,
	type ContentType
} from '#lib/server/db/schema.ts';
import { feedScopeConditions } from '#lib/server/feed/query.ts';
import type { RequestHandler } from './$types';
import { t } from '#lib/i18n/index.ts';

const NEW_POSTS_COUNT_CAP = 100;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function errorResponse(status: number, code: string, message: string, requestId: string) {
	return json(
		{ error: { code, message, requestId } },
		{ status, headers: { 'Cache-Control': 'no-store' } }
	);
}

/**
 * Counts shares newer than `afterId` in the current feed view (docs/designs/izgah-ui-v2.md §10).
 * Polled by the "yeni paylaşım" pill every 60s on visible tabs. The anchor's `(created_at, id)` is
 * read server-side (microsecond precision), never from a client timestamp.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user || locals.authChannel !== 'cookie') {
		return errorResponse(401, 'UNAUTHORIZED', t('auth.signInForActionAlt'), locals.requestId);
	}

	const afterId = url.searchParams.get('afterId')?.trim() || null;
	const sectionId = url.searchParams.get('section')?.trim() || null;
	const rawType = url.searchParams.get('type')?.trim() || null;

	if (
		(afterId !== null && !ID_PATTERN.test(afterId)) ||
		(sectionId !== null && !ID_PATTERN.test(sectionId)) ||
		(rawType !== null && !(contentTypeEnum.enumValues as readonly string[]).includes(rawType))
	) {
		return errorResponse(400, 'VALIDATION_ERROR', t('api.badQuery'), locals.requestId);
	}
	const type = rawType as ContentType | null;

	if (sectionId) {
		const [section] = await db
			.select({ id: sections.id })
			.from(sections)
			.where(eq(sections.id, sectionId))
			.limit(1);
		if (!section) {
			return errorResponse(404, 'NOT_FOUND', t('section.notFound'), locals.requestId);
		}
	}

	const conditions = feedScopeConditions({ sectionId, type });
	conditions.push(ne(linkShares.authorId, locals.user.id));

	if (afterId) {
		const [anchor] = await db
			.select({ id: linkShares.id })
			.from(linkShares)
			.where(eq(linkShares.id, afterId))
			.limit(1);
		if (!anchor) {
			return errorResponse(404, 'NOT_FOUND', t('share.notFound'), locals.requestId);
		}
		conditions.push(
			sql`(${linkShares.createdAt}, ${linkShares.id}) > (SELECT a.created_at, a.id FROM link_shares a WHERE a.id = ${afterId})`
		);
	}

	const capped = db
		.select({ id: linkShares.id })
		.from(linkShares)
		.innerJoin(canonicalResources, eq(canonicalResources.id, linkShares.resourceId))
		.where(and(...conditions))
		.limit(NEW_POSTS_COUNT_CAP)
		.as('capped');
	const [row] = await db.select({ value: sql<number>`count(*)::int` }).from(capped);

	return json({ newCount: Number(row?.value ?? 0) }, { headers: { 'Cache-Control': 'no-store' } });
};
