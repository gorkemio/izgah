import { and, asc, count, eq, inArray, isNull } from 'drizzle-orm';
import { db, type Database } from '#lib/server/db/client.ts';
import {
	canonicalResources,
	linkShareSections,
	linkShares,
	sections,
	unfurlJobs,
	users,
	type ContentType,
	type SourceChannel,
	type UnfurlStatus,
	type UserRole
} from '#lib/server/db/schema.ts';
import { findExistingSectionIds } from '#lib/server/sections/service.ts';
import { createResourceNotificationsInTx } from '#lib/server/interactions/service.ts';
import { detachResourceThumbnailInTx } from '#lib/server/media/storage.ts';
import { safeFetchDiscardBody, type SafeFetchOptions } from '#lib/server/unfurl/safe-fetch.ts';
import { notifyUnfurlWorker } from '#lib/server/unfurl/worker.ts';
import {
	asciiLower,
	canonicalizeUrl,
	UrlCanonicalizeError,
	type CanonicalizedUrl
} from './canonicalize';
import { classifyContentType } from './classify';
import { t } from '#lib/i18n/index.ts';

export const CANONICALIZER_VERSION = 1;
export const MAX_NOTE_LENGTH = 1000;
export const SHORT_URL_RESOLVE_TIMEOUT_MS = 1500;
export const KNOWN_SHORT_URL_HOSTS = new Set(['t.co', 'bit.ly', 'lnkd.in', 'tinyurl.com']);

export type ShortUrlResolver = (url: URL) => Promise<URL>;

const defaultShortUrlResolver: ShortUrlResolver = async (url) => url;
let activeShortUrlResolver: ShortUrlResolver = defaultShortUrlResolver;

export function createSafeFetchShortUrlResolver(
	safeFetchOptions?: SafeFetchOptions
): ShortUrlResolver {
	return async (targetUrl: URL): Promise<URL> => {
		const response = await safeFetchDiscardBody(targetUrl, {
			...safeFetchOptions,
			method: 'GET',
			maxRedirects: 3,
			connectTimeoutMs: SHORT_URL_RESOLVE_TIMEOUT_MS,
			totalTimeoutMs: SHORT_URL_RESOLVE_TIMEOUT_MS
		});
		return response.finalUrl;
	};
}

export function wireSafeFetchShortUrlResolver(safeFetchOptions?: SafeFetchOptions): void {
	setShortUrlResolver(createSafeFetchShortUrlResolver(safeFetchOptions));
}

export function setShortUrlResolver(resolver: ShortUrlResolver): void {
	activeShortUrlResolver = resolver;
}

export function getShortUrlResolver(): ShortUrlResolver {
	return activeShortUrlResolver;
}

export function resetShortUrlResolver(): void {
	activeShortUrlResolver = defaultShortUrlResolver;
}

export type LinkServiceErrorCode = 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'VALIDATION_ERROR';

export class LinkServiceError extends Error {
	readonly status: 403 | 404 | 409 | 422;
	readonly code: LinkServiceErrorCode;
	readonly details?: Record<string, string[]>;

	constructor(
		status: 403 | 404 | 409 | 422,
		code: LinkServiceErrorCode,
		message: string,
		details?: Record<string, string[]>
	) {
		super(message);
		this.name = 'LinkServiceError';
		this.status = status;
		this.code = code;
		this.details = details;
	}
}

export interface LinkActor {
	id: string;
	role: UserRole;
}

export interface LinkResolutionOptions {
	shortUrlResolver?: ShortUrlResolver;
	shortUrlTimeoutMs?: number;
}

export interface DuplicateFirstShareSummary {
	authorName: string;
	createdAt: string;
	isFeedVisible: boolean;
	sectionNames: string[];
}

export type DuplicateCheckResult =
	| {
			exists: false;
			canonicalUrl: string;
			rawUrl: string;
			suggestedContentType: ContentType;
	  }
	| {
			exists: true;
			canonicalUrl: string;
			rawUrl: string;
			suggestedContentType: ContentType;
			originalShareDeleted: boolean;
			resource: {
				id: string;
				title: string | null;
				likeCount: number;
				commentCount: number;
			};
			sharesSummary: {
				totalCount: number;
				firstShare: DuplicateFirstShareSummary;
			};
	  };

