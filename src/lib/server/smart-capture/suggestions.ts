import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db, type Database } from '#lib/server/db/client.ts';
import {
	linkShareSections,
	linkShares,
	resourceEnrichments,
	sections,
	shareSectionSuggestions,
	type SuggestedSectionRef,
	type SuggestionSource,
	type UserRole
} from '#lib/server/db/schema.ts';
import { computeHistorySuggestions, type HistorySuggestion } from './history.ts';
import { loadSmartCaptureState, type SectionMode } from './settings.ts';

/**
 * Section suggestions on shares (docs/designs/izgah-smart-capture.md §7, §10): written by the
 * enrichment worker, shown to the share's author and to admins, resolved with plain form actions.
 */

export const MAX_SHARE_SUGGESTIONS = 3;
const MAX_AUTO_SECTIONS = 2;

export interface SuggestionActor {
	id: string;
	role: UserRole;
}

export class SuggestionError extends Error {
	readonly status: 403 | 404 | 422;

	constructor(status: 403 | 404 | 422, message: string) {
		super(message);
		this.name = 'SuggestionError';
		this.status = status;
	}
}

export interface ShareSuggestionView {
	sectionId: string;
	name: string;
	slug: string;
	source: SuggestionSource;
	status: 'pending' | 'auto_applied';
}

export interface ComposerSuggestion {
	id: string;
	name: string;
	source: SuggestionSource;
}

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Writes suggestions for the feed-visible, unsectioned shares of a resource that have none yet. */
export async function writeResourceSuggestions(input: {
	resourceId: string;
	history: readonly HistorySuggestion[];
	aiRefs: readonly SuggestedSectionRef[];
	sectionMode: SectionMode;
	now?: Date;
}): Promise<{ pending: number; autoApplied: number }> {
	const now = input.now ?? new Date();
	const candidates = await db
		.select({ id: linkShares.id })
		.from(linkShares)
		.where(
			and(
				eq(linkShares.resourceId, input.resourceId),
				isNull(linkShares.deletedAt),
				eq(linkShares.isFeedVisible, true),
				sql`NOT EXISTS (SELECT 1 FROM ${linkShareSections} WHERE ${linkShareSections.shareId} = ${linkShares.id})`,
				sql`NOT EXISTS (SELECT 1 FROM ${shareSectionSuggestions} WHERE ${shareSectionSuggestions.shareId} = ${linkShares.id})`
			)
		);

	const useAi = input.sectionMode !== 'off';
	const auto =
		input.sectionMode === 'auto'
			? input.aiRefs
					.filter((ref) => ref.confidence === 'high')
					.slice(0, MAX_AUTO_SECTIONS)
					.map((ref) => ref.sectionId)
			: [];
	const pending: Array<{ sectionId: string; source: SuggestionSource }> = [];
	if (useAi) {
		for (const ref of input.aiRefs) {
			if (!auto.includes(ref.sectionId)) {
				pending.push({ sectionId: ref.sectionId, source: 'ai' });
			}
		}
	}
	for (const suggestion of input.history) {
		if (
			!auto.includes(suggestion.sectionId) &&
			!pending.some((p) => p.sectionId === suggestion.sectionId)
		) {
			pending.push({ sectionId: suggestion.sectionId, source: 'history' });
		}
	}
	const pendingSlice = pending.slice(0, MAX_SHARE_SUGGESTIONS);
	if (candidates.length === 0 || (auto.length === 0 && pendingSlice.length === 0)) {
		return { pending: 0, autoApplied: 0 };
	}

	const sectionIds = [...auto, ...pendingSlice.map((p) => p.sectionId)];
	const existing = new Set(
		(
			await db.select({ id: sections.id }).from(sections).where(inArray(sections.id, sectionIds))
		).map((row) => row.id)
	);

	let pendingCount = 0;
	let autoCount = 0;
	for (const candidate of candidates) {
		await db.transaction(async (tx) => {
			// Re-check under a row lock: the author may have added sections meanwhile.
			const [share] = await tx
				.select({ id: linkShares.id })
				.from(linkShares)
				.where(
					and(
						eq(linkShares.id, candidate.id),
						isNull(linkShares.deletedAt),
						eq(linkShares.isFeedVisible, true)
					)
				)
				.for('update');
			if (!share) {
				return;
			}
			const [hasSection] = await tx
				.select({ one: sql`1` })
				.from(linkShareSections)
				.where(eq(linkShareSections.shareId, share.id))
				.limit(1);
			if (hasSection) {
				return;
			}
			for (const sectionId of auto.filter((id) => existing.has(id))) {
				await tx
					.insert(linkShareSections)
					.values({ shareId: share.id, sectionId })
					.onConflictDoNothing();
				await tx
					.insert(shareSectionSuggestions)
					.values({
						shareId: share.id,
						sectionId,
						source: 'ai',
						status: 'auto_applied',
						createdAt: now
					})
					.onConflictDoNothing();
				autoCount += 1;
			}
			for (const entry of pendingSlice.filter((p) => existing.has(p.sectionId))) {
				const inserted = await tx
					.insert(shareSectionSuggestions)
					.values({
						shareId: share.id,
						sectionId: entry.sectionId,
						source: entry.source,
						status: 'pending',
						createdAt: now
					})
					.onConflictDoNothing()
					.returning({ shareId: shareSectionSuggestions.shareId });
				pendingCount += inserted.length;
			}
		});
	}
	return { pending: pendingCount, autoApplied: autoCount };
}

