import { fail, redirect, type Actions } from '@sveltejs/kit';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { db } from '#lib/server/db/client.ts';
import {
	decodeTimeIdCursor,
	encodeTimeIdCursor,
	isBeforeCursor,
	preciseTimestampText,
	type TimeIdCursor
} from '#lib/server/db/cursor.ts';
import { feedScopeConditions } from '#lib/server/feed/query.ts';
import { todayKey } from '#lib/format/date.ts';
import {
	canonicalResources,
	contentTypeEnum,
	linkShares,
	linkShareSections,
	mediaAssets,
	sections,
	users,
	type ContentType,
	type ProviderMeta,
	type SourceChannel,
	type UnfurlStatus
} from '#lib/server/db/schema.ts';

export type FeedShareAttribution =
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

export interface FeedShareItem {
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
	attribution: FeedShareAttribution | null;
	/** Section suggestions for the author and admins (docs/designs/izgah-smart-capture.md §10). */
	suggestions?: FeedShareSuggestion[];
}
import { sanitizeInternalPath } from '#lib/server/http/safe-path.ts';
import {
	getViewerLikedResourceIds,
	InteractionServiceError,
	toggleResourceLike
} from '#lib/server/interactions/service.ts';
import {
	createLinkShare,
	getResourceShareReferences,
	LinkServiceError,
	softDeleteLinkShare,
	updateLinkShare
} from '#lib/server/links/service.ts';
import type { PageServerLoad } from './$types';
import type { UserRole } from '#lib/server/db/schema.ts';
import type { FeedShareSuggestion } from '#lib/types/feed.ts';
import {
	acceptSuggestion,
	dismissSuggestions,
	listShareSuggestions,
	SuggestionError,
	undoAutoSection
} from '#lib/server/smart-capture/suggestions.ts';
import { t } from '#lib/i18n/index.ts';

const FEED_PAGE_SIZE = 25;

export type DecodedFeedCursor = TimeIdCursor;

export function _encodeFeedCursor(entry: { createdAt: string; id: string }): string {
	return encodeTimeIdCursor(entry.createdAt, entry.id);
}

export function _decodeFeedCursor(rawCursor: string | null): DecodedFeedCursor | null {
	return decodeTimeIdCursor(rawCursor);
}

function parseContentTypeParam(raw: string | null): ContentType | null {
	if (!raw) {
		return null;
	}
	const validTypes: ReadonlyArray<string> = contentTypeEnum.enumValues;
	if (validTypes.includes(raw)) {
		return raw as ContentType;
	}
	return null;
}

function isValidExplicitContentType(raw: string): raw is ContentType {
	const validTypes: ReadonlyArray<string> = contentTypeEnum.enumValues;
	return validTypes.includes(raw);
}

function sanitizeReturnTo(raw: FormDataEntryValue | null, fallback = '/'): string {
	return sanitizeInternalPath(raw, {
		fallback,
		stripParams: ['compose', 'edit', 'delete'],
		keepHash: false
	});
}

function parseDesiredLike(raw: FormDataEntryValue | null): boolean | undefined {
	if (raw === 'true') {
		return true;
	}
	if (raw === 'false') {
		return false;
	}
	return undefined;
}

function wantsJsonResponse(request: Request): boolean {
	const accept = request.headers.get('accept') ?? '';
	return accept.includes('application/json') || request.headers.has('x-sveltekit-action');
}

