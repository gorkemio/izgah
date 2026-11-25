/*
 * Client-safe domain types. They mirror the database enums in $lib/server/db/schema.ts so client
 * components never import server modules (izgah-ui-v2 §5); a type test keeps them in sync.
 */
export const CONTENT_TYPES = ['video', 'repo', 'social', 'article', 'web'] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];
export type UnfurlStatus = 'queued' | 'running' | 'ready' | 'failed';
export type SourceChannel = 'web' | 'api';

export interface ProviderMeta {
	stars?: number;
	language?: string;
	authorName?: string;
}