export interface ResourceShareReference {
	totalActiveCount: number;
	originalShareDeleted: boolean;
	allTimeFirstShareId: string | null;
	firstActiveShare: {
		id: string;
		authorName: string;
		createdAt: Date;
		isFeedVisible: boolean;
		sectionNames: string[];
	} | null;
}

export interface CreateLinkShareInput {
	actor: LinkActor;
	url: string;
	note?: string | null;
	sectionIds?: string[];
	contentType?: ContentType;
	isFeedVisible?: boolean;
	sourceChannel?: SourceChannel;
}

export interface CreateLinkShareResult {
	share: {
		id: string;
		resourceId: string;
		canonicalUrl: string;
		rawUrl: string;
		isFeedVisible: boolean;
		createdAt: Date;
		contentType: ContentType;
		note: string | null;
	};
	unfurlStatus: UnfurlStatus;
	duplicate: boolean;
}

export interface UpdateLinkShareInput {
	actor: LinkActor;
	shareId: string;
	note?: string | null;
	sectionIds?: string[];
	contentType?: ContentType;
	isFeedVisible?: boolean;
}

export interface UpdateLinkShareResult {
	id: string;
	resourceId: string;
	note: string | null;
	isFeedVisible: boolean;
	sectionIds: string[];
	contentType: ContentType;
}

export interface SoftDeleteLinkShareInput {
	actor: LinkActor;
	shareId: string;
}

export interface SoftDeleteLinkShareResult {
	id: string;
	resourceId: string;
	deletedAt: Date;
}

function isKnownShortUrlHost(hostname: string): boolean {
	const lower = asciiLower(hostname);
	const bare = lower.startsWith('www.') ? lower.slice(4) : lower;
	return KNOWN_SHORT_URL_HOSTS.has(bare);
}

function normalizeNote(note: string | null | undefined): string | null {
	if (note === undefined || note === null) {
		return null;
	}
	const trimmed = note.trim();
	if (trimmed.length === 0) {
		return null;
	}
	if (trimmed.length > MAX_NOTE_LENGTH) {
		throw new LinkServiceError(
			422,
			'VALIDATION_ERROR',
			t('share.noteTooLong', { max: MAX_NOTE_LENGTH }),
			{
				note: [t('share.noteTooLong', { max: MAX_NOTE_LENGTH })]
			}
		);
	}
	return trimmed;
}

async function resolveShortUrlWithBudget(
	target: URL,
	resolver: ShortUrlResolver,
	timeoutMs: number
): Promise<URL | null> {
	let timer: ReturnType<typeof setTimeout> | undefined;

	const resolverPromise = Promise.resolve()
		.then(() => resolver(new URL(target.toString())))
		.catch(() => null);

	const timeoutPromise = new Promise<null>((resolve) => {
		timer = setTimeout(() => resolve(null), timeoutMs);
	});

	try {
		return await Promise.race([resolverPromise, timeoutPromise]);
	} finally {
		if (timer !== undefined) {
			clearTimeout(timer);
		}
	}
}

export async function resolveAndCanonicalizeUrl(
	rawInputUrl: string,
	options?: LinkResolutionOptions
): Promise<CanonicalizedUrl> {
	let initial: CanonicalizedUrl;
	try {
		initial = canonicalizeUrl(rawInputUrl);
	} catch (error) {
		if (error instanceof UrlCanonicalizeError) {
			throw new LinkServiceError(422, 'VALIDATION_ERROR', error.message, {
				url: [error.message]
			});
		}
		throw error;
	}

	const initialUrl = new URL(initial.canonicalUrl);
	if (!isKnownShortUrlHost(initialUrl.hostname)) {
		return initial;
	}

	const resolver = options?.shortUrlResolver ?? activeShortUrlResolver;
	const timeoutMs = options?.shortUrlTimeoutMs ?? SHORT_URL_RESOLVE_TIMEOUT_MS;
	const resolvedUrl = await resolveShortUrlWithBudget(initialUrl, resolver, timeoutMs);

	if (!resolvedUrl) {
		return initial;
	}

	const resolvedHref = resolvedUrl.toString();
	if (resolvedHref === initial.canonicalUrl) {
		return initial;
	}

	try {
		return canonicalizeUrl(resolvedHref);
	} catch {
		return initial;
	}
}