export async function _loadFeedPage(options: {
	depends: (...deps: `${string}:${string}`[]) => void;
	url: URL;
	sectionId?: string;
	viewerUserId?: string;
	viewerRole?: UserRole;
}): Promise<{
	items: FeedShareItem[];
	activeType: ContentType | null;
	hasMore: boolean;
	nextCursor: string | null;
	hasCursorApplied: boolean;
	hasPendingUnfurl: boolean;
	todayKey: string;
}> {
	options.depends('app:feed');

	const activeType = parseContentTypeParam(options.url.searchParams.get('type'));
	const cursor = _decodeFeedCursor(options.url.searchParams.get('cursor'));

	const conditions = feedScopeConditions({ sectionId: options.sectionId, type: activeType });

	if (cursor) {
		conditions.push(isBeforeCursor(linkShares.createdAt, linkShares.id, cursor));
	}

	const rows = await db
		.select({
			shareId: linkShares.id,
			rawUrl: linkShares.rawUrl,
			note: linkShares.note,
			isFeedVisible: linkShares.isFeedVisible,
			sourceChannel: linkShares.sourceChannel,
			createdAt: linkShares.createdAt,
			createdAtCursor: preciseTimestampText(linkShares.createdAt),
			authorId: users.id,
			authorName: users.name,
			resourceId: canonicalResources.id,
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
		.where(and(...conditions))
		.orderBy(desc(linkShares.createdAt), desc(linkShares.id))
		.limit(FEED_PAGE_SIZE + 1);

	const hasMore = rows.length > FEED_PAGE_SIZE;
	const pageRows = rows.slice(0, FEED_PAGE_SIZE);
	const lastRow = pageRows.at(-1);
	const nextCursor =
		hasMore && lastRow
			? _encodeFeedCursor({ createdAt: lastRow.createdAtCursor, id: lastRow.shareId })
			: null;

	const shareIds = pageRows.map((row) => row.shareId);
	const sectionsByShareId = new Map<string, Array<{ id: string; slug: string; name: string }>>();

	if (shareIds.length > 0) {
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

		for (const row of sectionRows) {
			const existing = sectionsByShareId.get(row.shareId) ?? [];
			existing.push({ id: row.id, slug: row.slug, name: row.name });
			sectionsByShareId.set(row.shareId, existing);
		}
	}

	const uniqueResourceIds = Array.from(new Set(pageRows.map((row) => row.resourceId)));
	const [likedResourceIds, shareRefMap, suggestionsByShareId] = await Promise.all([
		getViewerLikedResourceIds(options.viewerUserId, uniqueResourceIds),
		getResourceShareReferences(uniqueResourceIds),
		options.viewerUserId && options.viewerRole
			? listShareSuggestions(
					pageRows.map((row) => ({
						id: row.shareId,
						authorId: row.authorId,
						sectionCount: sectionsByShareId.get(row.shareId)?.length ?? 0
					})),
					{ id: options.viewerUserId, role: options.viewerRole }
				)
			: Promise.resolve(new Map<string, FeedShareSuggestion[]>())
	]);

	const items: FeedShareItem[] = pageRows.map((row) => {
		const ref = shareRefMap.get(row.resourceId);
		let attribution: FeedShareAttribution | null = null;

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
				likedByViewer: likedResourceIds.has(row.resourceId)
			},
			sections: sectionsByShareId.get(row.shareId) ?? [],
			attribution,
			suggestions: suggestionsByShareId.get(row.shareId)
		};
	});

	const hasPendingUnfurl = items.some(
		(item) => item.resource.unfurlStatus === 'queued' || item.resource.unfurlStatus === 'running'
	);

	return {
		items,
		activeType,
		hasMore,
		nextCursor,
		hasCursorApplied: cursor !== null,
		hasPendingUnfurl,
		// Computed on the server so day labels are identical in SSR and hydration (izgah-ui-v2 §8.3).
		todayKey: todayKey()
	};
}

