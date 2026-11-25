import type { RequestEvent } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb } from '../../src/lib/server/db/client';
import {
	canonicalResources,
	linkShareSections,
	linkShares,
	sections,
	users,
	type ContentType
} from '../../src/lib/server/db/schema';
import { GET } from '../../src/routes/api/internal/feed/updates/+server';
import { closeTestDb, migrateTestDb, resetTestDb, testDb } from '../setup/db';

async function callUpdates(query: string, viewerId: string | null) {
	const url = new URL(`http://localhost:3000/api/internal/feed/updates${query}`);
	const event = {
		url,
		request: new Request(url),
		locals: {
			requestId: 'req_test_updates',
			user: viewerId
				? { id: viewerId, name: 'İzleyen', email: 'i@izgah.test', role: 'member', authVersion: 1 }
				: null,
			session: null,
			authChannel: viewerId ? 'cookie' : null,
			apiKeyId: null
		}
	} as unknown as RequestEvent;
	const response = await GET(event as Parameters<typeof GET>[0]);
	return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function seedUser(email: string) {
	const [user] = await testDb
		.insert(users)
		.values({ name: email, email, role: 'member' })
		.returning({ id: users.id });
	return user.id;
}

async function seedShare(options: {
	authorId: string;
	createdAt: string;
	isFeedVisible?: boolean;
	sectionId?: string;
	contentType?: ContentType;
	deleted?: boolean;
	label: string;
	id?: string;
}) {
	const [resource] = await testDb
		.insert(canonicalResources)
		.values({
			canonicalUrl: `https://updates.example/${options.label}`,
			domain: 'updates.example',
			contentType: options.contentType ?? 'web'
		})
		.returning({ id: canonicalResources.id });
	// Silent shares must get their section link in the same transaction (deferred constraint).
	return testDb.transaction(async (tx) => {
		const [share] = await tx
			.insert(linkShares)
			.values({
				...(options.id ? { id: options.id } : {}),
				resourceId: resource.id,
				authorId: options.authorId,
				rawUrl: `https://updates.example/${options.label}`,
				isFeedVisible: options.isFeedVisible ?? true,
				sourceChannel: 'web',
				createdAt: sql`${options.createdAt}::timestamptz`,
				deletedAt: options.deleted ? new Date() : null
			})
			.returning({ id: linkShares.id });
		if (options.sectionId) {
			await tx
				.insert(linkShareSections)
				.values({ shareId: share.id, sectionId: options.sectionId });
		}
		return share.id;
	});
}

describe('GET /api/internal/feed/updates (docs/designs/izgah-ui-v2.md §10)', () => {
	beforeAll(async () => {
		await migrateTestDb();
	});

	beforeEach(async () => {
		await resetTestDb();
	});

	afterAll(async () => {
		await closeDb();
		await closeTestDb();
	});

	it('requires a cookie session and validates parameters', async () => {
		expect((await callUpdates('', null)).status).toBe(401);
		const viewer = await seedUser('viewer@izgah.test');
		expect((await callUpdates('?type=podcast', viewer)).status).toBe(400);
		expect((await callUpdates('?afterId=../../x', viewer)).status).toBe(400);
		expect((await callUpdates('?afterId=missing-share', viewer)).status).toBe(404);
		expect((await callUpdates('?section=missing-section', viewer)).status).toBe(404);
	});

	it('counts newer shares in scope, excluding own, deleted and (on the feed) silent shares', async () => {
		const viewer = await seedUser('viewer@izgah.test');
		const other = await seedUser('other@izgah.test');
		const [section] = await testDb
			.insert(sections)
			.values({ slug: 'arayuz', name: 'Arayüz', createdById: other })
			.returning({ id: sections.id });

		const anchor = await seedShare({
			authorId: other,
			createdAt: '2026-11-20T10:00:00.000100Z',
			label: 'anchor',
			sectionId: section.id
		});
		// Same microsecond as the anchor but larger/smaller id must be ordered by (created_at, id).
		await seedShare({ authorId: other, createdAt: '2026-11-20T10:00:01Z', label: 'visible' });
		await seedShare({
			authorId: other,
			createdAt: '2026-11-20T10:00:02Z',
			label: 'video',
			contentType: 'video'
		});
		await seedShare({
			authorId: other,
			createdAt: '2026-11-20T10:00:03Z',
			label: 'silent',
			isFeedVisible: false,
			sectionId: section.id
		});
		await seedShare({ authorId: viewer, createdAt: '2026-11-20T10:00:04Z', label: 'own' });
		await seedShare({
			authorId: other,
			createdAt: '2026-11-20T10:00:05Z',
			label: 'deleted',
			deleted: true
		});
		await seedShare({ authorId: other, createdAt: '2026-11-20T09:00:00Z', label: 'older' });

		expect((await callUpdates(`?afterId=${anchor}`, viewer)).body).toEqual({ newCount: 2 });
		expect((await callUpdates(`?afterId=${anchor}&type=video`, viewer)).body).toEqual({
			newCount: 1
		});
		expect((await callUpdates(`?afterId=${anchor}&section=${section.id}`, viewer)).body).toEqual({
			newCount: 1
		});
		// Without an anchor (empty view) every share in scope counts.
		expect((await callUpdates('', viewer)).body).toEqual({ newCount: 4 });
	});

	it('orders shares in the anchor microsecond by id', async () => {
		const viewer = await seedUser('viewer@izgah.test');
		const other = await seedUser('other@izgah.test');
		const stamp = '2026-11-20T10:00:00.123456Z';
		await seedShare({ authorId: other, createdAt: stamp, label: 'b', id: 'share-b' });
		await seedShare({ authorId: other, createdAt: stamp, label: 'm', id: 'share-m' });
		await seedShare({ authorId: other, createdAt: stamp, label: 'z', id: 'share-z' });
		expect((await callUpdates('?afterId=share-m', viewer)).body).toEqual({ newCount: 1 });
	});

	it('caps the count at 100', async () => {
		const viewer = await seedUser('viewer@izgah.test');
		const other = await seedUser('other@izgah.test');
		for (let i = 0; i < 105; i += 1) {
			await seedShare({
				authorId: other,
				createdAt: `2026-11-20T10:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}Z`,
				label: `bulk-${i}`
			});
		}
		expect((await callUpdates('', viewer)).body).toEqual({ newCount: 100 });
	});
});
