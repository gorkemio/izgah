import type { RequestEvent } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { appTimeZone } from '../../src/lib/instance';
import {
	checkQuickSearchRateLimit,
	QUICK_SEARCH_MAX_REQUESTS,
	resetRateLimiters
} from '../../src/lib/server/auth/rate-limit';
import { closeDb } from '../../src/lib/server/db/client';
import {
	canonicalResources,
	linkShareSections,
	linkShares,
	resourceComments,
	searchLogs,
	sections,
	users
} from '../../src/lib/server/db/schema';
import { getFeedRailSummary } from '../../src/lib/server/feed/rail-summary';
import { countSharesBySection } from '../../src/lib/server/sections/service';
import { resetSearchLogDedupe, searchResources } from '../../src/lib/server/search/service';
import { GET as quickSearchGet } from '../../src/routes/api/internal/search/quick/+server';
import { closeTestDb, migrateTestDb, resetTestDb, testDb } from '../setup/db';

async function callQuickSearch(options: {
	query?: string;
	viewerId: string | null;
	authChannel?: 'cookie' | 'api_key' | null;
	headers?: HeadersInit;
}) {
	const search = options.query !== undefined ? `?q=${encodeURIComponent(options.query)}` : '';
	const url = new URL(`http://localhost:3000/api/internal/search/quick${search}`);
	const event = {
		url,
		request: new Request(url, { headers: options.headers }),
		locals: {
			requestId: 'req_test_quick_search',
			user: options.viewerId
				? {
						id: options.viewerId,
						name: 'Üye',
						email: 'uye@izgah.test',
						role: 'member',
						authVersion: 1
					}
				: null,
			session: null,
			authChannel:
				options.authChannel !== undefined
					? options.authChannel
					: options.viewerId
						? 'cookie'
						: null,
			apiKeyId: null
		}
	} as unknown as RequestEvent;

	const response = await quickSearchGet(event as Parameters<typeof quickSearchGet>[0]);
	return {
		status: response.status,
		cacheControl: response.headers.get('cache-control'),
		retryAfter: response.headers.get('retry-after'),
		body: (await response.json()) as Record<string, unknown>
	};
}

async function seedUser(input: { name: string; email: string; isActive?: boolean }) {
	const [user] = await testDb
		.insert(users)
		.values({
			name: input.name,
			email: input.email.toLowerCase(),
			role: 'member',
			isActive: input.isActive ?? true
		})
		.returning({ id: users.id, name: users.name });
	return user;
}