type ShareReferenceExecutor = Pick<Database, 'select' | 'selectDistinctOn'>;

/**
 * Computes active share count, all-time first share deletion status, and oldest active share summary.
 */
export async function getResourceShareReference(
	resourceId: string,
	executor: ShareReferenceExecutor = db
): Promise<ResourceShareReference> {
	const references = await getResourceShareReferences([resourceId], executor);
	return (
		references.get(resourceId) ?? {
			totalActiveCount: 0,
			originalShareDeleted: false,
			allTimeFirstShareId: null,
			firstActiveShare: null
		}
	);
}

/**
 * Batched {@link getResourceShareReference}: a fixed number of queries for any number of resources
 * (feed and search pages previously issued one query chain per resource).
 */
export async function getResourceShareReferences(
	resourceIds: readonly string[],
	executor: ShareReferenceExecutor = db
): Promise<Map<string, ResourceShareReference>> {
	const ids = [...new Set(resourceIds)];
	const result = new Map<string, ResourceShareReference>();
	if (ids.length === 0) {
		return result;
	}

	const [countRows, allTimeFirstRows, oldestActiveRows] = await Promise.all([
		executor
			.select({ resourceId: linkShares.resourceId, value: count() })
			.from(linkShares)
			.where(and(inArray(linkShares.resourceId, ids), isNull(linkShares.deletedAt)))
			.groupBy(linkShares.resourceId),
		executor
			.selectDistinctOn([linkShares.resourceId], {
				resourceId: linkShares.resourceId,
				id: linkShares.id,
				deletedAt: linkShares.deletedAt
			})
			.from(linkShares)
			.where(inArray(linkShares.resourceId, ids))
			.orderBy(linkShares.resourceId, asc(linkShares.createdAt), asc(linkShares.id)),
		executor
			.selectDistinctOn([linkShares.resourceId], {
				resourceId: linkShares.resourceId,
				id: linkShares.id,
				createdAt: linkShares.createdAt,
				isFeedVisible: linkShares.isFeedVisible,
				authorName: users.name
			})
			.from(linkShares)
			.innerJoin(users, eq(users.id, linkShares.authorId))
			.where(and(inArray(linkShares.resourceId, ids), isNull(linkShares.deletedAt)))
			.orderBy(linkShares.resourceId, asc(linkShares.createdAt), asc(linkShares.id))
	]);

	const oldestActiveShareIds = oldestActiveRows.map((row) => row.id);
	const sectionRows =
		oldestActiveShareIds.length > 0
			? await executor
					.select({ shareId: linkShareSections.shareId, name: sections.name })
					.from(linkShareSections)
					.innerJoin(sections, eq(sections.id, linkShareSections.sectionId))
					.where(inArray(linkShareSections.shareId, oldestActiveShareIds))
					.orderBy(asc(sections.sortOrder), asc(sections.name))
			: [];

	const activeCountByResource = new Map(
		countRows.map((row) => [row.resourceId, Number(row.value)])
	);
	const allTimeFirstByResource = new Map(allTimeFirstRows.map((row) => [row.resourceId, row]));
	const oldestActiveByResource = new Map(oldestActiveRows.map((row) => [row.resourceId, row]));
	const sectionNamesByShare = new Map<string, string[]>();
	for (const row of sectionRows) {
		const names = sectionNamesByShare.get(row.shareId) ?? [];
		names.push(row.name);
		sectionNamesByShare.set(row.shareId, names);
	}

	for (const resourceId of ids) {
		const allTimeFirst = allTimeFirstByResource.get(resourceId);
		const oldestActive = oldestActiveByResource.get(resourceId);
		const totalActiveCount = oldestActive ? (activeCountByResource.get(resourceId) ?? 0) : 0;
		result.set(resourceId, {
			totalActiveCount,
			originalShareDeleted: Boolean(allTimeFirst && allTimeFirst.deletedAt !== null),
			allTimeFirstShareId: allTimeFirst?.id ?? null,
			firstActiveShare: oldestActive
				? {
						id: oldestActive.id,
						authorName: oldestActive.authorName,
						createdAt: oldestActive.createdAt,
						isFeedVisible: oldestActive.isFeedVisible,
						sectionNames: sectionNamesByShare.get(oldestActive.id) ?? []
					}
				: null
		});
	}

	return result;
}

