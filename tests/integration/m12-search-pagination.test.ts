import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb } from '../../src/lib/server/db/client';
import { canonicalResources, linkShares, users } from '../../src/lib/server/db/schema';
import {
	MAX_SEARCH_OFFSET,
	resetSearchLogDedupe,
	searchResources
} from '../../src/lib/server/search/service';
import { closeTestDb, migrateTestDb, resetTestDb, testDb } from '../setup/db';

describe('search pagination beyond 25 results (docs/designs/izgah-ui-v2.md §13)', () => {
	beforeAll(async () => {
		await migrateTestDb();
	});

	beforeEach(async () => {
		await resetTestDb();
		resetSearchLogDedupe();
	});

	afterAll(async () => {
		await closeDb();
		await closeTestDb();
	});

	it('pages through every match exactly once and clamps deep offsets', async () => {
		const [author] = await testDb
			.insert(users)
			.values({ name: 'Arayan', email: 'arayan@izgah.test', role: 'member' })
			.returning({ id: users.id });
		for (let i = 0; i < 30; i += 1) {
			const [resource] = await testDb
				.insert(canonicalResources)
				.values({
					canonicalUrl: `https://sayfa.example/yazi-${i}`,
					domain: 'sayfa.example',
					unfurlStatus: 'ready',
					title: `Sayfalama rehberi ${i}`
				})
				.returning({ id: canonicalResources.id });
			await testDb.insert(linkShares).values({
				resourceId: resource.id,
				authorId: author.id,
				rawUrl: `https://sayfa.example/yazi-${i}`,
				isFeedVisible: true,
				sourceChannel: 'web'
			});
		}

		const first = await searchResources({ userId: author.id, query: 'sayfalama' });
		expect(first.totalCount).toBe(30);
		expect(first.items).toHaveLength(25);
		expect(first.offset).toBe(0);

		const second = await searchResources({ userId: author.id, query: 'sayfalama', offset: 25 });
		expect(second.totalCount).toBe(30);
		expect(second.items).toHaveLength(5);
		expect(second.offset).toBe(25);

		const seen = new Set([...first.items, ...second.items].map((item) => item.resource.id));
		expect(seen.size).toBe(30);

		const beyond = await searchResources({ userId: author.id, query: 'sayfalama', offset: 99_999 });
		expect(beyond.offset).toBe(MAX_SEARCH_OFFSET);
		expect(beyond.items).toHaveLength(0);
		expect(beyond.totalCount).toBe(30);
	});
});