/** Suggestions to show on cards: only for the author and admins. */
export async function listShareSuggestions(
	shares: ReadonlyArray<{ id: string; authorId: string; sectionCount: number }>,
	viewer: SuggestionActor,
	executor: Pick<Database, 'select'> = db
): Promise<Map<string, ShareSuggestionView[]>> {
	const visible = shares.filter((share) => viewer.role === 'admin' || share.authorId === viewer.id);
	const result = new Map<string, ShareSuggestionView[]>();
	if (visible.length === 0) {
		return result;
	}
	const rows = await executor
		.select({
			shareId: shareSectionSuggestions.shareId,
			sectionId: shareSectionSuggestions.sectionId,
			source: shareSectionSuggestions.source,
			status: shareSectionSuggestions.status,
			name: sections.name,
			slug: sections.slug,
			linked: sql<boolean>`EXISTS (
				SELECT 1 FROM ${linkShareSections}
				WHERE ${linkShareSections.shareId} = ${shareSectionSuggestions.shareId}
					AND ${linkShareSections.sectionId} = ${shareSectionSuggestions.sectionId}
			)`
		})
		.from(shareSectionSuggestions)
		.innerJoin(sections, eq(sections.id, shareSectionSuggestions.sectionId))
		.where(
			and(
				inArray(
					shareSectionSuggestions.shareId,
					visible.map((share) => share.id)
				),
				inArray(shareSectionSuggestions.status, ['pending', 'auto_applied'])
			)
		)
		.orderBy(asc(shareSectionSuggestions.createdAt), asc(sections.sortOrder), asc(sections.name));

	const sectionCounts = new Map(visible.map((share) => [share.id, share.sectionCount]));
	for (const row of rows) {
		if (row.status === 'pending' && ((sectionCounts.get(row.shareId) ?? 0) > 0 || row.linked)) {
			continue;
		}
		if (row.status === 'auto_applied' && !row.linked) {
			continue;
		}
		const list = result.get(row.shareId) ?? [];
		list.push({
			sectionId: row.sectionId,
			name: row.name,
			slug: row.slug,
			source: row.source,
			status: row.status as 'pending' | 'auto_applied'
		});
		result.set(row.shareId, list);
	}
	return result;
}

async function lockManageableShare(tx: Tx, actor: SuggestionActor, shareId: string) {
	const [share] = await tx
		.select({
			id: linkShares.id,
			authorId: linkShares.authorId,
			isFeedVisible: linkShares.isFeedVisible
		})
		.from(linkShares)
		.where(and(eq(linkShares.id, shareId), isNull(linkShares.deletedAt)))
		.for('update');
	if (!share) {
		throw new SuggestionError(404, 'Share not found');
	}
	if (actor.role !== 'admin' && share.authorId !== actor.id) {
		throw new SuggestionError(403, 'Not allowed');
	}
	return share;
}

export async function acceptSuggestion(input: {
	actor: SuggestionActor;
	shareId: string;
	sectionId: string;
}): Promise<void> {
	await db.transaction(async (tx) => {
		await lockManageableShare(tx, input.actor, input.shareId);
		const [suggestion] = await tx
			.select({ status: shareSectionSuggestions.status })
			.from(shareSectionSuggestions)
			.where(
				and(
					eq(shareSectionSuggestions.shareId, input.shareId),
					eq(shareSectionSuggestions.sectionId, input.sectionId)
				)
			)
			.for('update');
		if (!suggestion || suggestion.status !== 'pending') {
			throw new SuggestionError(422, 'Suggestion not found');
		}
		await tx
			.insert(linkShareSections)
			.values({ shareId: input.shareId, sectionId: input.sectionId })
			.onConflictDoNothing();
		await tx
			.update(shareSectionSuggestions)
			.set({ status: 'accepted', resolvedById: input.actor.id, resolvedAt: new Date() })
			.where(
				and(
					eq(shareSectionSuggestions.shareId, input.shareId),
					eq(shareSectionSuggestions.sectionId, input.sectionId)
				)
			);
	});
}

