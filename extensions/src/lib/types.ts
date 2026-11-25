import { msg } from './i18n';
export const DEFAULT_IZGAH_ORIGIN: string = __IZGAH_DEFAULT_ORIGIN__;

export const SESSION_META_TTL_MS = 60_000;
export const PENDING_SHARE_TTL_MS = 10_000;
export const REQUEST_TIMEOUT_MS = 10_000;
export const MAX_URL_LENGTH = 2048;
export const MAX_NOTE_LENGTH = 1000;

export type BrowserTarget = 'chrome' | 'firefox' | 'safari';
export type UserRole = 'admin' | 'member';
export type ContentType = 'video' | 'repo' | 'social' | 'article' | 'web';

export const CONTENT_TYPES = [
	'video',
	'repo',
	'social',
	'article',
	'web'
] as const satisfies readonly ContentType[];

/** Localized content type label (`contentType_<type>` in `_locales`). */
export function contentTypeLabel(type: ContentType): string {
	return msg(`contentType_${type}`);
}

export interface CachedUserProfile {
	id: string;
	name: string;
	email: string;
	role: UserRole;
}

export interface ExtensionSettings {
	serverOrigin: string;
	apiKey: string;
	cachedUser: CachedUserProfile | null;
}

export interface SectionItem {
	id: string;
	slug: string;
	name: string;
	description: string | null;
	sortOrder: number;
}

export interface SessionMetaCache {
	serverOrigin: string;
	user: CachedUserProfile;
	sections: SectionItem[];
	cachedAt: number;
}

export interface PendingShareContext {
	url: string;
	title: string | null;
	source: 'page' | 'link';
	createdAt: number;
}

export interface MeResponse {
	user: CachedUserProfile;
}

export interface SectionsResponse {
	sections: SectionItem[];
}

export interface LinkCheckResponse {
	exists: boolean;
	canonicalUrl: string;
	rawUrl: string;
	suggestedContentType: ContentType;
	resource?: {
		id: string;
		title: string | null;
		likeCount: number;
		commentCount: number;
	};
	sharesSummary?: {
		totalCount: number;
		firstShare: {
			authorName: string;
			createdAt: string;
			isFeedVisible: boolean;
			sectionNames: string[];
		} | null;
	};
}

export interface CreateLinkInput {
	url: string;
	note?: string;
	sectionIds?: string[];
	contentType?: ContentType;
	isFeedVisible?: boolean;
}

export interface CreateLinkResponse {
	share: {
		id: string;
		resourceId: string;
		canonicalUrl: string;
		rawUrl: string;
		isFeedVisible: boolean;
		createdAt: string;
	};
	unfurlStatus: string;
	duplicate: boolean;
}

export interface ApiErrorEnvelope {
	error: {
		code: string;
		message: string;
		requestId?: string;
		details?: Record<string, string[]>;
	};
}

export interface MappedApiError {
	status: number | null;
	code: string;
	userMessage: string;
	requestId: string | null;
	fieldErrors: Record<string, string[]>;
	retryAfterSeconds: number | null;
	isAuthError: boolean;
	isNetworkError: boolean;
}
