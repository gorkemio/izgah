import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { db, type Database } from '#lib/server/db/client.ts';
import { canonicalResources, linkShareSections, linkShares } from '#lib/server/db/schema.ts';

/**
 * Section suggestions learned from the team's own filing history
 * (docs/designs/izgah-smart-capture.md §3). Database only; no network, no key.
 */

export const SUGGESTION_THRESHOLD = 0.45;
export const MAX_SUGGESTIONS = 3;
const DOMAIN_MIN_SHARES = 3;
const DOMAIN_MIN_COUNT = 2;
const DOMAIN_MIN_RATIO = 0.4;
const SIMILAR_MIN = 0.35;
const SIMILAR_MIN_NEIGHBOURS = 2;
const SIMILAR_LIMIT = 10;
const MIN_TITLE_LENGTH = 8;

export type HistoryReason =
	{ kind: 'same_link' } | { kind: 'domain'; count: number; total: number } | { kind: 'similar' };

export interface HistorySuggestion {
	sectionId: string;
	score: number;
	/** The strongest signal behind the score (for "why" text in the UI). */
	reason: HistoryReason;
}

export interface HistoryInput {
	resourceId: string | null;
	domain: string;
	title: string | null;
}

type Executor = Pick<Database, 'select' | 'selectDistinct'>;

interface Accumulator {
	score: number;
	reason: HistoryReason;
	reasonWeight: number;
}

function add(
	scores: Map<string, Accumulator>,
	sectionId: string,
	amount: number,
	reason: HistoryReason
): void {
	const current = scores.get(sectionId);
	if (!current) {
		scores.set(sectionId, { score: amount, reason, reasonWeight: amount });
		return;
	}
	current.score += amount;
	if (amount > current.reasonWeight) {
		current.reason = reason;
		current.reasonWeight = amount;
	}
}

export async function computeHistorySuggestions(
	input: HistoryInput,
	executor: Executor = db
): Promise<HistorySuggestion[]> {
	const scores = new Map<string, Accumulator>();
	const otherResource = input.resourceId ? ne(linkShares.resourceId, input.resourceId) : sql`true`;

	// 1. Earlier shares of the same link.
	if (input.resourceId) {
		const rows = await executor
			.selectDistinct({ sectionId: linkShareSections.sectionId })
			.from(linkShares)
			.innerJoin(linkShareSections, eq(linkShareSections.shareId, linkShares.id))
			.where(and(eq(linkShares.resourceId, input.resourceId), isNull(linkShares.deletedAt)));
		for (const row of rows) {
			add(scores, row.sectionId, 1, { kind: 'same_link' });
		}
	}

	// 2. Where shares from the same domain went.
	const domainRows = await executor
		.select({
			sectionId: linkShareSections.sectionId,
			count: sql<number>`count(DISTINCT ${linkShares.id})::int`
		})
		.from(linkShares)
		.innerJoin(canonicalResources, eq(canonicalResources.id, linkShares.resourceId))
		.innerJoin(linkShareSections, eq(linkShareSections.shareId, linkShares.id))
		.where(
			and(eq(canonicalResources.domain, input.domain), isNull(linkShares.deletedAt), otherResource)
		)
		.groupBy(linkShareSections.sectionId);
	if (domainRows.length > 0) {
		const [totalRow] = await executor
			.select({ total: sql<number>`count(DISTINCT ${linkShares.id})::int` })
			.from(linkShares)
			.innerJoin(canonicalResources, eq(canonicalResources.id, linkShares.resourceId))
			.innerJoin(linkShareSections, eq(linkShareSections.shareId, linkShares.id))
			.where(
				and(
					eq(canonicalResources.domain, input.domain),
					isNull(linkShares.deletedAt),
					otherResource
				)
			);
		const total = totalRow?.total ?? 0;
		if (total >= DOMAIN_MIN_SHARES) {
			for (const row of domainRows) {
				const ratio = row.count / total;
				if (row.count >= DOMAIN_MIN_COUNT && ratio >= DOMAIN_MIN_RATIO) {
					add(scores, row.sectionId, 0.8 * ratio, {
						kind: 'domain',
						count: row.count,
						total
					});
				}
			}
		}
	}

	// 3. Resources with similar titles (pg_trgm).
	const title = input.title?.trim() ?? '';
	if (title.length >= MIN_TITLE_LENGTH) {
		const similarity = sql<number>`similarity(${canonicalResources.title}, ${title})`;
		const neighbours = await executor
			.select({ id: canonicalResources.id, sim: similarity })
			.from(canonicalResources)
			.where(
				and(
					sql`${canonicalResources.title} % ${title}`,
					input.resourceId ? ne(canonicalResources.id, input.resourceId) : sql`true`,
					sql`EXISTS (
						SELECT 1 FROM ${linkShares}
						INNER JOIN ${linkShareSections} ON ${linkShareSections.shareId} = ${linkShares.id}
						WHERE ${linkShares.resourceId} = ${canonicalResources.id}
							AND ${linkShares.deletedAt} IS NULL
					)`
				)
			)
			.orderBy(sql`${similarity} DESC`)
			.limit(SIMILAR_LIMIT);
		const close = neighbours.filter((row) => row.sim >= SIMILAR_MIN);
		if (close.length >= SIMILAR_MIN_NEIGHBOURS) {
			const simById = new Map(close.map((row) => [row.id, row.sim]));
			const totalSim = close.reduce((sum, row) => sum + row.sim, 0);
			const memberships = await executor
				.selectDistinct({
					resourceId: linkShares.resourceId,
					sectionId: linkShareSections.sectionId
				})
				.from(linkShares)
				.innerJoin(linkShareSections, eq(linkShareSections.shareId, linkShares.id))
				.where(
					and(
						inArray(
							linkShares.resourceId,
							close.map((row) => row.id)
						),
						isNull(linkShares.deletedAt)
					)
				);
			const mass = new Map<string, number>();
			for (const row of memberships) {
				mass.set(
					row.sectionId,
					(mass.get(row.sectionId) ?? 0) + (simById.get(row.resourceId) ?? 0)
				);
			}
			for (const [sectionId, value] of mass) {
				add(scores, sectionId, 0.6 * (value / totalSim), { kind: 'similar' });
			}
		}
	}

	return [...scores.entries()]
		.filter(([, entry]) => entry.score >= SUGGESTION_THRESHOLD)
		.sort((a, b) => b[1].score - a[1].score)
		.slice(0, MAX_SUGGESTIONS)
		.map(([sectionId, entry]) => ({
			sectionId,
			score: Math.round(entry.score * 1000) / 1000,
			reason: entry.reason
		}));
}
