import { and, asc, count, desc, eq, exists, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { db, type Database } from '#lib/server/db/client.ts';
import {
	canonicalResources,
	linkShareSections,
	linkShares,
	mediaAssets,
	siteIcons,
	notifications,
	resourceComments,
	resourceLikes,
	sections,
	users,
	type ContentType,
	type NotificationKind,
	type ProviderMeta,
	type SourceChannel,
	type UnfurlStatus,
	type UserRole
} from '#lib/server/db/schema.ts';
import { t } from '#lib/i18n/index.ts';

export type DbTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type DbExecutor = Database | DbTransaction;

export const MAX_COMMENT_LENGTH = 2000;
export const DEFAULT_NOTIFICATIONS_LIMIT = 20;

export type InteractionServiceErrorCode = 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION_ERROR';

export class InteractionServiceError extends Error {
	readonly status: 403 | 404 | 422;
	readonly code: InteractionServiceErrorCode;
	readonly details?: Record<string, string[]>;

	constructor(
		status: 403 | 404 | 422,
		code: InteractionServiceErrorCode,
		message: string,
		details?: Record<string, string[]>
	) {
		super(message);
		this.name = 'InteractionServiceError';
		this.status = status;
		this.code = code;
		this.details = details;
	}
}

export interface InteractionActor {
	id: string;
	role: UserRole;
}

export interface ToggleResourceLikeResult {
	resourceId: string;
	liked: boolean;
	likeCount: number;
}

export interface ResourceCommentItem {
	id: string;
	resourceId: string;
	body: string;
	createdAt: string;
	updatedAt: string;
	author: {
		id: string;
		name: string;
		avatarAssetKey?: string | null;
	};
}

export interface NotificationFeedItem {
	id: string;
	kind: NotificationKind;
	message: string;
	actorName: string;
	resourceId: string;
	resourceTitle: string | null;
	resourceDomain: string;
	commentId: string | null;
	createdAt: string;
}

export interface NotificationListResult {
	unreadCount: number;
	notifications: NotificationFeedItem[];
}

export interface MarkNotificationsReadResult {
	updatedCount: number;
	unreadCount: number;
}

export type ResourceDiscussionShareAttribution =
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

export interface ResourceDiscussionShareItem {
	id: string;
	rawUrl: string;
	note: string | null;
	isFeedVisible: boolean;
	sourceChannel: SourceChannel;
	createdAt: string;
	author: {
		id: string;
		name: string;
		avatarAssetKey?: string | null;
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
		siteIconAssetKey?: string | null;
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
	attribution: ResourceDiscussionShareAttribution | null;
}

export interface ResourceDiscussionData {
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
		siteIconAssetKey?: string | null;
		thumbnailWidth: number | null;
		thumbnailHeight: number | null;
		likeCount: number;
		commentCount: number;
		likedByViewer: boolean;
		createdAt: string;
	};
	originalShareDeleted: boolean;
	shares: ResourceDiscussionShareItem[];
	comments: ResourceCommentItem[];
}

function normalizeCommentBody(rawBody: string): string {
	const trimmed = rawBody.trim();
	if (trimmed.length === 0) {
		throw new InteractionServiceError(422, 'VALIDATION_ERROR', t('comment.bodyEmpty'), {
			body: [t('comment.required')]
		});
	}
	if (trimmed.length > MAX_COMMENT_LENGTH) {
		const message = t('comment.tooLong', { max: MAX_COMMENT_LENGTH });
		throw new InteractionServiceError(422, 'VALIDATION_ERROR', message, { body: [message] });
	}
	return trimmed;
}

/**
 * Locks the canonical_resources row for atomic counter updates and ensures at least
 * one active (non-soft-deleted) share references it.
 */
async function assertActiveResourceInTx(
	tx: DbTransaction,
	resourceId: string
): Promise<{ id: string; likeCount: number; commentCount: number }> {
	const [resource] = await tx
		.select({
			id: canonicalResources.id,
			likeCount: canonicalResources.likeCount,
			commentCount: canonicalResources.commentCount
		})
		.from(canonicalResources)
		.where(eq(canonicalResources.id, resourceId))
		.limit(1)
		.for('update');

	if (!resource) {
		throw new InteractionServiceError(404, 'NOT_FOUND', t('resource.notFound'));
	}

	const [activeShare] = await tx
		.select({ id: linkShares.id })
		.from(linkShares)
		.where(and(eq(linkShares.resourceId, resourceId), isNull(linkShares.deletedAt)))
		.limit(1);

	if (!activeShare) {
		throw new InteractionServiceError(404, 'NOT_FOUND', t('resource.notFound'));
	}

	return resource;
}

function activeShareExistsSql(resourceIdCol: typeof notifications.resourceId) {
	return exists(
		db
			.select({ id: linkShares.id })
			.from(linkShares)
			.where(and(eq(linkShares.resourceId, resourceIdCol), isNull(linkShares.deletedAt)))
	);
}

/** Comment notifications disappear once their comment is soft-deleted. */
function commentStillVisibleSql(commentIdCol: typeof notifications.commentId) {
	return or(
		isNull(commentIdCol),
		exists(
			db
				.select({ id: resourceComments.id })
				.from(resourceComments)
				.where(and(eq(resourceComments.id, commentIdCol), isNull(resourceComments.deletedAt)))
		)
	);
}

/**
 * Formats the localized notification text according to Milestone M6 item 30 templates.
 */
export function formatNotificationMessage(kind: NotificationKind, actorName: string): string {
	switch (kind) {
		case 'like':
			return t('notif.liked', { name: actorName });
		case 'comment':
			return t('notif.commented', { name: actorName });
		case 'reshare':
			return t('notif.reshared', { name: actorName });
	}
}

/**
 * Emits deduplicated notifications inside an active transaction to all active users
 * who have shared or commented on the target resource (excluding the actor).
 */
export async function createResourceNotificationsInTx(
	tx: DbTransaction,
	input: {
		actorUserId: string;
		resourceId: string;
		kind: NotificationKind;
		commentId?: string | null;
	}
): Promise<void> {
	const [shareRecipients, commentRecipients] = await Promise.all([
		tx
			.selectDistinct({ userId: users.id })
			.from(linkShares)
			.innerJoin(users, eq(users.id, linkShares.authorId))
			.where(
				and(
					eq(linkShares.resourceId, input.resourceId),
					isNull(linkShares.deletedAt),
					eq(users.isActive, true),
					ne(users.id, input.actorUserId)
				)
			),
		tx
			.selectDistinct({ userId: users.id })
			.from(resourceComments)
			.innerJoin(users, eq(users.id, resourceComments.authorId))
			.where(
				and(
					eq(resourceComments.resourceId, input.resourceId),
					isNull(resourceComments.deletedAt),
					eq(users.isActive, true),
					ne(users.id, input.actorUserId)
				)
			)
	]);

	const recipientIds = Array.from(
		new Set([
			...shareRecipients.map((row) => row.userId),
			...commentRecipients.map((row) => row.userId)
		])
	);

	if (recipientIds.length === 0) {
		return;
	}

	const rowsToInsert = recipientIds.map((recipientUserId) => ({
		recipientUserId,
		actorUserId: input.actorUserId,
		resourceId: input.resourceId,
		commentId: input.commentId ?? null,
		kind: input.kind
	}));

	if (input.kind === 'like') {
		await tx
			.insert(notifications)
			.values(rowsToInsert)
			.onConflictDoNothing({
				target: [
					notifications.recipientUserId,
					notifications.actorUserId,
					notifications.resourceId
				],
				where: sql`${notifications.kind} = 'like'`
			});
		return;
	}

	await tx.insert(notifications).values(rowsToInsert);
}

/**
 * Toggles the actor's like on a canonical resource while updating like_count atomically
 * in the same transaction so concurrent likes never drift.
 */
export async function toggleResourceLike(input: {
	actorId: string;
	resourceId: string;
	/**
	 * Desired end state. When set, the call is idempotent: a double click or a retried request
	 * cannot flip the like back. Omitted keeps the legacy toggle behaviour.
	 */
	desired?: boolean;
}): Promise<ToggleResourceLikeResult> {
	const cleanResourceId = input.resourceId.trim();
	if (!cleanResourceId) {
		throw new InteractionServiceError(422, 'VALIDATION_ERROR', t('resource.idMissing'));
	}

	return db.transaction(async (tx) => {
		const resource = await assertActiveResourceInTx(tx, cleanResourceId);

		if (input.desired !== undefined) {
			const [existingLike] = await tx
				.select({ userId: resourceLikes.userId })
				.from(resourceLikes)
				.where(
					and(
						eq(resourceLikes.resourceId, cleanResourceId),
						eq(resourceLikes.userId, input.actorId)
					)
				)
				.limit(1);
			if (Boolean(existingLike) === input.desired) {
				return {
					resourceId: cleanResourceId,
					liked: input.desired,
					likeCount: resource.likeCount
				};
			}
		}

		const deleted = await tx
			.delete(resourceLikes)
			.where(
				and(eq(resourceLikes.resourceId, cleanResourceId), eq(resourceLikes.userId, input.actorId))
			)
			.returning({ userId: resourceLikes.userId });

		if (deleted.length > 0) {
			const [updated] = await tx
				.update(canonicalResources)
				.set({
					likeCount: sql`GREATEST(${canonicalResources.likeCount} - 1, 0)`,
					updatedAt: new Date()
				})
				.where(eq(canonicalResources.id, cleanResourceId))
				.returning({ likeCount: canonicalResources.likeCount });

			return {
				resourceId: cleanResourceId,
				liked: false,
				likeCount: updated.likeCount
			};
		}

		const inserted = await tx
			.insert(resourceLikes)
			.values({
				resourceId: cleanResourceId,
				userId: input.actorId
			})
			.onConflictDoNothing()
			.returning({ userId: resourceLikes.userId });

		if (inserted.length > 0) {
			const [updated] = await tx
				.update(canonicalResources)
				.set({
					likeCount: sql`${canonicalResources.likeCount} + 1`,
					updatedAt: new Date()
				})
				.where(eq(canonicalResources.id, cleanResourceId))
				.returning({ likeCount: canonicalResources.likeCount });

			await createResourceNotificationsInTx(tx, {
				actorUserId: input.actorId,
				resourceId: cleanResourceId,
				kind: 'like'
			});

			return {
				resourceId: cleanResourceId,
				liked: true,
				likeCount: updated.likeCount
			};
		}

		return {
			resourceId: cleanResourceId,
			liked: true,
			likeCount: resource.likeCount
		};
	});
}

/**
 * Adds a comment on a canonical resource, increments comment_count in the same
 * transaction, and notifies tracked participants.
 */
export async function addResourceComment(input: {
	actorId: string;
	resourceId: string;
	body: string;
}): Promise<{ comment: ResourceCommentItem; commentCount: number }> {
	const cleanResourceId = input.resourceId.trim();
	if (!cleanResourceId) {
		throw new InteractionServiceError(422, 'VALIDATION_ERROR', t('resource.idMissing'));
	}

	const normalizedBody = normalizeCommentBody(input.body);

	return db.transaction(async (tx) => {
		await assertActiveResourceInTx(tx, cleanResourceId);

		const [inserted] = await tx
			.insert(resourceComments)
			.values({
				resourceId: cleanResourceId,
				authorId: input.actorId,
				body: normalizedBody
			})
			.returning({
				id: resourceComments.id,
				resourceId: resourceComments.resourceId,
				authorId: resourceComments.authorId,
				body: resourceComments.body,
				createdAt: resourceComments.createdAt,
				updatedAt: resourceComments.updatedAt
			});

		const [updatedResource] = await tx
			.update(canonicalResources)
			.set({
				commentCount: sql`${canonicalResources.commentCount} + 1`,
				updatedAt: new Date()
			})
			.where(eq(canonicalResources.id, cleanResourceId))
			.returning({ commentCount: canonicalResources.commentCount });

		const [authorRow] = await tx
			.select({ id: users.id, name: users.name, avatarAssetKey: users.avatarAssetKey })
			.from(users)
			.where(eq(users.id, inserted.authorId))
			.limit(1);

		await createResourceNotificationsInTx(tx, {
			actorUserId: input.actorId,
			resourceId: cleanResourceId,
			kind: 'comment',
			commentId: inserted.id
		});

		return {
			comment: {
				id: inserted.id,
				resourceId: inserted.resourceId,
				body: inserted.body,
				createdAt: inserted.createdAt.toISOString(),
				updatedAt: inserted.updatedAt.toISOString(),
				author: {
					id: inserted.authorId,
					name: authorRow?.name ?? t('role.member'),
					avatarAssetKey: authorRow?.avatarAssetKey ?? null
				}
			},
			commentCount: updatedResource.commentCount
		};
	});
}

/**
 * Edits an existing active comment. Only the comment author may edit its body.
 */
export async function updateResourceComment(input: {
	actor: InteractionActor;
	commentId: string;
	body: string;
	expectedResourceId?: string;
}): Promise<ResourceCommentItem> {
	const cleanCommentId = input.commentId.trim();
	if (!cleanCommentId) {
		throw new InteractionServiceError(422, 'VALIDATION_ERROR', t('comment.idMissing'));
	}

	const normalizedBody = normalizeCommentBody(input.body);

	return db.transaction(async (tx) => {
		const [existing] = await tx
			.select({
				id: resourceComments.id,
				resourceId: resourceComments.resourceId,
				authorId: resourceComments.authorId,
				deletedAt: resourceComments.deletedAt
			})
			.from(resourceComments)
			.where(eq(resourceComments.id, cleanCommentId))
			.limit(1)
			.for('update');

		if (
			!existing ||
			existing.deletedAt !== null ||
			(input.expectedResourceId && existing.resourceId !== input.expectedResourceId)
		) {
			throw new InteractionServiceError(404, 'NOT_FOUND', t('comment.notFound'));
		}

		await assertActiveResourceInTx(tx, existing.resourceId);

		if (existing.authorId !== input.actor.id) {
			throw new InteractionServiceError(403, 'FORBIDDEN', t('comment.onlyOwn'));
		}

		const [updated] = await tx
			.update(resourceComments)
			.set({
				body: normalizedBody,
				updatedAt: new Date()
			})
			.where(eq(resourceComments.id, existing.id))
			.returning({
				id: resourceComments.id,
				resourceId: resourceComments.resourceId,
				authorId: resourceComments.authorId,
				body: resourceComments.body,
				createdAt: resourceComments.createdAt,
				updatedAt: resourceComments.updatedAt
			});

		const [authorRow] = await tx
			.select({ id: users.id, name: users.name, avatarAssetKey: users.avatarAssetKey })
			.from(users)
			.where(eq(users.id, updated.authorId))
			.limit(1);

		return {
			id: updated.id,
			resourceId: updated.resourceId,
			body: updated.body,
			createdAt: updated.createdAt.toISOString(),
			updatedAt: updated.updatedAt.toISOString(),
			author: {
				id: updated.authorId,
				name: authorRow?.name ?? t('role.member'),
				avatarAssetKey: authorRow?.avatarAssetKey ?? null
			}
		};
	});
}

/**
 * Soft-deletes a comment (author or admin only) and decrements canonical_resources.comment_count
 * by 1 inside the same transaction.
 */
export async function softDeleteResourceComment(input: {
	actor: InteractionActor;
	commentId: string;
	expectedResourceId?: string;
}): Promise<{ id: string; resourceId: string; deletedAt: Date; commentCount: number }> {
	const cleanCommentId = input.commentId.trim();
	if (!cleanCommentId) {
		throw new InteractionServiceError(422, 'VALIDATION_ERROR', t('comment.idMissing'));
	}

	return db.transaction(async (tx) => {
		const [existing] = await tx
			.select({
				id: resourceComments.id,
				resourceId: resourceComments.resourceId,
				authorId: resourceComments.authorId,
				deletedAt: resourceComments.deletedAt
			})
			.from(resourceComments)
			.where(eq(resourceComments.id, cleanCommentId))
			.limit(1)
			.for('update');

		if (
			!existing ||
			existing.deletedAt !== null ||
			(input.expectedResourceId && existing.resourceId !== input.expectedResourceId)
		) {
			throw new InteractionServiceError(404, 'NOT_FOUND', t('comment.notFound'));
		}

		await tx
			.select({ id: canonicalResources.id })
			.from(canonicalResources)
			.where(eq(canonicalResources.id, existing.resourceId))
			.limit(1)
			.for('update');

		if (existing.authorId !== input.actor.id && input.actor.role !== 'admin') {
			throw new InteractionServiceError(403, 'FORBIDDEN', t('comment.noDeletePermission'));
		}

		const now = new Date();
		const [deletedComment] = await tx
			.update(resourceComments)
			.set({
				deletedAt: now,
				updatedAt: now
			})
			.where(and(eq(resourceComments.id, existing.id), isNull(resourceComments.deletedAt)))
			.returning({
				id: resourceComments.id,
				resourceId: resourceComments.resourceId,
				deletedAt: resourceComments.deletedAt
			});

		if (!deletedComment) {
			throw new InteractionServiceError(404, 'NOT_FOUND', t('comment.notFound'));
		}

		const [updatedResource] = await tx
			.update(canonicalResources)
			.set({
				commentCount: sql`GREATEST(${canonicalResources.commentCount} - 1, 0)`,
				updatedAt: now
			})
			.where(eq(canonicalResources.id, existing.resourceId))
			.returning({ commentCount: canonicalResources.commentCount });

		return {
			id: deletedComment.id,
			resourceId: deletedComment.resourceId,
			deletedAt: deletedComment.deletedAt ?? now,
			commentCount: updatedResource?.commentCount ?? 0
		};
	});
}

async function countUnreadNotifications(
	userId: string,
	executor: DbExecutor = db
): Promise<number> {
	const [row] = await executor
		.select({ value: count() })
		.from(notifications)
		.where(
			and(
				eq(notifications.recipientUserId, userId),
				isNull(notifications.readAt),
				activeShareExistsSql(notifications.resourceId),
				commentStillVisibleSql(notifications.commentId)
			)
		);

	return Number(row?.value ?? 0);
}

/**
 * Lists unread notifications for a user along with the total unread count.
 */
export async function listUnreadNotifications(
	userId: string,
	limit = DEFAULT_NOTIFICATIONS_LIMIT
): Promise<NotificationListResult> {
	const [unreadCount, rows] = await Promise.all([
		countUnreadNotifications(userId),
		db
			.select({
				id: notifications.id,
				kind: notifications.kind,
				actorName: users.name,
				resourceId: notifications.resourceId,
				resourceTitle: canonicalResources.title,
				resourceDomain: canonicalResources.domain,
				commentId: notifications.commentId,
				createdAt: notifications.createdAt
			})
			.from(notifications)
			.innerJoin(users, eq(users.id, notifications.actorUserId))
			.innerJoin(canonicalResources, eq(canonicalResources.id, notifications.resourceId))
			.where(
				and(
					eq(notifications.recipientUserId, userId),
					isNull(notifications.readAt),
					activeShareExistsSql(notifications.resourceId),
					commentStillVisibleSql(notifications.commentId)
				)
			)
			.orderBy(desc(notifications.createdAt), desc(notifications.id))
			.limit(limit)
	]);

	return {
		unreadCount,
		notifications: rows.map((row) => ({
			id: row.id,
			kind: row.kind,
			message: formatNotificationMessage(row.kind, row.actorName),
			actorName: row.actorName,
			resourceId: row.resourceId,
			resourceTitle: row.resourceTitle,
			resourceDomain: row.resourceDomain,
			commentId: row.commentId,
			createdAt: row.createdAt.toISOString()
		}))
	};
}

/**
 * Marks specific unread notifications or all unread notifications for the user as read.
 */
export async function markNotificationsRead(
	userId: string,
	options: { notificationIds?: string[]; markAll?: boolean }
): Promise<MarkNotificationsReadResult> {
	const uniqueIds = Array.from(
		new Set((options.notificationIds ?? []).map((id) => id.trim()).filter(Boolean))
	);

	let updatedCount = 0;
	const now = new Date();

	if (options.markAll) {
		const updatedRows = await db
			.update(notifications)
			.set({ readAt: now })
			.where(and(eq(notifications.recipientUserId, userId), isNull(notifications.readAt)))
			.returning({ id: notifications.id });
		updatedCount = updatedRows.length;
	} else if (uniqueIds.length > 0) {
		const updatedRows = await db
			.update(notifications)
			.set({ readAt: now })
			.where(
				and(
					eq(notifications.recipientUserId, userId),
					isNull(notifications.readAt),
					inArray(notifications.id, uniqueIds)
				)
			)
			.returning({ id: notifications.id });
		updatedCount = updatedRows.length;
	}

	const unreadCount = await countUnreadNotifications(userId);
	return { updatedCount, unreadCount };
}

/**
 * Batch-fetches canonical resource IDs currently liked by the viewer.
 */
export async function getViewerLikedResourceIds(
	viewerUserId: string | undefined,
	resourceIds: readonly string[],
	executor: Pick<Database, 'select'> = db
): Promise<Set<string>> {
	if (!viewerUserId || resourceIds.length === 0) {
		return new Set();
	}

	const uniqueIds = Array.from(new Set(resourceIds));
	const rows = await executor
		.select({ resourceId: resourceLikes.resourceId })
		.from(resourceLikes)
		.where(
			and(eq(resourceLikes.userId, viewerUserId), inArray(resourceLikes.resourceId, uniqueIds))
		);

	return new Set(rows.map((row) => row.resourceId));
}

/**
 * Loads a canonical resource's full discussion state (resource summary, chronological active
 * share history, attribution, viewer like state, and flat chronological active comments).
 * Returns null if the resource does not exist or all shares have been soft-deleted.
 */
export async function getResourceDiscussion(input: {
	resourceId: string;
	viewerUserId: string;
}): Promise<ResourceDiscussionData | null> {
	const [resourceRow] = await db
		.select({
			id: canonicalResources.id,
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
			siteIconAssetKey: siteIcons.assetKey,
			thumbnailWidth: mediaAssets.width,
			thumbnailHeight: mediaAssets.height,
			likeCount: canonicalResources.likeCount,
			commentCount: canonicalResources.commentCount,
			createdAt: canonicalResources.createdAt
		})
		.from(canonicalResources)
		.leftJoin(mediaAssets, eq(canonicalResources.thumbnailAssetKey, mediaAssets.assetKey))
		.leftJoin(siteIcons, eq(siteIcons.domain, canonicalResources.domain))
		.where(eq(canonicalResources.id, input.resourceId))
		.limit(1);

	if (!resourceRow) {
		return null;
	}

	const [activeShareRows, allTimeFirstShareRows, likedSet, commentRows] = await Promise.all([
		db
			.select({
				id: linkShares.id,
				rawUrl: linkShares.rawUrl,
				note: linkShares.note,
				isFeedVisible: linkShares.isFeedVisible,
				sourceChannel: linkShares.sourceChannel,
				createdAt: linkShares.createdAt,
				authorId: users.id,
				authorName: users.name,
				authorAvatarAssetKey: users.avatarAssetKey
			})
			.from(linkShares)
			.innerJoin(users, eq(users.id, linkShares.authorId))
			.where(and(eq(linkShares.resourceId, resourceRow.id), isNull(linkShares.deletedAt)))
			.orderBy(asc(linkShares.createdAt), asc(linkShares.id)),
		db
			.select({
				id: linkShares.id,
				deletedAt: linkShares.deletedAt
			})
			.from(linkShares)
			.where(eq(linkShares.resourceId, resourceRow.id))
			.orderBy(asc(linkShares.createdAt), asc(linkShares.id))
			.limit(1),
		getViewerLikedResourceIds(input.viewerUserId, [resourceRow.id]),
		db
			.select({
				id: resourceComments.id,
				resourceId: resourceComments.resourceId,
				body: resourceComments.body,
				createdAt: resourceComments.createdAt,
				updatedAt: resourceComments.updatedAt,
				authorId: users.id,
				authorName: users.name,
				authorAvatarAssetKey: users.avatarAssetKey
			})
			.from(resourceComments)
			.innerJoin(users, eq(users.id, resourceComments.authorId))
			.where(
				and(eq(resourceComments.resourceId, resourceRow.id), isNull(resourceComments.deletedAt))
			)
			.orderBy(asc(resourceComments.createdAt), asc(resourceComments.id))
	]);

	if (activeShareRows.length === 0) {
		return null;
	}

	const shareIds = activeShareRows.map((share) => share.id);
	const sectionRows = await db
		.select({
			shareId: linkShareSections.shareId,
			id: sections.id,
			slug: sections.slug,
			name: sections.name
		})
		.from(linkShareSections)
		.innerJoin(sections, eq(linkShareSections.sectionId, sections.id))
		.where(inArray(linkShareSections.shareId, shareIds))
		.orderBy(asc(sections.sortOrder), asc(sections.name));

	const sectionsByShareId = new Map<string, Array<{ id: string; slug: string; name: string }>>();
	for (const row of sectionRows) {
		const list = sectionsByShareId.get(row.shareId) ?? [];
		list.push({ id: row.id, slug: row.slug, name: row.name });
		sectionsByShareId.set(row.shareId, list);
	}

	const likedByViewer = likedSet.has(resourceRow.id);
	const allTimeFirst = allTimeFirstShareRows[0];
	const originalShareDeleted = Boolean(allTimeFirst && allTimeFirst.deletedAt !== null);
	const oldestActive = activeShareRows[0];
	const oldestActiveSections = (sectionsByShareId.get(oldestActive.id) ?? []).map((s) => s.name);

	const shares: ResourceDiscussionShareItem[] = activeShareRows.map((row) => {
		let attribution: ResourceDiscussionShareAttribution | null = null;
		if (originalShareDeleted) {
			attribution = { kind: 'original-deleted' };
		} else if (allTimeFirst && allTimeFirst.id !== row.id) {
			attribution = {
				kind: 'first-share',
				shareId: oldestActive.id,
				authorName: oldestActive.authorName,
				createdAt: oldestActive.createdAt.toISOString(),
				sectionNames: oldestActiveSections
			};
		}

		return {
			id: row.id,
			rawUrl: row.rawUrl,
			note: row.note,
			isFeedVisible: row.isFeedVisible,
			sourceChannel: row.sourceChannel,
			createdAt: row.createdAt.toISOString(),
			author: {
				id: row.authorId,
				name: row.authorName,
				avatarAssetKey: row.authorAvatarAssetKey
			},
			resource: {
				id: resourceRow.id,
				canonicalUrl: resourceRow.canonicalUrl,
				domain: resourceRow.domain,
				contentType: resourceRow.contentType,
				contentTypeLocked: resourceRow.contentTypeLocked,
				unfurlStatus: resourceRow.unfurlStatus,
				title: resourceRow.title,
				description: resourceRow.description,
				siteName: resourceRow.siteName,
				providerMeta: resourceRow.providerMeta,
				thumbnailAssetKey: resourceRow.thumbnailAssetKey,
				siteIconAssetKey: resourceRow.siteIconAssetKey,
				thumbnailWidth: resourceRow.thumbnailWidth,
				thumbnailHeight: resourceRow.thumbnailHeight,
				likeCount: resourceRow.likeCount,
				commentCount: resourceRow.commentCount,
				likedByViewer
			},
			sections: sectionsByShareId.get(row.id) ?? [],
			attribution
		};
	});

	return {
		resource: {
			id: resourceRow.id,
			canonicalUrl: resourceRow.canonicalUrl,
			domain: resourceRow.domain,
			contentType: resourceRow.contentType,
			contentTypeLocked: resourceRow.contentTypeLocked,
			unfurlStatus: resourceRow.unfurlStatus,
			title: resourceRow.title,
			description: resourceRow.description,
			siteName: resourceRow.siteName,
			providerMeta: resourceRow.providerMeta,
			thumbnailAssetKey: resourceRow.thumbnailAssetKey,
			siteIconAssetKey: resourceRow.siteIconAssetKey,
			thumbnailWidth: resourceRow.thumbnailWidth,
			thumbnailHeight: resourceRow.thumbnailHeight,
			likeCount: resourceRow.likeCount,
			commentCount: resourceRow.commentCount,
			likedByViewer,
			createdAt: resourceRow.createdAt.toISOString()
		},
		originalShareDeleted,
		shares,
		comments: commentRows.map((row) => ({
			id: row.id,
			resourceId: row.resourceId,
			body: row.body,
			createdAt: row.createdAt.toISOString(),
			updatedAt: row.updatedAt.toISOString(),
			author: {
				id: row.authorId,
				name: row.authorName,
				avatarAssetKey: row.authorAvatarAssetKey
			}
		}))
	};
}