/**
 * Checks whether an input URL already has active (deleted_at IS NULL) shares.
 */
export async function checkDuplicateLink(
	inputUrl: string,
	options?: LinkResolutionOptions
): Promise<DuplicateCheckResult> {
	const resolved = await resolveAndCanonicalizeUrl(inputUrl, options);

	const [resource] = await db
		.select({
			id: canonicalResources.id,
			contentType: canonicalResources.contentType,
			title: canonicalResources.title,
			likeCount: canonicalResources.likeCount,
			commentCount: canonicalResources.commentCount
		})
		.from(canonicalResources)
		.where(eq(canonicalResources.canonicalUrl, resolved.canonicalUrl))
		.limit(1);

	if (!resource) {
		return {
			exists: false,
			canonicalUrl: resolved.canonicalUrl,
			rawUrl: resolved.rawUrl,
			suggestedContentType: classifyContentType(resolved.canonicalUrl)
		};
	}

	const shareRef = await getResourceShareReference(resource.id);
	if (shareRef.totalActiveCount === 0 || !shareRef.firstActiveShare) {
		return {
			exists: false,
			canonicalUrl: resolved.canonicalUrl,
			rawUrl: resolved.rawUrl,
			suggestedContentType: classifyContentType(resolved.canonicalUrl)
		};
	}

	return {
		exists: true,
		canonicalUrl: resolved.canonicalUrl,
		rawUrl: resolved.rawUrl,
		suggestedContentType: resource.contentType,
		originalShareDeleted: shareRef.originalShareDeleted,
		resource: {
			id: resource.id,
			title: resource.title,
			likeCount: resource.likeCount,
			commentCount: resource.commentCount
		},
		sharesSummary: {
			totalCount: shareRef.totalActiveCount,
			firstShare: {
				authorName: shareRef.firstActiveShare.authorName,
				createdAt: shareRef.firstActiveShare.createdAt.toISOString(),
				isFeedVisible: shareRef.firstActiveShare.isFeedVisible,
				sectionNames: shareRef.firstActiveShare.sectionNames
			}
		}
	};
}

function postgresErrorCode(error: unknown): string | undefined {
	const record = error as { code?: unknown; cause?: { code?: unknown } } | null;
	if (typeof record?.code === 'string') {
		return record.code;
	}
	return typeof record?.cause?.code === 'string' ? record.cause.code : undefined;
}

/**
 * A section can be deleted between section validation and the link_share_sections insert; the
 * resulting foreign-key violation (23503) is a validation problem for the user, not a 500.
 */
async function runCreateShareTransaction<T>(
	work: Parameters<typeof db.transaction<T>>[0]
): Promise<T> {
	try {
		return await db.transaction(work);
	} catch (error) {
		if (postgresErrorCode(error) === '23503') {
			throw new LinkServiceError(422, 'VALIDATION_ERROR', t('link.sectionGoneReload'), {
				sectionIds: [t('link.sectionGone')]
			});
		}
		throw error;
	}
}

/**
 * Creates a link share inside a single database transaction (canonical_resources upsert +
 * link_shares + link_share_sections + unfurl_jobs) with zero external network calls.
 */
