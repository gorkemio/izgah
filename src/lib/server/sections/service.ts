import { asc, count, eq, inArray, isNull } from 'drizzle-orm';
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
