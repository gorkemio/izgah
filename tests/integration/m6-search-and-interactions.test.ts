import type { Cookies, RequestEvent } from '@sveltejs/kit';
import { and, asc, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handle } from '../../src/hooks.server';
import { createApiKey } from '../../src/lib/server/auth/api-keys';
import { resetRateLimiters } from '../../src/lib/server/auth/rate-limit';
import { consumeInviteToken, createInviteToken } from '../../src/lib/server/auth/tokens';
import { closeDb } from '../../src/lib/server/db/client';
import {
	canonicalResources,
	notifications,
	resourceLikes,
	searchLogs,
	sections,
	users,
	type UserRole
} from '../../src/lib/server/db/schema';
import {
	addResourceComment,
	getResourceDiscussion,
	InteractionServiceError,
	listUnreadNotifications,
	markNotificationsRead,
	softDeleteResourceComment,
	toggleResourceLike,
	updateResourceComment
} from '../../src/lib/server/interactions/service';
import { createLinkShare, softDeleteLinkShare } from '../../src/lib/server/links/service';
import { searchResources } from '../../src/lib/server/search/service';
import { _loadFeedPage } from '../../src/routes/(app)/+page.server';
import {
	GET as notificationsGet,
	POST as notificationsPost
} from '../../src/routes/api/internal/notifications/+server';
import { closeTestDb, migrateTestDb, resetTestDb, testDb } from '../setup/db';

function createMockCookies(initialCookieHeader?: string): Cookies {
	const store = new Map<string, string>();
	if (initialCookieHeader) {
		for (const part of initialCookieHeader.split(';')) {
			const idx = part.indexOf('=');
			if (idx === -1) {
				continue;
			}
			const name = part.slice(0, idx).trim();
			const value = part.slice(idx + 1).trim();
			if (name) {
				try {
					store.set(name, decodeURIComponent(value));
				} catch {
					store.set(name, value);
				}
			}
		}
	}

	return {
		get(name) {
			return store.get(name);
		},
		getAll() {
			return Array.from(store.entries()).map(([name, value]) => ({ name, value }));
		},
		set(name, value) {
			store.set(name, value);
		},
		delete(name) {
			store.delete(name);
		},
		parse: (() => {
			throw new Error('cookies.parse is not used in tests');
		}) as never,
		serialize(name, value) {
			return `${name}=${encodeURIComponent(value)}`;
		}
	};
}

function extractCookiePairFromSetCookies(setCookieHeaders: string[]): string {
	for (const line of setCookieHeaders) {
		const semi = line.indexOf(';');
		const pair = semi === -1 ? line : line.slice(0, semi);
		if (
			pair.startsWith('better-auth.session_token=') ||
			pair.startsWith('__Secure-better-auth.session_token=')
		) {
			return pair.trim();
		}
	}
	throw new Error('Session Set-Cookie header not found');
}

function createMockEvent(options: {
	url: string;
	method?: string;
	headers?: HeadersInit;
	rawBody?: string;
	jsonBody?: unknown;
}): RequestEvent {
	const fullUrl = new URL(options.url, 'http://localhost:3000');
	const headers = new Headers(options.headers);
	const method = (
		options.method ?? (options.jsonBody !== undefined ? 'POST' : 'GET')
	).toUpperCase();

	let body: BodyInit | undefined;
	if (options.rawBody !== undefined) {
		body = options.rawBody;
		if (!headers.has('content-type')) {
			headers.set('content-type', 'application/json');
		}
	} else if (options.jsonBody !== undefined) {
		body = JSON.stringify(options.jsonBody);
		if (!headers.has('content-type')) {
			headers.set('content-type', 'application/json');
		}
	}

	const request = new Request(fullUrl, {
		method,
		headers,
		...(body !== undefined ? { body } : {})
	});

	return {
		request,
		url: fullUrl,
		cookies: createMockCookies(headers.get('cookie') ?? undefined),
		params: {},
		route: { id: null },
		locals: {
			requestId: 'req_m6_test',
			user: null,
			session: null,
			authChannel: null,
			apiKeyId: null
		},
		platform: undefined,
		isDataRequest: false,
		isSubRequest: false,
		getClientAddress: () => '10.20.30.40',
		setHeaders: () => {},
		fetch,
		depends: () => {},
		parent: async () => ({}),
		untrack: <T>(fn: () => T) => fn(),
		tracing: {
			enabled: false,
			root: {} as RequestEvent['tracing']['root'],
			current: {} as RequestEvent['tracing']['current']
		}
	} as unknown as RequestEvent;
}

