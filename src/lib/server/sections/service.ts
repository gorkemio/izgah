import { asc, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db, type Database } from '#lib/server/db/client.ts';
import { linkShareSections, linkShares, sections } from '#lib/server/db/schema.ts';

export interface SectionListItem {
	id: string;
	slug: string;
	name: string;
	description: string | null;
	sortOrder: number;
}

/**
 * Lists all sections ordered by sort_order ASC, name ASC.
 */
export async function listSections(
	executor: Pick<Database, 'select'> = db
): Promise<SectionListItem[]> {
	return executor
		.select({
			id: sections.id,
			slug: sections.slug,
			name: sections.name,
			description: sections.description,
			sortOrder: sections.sortOrder
		})
		.from(sections)
		.orderBy(asc(sections.sortOrder), asc(sections.name));
}

/**
 * Counts the live shares in each section, silent ones included, as the section page lists them
 * (izgah-ui-v4 §5). Sections without shares are absent from the map.
 */
export async function countSharesBySection(
	executor: Pick<Database, 'select'> = db
): Promise<Map<string, number>> {
	const rows = await executor
		.select({ sectionId: linkShareSections.sectionId, value: count() })
		.from(linkShareSections)
		.innerJoin(linkShares, eq(linkShares.id, linkShareSections.shareId))
		.where(isNull(linkShares.deletedAt))
		.groupBy(linkShareSections.sectionId);
	return new Map(rows.map((row) => [row.sectionId, Number(row.value)]));
}

export interface SectionContributor {
	id: string;
	name: string;
	avatarAssetKey: string | null;
}

/**
 * The most recent distinct authors of active shares in each section, newest first, for the avatar
 * stacks on /sections (docs/designs/izgah-ui-v5.md §5.4). Also returns the latest share time.
 */
export async function listSectionActivity(
	limitPerSection = 3
): Promise<Map<string, { contributors: SectionContributor[]; lastSharedAt: string | null }>> {
	const rows = await db.execute(sql`
		WITH ranked AS (
			SELECT
				lss.section_id AS "sectionId",
				u.id AS "userId",
				u.name AS "name",
				u.avatar_asset_key AS "avatarAssetKey",
				MAX(ls.created_at) AS "lastAt",
				ROW_NUMBER() OVER (
					PARTITION BY lss.section_id ORDER BY MAX(ls.created_at) DESC, u.id
				) AS "rank"
			FROM link_share_sections lss
			JOIN link_shares ls ON ls.id = lss.share_id AND ls.deleted_at IS NULL
			JOIN users u ON u.id = ls.author_id
			GROUP BY lss.section_id, u.id, u.name, u.avatar_asset_key
		)
		SELECT * FROM ranked WHERE "rank" <= ${limitPerSection} ORDER BY "sectionId", "rank"
	`);
	const activity = new Map<
		string,
		{ contributors: SectionContributor[]; lastSharedAt: string | null }
	>();
	for (const row of rows as unknown as Array<Record<string, unknown>>) {
		const sectionId = String(row.sectionId);
		const entry = activity.get(sectionId) ?? { contributors: [], lastSharedAt: null };
		const lastAt = new Date(row.lastAt as string | Date).toISOString();
		if (!entry.lastSharedAt || lastAt > entry.lastSharedAt) {
			entry.lastSharedAt = lastAt;
		}
		entry.contributors.push({
			id: String(row.userId),
			name: String(row.name),
			avatarAssetKey: row.avatarAssetKey ? String(row.avatarAssetKey) : null
		});
		activity.set(sectionId, entry);
	}
	return activity;
}

/**
 * Returns the subset of provided section IDs that currently exist in the database.
 */
export async function findExistingSectionIds(
	sectionIds: readonly string[],
	executor: Pick<Database, 'select'> = db
): Promise<Set<string>> {
	if (sectionIds.length === 0) {
		return new Set();
	}

	const rows = await executor
		.select({ id: sections.id })
		.from(sections)
		.where(inArray(sections.id, [...sectionIds]));

	return new Set(rows.map((row) => row.id));
}