export async function dismissSuggestions(input: {
	actor: SuggestionActor;
	shareId: string;
}): Promise<number> {
	return db.transaction(async (tx) => {
		await lockManageableShare(tx, input.actor, input.shareId);
		const rows = await tx
			.update(shareSectionSuggestions)
			.set({ status: 'dismissed', resolvedById: input.actor.id, resolvedAt: new Date() })
			.where(
				and(
					eq(shareSectionSuggestions.shareId, input.shareId),
					eq(shareSectionSuggestions.status, 'pending')
				)
			)
			.returning({ sectionId: shareSectionSuggestions.sectionId });
		return rows.length;
	});
}

/** Removes a section the AI added automatically; the suggestion is marked dismissed. */
export async function undoAutoSection(input: {
	actor: SuggestionActor;
	shareId: string;
	sectionId: string;
}): Promise<void> {
	await db.transaction(async (tx) => {
		const share = await lockManageableShare(tx, input.actor, input.shareId);
		const [suggestion] = await tx
			.select({ status: shareSectionSuggestions.status })
			.from(shareSectionSuggestions)
			.where(
				and(
					eq(shareSectionSuggestions.shareId, input.shareId),
					eq(shareSectionSuggestions.sectionId, input.sectionId)
				)
			)
			.for('update');
		if (!suggestion || suggestion.status !== 'auto_applied') {
			throw new SuggestionError(422, 'Suggestion not found');
		}
		if (!share.isFeedVisible) {
			// Silent shares are never auto-filed; refuse rather than break the section invariant.
			throw new SuggestionError(422, 'Silent shares keep their sections');
		}
		await tx
			.delete(linkShareSections)
			.where(
				and(
					eq(linkShareSections.shareId, input.shareId),
					eq(linkShareSections.sectionId, input.sectionId)
				)
			);
		await tx
			.update(shareSectionSuggestions)
			.set({ status: 'dismissed', resolvedById: input.actor.id, resolvedAt: new Date() })
			.where(
				and(
					eq(shareSectionSuggestions.shareId, input.shareId),
					eq(shareSectionSuggestions.sectionId, input.sectionId)
				)
			);
	});
}

/** Accepts every pending suggestion of the given shares (admin "Accept all suggestions"). */
export async function acceptAllSuggestions(input: {
	actor: SuggestionActor;
	shareIds: readonly string[];
}): Promise<number> {
	if (input.actor.role !== 'admin') {
		throw new SuggestionError(403, 'Not allowed');
	}
	if (input.shareIds.length === 0) {
		return 0;
	}
	const rows = await db
		.select({
			shareId: shareSectionSuggestions.shareId,
			sectionId: shareSectionSuggestions.sectionId
		})
		.from(shareSectionSuggestions)
		.innerJoin(linkShares, eq(linkShares.id, shareSectionSuggestions.shareId))
		.where(
			and(
				inArray(shareSectionSuggestions.shareId, [...input.shareIds]),
				eq(shareSectionSuggestions.status, 'pending'),
				isNull(linkShares.deletedAt)
			)
		);
	let accepted = 0;
	for (const row of rows) {
		try {
			await acceptSuggestion({
				actor: input.actor,
				shareId: row.shareId,
				sectionId: row.sectionId
			});
			accepted += 1;
		} catch (error) {
			if (!(error instanceof SuggestionError)) {
				throw error;
			}
		}
	}
	return accepted;
}

/** Suggestions for the share form, before the link is shared (duplicate check). */
export async function suggestSectionsForLink(input: {
	resourceId: string | null;
	domain: string;
	title: string | null;
}): Promise<ComposerSuggestion[]> {
	const state = await loadSmartCaptureState();
	const out: Array<{ sectionId: string; source: SuggestionSource }> = [];
	if (input.resourceId && state.aiAllowed && state.settings.sectionMode !== 'off') {
		const [enrichment] = await db
			.select({ suggested: resourceEnrichments.suggestedSections })
			.from(resourceEnrichments)
			.where(eq(resourceEnrichments.resourceId, input.resourceId))
			.limit(1);
		for (const ref of enrichment?.suggested ?? []) {
			out.push({ sectionId: ref.sectionId, source: 'ai' });
		}
	}
	if (state.settings.historySuggestions) {
		for (const suggestion of await computeHistorySuggestions(input)) {
			if (!out.some((entry) => entry.sectionId === suggestion.sectionId)) {
				out.push({ sectionId: suggestion.sectionId, source: 'history' });
			}
		}
	}
	const slice = out.slice(0, MAX_SHARE_SUGGESTIONS);
	if (slice.length === 0) {
		return [];
	}
	const names = new Map(
		(
			await db
				.select({ id: sections.id, name: sections.name })
				.from(sections)
				.where(
					inArray(
						sections.id,
						slice.map((entry) => entry.sectionId)
					)
				)
		).map((row) => [row.id, row.name])
	);
	return slice
		.filter((entry) => names.has(entry.sectionId))
		.map((entry) => ({
			id: entry.sectionId,
			name: names.get(entry.sectionId) as string,
			source: entry.source
		}));
}