async function dispatchNotificationsEndpoint(options: {
	url: string;
	method?: string;
	headers?: HeadersInit;
	rawBody?: string;
	jsonBody?: unknown;
}): Promise<Response> {
	const event = createMockEvent(options);
	return handle({
		event,
		resolve: async (ev) => {
			if (ev.url.pathname === '/api/internal/notifications') {
				const method = ev.request.method.toUpperCase();
				if (method === 'GET') {
					return notificationsGet(ev as Parameters<typeof notificationsGet>[0]);
				}
				if (method === 'POST') {
					return notificationsPost(ev as Parameters<typeof notificationsPost>[0]);
				}
			}
			return new Response('Not Found', { status: 404 });
		}
	});
}

async function seedUserWithSessionAndKey(input: {
	name: string;
	email: string;
	role: UserRole;
	isActive?: boolean;
}) {
	const [user] = await testDb
		.insert(users)
		.values({
			name: input.name,
			email: input.email.toLowerCase(),
			role: input.role,
			isActive: true
		})
		.returning();

	const invite = await createInviteToken(user.id, 'invite', null);
	const accepted = await consumeInviteToken(invite.rawToken, 'invite', 'GucluParola1234!');
	const cookie = extractCookiePairFromSetCookies(accepted.setCookieHeaders);
	const apiKey = await createApiKey(user.id, `${input.name} Extension`);

	if (input.isActive === false) {
		await testDb.update(users).set({ isActive: false }).where(eq(users.id, user.id));
	}

	return {
		user: { ...user, isActive: input.isActive ?? true },
		cookie,
		rawApiKey: apiKey.rawKey
	};
}

async function seedSection(input: {
	name: string;
	slug: string;
	sortOrder: number;
	createdById: string;
}) {
	const [row] = await testDb
		.insert(sections)
		.values({
			name: input.name,
			slug: input.slug,
			description: null,
			sortOrder: input.sortOrder,
			createdById: input.createdById
		})
		.returning();
	return row;
}