export const _feedShareActions = {
	createShare: async ({ request, locals }) => {
		if (!locals.user) {
			return fail(401, {
				formType: 'createShare' as const,
				errorMessage: t('auth.signInForActionAlt')
			});
		}

		const formData = await request.formData();
		const urlInput = String(formData.get('url') ?? '').trim();
		const noteInput = String(formData.get('note') ?? '').trim();
		const sectionIds = formData
			.getAll('sectionIds')
			.map((entry) => String(entry).trim())
			.filter(Boolean);
		const rawContentType = String(formData.get('contentType') ?? '').trim();
		const silentModeRaw = formData.get('silentMode');
		const silentMode = silentModeRaw === 'true' || silentModeRaw === 'on';
		const returnTo = sanitizeReturnTo(formData.get('returnTo'), '/');

		const values = {
			url: urlInput,
			note: noteInput,
			sectionIds,
			contentType: rawContentType,
			silentMode
		};

		if (silentMode && locals.user.role !== 'admin') {
			return fail(403, {
				formType: 'createShare' as const,
				errorMessage: t('share.noSilentPermission'),
				values
			});
		}

		if (silentMode && sectionIds.length === 0) {
			return fail(422, {
				formType: 'createShare' as const,
				errorMessage: t('share.silentNeedsSection'),
				fieldErrors: {
					sectionIds: [t('share.silentNeedsSection')]
				},
				values
			});
		}

		let explicitContentType: ContentType | undefined;
		if (rawContentType !== '') {
			if (!isValidExplicitContentType(rawContentType)) {
				return fail(422, {
					formType: 'createShare' as const,
					errorMessage: t('share.contentTypeInvalid'),
					fieldErrors: {
						contentType: [t('share.contentTypePick')]
					},
					values
				});
			}
			explicitContentType = rawContentType;
		}

		try {
			const created = await createLinkShare({
				actor: {
					id: locals.user.id,
					role: locals.user.role
				},
				url: urlInput,
				note: noteInput || undefined,
				sectionIds,
				contentType: explicitContentType,
				isFeedVisible: !silentMode,
				sourceChannel: 'web'
			});

			if (!wantsJsonResponse(request)) {
				redirect(303, returnTo);
			}

			return {
				success: true,
				formType: 'createShare' as const,
				shareId: created.share.id
			};
		} catch (error) {
			if (error instanceof LinkServiceError) {
				return fail(
					error.status === 403 || error.status === 404 || error.status === 409 ? error.status : 422,
					{
						formType: 'createShare' as const,
						errorMessage: error.message,
						fieldErrors: error.details ?? {},
						values
					}
				);
			}
			throw error;
		}
	},

	updateShare: async ({ request, locals }) => {
		if (!locals.user) {
			return fail(401, {
				formType: 'updateShare' as const,
				errorMessage: t('auth.signInForActionAlt')
			});
		}

		const formData = await request.formData();
		const shareId = String(formData.get('shareId') ?? '').trim();
		const returnTo = sanitizeReturnTo(formData.get('returnTo'), '/');
		const hasNoteField = formData.has('note');
		const rawNote = String(formData.get('note') ?? '').trim();
		const sectionIds = formData
			.getAll('sectionIds')
			.map((entry) => String(entry).trim())
			.filter(Boolean);
		const rawContentType = String(formData.get('contentType') ?? '').trim();
		const previousContentType = String(formData.get('previousContentType') ?? '').trim();
		const silentModeRaw = formData.get('silentMode');
		const silentMode = silentModeRaw === 'true' || silentModeRaw === 'on';

		const values = {
			note: hasNoteField ? rawNote : undefined,
			sectionIds,
			contentType: rawContentType,
			silentMode
		};

		if (!shareId) {
			return fail(422, {
				formType: 'updateShare' as const,
				shareId,
				errorMessage: t('share.idMissing'),
				values
			});
		}

		if (locals.user.role === 'admin' && silentMode && sectionIds.length === 0) {
			return fail(422, {
				formType: 'updateShare' as const,
				shareId,
				errorMessage: t('share.silentNeedsSection'),
				fieldErrors: {
					sectionIds: [t('share.silentNeedsSection')]
				},
				values
			});
		}

		let nextContentType: ContentType | undefined;
		if (rawContentType !== '' && rawContentType !== previousContentType) {
			if (!isValidExplicitContentType(rawContentType)) {
				return fail(422, {
					formType: 'updateShare' as const,
					shareId,
					errorMessage: t('share.contentTypeInvalid'),
					fieldErrors: {
						contentType: [t('share.contentTypePick')]
					},
					values
				});
			}
			nextContentType = rawContentType;
		}

		try {
			await updateLinkShare({
				actor: {
					id: locals.user.id,
					role: locals.user.role
				},
				shareId,
				note: hasNoteField ? rawNote || null : undefined,
				sectionIds,
				contentType: nextContentType,
				isFeedVisible: locals.user.role === 'admin' ? !silentMode : undefined
			});

			if (!wantsJsonResponse(request)) {
				redirect(303, returnTo);
			}

			return {
				success: true,
				formType: 'updateShare' as const,
				shareId
			};
		} catch (error) {
			if (error instanceof LinkServiceError) {
				return fail(
					error.status === 403 || error.status === 404 || error.status === 409 ? error.status : 422,
					{
						formType: 'updateShare' as const,
						shareId,
						errorMessage: error.message,
						fieldErrors: error.details ?? {},
						values
					}
				);
			}
			throw error;
		}
	},

	deleteShare: async ({ request, locals }) => {
		if (!locals.user) {
			return fail(401, {
				formType: 'deleteShare' as const,
				errorMessage: t('auth.signInForActionAlt')
			});
		}

		const formData = await request.formData();
		const shareId = String(formData.get('shareId') ?? '').trim();
		const returnTo = sanitizeReturnTo(formData.get('returnTo'), '/');

		if (!shareId) {
			return fail(422, {
				formType: 'deleteShare' as const,
				shareId,
				errorMessage: t('share.idMissing')
			});
		}

		try {
			await softDeleteLinkShare({
				actor: {
					id: locals.user.id,
					role: locals.user.role
				},
				shareId
			});

			if (!wantsJsonResponse(request)) {
				redirect(303, returnTo);
			}

			return {
				success: true,
				formType: 'deleteShare' as const,
				shareId
			};
		} catch (error) {
			if (error instanceof LinkServiceError) {
				return fail(
					error.status === 403 || error.status === 404 || error.status === 409 ? error.status : 422,
					{
						formType: 'deleteShare' as const,
						shareId,
						errorMessage: error.message
					}
				);
			}
			throw error;
		}
	},

	toggleLike: async ({ request, locals }) => {
		if (!locals.user) {
			return fail(401, {
				formType: 'toggleLike' as const,
				errorMessage: t('auth.signInForActionAlt')
			});
		}

		const formData = await request.formData();
		const resourceId = String(formData.get('resourceId') ?? '').trim();
		const returnTo = sanitizeReturnTo(formData.get('returnTo'), '/');

		if (!resourceId) {
			return fail(422, {
				formType: 'toggleLike' as const,
				resourceId,
				errorMessage: t('resource.idMissing')
			});
		}

		try {
			const result = await toggleResourceLike({
				actorId: locals.user.id,
				resourceId,
				desired: parseDesiredLike(formData.get('liked'))
			});

			if (!wantsJsonResponse(request)) {
				redirect(303, returnTo);
			}

			return {
				success: true,
				formType: 'toggleLike' as const,
				resourceId: result.resourceId,
				liked: result.liked,
				likeCount: result.likeCount
			};
		} catch (error) {
			if (error instanceof InteractionServiceError) {
				return fail(error.status === 403 || error.status === 404 ? error.status : 422, {
					formType: 'toggleLike' as const,
					resourceId,
					errorMessage: error.message
				});
			}
			throw error;
		}
	},

	acceptSuggestion: async ({ request, locals }) =>
		resolveSuggestion(request, locals, 'acceptSuggestion', (actor, shareId, sectionId) =>
			acceptSuggestion({ actor, shareId, sectionId })
		),

	dismissSuggestions: async ({ request, locals }) =>
		resolveSuggestion(request, locals, 'dismissSuggestions', async (actor, shareId) => {
			await dismissSuggestions({ actor, shareId });
		}),

	undoAutoSection: async ({ request, locals }) =>
		resolveSuggestion(request, locals, 'undoAutoSection', (actor, shareId, sectionId) =>
			undoAutoSection({ actor, shareId, sectionId })
		)
} satisfies Actions;

