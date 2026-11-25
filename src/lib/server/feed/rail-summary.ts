import { and, asc, desc, eq, exists, gte, isNull, sql } from 'drizzle-orm';
import { appTimeZone } from '$lib/instance';
import { db, type Database } from '$lib/server/db/client';
import { canonicalResources, linkShares, resourceComments, users } from '$lib/server/db/schema';

export type RailSummaryExecutor = Pick<Database, 'select'>;

export interface RailPopularResource {
	id: string;
	title: string | null;
	domain: string;
	likeCount: number;
	recentCommentCount: number;
}

export interface RailActiveMember {
	id: string;
	name: string;
	shareCount: number;
}

export interface FeedRailSummary {
	todayShares: number;
	todayComments: number;
	popularResources: RailPopularResource[];
	activeMembers: RailActiveMember[];
}

/**
 * Loads the 3 right-rail summary modules directly from PostgreSQL (docs/designs/izgah-ui-v3.md §5).
 * No in-memory cache is used: for a 10-15 person team all queries complete in < 2ms total and
 * running them live in parallel eliminates stale-data invalidation risks.
 */
export async function getFeedRailSummary(
	executor: RailSummaryExecutor = db
): Promise<FeedRailSummary> {
	const timeZone = appTimeZone();
	const todayStart = sql`(date_trunc('day', now() AT TIME ZONE ${timeZone}) AT TIME ZONE ${timeZone})`;
	const sevenDaysAgo = sql`now() - interval '7 days'`;
	const recentCommentCount = sql<number>`count(${resourceComments.id})::int`;
	const memberShareCount = sql<number>`count(${linkShares.id})::int`;

	const [todaySharesRows, todayCommentsRows, popularResources, activeMembers] = await Promise.all([
		executor
			.select({ shareCount: sql<number>`count(*)::int` })
			.from(linkShares)
			.where(
				and(
					isNull(linkShares.deletedAt),
					eq(linkShares.isFeedVisible, true),
					gte(linkShares.createdAt, todayStart)
				)
			),
		executor
			.select({ commentCount: sql<number>`count(*)::int` })
			.from(resourceComments)
			.where(and(isNull(resourceComments.deletedAt), gte(resourceComments.createdAt, todayStart))),
		executor
			.select({
				id: canonicalResources.id,
				title: canonicalResources.title,
				domain: canonicalResources.domain,
				likeCount: canonicalResources.likeCount,
				recentCommentCount
			})
			.from(resourceComments)
			.innerJoin(canonicalResources, eq(canonicalResources.id, resourceComments.resourceId))
			.where(
				and(
					isNull(resourceComments.deletedAt),
					gte(resourceComments.createdAt, sevenDaysAgo),
					exists(
						executor
							.select({ one: sql`1` })
							.from(linkShares)
							.where(
								and(
									eq(linkShares.resourceId, canonicalResources.id),
									isNull(linkShares.deletedAt),
									eq(linkShares.isFeedVisible, true)
								)
							)
					)
				)
			)
			.groupBy(canonicalResources.id)
			.orderBy(
				desc(recentCommentCount),
				desc(canonicalResources.likeCount),
				desc(canonicalResources.createdAt)
			)
			.limit(3),
		executor
			.select({
				id: users.id,
				name: users.name,
				shareCount: memberShareCount
			})
			.from(linkShares)
			.innerJoin(users, eq(users.id, linkShares.authorId))
			.where(
				and(
					isNull(linkShares.deletedAt),
					eq(linkShares.isFeedVisible, true),
					gte(linkShares.createdAt, sevenDaysAgo),
					eq(users.isActive, true)
				)
			)
			.groupBy(users.id, users.name)
			.orderBy(desc(memberShareCount), asc(users.name))
			.limit(5)
	]);

	return {
		todayShares: todaySharesRows[0]?.shareCount ?? 0,
		todayComments: todayCommentsRows[0]?.commentCount ?? 0,
		popularResources,
		activeMembers
	};
}