export async function createLinkShare(
	input: CreateLinkShareInput,
	options?: LinkResolutionOptions
): Promise<CreateLinkShareResult> {
	const isFeedVisible = input.isFeedVisible ?? true;
	if (!isFeedVisible && input.actor.role !== 'admin') {
		throw new LinkServiceError(403, 'FORBIDDEN', t('link.silentAdminOnly'));
	}

	const uniqueSectionIds = Array.from(new Set(input.sectionIds ?? []));
	if (!isFeedVisible && uniqueSectionIds.length === 0) {
		throw new LinkServiceError(422, 'VALIDATION_ERROR', t('link.silentNeedsSection'), {
			sectionIds: [t('link.pickSection')]
		});
	}

	const normalizedNote = normalizeNote(input.note);
	const resolved = await resolveAndCanonicalizeUrl(input.url, options);

	const result = await runCreateShareTransaction(async (tx) => {
		if (uniqueSectionIds.length > 0) {
			const existingSectionIds = await findExistingSectionIds(uniqueSectionIds, tx);
			const missingIds = uniqueSectionIds.filter((id) => !existingSectionIds.has(id));
			if (missingIds.length > 0) {
				throw new LinkServiceError(422, 'VALIDATION_ERROR', t('link.sectionNotFound'), {
					sectionIds: [t('link.sectionInvalid')]
				});
			}
		}

		const initialContentType = input.contentType ?? classifyContentType(resolved.canonicalUrl);
		const initialLocked = input.contentType !== undefined;

		const [insertedResource] = await tx
			.insert(canonicalResources)
			.values({
				canonicalUrl: resolved.canonicalUrl,
				canonicalizerVersion: CANONICALIZER_VERSION,
				domain: resolved.domain,
				contentType: initialContentType,
				contentTypeLocked: initialLocked,
				unfurlStatus: 'queued'
			})
			.onConflictDoNothing({ target: canonicalResources.canonicalUrl })
			.returning({
				id: canonicalResources.id,
				contentType: canonicalResources.contentType,
				contentTypeLocked: canonicalResources.contentTypeLocked,
				unfurlStatus: canonicalResources.unfurlStatus
			});

		let resource = insertedResource;
		let duplicate = false;
		let shouldRequeueUnfurl = false;

		if (!resource) {
			const [existingResource] = await tx
				.select({
					id: canonicalResources.id,
					contentType: canonicalResources.contentType,
					contentTypeLocked: canonicalResources.contentTypeLocked,
					unfurlStatus: canonicalResources.unfurlStatus,
					thumbnailAssetKey: canonicalResources.thumbnailAssetKey
				})
				.from(canonicalResources)
				.where(eq(canonicalResources.canonicalUrl, resolved.canonicalUrl))
				.limit(1)
				.for('update');

			if (!existingResource) {
				throw new Error('Failed to load canonical resource after upsert conflict');
			}

			const [activePriorShare] = await tx
				.select({ id: linkShares.id })
				.from(linkShares)
				.where(and(eq(linkShares.resourceId, existingResource.id), isNull(linkShares.deletedAt)))
				.limit(1);

			duplicate = Boolean(activePriorShare);
			shouldRequeueUnfurl =
				!duplicate &&
				(existingResource.unfurlStatus === 'failed' || existingResource.thumbnailAssetKey === null);

			const nextFields: {
				contentType?: ContentType;
				contentTypeLocked?: boolean;
				unfurlStatus?: UnfurlStatus;
				updatedAt?: Date;
			} = {};

			if ((!existingResource.contentTypeLocked || !duplicate) && input.contentType !== undefined) {
				nextFields.contentType = input.contentType;
				nextFields.contentTypeLocked = true;
			}
			if (shouldRequeueUnfurl && existingResource.unfurlStatus !== 'queued') {
				nextFields.unfurlStatus = 'queued';
			}

			if (Object.keys(nextFields).length > 0) {
				nextFields.updatedAt = new Date();
				const [updatedResource] = await tx
					.update(canonicalResources)
					.set(nextFields)
					.where(eq(canonicalResources.id, existingResource.id))
					.returning({
						id: canonicalResources.id,
						contentType: canonicalResources.contentType,
						contentTypeLocked: canonicalResources.contentTypeLocked,
						unfurlStatus: canonicalResources.unfurlStatus
					});
				resource = updatedResource;
			} else {
				resource = existingResource;
			}
		}

		const [insertedShare] = await tx
			.insert(linkShares)
			.values({
				resourceId: resource.id,
				authorId: input.actor.id,
				rawUrl: resolved.rawUrl,
				note: normalizedNote,
				isFeedVisible,
				sourceChannel: input.sourceChannel ?? 'web'
			})
			.returning({
				id: linkShares.id,
				resourceId: linkShares.resourceId,
				rawUrl: linkShares.rawUrl,
				note: linkShares.note,
				isFeedVisible: linkShares.isFeedVisible,
				createdAt: linkShares.createdAt
			});

		if (uniqueSectionIds.length > 0) {
			await tx.insert(linkShareSections).values(
				uniqueSectionIds.map((sectionId) => ({
					shareId: insertedShare.id,
					sectionId
				}))
			);
		}

		if (duplicate && isFeedVisible) {
			await createResourceNotificationsInTx(tx, {
				actorUserId: input.actor.id,
				resourceId: resource.id,
				kind: 'reshare'
			});
		}

		if (shouldRequeueUnfurl) {
			await tx
				.insert(unfurlJobs)
				.values({
					resourceId: resource.id,
					targetUrl: resolved.canonicalUrl,
					status: 'queued'
				})
				.onConflictDoUpdate({
					target: unfurlJobs.resourceId,
					set: {
						targetUrl: resolved.canonicalUrl,
						status: 'queued',
						attempts: 0,
						nextRunAt: new Date(),
						lockedUntil: null,
						lockToken: null,
						lastErrorCode: null,
						lastErrorMessage: null,
						updatedAt: new Date()
					}
				});
		} else {
			await tx
				.insert(unfurlJobs)
				.values({
					resourceId: resource.id,
					targetUrl: resolved.canonicalUrl,
					status: 'queued'
				})
				.onConflictDoNothing({ target: unfurlJobs.resourceId });
		}

		return {
			share: {
				id: insertedShare.id,
				resourceId: insertedShare.resourceId,
				canonicalUrl: resolved.canonicalUrl,
				rawUrl: insertedShare.rawUrl,
				isFeedVisible: insertedShare.isFeedVisible,
				createdAt: insertedShare.createdAt,
				contentType: resource.contentType,
				note: insertedShare.note
			},
			unfurlStatus: resource.unfurlStatus,
			duplicate
		};
	});

	notifyUnfurlWorker();
	return result;
}

