/** Feed item shapes shared by the server loaders and the client components. */
import {
	CONTENT_TYPES,
	type ContentType,
	type ProviderMeta,
	type SourceChannel,
	type UnfurlStatus
} from '#lib/types/domain.ts';
import { t } from '#lib/i18n/index.ts';

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
		likedByViewer?: boolean;
	};
	sections: Array<{
		id: string;
		slug: string;
		name: string;
	}>;
	attribution: FeedShareAttribution | null;
}

export interface ShareCardFormError {
	formType: 'updateShare' | 'deleteShare';
	shareId: string;
	errorMessage: string;
	fieldErrors?: Record<string, string[]>;
	values?: {
		note?: string;
		sectionIds?: string[];
		contentType?: string;
		silentMode?: boolean;
	};
}

/** Localized label for a content type (falls back to "Web" for unknown values). */
export function contentTypeLabel(type: string): string {
	const known: readonly string[] = CONTENT_TYPES;
	return t(`contentType.${(known.includes(type) ? type : 'web') as ContentType}`);
}

/** Feed pages appended with "Daha fazla yükle", kept across Back/Forward via Kit snapshots. */
export interface FeedSnapshot {
	key: string;
	appended: FeedShareItem[];
	hasMore: boolean | null;
	nextCursor: string | null;
	scrollY: number;
}
