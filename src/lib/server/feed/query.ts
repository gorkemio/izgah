import { and, eq, exists, isNull, type SQL } from 'drizzle-orm';
import { db } from '#lib/server/db/client.ts';
import {
	canonicalResources,
	linkShareSections,
	linkShares,
	type ContentType
} from '#lib/server/db/schema.ts';

/**
 * Scope of a feed view, shared by the feed/section page loader and the new-posts counter so a
 * refresh shows exactly what the pill counted: the main feed shows feed-visible shares only; a
 * section shows every active share linked to it (silent ones included). Callers must join
 * `canonical_resources` when `type` is set.
 */
export function feedScopeConditions(options: {
	sectionId?: string | null;
	type?: ContentType | null;
}): SQL[] {
	const conditions: SQL[] = [isNull(linkShares.deletedAt)];
	if (options.sectionId) {
		conditions.push(
			exists(
				db
					.select({ shareId: linkShareSections.shareId })
					.from(linkShareSections)
					.where(
						and(
							eq(linkShareSections.shareId, linkShares.id),
							eq(linkShareSections.sectionId, options.sectionId)
						)
					)
			)
		);
	} else {
		conditions.push(eq(linkShares.isFeedVisible, true));
	}
	if (options.type) {
		conditions.push(eq(canonicalResources.contentType, options.type));
	}
	return conditions;
}