/** Shared body of the suggestion actions (forms first; JS-off posts redirect back). */
async function resolveSuggestion(
	request: Request,
	locals: App.Locals,
	formType: 'acceptSuggestion' | 'dismissSuggestions' | 'undoAutoSection',
	run: (actor: { id: string; role: UserRole }, shareId: string, sectionId: string) => Promise<void>
) {
	if (!locals.user) {
		return fail(401, { formType, errorMessage: t('auth.signInForActionAlt') });
	}
	const formData = await request.formData();
	const shareId = String(formData.get('shareId') ?? '').trim();
	const sectionId = String(formData.get('sectionId') ?? '').trim();
	const returnTo = sanitizeReturnTo(formData.get('returnTo'), '/');
	if (!shareId || (formType !== 'dismissSuggestions' && !sectionId)) {
		return fail(422, { formType, shareId, errorMessage: t('suggest.failed') });
	}
	try {
		await run({ id: locals.user.id, role: locals.user.role }, shareId, sectionId);
	} catch (error) {
		if (error instanceof SuggestionError) {
			return fail(error.status, { formType, shareId, errorMessage: t('suggest.failed') });
		}
		throw error;
	}
	if (!wantsJsonResponse(request)) {
		redirect(303, returnTo);
	}
	return { success: true, formType, shareId };
}

export const load: PageServerLoad = async ({ depends, locals, url }) =>
	_loadFeedPage({
		depends,
		url,
		viewerUserId: locals.user?.id,
		viewerRole: locals.user?.role
	});

export const actions: Actions = _feedShareActions;