/**
 * Updates an active share's note, visibility, sections, or resource content type.
 * Updating content type always locks content_type_locked = true.
 */
export async function updateLinkShare(input: UpdateLinkShareInput): Promise<UpdateLinkShareResult> {
	return db.transaction(async (tx) => {
		const [existing] = await tx
			.select({
				id: linkShares.id,
				resourceId: linkShares.resourceId,
				authorId: linkShares.authorId,
				note: linkShares.note,
				isFeedVisible: linkShares.isFeedVisible,
				deletedAt: linkShares.deletedAt
			})
			.from(linkShares)
			.where(eq(linkShares.id, input.shareId))
			.limit(1)
			.for('update');

		if (!existing || existing.deletedAt !== null) {
			throw new LinkServiceError(404, 'NOT_FOUND', t('share.notFound'));
		}

		const isOwner = existing.authorId === input.actor.id;
		const isAdmin = input.actor.role === 'admin';
		if (!isOwner && !isAdmin) {
			throw new LinkServiceError(403, 'FORBIDDEN', t('share.noEditPermission'));
		}

		if (
			input.isFeedVisible !== undefined &&
			input.isFeedVisible !== existing.isFeedVisible &&
			!isAdmin
		) {
			throw new LinkServiceError(403, 'FORBIDDEN', t('share.visibilityAdminOnly'));
		}

		const nextNote = input.note !== undefined ? normalizeNote(input.note) : existing.note;
		if (!isOwner && nextNote !== existing.note) {
			throw new LinkServiceError(403, 'FORBIDDEN', t('share.noteOwnerOnly'));
		}

		const nextIsFeedVisible = input.isFeedVisible ?? existing.isFeedVisible;

		let nextSectionIds: string[];
		if (input.sectionIds !== undefined) {
			nextSectionIds = Array.from(new Set(input.sectionIds));
			if (nextSectionIds.length > 0) {
				const existingSectionIds = await findExistingSectionIds(nextSectionIds, tx);
				const missingIds = nextSectionIds.filter((id) => !existingSectionIds.has(id));
				if (missingIds.length > 0) {
					throw new LinkServiceError(422, 'VALIDATION_ERROR', t('link.sectionNotFound'), {
						sectionIds: [t('link.sectionInvalid')]
					});
				}
			}
		} else {
			const currentRows = await tx
				.select({ sectionId: linkShareSections.sectionId })
				.from(linkShareSections)
				.where(eq(linkShareSections.shareId, existing.id));
			nextSectionIds = currentRows.map((row) => row.sectionId);
		}

		if (!nextIsFeedVisible && nextSectionIds.length === 0) {
			throw new LinkServiceError(422, 'VALIDATION_ERROR', t('link.silentNeedsSection'), {
				sectionIds: [t('link.pickSection')]
			});
		}

		const now = new Date();
		const [updatedShare] = await tx
			.update(linkShares)
			.set({
				note: nextNote,
				isFeedVisible: nextIsFeedVisible,
				updatedAt: now
			})
			.where(eq(linkShares.id, existing.id))
			.returning({
				id: linkShares.id,
				resourceId: linkShares.resourceId,
				note: linkShares.note,
				isFeedVisible: linkShares.isFeedVisible
			});

		if (input.sectionIds !== undefined) {
			await tx.delete(linkShareSections).where(eq(linkShareSections.shareId, existing.id));
			if (nextSectionIds.length > 0) {
				await tx.insert(linkShareSections).values(
					nextSectionIds.map((sectionId) => ({
						shareId: existing.id,
						sectionId
					}))
				);
			}
		}

		let resolvedContentType: ContentType;
		if (input.contentType !== undefined) {
			const [updatedResource] = await tx
				.update(canonicalResources)
				.set({
					contentType: input.contentType,
					contentTypeLocked: true,
					updatedAt: now
				})
				.where(eq(canonicalResources.id, existing.resourceId))
				.returning({ contentType: canonicalResources.contentType });
			resolvedContentType = updatedResource.contentType;
		} else {
			const [currentResource] = await tx
				.select({ contentType: canonicalResources.contentType })
				.from(canonicalResources)
				.where(eq(canonicalResources.id, existing.resourceId))
				.limit(1);
			resolvedContentType = currentResource.contentType;
		}

		return {
			id: updatedShare.id,
			resourceId: updatedShare.resourceId,
			note: updatedShare.note,
			isFeedVisible: updatedShare.isFeedVisible,
			sectionIds: nextSectionIds,
			contentType: resolvedContentType
		};
	});
}