describe('Milestone M6 — Shared likes, flat comments, bilingual search, and targeted notifications', () => {
	beforeAll(async () => {
		await migrateTestDb();
	});

	beforeEach(async () => {
		await resetTestDb();
		resetRateLimiters();
	});

	afterEach(() => {
		resetRateLimiters();
	});

	afterAll(async () => {
		await Promise.all([closeTestDb(), closeDb()]);
	});

	describe('Shared resource likes, atomic counters, and feed projection', () => {
		it('projects shared like_count and viewer-specific likedByViewer across multiple shares of the same canonical resource', async () => {
			const alice = await seedUserWithSessionAndKey({
				name: 'Alice Yilmaz',
				email: 'alice@izgah.test',
				role: 'admin'
			});
			const bob = await seedUserWithSessionAndKey({
				name: 'Bob Demir',
				email: 'bob@izgah.test',
				role: 'member'
			});
			const sec = await seedSection({
				name: 'Mühendislik',
				slug: 'muhendislik',
				sortOrder: 1,
				createdById: alice.user.id
			});

			const share1 = await createLinkShare({
				actor: { id: alice.user.id, role: alice.user.role },
				url: 'https://example.com/architecture?utm_source=x',
				note: 'İlk paylaşım',
				sectionIds: [sec.id]
			});
			const share2 = await createLinkShare({
				actor: { id: bob.user.id, role: bob.user.role },
				url: 'https://example.com/architecture?fbclid=hn123',
				note: 'Ben de ekliyorum',
				sectionIds: [sec.id]
			});

			expect(share2.share.resourceId).toBe(share1.share.resourceId);

			const likeResult = await toggleResourceLike({
				actorId: bob.user.id,
				resourceId: share1.share.resourceId
			});
			expect(likeResult).toEqual({
				resourceId: share1.share.resourceId,
				liked: true,
				likeCount: 1
			});

			const feedForBob = await _loadFeedPage({
				depends: () => {},
				url: new URL('http://localhost:3000/'),
				viewerUserId: bob.user.id
			});
			expect(feedForBob.items).toHaveLength(2);
			for (const item of feedForBob.items) {
				expect(item.resource.id).toBe(share1.share.resourceId);
				expect(item.resource.likeCount).toBe(1);
				expect(item.resource.likedByViewer).toBe(true);
			}

			const feedForAlice = await _loadFeedPage({
				depends: () => {},
				url: new URL('http://localhost:3000/'),
				viewerUserId: alice.user.id
			});
			for (const item of feedForAlice.items) {
				expect(item.resource.likeCount).toBe(1);
				expect(item.resource.likedByViewer).toBe(false);
			}
		});

		it('maintains exact like_count with zero drift under concurrent likes/unlikes and deduplicates like notifications', async () => {
			const seededUsers = await Promise.all([
				seedUserWithSessionAndKey({ name: 'Üye 1', email: 'u1@izgah.test', role: 'admin' }),
				seedUserWithSessionAndKey({ name: 'Üye 2', email: 'u2@izgah.test', role: 'member' }),
				seedUserWithSessionAndKey({ name: 'Üye 3', email: 'u3@izgah.test', role: 'member' }),
				seedUserWithSessionAndKey({ name: 'Üye 4', email: 'u4@izgah.test', role: 'member' }),
				seedUserWithSessionAndKey({ name: 'Üye 5', email: 'u5@izgah.test', role: 'member' }),
				seedUserWithSessionAndKey({ name: 'Üye 6', email: 'u6@izgah.test', role: 'member' })
			]);
			const [owner, ...likers] = seededUsers;
			const sec = await seedSection({
				name: 'Genel',
				slug: 'genel',
				sortOrder: 1,
				createdById: owner.user.id
			});

			const share = await createLinkShare({
				actor: { id: owner.user.id, role: owner.user.role },
				url: 'https://example.com/concurrency-check',
				sectionIds: [sec.id]
			});
			const resourceId = share.share.resourceId;

			// 5 concurrent likes at the same time
			await Promise.all(likers.map((u) => toggleResourceLike({ actorId: u.user.id, resourceId })));

			const [afterLikes] = await testDb
				.select({ likeCount: canonicalResources.likeCount })
				.from(canonicalResources)
				.where(eq(canonicalResources.id, resourceId));
			const likeRows = await testDb
				.select({ userId: resourceLikes.userId })
				.from(resourceLikes)
				.where(eq(resourceLikes.resourceId, resourceId));

			expect(likeRows).toHaveLength(likers.length);
			expect(afterLikes.likeCount).toBe(likers.length);

			// Like -> unlike -> re-like by likers[0] must not produce a second 'like' notification
			await toggleResourceLike({ actorId: likers[0].user.id, resourceId });
			await toggleResourceLike({ actorId: likers[0].user.id, resourceId });

			const ownerLikeNotifs = await testDb
				.select({ id: notifications.id, actorUserId: notifications.actorUserId })
				.from(notifications)
				.where(
					and(
						eq(notifications.recipientUserId, owner.user.id),
						eq(notifications.resourceId, resourceId),
						eq(notifications.kind, 'like')
					)
				);
			expect(ownerLikeNotifs.filter((n) => n.actorUserId === likers[0].user.id)).toHaveLength(1);

			// Concurrent unlikes drop count cleanly back to 0 and never negative
			await Promise.all(likers.map((u) => toggleResourceLike({ actorId: u.user.id, resourceId })));

			const [afterUnlikes] = await testDb
				.select({ likeCount: canonicalResources.likeCount })
				.from(canonicalResources)
				.where(eq(canonicalResources.id, resourceId));
			const remainingLikes = await testDb
				.select({ userId: resourceLikes.userId })
				.from(resourceLikes)
				.where(eq(resourceLikes.resourceId, resourceId));

			expect(remainingLikes).toHaveLength(0);
			expect(afterUnlikes.likeCount).toBe(0);
		});
	});

	describe('Flat resource comments, permissions, and soft-delete guards', () => {
		it('enforces author-only edit, author+admin soft-delete, concurrent delete counter guard, and 404 on deleted resource', async () => {
			const admin = await seedUserWithSessionAndKey({
				name: 'Yönetici Ece',
				email: 'admin@izgah.test',
				role: 'admin'
			});
			const author = await seedUserWithSessionAndKey({
				name: 'Yazar Mert',
				email: 'mert@izgah.test',
				role: 'member'
			});
			const otherMember = await seedUserWithSessionAndKey({
				name: 'Üye Can',
				email: 'can@izgah.test',
				role: 'member'
			});
			const sec = await seedSection({
				name: 'Backend',
				slug: 'backend',
				sortOrder: 1,
				createdById: admin.user.id
			});

			const share = await createLinkShare({
				actor: { id: author.user.id, role: author.user.role },
				url: 'https://example.com/flat-comments',
				sectionIds: [sec.id]
			});
			const resourceId = share.share.resourceId;

			await expect(
				addResourceComment({ actorId: author.user.id, resourceId, body: '   ' })
			).rejects.toMatchObject({ status: 422, code: 'VALIDATION_ERROR' });

			await expect(
				addResourceComment({
					actorId: author.user.id,
					resourceId,
					body: 'a'.repeat(2001)
				})
			).rejects.toMatchObject({ status: 422, code: 'VALIDATION_ERROR' });

			const first = await addResourceComment({
				actorId: author.user.id,
				resourceId,
				body: 'İlk yorum'
			});
			const second = await addResourceComment({
				actorId: otherMember.user.id,
				resourceId,
				body: 'İkinci yorum'
			});
			expect(second.commentCount).toBe(2);

			// Only comment author can edit; even admin cannot edit another user's comment
			await expect(
				updateResourceComment({
					actor: { id: otherMember.user.id, role: otherMember.user.role },
					commentId: first.comment.id,
					body: 'Yetkisiz düzenleme'
				})
			).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });

			await expect(
				updateResourceComment({
					actor: { id: admin.user.id, role: admin.user.role },
					commentId: first.comment.id,
					body: 'Admin bile düzenleyememeli'
				})
			).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });

			const edited = await updateResourceComment({
				actor: { id: author.user.id, role: author.user.role },
				commentId: first.comment.id,
				body: 'İlk yorum güncellendi'
			});
			expect(edited.body).toBe('İlk yorum güncellendi');

			// Flat chronological order in discussion loader
			const discussion = await getResourceDiscussion({
				resourceId,
				viewerUserId: admin.user.id
			});
			expect(discussion?.comments.map((c) => c.id)).toEqual([first.comment.id, second.comment.id]);
			expect(discussion?.resource.commentCount).toBe(2);

			// Unrelated member cannot soft-delete author's comment
			await expect(
				softDeleteResourceComment({
					actor: { id: otherMember.user.id, role: otherMember.user.role },
					commentId: first.comment.id
				})
			).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });

			// Concurrent double-delete decrements comment_count only once
			const concurrentDeletes = await Promise.allSettled([
				softDeleteResourceComment({
					actor: { id: author.user.id, role: author.user.role },
					commentId: first.comment.id
				}),
				softDeleteResourceComment({
					actor: { id: admin.user.id, role: admin.user.role },
					commentId: first.comment.id
				})
			]);
			const fulfilled = concurrentDeletes.filter((r) => r.status === 'fulfilled');
			const rejected = concurrentDeletes.filter((r) => r.status === 'rejected');
			expect(fulfilled).toHaveLength(1);
			expect(rejected).toHaveLength(1);
			if (rejected[0]?.status === 'rejected') {
				expect(rejected[0].reason).toBeInstanceOf(InteractionServiceError);
				expect((rejected[0].reason as InteractionServiceError).status).toBe(404);
			}

			// Admin CAN soft-delete another member's comment
			const adminDel = await softDeleteResourceComment({
				actor: { id: admin.user.id, role: admin.user.role },
				commentId: second.comment.id
			});
			expect(adminDel.commentCount).toBe(0);

			// Once all shares of the resource are soft-deleted, resource discussion & interactions return 404 / null
			await addResourceComment({
				actorId: otherMember.user.id,
				resourceId,
				body: 'Bildirim bırakan yorum'
			});
			await softDeleteLinkShare({
				actor: { id: author.user.id, role: author.user.role },
				shareId: share.share.id
			});

			expect(await getResourceDiscussion({ resourceId, viewerUserId: author.user.id })).toBeNull();
			await expect(
				toggleResourceLike({ actorId: admin.user.id, resourceId })
			).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
			await expect(
				addResourceComment({ actorId: admin.user.id, resourceId, body: 'Olmamalı' })
			).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });

			const unreadAfterDelete = await listUnreadNotifications(author.user.id);
			expect(unreadAfterDelete.unreadCount).toBe(0);
		});
	});

	describe('Targeted notifications & /api/internal/notifications auth/read discipline', () => {
		it('delivers reshare/like/comment notifications to active participants, skips silent reshares, and marks read via internal API', async () => {
			const admin = await seedUserWithSessionAndKey({
				name: 'Elif Yönetici',
				email: 'elif@izgah.test',
				role: 'admin'
			});
			const sharer = await seedUserWithSessionAndKey({
				name: 'Ahmet Çelik',
				email: 'ahmet@izgah.test',
				role: 'member'
			});
			const commenter = await seedUserWithSessionAndKey({
				name: 'Selin Aksoy',
				email: 'selin@izgah.test',
				role: 'member'
			});
			const passiveObserver = await seedUserWithSessionAndKey({
				name: 'Pasif Kullanıcı',
				email: 'pasif@izgah.test',
				role: 'member',
				isActive: false
			});
			const sec = await seedSection({
				name: 'Sistem',
				slug: 'sistem',
				sortOrder: 1,
				createdById: admin.user.id
			});

			const shareA = await createLinkShare({
				actor: { id: sharer.user.id, role: sharer.user.role },
				url: 'https://example.com/shared-article',
				sectionIds: [sec.id]
			});
			const resourceId = shareA.share.resourceId;

			// Commenter leaves a comment -> notifies sharer
			await addResourceComment({
				actorId: commenter.user.id,
				resourceId,
				body: 'Harika kaynak!'
			});
			// Sharer also comments -> must deduplicate when someone else acts next, and passiveObserver gets nothing
			await addResourceComment({
				actorId: sharer.user.id,
				resourceId,
				body: 'Katılıyorum!'
			});

			// Silent duplicate share (admin only, isFeedVisible: false) MUST NOT emit reshare notification
			await createLinkShare({
				actor: { id: admin.user.id, role: admin.user.role },
				url: 'https://example.com/shared-article?utm_campaign=silent',
				sectionIds: [sec.id],
				isFeedVisible: false
			});

			let sharerUnreadBeforeReshare = await listUnreadNotifications(sharer.user.id);
			expect(sharerUnreadBeforeReshare.notifications.map((n) => n.kind)).toEqual(['comment']);

			// Visible duplicate share emits 'reshare' to sharer and commenter (excluding actor admin)
			await createLinkShare({
				actor: { id: admin.user.id, role: admin.user.role },
				url: 'https://example.com/shared-article?utm_campaign=loud',
				sectionIds: [sec.id],
				isFeedVisible: true
			});

			// Admin likes -> notifies sharer & commenter
			await toggleResourceLike({
				actorId: admin.user.id,
				resourceId
			});

			sharerUnreadBeforeReshare = await listUnreadNotifications(sharer.user.id);
			expect(sharerUnreadBeforeReshare.unreadCount).toBe(3);
			const messages = sharerUnreadBeforeReshare.notifications.map((n) => n.message);
			expect(messages).toContain('Elif Yönetici paylaştığın bağlantıyı beğendi');
			expect(messages).toContain('Elif Yönetici daha önce paylaştığın bağlantıyı yeniden paylaştı');
			expect(messages).toContain('Selin Aksoy takip ettiğin kaynağa yorum yaptı');

			// Disabled user never receives notifications
			const passiveNotifs = await listUnreadNotifications(passiveObserver.user.id);
			expect(passiveNotifs.unreadCount).toBe(0);

			// /api/internal/notifications enforces cookie-only + same-origin
			const unauthRes = await dispatchNotificationsEndpoint({
				url: 'http://localhost:3000/api/internal/notifications',
				method: 'GET'
			});
			expect(unauthRes.status).toBe(401);

			const bearerRes = await dispatchNotificationsEndpoint({
				url: 'http://localhost:3000/api/internal/notifications',
				method: 'GET',
				headers: {
					Authorization: `Bearer ${sharer.rawApiKey}`
				}
			});
			expect(bearerRes.status).toBe(401);

			const crossOriginPost = await dispatchNotificationsEndpoint({
				url: 'http://localhost:3000/api/internal/notifications',
				method: 'POST',
				headers: {
					Cookie: sharer.cookie,
					Origin: 'https://evil.example'
				},
				jsonBody: { markAll: true }
			});
			expect(crossOriginPost.status).toBe(403);

			// Cookie GET returns 200 with Cache-Control: private, no-store
			const validGet = await dispatchNotificationsEndpoint({
				url: 'http://localhost:3000/api/internal/notifications',
				method: 'GET',
				headers: {
					Cookie: sharer.cookie
				}
			});
			expect(validGet.status).toBe(200);
			expect(validGet.headers.get('cache-control')).toBe('private, no-store');
			const getJson = (await validGet.json()) as {
				unreadCount: number;
				notifications: Array<{ id: string; message: string }>;
			};
			expect(getJson.unreadCount).toBe(3);
			expect(getJson.notifications).toHaveLength(3);

			// Empty payload -> 422
			const invalidPost = await dispatchNotificationsEndpoint({
				url: 'http://localhost:3000/api/internal/notifications',
				method: 'POST',
				headers: {
					Cookie: sharer.cookie,
					Origin: 'http://localhost:3000'
				},
				jsonBody: {}
			});
			expect(invalidPost.status).toBe(422);

			// Single notification mark-read
			const markOneRes = await dispatchNotificationsEndpoint({
				url: 'http://localhost:3000/api/internal/notifications',
				method: 'POST',
				headers: {
					Cookie: sharer.cookie,
					Origin: 'http://localhost:3000'
				},
				jsonBody: { notificationIds: [getJson.notifications[0].id] }
			});
			expect(markOneRes.status).toBe(200);
			const markOneJson = (await markOneRes.json()) as {
				updatedCount: number;
				unreadCount: number;
			};
			expect(markOneJson).toEqual({ updatedCount: 1, unreadCount: 2 });

			// Mark all remaining as read
			const markAllRes = await markNotificationsRead(sharer.user.id, { markAll: true });
			expect(markAllRes).toEqual({ updatedCount: 2, unreadCount: 0 });
		});
	});

	describe('Bilingual search (§6 examples), deduplication, scope filters, and zero-query-text search_logs privacy', () => {
		it('matches Turkish inflected words, English terms, share notes, and owner/repo substrings while keeping search_logs private', async () => {
			const alice = await seedUserWithSessionAndKey({
				name: 'Deniz',
				email: 'deniz@izgah.test',
				role: 'admin'
			});
			const bob = await seedUserWithSessionAndKey({
				name: 'Burak',
				email: 'burak@izgah.test',
				role: 'member'
			});

			const backendSection = await seedSection({
				name: 'Backend',
				slug: 'backend',
				sortOrder: 1,
				createdById: alice.user.id
			});
			const frontendSection = await seedSection({
				name: 'Frontend',
				slug: 'frontend',
				sortOrder: 2,
				createdById: alice.user.id
			});

			// 1) Turkish resource + English terms + duplicate share (to verify deduplication & attribution)
			const turkishShare1 = await createLinkShare({
				actor: { id: alice.user.id, role: alice.user.role },
				url: 'https://martinfowler.example/articles/distributed-cache',
				note: 'Üretim ortamında kuyruk gecikmelerini çözen kılavuz',
				sectionIds: [backendSection.id],
				contentType: 'article'
			});
			await createLinkShare({
				actor: { id: bob.user.id, role: bob.user.role },
				url: 'https://martinfowler.example/articles/distributed-cache?utm_medium=feed',
				note: 'İkinci paylaşım notu',
				sectionIds: [backendSection.id]
			});
			await testDb
				.update(canonicalResources)
				.set({
					unfurlStatus: 'ready',
					title: 'Dağıtık Sistemlerde Önbellekleme Mimarileri',
					description: 'OpenTelemetry distributed tracing instrumentation rehberi'
				})
				.where(eq(canonicalResources.id, turkishShare1.share.resourceId));

			// 2) owner/repo GitHub resource in Frontend section
			const repoShare = await createLinkShare({
				actor: { id: bob.user.id, role: bob.user.role },
				url: 'https://github.com/sveltejs/kit',
				note: 'SvelteKit tam yığın çerçevesi',
				sectionIds: [frontendSection.id],
				contentType: 'repo'
			});
			await testDb
				.update(canonicalResources)
				.set({
					unfurlStatus: 'ready',
					title: 'SvelteKit',
					description: 'Web development, streamlined'
				})
				.where(eq(canonicalResources.id, repoShare.share.resourceId));

			// Empty or whitespace queries do NOT execute or write to search_logs
			const emptyResult = await searchResources({ userId: alice.user.id, query: '   \t\n ' });
			expect(emptyResult.executed).toBe(false);
			expect(emptyResult.items).toHaveLength(0);
			const logsAfterEmpty = await testDb.select().from(searchLogs);
			expect(logsAfterEmpty).toHaveLength(0);

			// §6.1: Turkish inflected query ("mimariler" / "dagitik" -> matches "Mimarileri" & "Dağıtık")
			const trStemMatch = await searchResources({
				userId: alice.user.id,
				query: 'dagitik mimariler'
			});
			expect(trStemMatch.executed).toBe(true);
			expect(trStemMatch.totalCount).toBe(1);
			// Must deduplicate by canonical_resources.id even though 2 active shares exist
			expect(trStemMatch.items).toHaveLength(1);
			expect(trStemMatch.items[0].resource.id).toBe(turkishShare1.share.resourceId);

			// §6.2: English technical term ("instrumentation")
			const enTermMatch = await searchResources({
				userId: alice.user.id,
				query: 'instrumentation'
			});
			expect(enTermMatch.totalCount).toBe(1);
			expect(enTermMatch.items[0].resource.id).toBe(turkishShare1.share.resourceId);

			// §6.3: Share note ("kuyruk gecikmeler" matches "kuyruk gecikmelerini" via note_search_vector)
			const noteMatch = await searchResources({
				userId: alice.user.id,
				query: 'kuyruk gecikmeler'
			});
			expect(noteMatch.totalCount).toBe(1);
			expect(noteMatch.items[0].note).toContain('kuyruk gecikmelerini');

			// §6.4: owner/repo URL substring
			const ownerRepoMatch = await searchResources({
				userId: alice.user.id,
				query: 'sveltejs/kit'
			});
			expect(ownerRepoMatch.totalCount).toBe(1);
			expect(ownerRepoMatch.items[0].resource.id).toBe(repoShare.share.resourceId);

			// Section filter ("Bu Bölüm"): repoShare is only in Frontend, not Backend
			const scopedEmpty = await searchResources({
				userId: alice.user.id,
				query: 'sveltejs/kit',
				sectionId: backendSection.id
			});
			expect(scopedEmpty.totalCount).toBe(0);

			const scopedFrontend = await searchResources({
				userId: alice.user.id,
				query: 'sveltejs/kit',
				sectionId: frontendSection.id
			});
			expect(scopedFrontend.totalCount).toBe(1);

			// Content-type filter
			const filteredByType = await searchResources({
				userId: alice.user.id,
				query: 'sveltejs/kit',
				contentType: 'article'
			});
			expect(filteredByType.totalCount).toBe(0);

			// Soft-deleting share clears its note_search_vector via DB trigger
			await softDeleteLinkShare({
				actor: { id: alice.user.id, role: alice.user.role },
				shareId: turkishShare1.share.id
			});
			const afterDeleteNoteSearch = await searchResources({
				userId: alice.user.id,
				query: 'kuyruk gecikmeler'
			});
			expect(afterDeleteNoteSearch.totalCount).toBe(0);

			// Verify search_logs stores count & optional sectionId ONLY — never raw query text
			const logs = await testDb
				.select()
				.from(searchLogs)
				.orderBy(asc(searchLogs.createdAt), asc(searchLogs.id));
			expect(logs.length).toBe(8);
			for (const log of logs) {
				expect(Object.keys(log).sort()).toEqual([
					'createdAt',
					'id',
					'resultCount',
					'sectionId',
					'userId'
				]);
				expect(JSON.stringify(log)).not.toContain('sveltejs/kit');
				expect(JSON.stringify(log)).not.toContain('instrumentation');
				expect(JSON.stringify(log)).not.toContain('kuyruk');
			}
			expect(logs[4].sectionId).toBe(backendSection.id);
			expect(logs[4].resultCount).toBe(0);
		});
	});
});
