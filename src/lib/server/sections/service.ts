import { asc, inArray } from 'drizzle-orm';
import { db, type Database } from '$lib/server/db/client';
import { sections } from '$lib/server/db/schema';

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