async function seedResourceAndShare(options: {
	authorId: string;
	slug: string;
	title: string;
	likeCount?: number;
	isFeedVisible?: boolean;
	sectionId?: string;
	deleted?: boolean;
	createdAtExpr?: ReturnType<typeof sql>;
}) {
	const url = `https://studio.example/${options.slug}`;
	const [resource] = await testDb
		.insert(canonicalResources)
		.values({
			canonicalUrl: url,
			domain: 'studio.example',
			unfurlStatus: 'ready',
			title: options.title,
			likeCount: options.likeCount ?? 0
		})
		.returning({ id: canonicalResources.id });

	const shareId = await testDb.transaction(async (tx) => {
		const [share] = await tx
			.insert(linkShares)
			.values({
				resourceId: resource.id,
				authorId: options.authorId,
				rawUrl: url,
				isFeedVisible: options.isFeedVisible ?? true,
				sourceChannel: 'web',
				...(options.createdAtExpr ? { createdAt: options.createdAtExpr } : {}),
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

	return { resourceId: resource.id, shareId };
}

describe('UI v3 integration — GET /api/internal/search/quick & getFeedRailSummary (docs/designs/izgah-ui-v3.md §5, §7.3)', () => {
	beforeAll(async () => {
		await migrateTestDb();
	});

	beforeEach(async () => {
		await resetTestDb();
		resetSearchLogDedupe();
		resetRateLimiters();
	});

	afterAll(async () => {
		await closeDb();
		await closeTestDb();
	});

	describe('GET /api/internal/search/quick and search_logs discipline', () => {
		it('enforces cookie auth (401), same-origin / Sec-Fetch-Site (403), and Cache-Control: no-store', async () => {
			const viewer = await seedUser({ name: 'Arama Üyesi', email: 'arama@izgah.test' });

			const unauth = await callQuickSearch({ query: 'svelte', viewerId: null });
			expect(unauth.status).toBe(401);
			expect(unauth.cacheControl).toBe('no-store');

			const apiKeyAuth = await callQuickSearch({
				query: 'svelte',
				viewerId: viewer.id,
				authChannel: 'api_key'
			});
			expect(apiKeyAuth.status).toBe(401);

			const badOrigin = await callQuickSearch({
				query: 'svelte',
				viewerId: viewer.id,
				headers: { origin: 'https://evil.example' }
			});
			expect(badOrigin.status).toBe(403);
			expect(badOrigin.cacheControl).toBe('no-store');

			const badFetchSite = await callQuickSearch({
				query: 'svelte',
				viewerId: viewer.id,
				headers: { 'sec-fetch-site': 'cross-site' }
			});
			expect(badFetchSite.status).toBe(403);
		});

		it('returns empty for < 2 chars, caps results at 6, and never writes to search_logs while default searchResources still logs', async () => {
			const viewer = await seedUser({ name: 'Hızlı Arayan', email: 'hizli@izgah.test' });
			for (let i = 0; i < 8; i += 1) {
				await seedResourceAndShare({
					authorId: viewer.id,
					slug: `studio-rehber-${i}`,
					title: `Stüdyo Mimari Rehberi ${i}`
				});
			}

			for (const shortQuery of ['', 's', '  x  ']) {
				const shortRes = await callQuickSearch({
					query: shortQuery,
					viewerId: viewer.id,
					headers: { origin: 'http://localhost:3000', 'sec-fetch-site': 'same-origin' }
				});
				expect(shortRes.status).toBe(200);
				expect(shortRes.cacheControl).toBe('no-store');
				expect(shortRes.body).toEqual({ items: [], totalCount: 0, query: '' });
			}

			const quickRes = await callQuickSearch({
				query: 'Stüdyo',
				viewerId: viewer.id,
				headers: { origin: 'http://localhost:3000', 'sec-fetch-site': 'same-origin' }
			});
			expect(quickRes.status).toBe(200);
			expect(quickRes.cacheControl).toBe('no-store');
			expect(quickRes.body.totalCount).toBe(8);
			expect(quickRes.body.query).toBe('Stüdyo');
			expect(Array.isArray(quickRes.body.items)).toBe(true);
			expect((quickRes.body.items as unknown[]).length).toBe(6);

			// Critical invariant: ⌘K quick search must leave search_logs completely untouched.
			const logsAfterQuick = await testDb.select().from(searchLogs);
			expect(logsAfterQuick).toHaveLength(0);

			// Full search (default recordLog = true, as used by /search) still records a search_logs row.
			const fullSearch = await searchResources({
				userId: viewer.id,
				query: 'Stüdyo'
			});
			expect(fullSearch.totalCount).toBe(8);
			expect(fullSearch.items).toHaveLength(8);
			const logsAfterFull = await testDb.select().from(searchLogs);
			expect(logsAfterFull).toHaveLength(1);
			expect(logsAfterFull[0]).toMatchObject({
				userId: viewer.id,
				resultCount: 8
			});
		});

		it('rate-limits typeahead per session with 429 + Retry-After', async () => {
			const viewer = await seedUser({ name: 'Hızlı Yazan', email: 'hizli-yazan@izgah.test' });
			const sameOrigin = { origin: 'http://localhost:3000', 'sec-fetch-site': 'same-origin' };

			// Short queries never hit the database and are not counted.
			const short = await callQuickSearch({ query: 'a', viewerId: viewer.id, headers: sameOrigin });
			expect(short.status).toBe(200);

			for (let i = 0; i < QUICK_SEARCH_MAX_REQUESTS; i += 1) {
				expect(checkQuickSearchRateLimit(viewer.id).allowed).toBe(true);
			}

			const limited = await callQuickSearch({
				query: 'svelte',
				viewerId: viewer.id,
				headers: sameOrigin
			});
			expect(limited.status).toBe(429);
			expect(limited.cacheControl).toBe('no-store');
			expect(Number(limited.retryAfter)).toBeGreaterThan(0);
			expect((limited.body.error as { code: string }).code).toBe('RATE_LIMITED');
		});
	});

	describe('getFeedRailSummary()', () => {
		it('returns zeros and empty lists on an empty database', async () => {
			expect(await getFeedRailSummary(testDb)).toEqual({
				todayShares: 0,
				todayComments: 0,
				popularResources: [],
				activeMembers: []
			});
		});

		it('computes today counts using APP_TIME_ZONE midnight and filters deleted/silent records', async () => {
			const APP_TIME_ZONE = appTimeZone();
			const author = await seedUser({ name: 'Zaman Üyesi', email: 'zaman@izgah.test' });
			const [sec] = await testDb
				.insert(sections)
				.values({ slug: 'genel', name: 'Genel', createdById: author.id })
				.returning({ id: sections.id });

			const todayPlusOneMin = sql`(date_trunc('day', now() AT TIME ZONE ${APP_TIME_ZONE}) AT TIME ZONE ${APP_TIME_ZONE}) + interval '1 minute'`;
			const yesterdayMinusOneMin = sql`(date_trunc('day', now() AT TIME ZONE ${APP_TIME_ZONE}) AT TIME ZONE ${APP_TIME_ZONE}) - interval '1 minute'`;

			// 1 visible share today -> counted
			const visibleToday = await seedResourceAndShare({
				authorId: author.id,
				slug: 'bugun-gorunur',
				title: 'Bugün Görünür',
				createdAtExpr: todayPlusOneMin
			});
			// 1 visible share yesterday (1 minute before Istanbul midnight) -> excluded from todayShares
			await seedResourceAndShare({
				authorId: author.id,
				slug: 'dun-gorunur',
				title: 'Dün Görünür',
				createdAtExpr: yesterdayMinusOneMin
			});
			// 1 silent share today -> excluded from todayShares
			await seedResourceAndShare({
				authorId: author.id,
				slug: 'bugun-sessiz',
				title: 'Bugün Sessiz',
				isFeedVisible: false,
				sectionId: sec.id,
				createdAtExpr: todayPlusOneMin
			});
			// 1 soft-deleted share today -> excluded from todayShares
			await seedResourceAndShare({
				authorId: author.id,
				slug: 'bugun-silinmis',
				title: 'Bugün Silinmiş',
				deleted: true,
				createdAtExpr: todayPlusOneMin
			});

			// Comments: 1 active today (counted), 1 yesterday (excluded), 1 deleted today (excluded)
			await testDb.insert(resourceComments).values([
				{
					resourceId: visibleToday.resourceId,
					authorId: author.id,
					body: 'Bugünkü yorum',
					createdAt: todayPlusOneMin
				},
				{
					resourceId: visibleToday.resourceId,
					authorId: author.id,
					body: 'Dünkü yorum',
					createdAt: yesterdayMinusOneMin
				},
				{
					resourceId: visibleToday.resourceId,
					authorId: author.id,
					body: 'Silinmiş yorum',
					createdAt: todayPlusOneMin,
					deletedAt: new Date()
				}
			]);

			const summary = await getFeedRailSummary(testDb);
			expect(summary.todayShares).toBe(1);
			expect(summary.todayComments).toBe(1);
		});

		it('ranks 7-day top commented resources (limit 3) and excludes deleted, silent-only, and >7d comments', async () => {
			const author = await seedUser({ name: 'Yorumcu', email: 'yorumcu@izgah.test' });
			const [sec] = await testDb
				.insert(sections)
				.values({ slug: 'arsiv', name: 'Arşiv', createdById: author.id })
				.returning({ id: sections.id });

			const rTop = await seedResourceAndShare({
				authorId: author.id,
				slug: 'top',
				title: 'En Çok Konuşulan',
				likeCount: 2
			});
			const rTieHighLikes = await seedResourceAndShare({
				authorId: author.id,
				slug: 'tie-hi',
				title: 'Eşit Yorum Çok Beğeni',
				likeCount: 10
			});
			const rTieLowLikes = await seedResourceAndShare({
				authorId: author.id,
				slug: 'tie-lo',
				title: 'Eşit Yorum Az Beğeni',
				likeCount: 1
			});
			const rFourth = await seedResourceAndShare({
				authorId: author.id,
				slug: 'fourth',
				title: 'Dördüncü Kaynak',
				likeCount: 50
			});
			const rSilentOnly = await seedResourceAndShare({
				authorId: author.id,
				slug: 'silent-only',
				title: 'Sadece Sessiz Kaynak',
				isFeedVisible: false,
				sectionId: sec.id
			});
			const rDeletedOnly = await seedResourceAndShare({
				authorId: author.id,
				slug: 'deleted-only',
				title: 'Silinmiş Kaynak',
				deleted: true
			});
			const rOldComments = await seedResourceAndShare({
				authorId: author.id,
				slug: 'old-comments',
				title: 'Eski Yorumlu Kaynak'
			});

			const recentTime = sql`now() - interval '2 days'`;
			const oldTime = sql`now() - interval '8 days'`;

			// 3 recent comments on rTop (+ 1 deleted comment that must not count)
			await testDb.insert(resourceComments).values([
				{ resourceId: rTop.resourceId, authorId: author.id, body: 'c1', createdAt: recentTime },
				{ resourceId: rTop.resourceId, authorId: author.id, body: 'c2', createdAt: recentTime },
				{ resourceId: rTop.resourceId, authorId: author.id, body: 'c3', createdAt: recentTime },
				{
					resourceId: rTop.resourceId,
					authorId: author.id,
					body: 'deleted',
					createdAt: recentTime,
					deletedAt: new Date()
				}
			]);
			// 2 recent comments each on rTieHighLikes and rTieLowLikes
			await testDb.insert(resourceComments).values([
				{
					resourceId: rTieHighLikes.resourceId,
					authorId: author.id,
					body: 'c1',
					createdAt: recentTime
				},
				{
					resourceId: rTieHighLikes.resourceId,
					authorId: author.id,
					body: 'c2',
					createdAt: recentTime
				},
				{
					resourceId: rTieLowLikes.resourceId,
					authorId: author.id,
					body: 'c1',
					createdAt: recentTime
				},
				{
					resourceId: rTieLowLikes.resourceId,
					authorId: author.id,
					body: 'c2',
					createdAt: recentTime
				}
			]);
			// 1 recent comment on rFourth (excluded by LIMIT 3)
			await testDb.insert(resourceComments).values({
				resourceId: rFourth.resourceId,
				authorId: author.id,
				body: 'c1',
				createdAt: recentTime
			});
			// 5 recent comments each on silent-only and deleted-only resources (must be excluded)
			for (let i = 0; i < 5; i += 1) {
				await testDb.insert(resourceComments).values([
					{
						resourceId: rSilentOnly.resourceId,
						authorId: author.id,
						body: `s${i}`,
						createdAt: recentTime
					},
					{
						resourceId: rDeletedOnly.resourceId,
						authorId: author.id,
						body: `d${i}`,
						createdAt: recentTime
					},
					{
						resourceId: rOldComments.resourceId,
						authorId: author.id,
						body: `o${i}`,
						createdAt: oldTime
					}
				]);
			}

			const summary = await getFeedRailSummary(testDb);
			expect(summary.popularResources).toHaveLength(3);
			expect(
				summary.popularResources.map((r) => ({
					id: r.id,
					recentCommentCount: r.recentCommentCount
				}))
			).toEqual([
				{ id: rTop.resourceId, recentCommentCount: 3 },
				{ id: rTieHighLikes.resourceId, recentCommentCount: 2 },
				{ id: rTieLowLikes.resourceId, recentCommentCount: 2 }
			]);
		});

		it('ranks 7-day top sharers (limit 5) and excludes inactive users, silent/deleted shares, and >7d shares', async () => {
			const activeMembers = await Promise.all([
				seedUser({ name: 'Ada', email: 'ada@izgah.test' }),
				seedUser({ name: 'Bora', email: 'bora@izgah.test' }),
				seedUser({ name: 'Can', email: 'can@izgah.test' }),
				seedUser({ name: 'Deniz', email: 'deniz@izgah.test' }),
				seedUser({ name: 'Ece', email: 'ece@izgah.test' }),
				seedUser({ name: 'Fırat', email: 'firat@izgah.test' })
			]);
			const inactive = await seedUser({
				name: 'Pasif Üye',
				email: 'pasif@izgah.test',
				isActive: false
			});
			const [sec] = await testDb
				.insert(sections)
				.values({ slug: 'ekip', name: 'Ekip', createdById: activeMembers[0].id })
				.returning({ id: sections.id });

			const recentTime = sql`now() - interval '1 day'`;
			const oldTime = sql`now() - interval '9 days'`;

			// Give counts: Ada=6, Bora=5, Can=4, Deniz=3, Ece=2, Fırat=1 (Fırat excluded by LIMIT 5)
			const counts = [6, 5, 4, 3, 2, 1];
			for (let m = 0; m < activeMembers.length; m += 1) {
				for (let i = 0; i < counts[m]; i += 1) {
					await seedResourceAndShare({
						authorId: activeMembers[m].id,
						slug: `m-${m}-${i}`,
						title: `Share ${m}-${i}`,
						createdAtExpr: recentTime
					});
				}
			}

			// Give Ece extra silent, deleted, and >7d shares — none should inflate Ece's count
			await seedResourceAndShare({
				authorId: activeMembers[4].id,
				slug: 'ece-silent',
				title: 'Ece Silent',
				isFeedVisible: false,
				sectionId: sec.id,
				createdAtExpr: recentTime
			});
			await seedResourceAndShare({
				authorId: activeMembers[4].id,
				slug: 'ece-deleted',
				title: 'Ece Deleted',
				deleted: true,
				createdAtExpr: recentTime
			});
			await seedResourceAndShare({
				authorId: activeMembers[4].id,
				slug: 'ece-old',
				title: 'Ece Old',
				createdAtExpr: oldTime
			});

			// Inactive user has 8 recent visible shares — must be completely excluded
			for (let i = 0; i < 8; i += 1) {
				await seedResourceAndShare({
					authorId: inactive.id,
					slug: `inactive-${i}`,
					title: `Inactive ${i}`,
					createdAtExpr: recentTime
				});
			}

			const summary = await getFeedRailSummary(testDb);
			expect(summary.activeMembers).toHaveLength(5);
			expect(summary.activeMembers.map((m) => [m.name, m.shareCount])).toEqual([
				['Ada', 6],
				['Bora', 5],
				['Can', 4],
				['Deniz', 3],
				['Ece', 2]
			]);
		});
	});

	describe('countSharesBySection()', () => {
		it('counts live shares per section, silent ones included and deleted ones left out', async () => {
			const author = await seedUser({ name: 'Sayan Üye', email: 'sayan@izgah.test' });
			const [tasarim, bos] = await testDb
				.insert(sections)
				.values([
					{ slug: 'tasarim', name: 'Tasarım', createdById: author.id },
					{ slug: 'bos', name: 'Boş', createdById: author.id }
				])
				.returning({ id: sections.id });
			await seedResourceAndShare({
				authorId: author.id,
				slug: 'a',
				title: 'A',
				sectionId: tasarim.id
			});
			await seedResourceAndShare({
				authorId: author.id,
				slug: 'b',
				title: 'B',
				sectionId: tasarim.id,
				isFeedVisible: false
			});
			await seedResourceAndShare({
				authorId: author.id,
				slug: 'c',
				title: 'C',
				sectionId: tasarim.id,
				deleted: true
			});
			await seedResourceAndShare({ authorId: author.id, slug: 'd', title: 'D' });

			const counts = await countSharesBySection(testDb);
			expect(counts.get(tasarim.id)).toBe(2);
			expect(counts.has(bos.id)).toBe(false);
		});
	});
});
