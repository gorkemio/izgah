import crypto from 'node:crypto';
import { and, asc, desc, eq, exists, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/client.ts';
import {
	canonicalResources,
	contentTypeEnum,
	linkShareSections,
	linkShares,
	mediaAssets,
	searchLogs,
	sections,
	users,
	type ContentType,
	type ProviderMeta,
	type SourceChannel,
	type UnfurlStatus
} from '#lib/server/db/schema.ts';
import { getViewerLikedResourceIds } from '#lib/server/interactions/service.ts';
import { getResourceShareReferences } from '#lib/server/links/service.ts';

export const DEFAULT_SEARCH_LIMIT = 25;
export const MAX_SEARCH_QUERY_LENGTH = 200;
export const SEARCH_LOG_DEDUPE_WINDOW_MS = 60_000;
const SEARCH_LOG_DEDUPE_MAX_ENTRIES = 5_000;

// Re-running the same search (page refresh, invalidation after editing a result) must not add a
// new search_logs row. Only a one-way digest is kept in memory, so query text is never persisted.
const recentSearchDigests = new Map<string, number>();

function shouldRecordSearchLog(digest: string, now: number): boolean {
	const lastSeen = recentSearchDigests.get(digest);
	if (lastSeen !== undefined && now - lastSeen < SEARCH_LOG_DEDUPE_WINDOW_MS) {
		recentSearchDigests.delete(digest);
		recentSearchDigests.set(digest, now);
		return false;
	}
	recentSearchDigests.delete(digest);
	recentSearchDigests.set(digest, now);
	while (recentSearchDigests.size > SEARCH_LOG_DEDUPE_MAX_ENTRIES) {
		const oldest = recentSearchDigests.keys().next().value;
		if (oldest === undefined) {
			break;
		}
		recentSearchDigests.delete(oldest);
	}
	return true;
}

export function resetSearchLogDedupe(): void {
	recentSearchDigests.clear();
}

export type SearchShareAttribution =
	| {
			kind: 'original-deleted';
	  }
	| {
			kind: 'first-share';
			shareId: string;
			authorName: string;
			createdAt: string;
			sectionNames: string[];
	  };

export interface SearchShareItem {
	id: string;
	rawUrl: string;
	note: string | null;
	isFeedVisible: boolean;
	sourceChannel: SourceChannel;
	createdAt: string;
	author: {
		id: string;
		name: string;
	};
	resource: {
		id: string;
		canonicalUrl: string;
		domain: string;
		contentType: ContentType;
		contentTypeLocked: boolean;
		unfurlStatus: UnfurlStatus;
		title: string | null;
		description: string | null;
		siteName: string | null;
		providerMeta: ProviderMeta | null;
		thumbnailAssetKey: string | null;
		thumbnailWidth: number | null;
		thumbnailHeight: number | null;
		likeCount: number;
		commentCount: number;
		likedByViewer: boolean;
	};
	sections: Array<{
		id: string;
		slug: string;
		name: string;
	}>;
	attribution: SearchShareAttribution | null;
}

export interface SearchResourcesResult {
	executed: boolean;
	query: string;
	sectionId: string | null;
	contentType: ContentType | null;
	totalCount: number;
	/** Zero-based offset of the first returned item (offset pagination over relevance order). */
	offset: number;
	limit: number;
	items: SearchShareItem[];
}

/** Deepest page a search may request; relevance order makes keyset pagination impractical. */
export const MAX_SEARCH_OFFSET = 1000;

export function normalizeContentTypeFilter(raw: string | null | undefined): ContentType | null {
	if (!raw) {
		return null;
	}
	const trimmed = raw.trim();
	const allowed: ReadonlyArray<string> = contentTypeEnum.enumValues;
	return allowed.includes(trimmed) ? (trimmed as ContentType) : null;
}

function escapeSqlLikePattern(raw: string): string {
	return raw.replace(/[\\%_]/g, '\\$&');
}

function normalizeQueryString(raw: string): string {
	return raw.trim().replace(/\s+/g, ' ').slice(0, MAX_SEARCH_QUERY_LENGTH);
}

/**
 * Searches canonical resources using multilingual ('simple' + 'turkish' + 'english' with unaccent) full-text
 * search across resource metadata and active share notes, combined with pg_trgm/ILIKE matching
 * for URL substrings such as "owner/repo". Deduplicates results by canonical_resource_id,
 * enforces section/content-type filters, and logs only aggregate search metadata (never query text).
 */
export async function searchResources(input: {
	userId: string;
	query: string;
	sectionId?: string | null;
	contentType?: ContentType | string | null;
	limit?: number;
	offset?: number;
	/** Set to false for typeahead/command-palette quick search so search_logs are not polluted. */
	recordLog?: boolean;
}): Promise<SearchResourcesResult> {
	const normalizedQuery = normalizeQueryString(input.query);
	const validContentType = normalizeContentTypeFilter(input.contentType ?? null);
	const safeLimit = Math.min(Math.max(Math.trunc(input.limit ?? DEFAULT_SEARCH_LIMIT), 1), 50);
	const rawOffset = Math.trunc(input.offset ?? 0);
	const safeOffset = Number.isFinite(rawOffset)
		? Math.min(Math.max(rawOffset, 0), MAX_SEARCH_OFFSET)
		: 0;

	let resolvedSectionId: string | null = null;
	const candidateSectionId = input.sectionId?.trim() || null;
	if (candidateSectionId) {
		const [sectionRow] = await db
			.select({ id: sections.id })
			.from(sections)
			.where(eq(sections.id, candidateSectionId))
			.limit(1);
		if (sectionRow) {
			resolvedSectionId = sectionRow.id;
		}
	}

	if (normalizedQuery.length === 0) {
		return {
			executed: false,
			query: '',
			sectionId: resolvedSectionId,
			contentType: validContentType,
			totalCount: 0,
			offset: 0,
			limit: safeLimit,
			items: []
		};
	}

	const escapedLike = escapeSqlLikePattern(normalizedQuery);
	const likePattern = `%${escapedLike}%`;
	const allowTrigramSimilarity = normalizedQuery.length >= 4;

	const simpleTsQuery = sql`websearch_to_tsquery('simple', unaccent(${normalizedQuery}))`;
	const turkishTsQuery = sql`websearch_to_tsquery('turkish', unaccent(${normalizedQuery}))`;
	const englishTsQuery = sql`websearch_to_tsquery('english', unaccent(${normalizedQuery}))`;

	const activeScopeCondition = resolvedSectionId
		? exists(
				db
					.select({ id: linkShares.id })
					.from(linkShares)
					.innerJoin(linkShareSections, eq(linkShareSections.shareId, linkShares.id))
					.where(
						and(
							eq(linkShares.resourceId, canonicalResources.id),
							isNull(linkShares.deletedAt),
							eq(linkShareSections.sectionId, resolvedSectionId)
						)
					)
			)
		: exists(
				db
					.select({ id: linkShares.id })
					.from(linkShares)
					.where(
						and(eq(linkShares.resourceId, canonicalResources.id), isNull(linkShares.deletedAt))
					)
			);

	const noteMatchExists = resolvedSectionId
		? sql`EXISTS (
				SELECT 1
				FROM "link_shares" AS "ls_note"
				INNER JOIN "link_share_sections" AS "lss_note"
					ON "lss_note"."share_id" = "ls_note"."id"
				WHERE "ls_note"."resource_id" = ${canonicalResources.id}
					AND "ls_note"."deleted_at" IS NULL
					AND "lss_note"."section_id" = ${resolvedSectionId}
					AND (
						"ls_note"."note_search_vector" @@ ${simpleTsQuery}
						OR "ls_note"."note_search_vector" @@ ${turkishTsQuery}
						OR "ls_note"."note_search_vector" @@ ${englishTsQuery}
						OR coalesce("ls_note"."note", '') ILIKE ${likePattern} ESCAPE '\\'
						OR unaccent(coalesce("ls_note"."note", '')) ILIKE unaccent(${likePattern}) ESCAPE '\\'
					)
			)`
		: sql`EXISTS (
				SELECT 1
				FROM "link_shares" AS "ls_note"
				WHERE "ls_note"."resource_id" = ${canonicalResources.id}
					AND "ls_note"."deleted_at" IS NULL
					AND (
						"ls_note"."note_search_vector" @@ ${simpleTsQuery}
						OR "ls_note"."note_search_vector" @@ ${turkishTsQuery}
						OR "ls_note"."note_search_vector" @@ ${englishTsQuery}
						OR coalesce("ls_note"."note", '') ILIKE ${likePattern} ESCAPE '\\'
						OR unaccent(coalesce("ls_note"."note", '')) ILIKE unaccent(${likePattern}) ESCAPE '\\'
					)
			)`;

	const urlSubstringMatch = sql`${canonicalResources.canonicalUrl} ILIKE ${likePattern} ESCAPE '\\'`;
	const titleSubstringMatch = sql`(
		coalesce(${canonicalResources.title}, '') ILIKE ${likePattern} ESCAPE '\\'
		OR unaccent(coalesce(${canonicalResources.title}, '')) ILIKE unaccent(${likePattern}) ESCAPE '\\'
	)`;
	const trigramMatch = allowTrigramSimilarity
		? sql`(
			${canonicalResources.canonicalUrl} % ${normalizedQuery}
			OR ${canonicalResources.title} % ${normalizedQuery}
			OR word_similarity(${normalizedQuery}, ${canonicalResources.canonicalUrl}) >= 0.55
			OR word_similarity(unaccent(${normalizedQuery}), unaccent(coalesce(${canonicalResources.title}, ''))) >= 0.55
		)`
		: sql`false`;

	const matchPredicate = sql`(
		${canonicalResources.searchVector} @@ ${simpleTsQuery}
		OR ${canonicalResources.searchVector} @@ ${turkishTsQuery}
		OR ${canonicalResources.searchVector} @@ ${englishTsQuery}
		OR ${noteMatchExists}
		OR ${urlSubstringMatch}
		OR ${titleSubstringMatch}
		OR ${trigramMatch}
	)`;

	const whereConditions = [activeScopeCondition, matchPredicate];
	if (validContentType) {
		whereConditions.push(eq(canonicalResources.contentType, validContentType));
	}

	const combinedWhere = and(...whereConditions);

	const relevanceExpr = sql<number>`(
		COALESCE(ts_rank_cd(${canonicalResources.searchVector}, ${simpleTsQuery}), 0)
		+ COALESCE(ts_rank_cd(${canonicalResources.searchVector}, ${turkishTsQuery}), 0)
		+ COALESCE(ts_rank_cd(${canonicalResources.searchVector}, ${englishTsQuery}), 0)
		+ CASE WHEN ${noteMatchExists} THEN 0.5 ELSE 0 END
		+ CASE WHEN ${urlSubstringMatch} THEN 0.6 ELSE 0 END
		+ CASE WHEN ${titleSubstringMatch} THEN 0.4 ELSE 0 END
		+ GREATEST(
			similarity(${canonicalResources.canonicalUrl}, ${normalizedQuery}),
			similarity(coalesce(${canonicalResources.title}, ''), ${normalizedQuery}),
			similarity(unaccent(coalesce(${canonicalResources.title}, '')), unaccent(${normalizedQuery})),
			word_similarity(${normalizedQuery}, ${canonicalResources.canonicalUrl}),
			word_similarity(${normalizedQuery}, coalesce(${canonicalResources.title}, '')),
			word_similarity(unaccent(${normalizedQuery}), unaccent(coalesce(${canonicalResources.title}, '')))
		) * 0.35
	)`;

	const [matchedRows, totalRow] = await Promise.all([
		db
			.select({
				resourceId: canonicalResources.id,
				relevance: relevanceExpr
			})
			.from(canonicalResources)
			.where(combinedWhere)
			.orderBy(desc(relevanceExpr), desc(canonicalResources.updatedAt), desc(canonicalResources.id))
			.limit(safeLimit)
			.offset(safeOffset),
		db
			.select({ value: sql<number>`count(*)::int` })
			.from(canonicalResources)
			.where(combinedWhere)
	]);

	const totalCount = Number(totalRow[0]?.value ?? 0);

	const shouldLog = input.recordLog ?? true;
	if (shouldLog) {
		const searchDigest = crypto
			.createHash('sha256')
			.update(
				JSON.stringify([
					input.userId,
					normalizedQuery,
					resolvedSectionId,
					validContentType,
					totalCount
				])
			)
			.digest('hex');
		if (shouldRecordSearchLog(searchDigest, Date.now())) {
			await db.insert(searchLogs).values({
				userId: input.userId,
				sectionId: resolvedSectionId,
				resultCount: totalCount
			});
		}
	}

	if (matchedRows.length === 0) {
		return {
			executed: true,
			query: normalizedQuery,
			sectionId: resolvedSectionId,
			contentType: validContentType,
			totalCount,
			offset: safeOffset,
			limit: safeLimit,
			items: []
		};
	}

	const orderedResourceIds = matchedRows.map((row) => row.resourceId);

	const shareScopeConditions = [
		inArray(linkShares.resourceId, orderedResourceIds),
		isNull(linkShares.deletedAt)
	];
	if (resolvedSectionId) {
		shareScopeConditions.push(
			exists(
				db
					.select({ shareId: linkShareSections.shareId })
					.from(linkShareSections)
					.where(
						and(
							eq(linkShareSections.shareId, linkShares.id),
							eq(linkShareSections.sectionId, resolvedSectionId)
						)
					)
			)
		);
	}

	const shareNoteMatchedExpr = sql<boolean>`(
		${linkShares.noteSearchVector} @@ ${simpleTsQuery}
		OR ${linkShares.noteSearchVector} @@ ${turkishTsQuery}
		OR ${linkShares.noteSearchVector} @@ ${englishTsQuery}
		OR coalesce(${linkShares.note}, '') ILIKE ${likePattern} ESCAPE '\\'
		OR unaccent(coalesce(${linkShares.note}, '')) ILIKE unaccent(${likePattern}) ESCAPE '\\'
	)`;

	const candidateShares = await db
		.select({
			shareId: linkShares.id,
			resourceId: linkShares.resourceId,
			rawUrl: linkShares.rawUrl,
			note: linkShares.note,
			isFeedVisible: linkShares.isFeedVisible,
			sourceChannel: linkShares.sourceChannel,
			createdAt: linkShares.createdAt,
			authorId: users.id,
			authorName: users.name,
			noteMatched: shareNoteMatchedExpr,
			canonicalUrl: canonicalResources.canonicalUrl,
			domain: canonicalResources.domain,
			contentType: canonicalResources.contentType,
			contentTypeLocked: canonicalResources.contentTypeLocked,
			unfurlStatus: canonicalResources.unfurlStatus,
			title: canonicalResources.title,
			description: canonicalResources.description,
			siteName: canonicalResources.siteName,
			providerMeta: canonicalResources.providerMeta,
			thumbnailAssetKey: canonicalResources.thumbnailAssetKey,
			thumbnailWidth: mediaAssets.width,
			thumbnailHeight: mediaAssets.height,
			likeCount: canonicalResources.likeCount,
			commentCount: canonicalResources.commentCount
		})
		.from(linkShares)
		.innerJoin(canonicalResources, eq(linkShares.resourceId, canonicalResources.id))
		.innerJoin(users, eq(linkShares.authorId, users.id))
		.leftJoin(mediaAssets, eq(canonicalResources.thumbnailAssetKey, mediaAssets.assetKey))
		.where(and(...shareScopeConditions))
		.orderBy(
			desc(shareNoteMatchedExpr),
			desc(linkShares.isFeedVisible),
			desc(linkShares.createdAt),
			desc(linkShares.id)
		);

	const representativeByResourceId = new Map<string, (typeof candidateShares)[number]>();
	for (const row of candidateShares) {
		if (!representativeByResourceId.has(row.resourceId)) {
			representativeByResourceId.set(row.resourceId, row);
		}
	}

	const chosenShares = orderedResourceIds
		.map((resourceId) => representativeByResourceId.get(resourceId))
		.filter((row): row is (typeof candidateShares)[number] => Boolean(row));

	const chosenShareIds = chosenShares.map((row) => row.shareId);
	const sectionsByShareId = new Map<string, Array<{ id: string; slug: string; name: string }>>();

	if (chosenShareIds.length > 0) {
		const sectionRows = await db
			.select({
				shareId: linkShareSections.shareId,
				id: sections.id,
				slug: sections.slug,
				name: sections.name
			})
			.from(linkShareSections)
			.innerJoin(sections, eq(linkShareSections.sectionId, sections.id))
			.where(inArray(linkShareSections.shareId, chosenShareIds))
			.orderBy(asc(sections.sortOrder), asc(sections.name));

		for (const row of sectionRows) {
			const list = sectionsByShareId.get(row.shareId) ?? [];
			list.push({ id: row.id, slug: row.slug, name: row.name });
			sectionsByShareId.set(row.shareId, list);
		}
	}

	const [likedSet, shareRefMap] = await Promise.all([
		getViewerLikedResourceIds(input.userId, orderedResourceIds),
		getResourceShareReferences(orderedResourceIds)
	]);

	const items: SearchShareItem[] = chosenShares.map((row) => {
		const ref = shareRefMap.get(row.resourceId);
		let attribution: SearchShareAttribution | null = null;

		if (ref) {
			if (ref.originalShareDeleted) {
				attribution = { kind: 'original-deleted' };
			} else if (ref.allTimeFirstShareId !== row.shareId && ref.firstActiveShare) {
				attribution = {
					kind: 'first-share',
					shareId: ref.firstActiveShare.id,
					authorName: ref.firstActiveShare.authorName,
					createdAt: ref.firstActiveShare.createdAt.toISOString(),
					sectionNames: ref.firstActiveShare.sectionNames
				};
			}
		}

		return {
			id: row.shareId,
			rawUrl: row.rawUrl,
			note: row.note,
			isFeedVisible: row.isFeedVisible,
			sourceChannel: row.sourceChannel,
			createdAt: row.createdAt.toISOString(),
			author: {
				id: row.authorId,
				name: row.authorName
			},
			resource: {
				id: row.resourceId,
				canonicalUrl: row.canonicalUrl,
				domain: row.domain,
				contentType: row.contentType,
				contentTypeLocked: row.contentTypeLocked,
				unfurlStatus: row.unfurlStatus,
				title: row.title,
				description: row.description,
				siteName: row.siteName,
				providerMeta: row.providerMeta,
				thumbnailAssetKey: row.thumbnailAssetKey,
				thumbnailWidth: row.thumbnailWidth,
				thumbnailHeight: row.thumbnailHeight,
				likeCount: row.likeCount,
				commentCount: row.commentCount,
				likedByViewer: likedSet.has(row.resourceId)
			},
			sections: sectionsByShareId.get(row.shareId) ?? [],
			attribution
		};
	});

	return {
		executed: true,
		query: normalizedQuery,
		sectionId: resolvedSectionId,
		contentType: validContentType,
		totalCount,
		offset: safeOffset,
		limit: safeLimit,
		items
	};
}
