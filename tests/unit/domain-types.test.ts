import { describe, expect, expectTypeOf, it } from 'vitest';
import {
	contentTypeEnum,
	sourceChannelEnum,
	unfurlStatusEnum,
	type ContentType as DbContentType,
	type ProviderMeta as DbProviderMeta,
	type SourceChannel as DbSourceChannel,
	type UnfurlStatus as DbUnfurlStatus
} from '../../src/lib/server/db/schema';
import type {
	ContentType,
	ProviderMeta,
	SourceChannel,
	UnfurlStatus
} from '../../src/lib/types/domain';

describe('client-safe domain types mirror the database enums', () => {
	it('matches enum values', () => {
		expect([...contentTypeEnum.enumValues].sort()).toEqual(
			['article', 'repo', 'social', 'video', 'web'].sort()
		);
		expect([...unfurlStatusEnum.enumValues].sort()).toEqual(
			['failed', 'queued', 'ready', 'running'].sort()
		);
		expect([...sourceChannelEnum.enumValues].sort()).toEqual(['api', 'web']);
		expectTypeOf<ContentType>().toEqualTypeOf<DbContentType>();
		expectTypeOf<UnfurlStatus>().toEqualTypeOf<DbUnfurlStatus>();
		expectTypeOf<SourceChannel>().toEqualTypeOf<DbSourceChannel>();
		expectTypeOf<ProviderMeta>().toEqualTypeOf<DbProviderMeta>();
	});
});