/**
 * Soft-deletes an active link share (author or admin only).
 */
export async function softDeleteLinkShare(
	input: SoftDeleteLinkShareInput
): Promise<SoftDeleteLinkShareResult> {
	return db.transaction(async (tx) => {
		const [existing] = await tx
			.select({
				id: linkShares.id,
				resourceId: linkShares.resourceId,
				authorId: linkShares.authorId,
				deletedAt: linkShares.deletedAt
			})
			.from(linkShares)
			.where(eq(linkShares.id, input.shareId))
			.limit(1)
			.for('update');

		if (!existing || existing.deletedAt !== null) {
			throw new LinkServiceError(404, 'NOT_FOUND', t('share.notFound'));
		}

		if (existing.authorId !== input.actor.id && input.actor.role !== 'admin') {
			throw new LinkServiceError(403, 'FORBIDDEN', t('share.noDeletePermission'));
		}

		const deletedAt = new Date();
		const [updated] = await tx
			.update(linkShares)
			.set({
				deletedAt,
				updatedAt: deletedAt
			})
			.where(eq(linkShares.id, existing.id))
			.returning({
				id: linkShares.id,
				resourceId: linkShares.resourceId,
				deletedAt: linkShares.deletedAt
			});

		// Serialize with concurrent deletes and re-shares of the same resource before counting, so
		// the "last active share" decision (thumbnail detach) is made on committed state.
		await tx
			.select({ id: canonicalResources.id })
			.from(canonicalResources)
			.where(eq(canonicalResources.id, existing.resourceId))
			.for('update');

		const [remainingRow] = await tx
			.select({ value: count() })
			.from(linkShares)
			.where(and(eq(linkShares.resourceId, existing.resourceId), isNull(linkShares.deletedAt)));

		if (Number(remainingRow?.value ?? 0) === 0) {
			await detachResourceThumbnailInTx(tx, existing.resourceId);
		}

		return {
			id: updated.id,
			resourceId: updated.resourceId,
			deletedAt: updated.deletedAt ?? deletedAt
		};
	});
}
