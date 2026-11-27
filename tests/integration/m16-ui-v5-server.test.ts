import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { RequestEvent } from '@sveltejs/kit';
import { isActionFailure } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handle } from '../../src/hooks.server';
import { resetRateLimiters } from '../../src/lib/server/auth/rate-limit';
import { closeDb } from '../../src/lib/server/db/client';
import {
	auditLogs,
	canonicalResources,
	linkShares,
	mediaAssets,
	siteIcons,
	unfurlJobs,
	users,
	type UserRole
} from '../../src/lib/server/db/schema';
import {
	createLinkShare,
	LinkServiceError,
	restoreLinkShare,
	RESTORE_WINDOW_MS,
	softDeleteLinkShare
} from '../../src/lib/server/links/service';
import {
	AvatarError,
	MAX_AVATAR_BYTES,
	removeUserAvatar,
	setUserAvatar
} from '../../src/lib/server/media/avatars';
import { refreshSiteIcon, SITE_ICON_REFRESH_MS } from '../../src/lib/server/media/site-icons';
import type { MediaDiskCheckOptions } from '../../src/lib/server/media/storage';
import { _loadFeedPage } from '../../src/routes/(app)/+page.server';
import { actions as settingsActions } from '../../src/routes/(app)/settings/+page.server';
import { actions as adminUserActions } from '../../src/routes/(app)/admin/users/+page.server';
import { closeTestDb, migrateTestDb, resetTestDb, testDb } from '../setup/db';

let mediaDir = '';
let prevMediaStorageDir: string | undefined;
let media: MediaDiskCheckOptions;

/** A roomy disk so the free-space guard never depends on the machine running the tests. */
const roomyDisk: MediaDiskCheckOptions['statfs'] = async () => ({
	bavail: 1_000_000,
	bsize: 4096,
	blocks: 1_000_000
});

async function png(width: number, height: number, colour = '#3a7'): Promise<Uint8Array<ArrayBuffer>> {
	return new Uint8Array(
		await sharp({ create: { width, height, channels: 3, background: colour } })
			.png()
			.toBuffer()
	);
}

async function createUser(name: string, role: UserRole = 'member') {
	const [user] = await testDb
		.insert(users)
		.values({ name, email: `${name.toLowerCase()}@izgah.test`, role, isActive: true })
		.returning();
	return user;
}

async function assetRow(assetKey: string) {
	const [row] = await testDb.select().from(mediaAssets).where(eq(mediaAssets.assetKey, assetKey));
	return row;
}

function actionEvent(options: {
	url: string;
	user: { id: string; name: string; email: string; role: UserRole };
	body: FormData;
}): RequestEvent {
	const url = new URL(options.url, 'http://localhost:3000');
	return {
		request: new Request(url, { method: 'POST', body: options.body }),
		url,
		cookies: { get: () => undefined, getAll: () => [], set: () => {}, delete: () => {} },
		params: {},
		route: { id: null },
		locals: {
			requestId: 'req_test_ui_v5',
			user: { ...options.user, authVersion: 1 },
			session: { id: 'session-1', expiresAt: new Date(Date.now() + 60_000) },
			authChannel: 'cookie',
			apiKeyId: null
		},
		getClientAddress: () => '10.0.0.1',
		setHeaders: () => {},
		fetch,
		depends: () => {},
		parent: async () => ({}),
		untrack: <T>(fn: () => T) => fn()
	} as unknown as RequestEvent;
}

beforeAll(async () => {
	await migrateTestDb();
	mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'izgah-m16-media-'));
	prevMediaStorageDir = process.env.MEDIA_STORAGE_DIR;
	process.env.MEDIA_STORAGE_DIR = mediaDir;
	media = { storageDir: mediaDir, statfs: roomyDisk };
});

beforeEach(async () => {
	await resetTestDb();
	resetRateLimiters();
});

afterAll(async () => {
	fs.rmSync(mediaDir, { recursive: true, force: true });
	if (prevMediaStorageDir === undefined) {
		delete process.env.MEDIA_STORAGE_DIR;
	} else {
		process.env.MEDIA_STORAGE_DIR = prevMediaStorageDir;
	}
	await closeTestDb();
	await closeDb();
});

describe('site icons (izgah-ui-v5.md §10.1)', () => {
	it('stores the first decodable candidate as a 64px WebP and shows it in the feed', async () => {
		const member = await createUser('Ada');
		await createLinkShare({
			actor: { id: member.id, role: member.role },
			url: 'https://icons.example.test/post'
		});

		const requested: string[] = [];
		const outcome = await refreshSiteIcon(
			'icons.example.test',
			['https://icons.example.test/missing.png', 'https://icons.example.test/apple.png'],
			{
				mediaOptions: media,
				fetchBytes: async (url) => {
					requested.push(url);
					return url.endsWith('apple.png')
						? { status: 200, bytes: await png(180, 180) }
						: { status: 404, bytes: new Uint8Array() };
				}
			}
		);

		expect(outcome).toBe('ok');
		expect(requested).toEqual([
			'https://icons.example.test/missing.png',
			'https://icons.example.test/apple.png'
		]);
		const [icon] = await testDb
			.select()
			.from(siteIcons)
			.where(eq(siteIcons.domain, 'icons.example.test'));
		expect(icon.status).toBe('ok');
		expect(icon.sourceUrl).toBe('https://icons.example.test/apple.png');
		const asset = await assetRow(icon.assetKey!);
		expect([asset.width, asset.height, asset.refCount]).toEqual([64, 64, 1]);

		const feed = await _loadFeedPage({
			depends: () => {},
			url: new URL('http://localhost:3000/'),
			viewerUserId: member.id
		});
		expect(feed.items[0].resource.siteIconAssetKey).toBe(icon.assetKey);
	});

	it('skips fresh icons, replaces stale ones and keeps the old icon when a refresh fails', async () => {
		const start = new Date('2026-01-01T00:00:00Z');
		const first = await refreshSiteIcon('swap.example.test', ['https://swap.example.test/a.png'], {
			mediaOptions: media,
			now: start,
			fetchBytes: async () => ({ status: 200, bytes: await png(32, 32, '#111') })
		});
		expect(first).toBe('ok');
		const [before] = await testDb.select().from(siteIcons);

		const fresh = await refreshSiteIcon('swap.example.test', ['https://swap.example.test/a.png'], {
			mediaOptions: media,
			now: new Date(start.getTime() + 1000),
			fetchBytes: async () => {
				throw new Error('must not fetch a fresh icon');
			}
		});
		expect(fresh).toBe('fresh');

		const later = new Date(start.getTime() + SITE_ICON_REFRESH_MS + 1000);
		const failed = await refreshSiteIcon('swap.example.test', ['https://swap.example.test/a.png'], {
			mediaOptions: media,
			now: later,
			fetchBytes: async () => {
				throw new Error('network down');
			}
		});
		expect(failed).toBe('failed');
		const [kept] = await testDb.select().from(siteIcons);
		expect(kept.assetKey).toBe(before.assetKey);
		expect(kept.status).toBe('ok');

		const replaced = await refreshSiteIcon(
			'swap.example.test',
			['https://swap.example.test/b.png'],
			{
				mediaOptions: media,
				now: new Date(later.getTime() + SITE_ICON_REFRESH_MS + 1000),
				fetchBytes: async () => ({ status: 200, bytes: await png(48, 48, '#e33') })
			}
		);
		expect(replaced).toBe('ok');
		const [after] = await testDb.select().from(siteIcons);
		expect(after.assetKey).not.toBe(before.assetKey);
		expect((await assetRow(before.assetKey!)).refCount).toBe(0);
		expect((await assetRow(before.assetKey!)).orphanedAt).not.toBeNull();
		expect((await assetRow(after.assetKey!)).refCount).toBe(1);
	});

	it('records "none" when no candidate is an image', async () => {
		const outcome = await refreshSiteIcon('none.example.test', ['https://none.example.test/x'], {
			mediaOptions: media,
			fetchBytes: async () => ({
				status: 200,
				bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')
			})
		});
		expect(outcome).toBe('none');
		const [icon] = await testDb.select().from(siteIcons);
		expect([icon.status, icon.assetKey]).toEqual(['none', null]);
	});
});

describe('profile photos (izgah-ui-v5.md §10.2)', () => {
	it('stores a 256×256 WebP, replaces it with reference counting and removes it', async () => {
		const member = await createUser('Bora');
		const firstKey = await setUserAvatar(member.id, await png(800, 400, '#246'), media);
		const first = await assetRow(firstKey);
		expect([first.width, first.height, first.mimeType, first.refCount]).toEqual([
			256,
			256,
			'image/webp',
			1
		]);

		const secondKey = await setUserAvatar(member.id, await png(300, 300, '#a24'), media);
		expect(secondKey).not.toBe(firstKey);
		expect((await assetRow(firstKey)).refCount).toBe(0);
		expect((await assetRow(secondKey)).refCount).toBe(1);

		// Uploading the same picture again does not add a second reference.
		expect(await setUserAvatar(member.id, await png(300, 300, '#a24'), media)).toBe(secondKey);
		expect((await assetRow(secondKey)).refCount).toBe(1);

		expect(await removeUserAvatar(member.id)).toBe(true);
		expect(await removeUserAvatar(member.id)).toBe(false);
		const [row] = await testDb.select().from(users).where(eq(users.id, member.id));
		expect(row.avatarAssetKey).toBeNull();
		expect((await assetRow(secondKey)).orphanedAt).not.toBeNull();
	});

	it('rejects GIFs, oversized files and bytes that do not decode', async () => {
		const member = await createUser('Cem');
		const gif = new Uint8Array(
			await sharp({ create: { width: 4, height: 4, channels: 3, background: '#000' } })
				.gif()
				.toBuffer()
		);
		const code = async (bytes: Uint8Array) => {
			try {
				await setUserAvatar(member.id, bytes, media);
				return 'stored';
			} catch (error) {
				return error instanceof AvatarError ? error.code : 'other';
			}
		};
		expect(await code(gif)).toBe('unsupported');
		expect(await code(new Uint8Array(MAX_AVATAR_BYTES + 1))).toBe('too_large');
		expect(await code(new Uint8Array())).toBe('empty');
		const truncated = (await png(64, 64)).slice(0, 40);
		expect(await code(truncated)).toBe('unsupported');
	});

	it('runs through the settings actions with an audit entry and the rate limit', async () => {
		const member = await createUser('Deniz');
		const user = { id: member.id, name: member.name, email: member.email, role: member.role };

		const body = new FormData();
		body.set('avatar', new File([await png(120, 120)], 'me.png', { type: 'image/png' }));
		const result = await settingsActions.setAvatar(
			actionEvent({ url: '/settings?/setAvatar', user, body }) as never
		);
		expect(isActionFailure(result)).toBe(false);
		const stored = (result as { avatarAssetKey: string }).avatarAssetKey;
		expect(stored).toMatch(/^[0-9a-f]{64}$/);

		const removed = await settingsActions.removeAvatar(
			actionEvent({ url: '/settings?/removeAvatar', user, body: new FormData() }) as never
		);
		expect((removed as { avatarAssetKey: null }).avatarAssetKey).toBeNull();

		const actions = await testDb
			.select({ action: auditLogs.action })
			.from(auditLogs)
			.where(eq(auditLogs.targetId, member.id));
		expect(actions.map((entry) => entry.action).sort()).toEqual([
			'user.avatar_removed',
			'user.avatar_updated'
		]);

		const empty = await settingsActions.setAvatar(
			actionEvent({ url: '/settings?/setAvatar', user, body: new FormData() }) as never
		);
		expect(isActionFailure(empty) && empty.status).toBe(400);

		// Ten changes per 15 minutes: two used above, one rejected empty upload, seven more allowed.
		for (let i = 0; i < 7; i += 1) {
			await settingsActions.removeAvatar(
				actionEvent({ url: '/settings?/removeAvatar', user, body: new FormData() }) as never
			);
		}
		const limited = await settingsActions.removeAvatar(
			actionEvent({ url: '/settings?/removeAvatar', user, body: new FormData() }) as never
		);
		expect(isActionFailure(limited) && limited.status).toBe(429);
	});

	it('lets an admin remove a member photo', async () => {
		const admin = await createUser('Ece', 'admin');
		const member = await createUser('Fuat');
		await setUserAvatar(member.id, await png(64, 64), media);

		const body = new FormData();
		body.set('userId', member.id);
		const result = await adminUserActions.removeAvatar(
			actionEvent({
				url: '/admin/users?/removeAvatar',
				user: { id: admin.id, name: admin.name, email: admin.email, role: 'admin' },
				body
			}) as never
		);
		expect((result as { success: boolean }).success).toBe(true);
		const [row] = await testDb.select().from(users).where(eq(users.id, member.id));
		expect(row.avatarAssetKey).toBeNull();
		const [entry] = await testDb
			.select({ action: auditLogs.action, actor: auditLogs.actorUserId })
			.from(auditLogs);
		expect(entry).toEqual({ action: 'admin.user_avatar_removed', actor: admin.id });
	});

	it('keeps the 512 KB body limit for everything except the avatar upload', async () => {
		const big = 'x'.repeat(600 * 1024);
		const run = async (url: string) => {
			const target = new URL(url, 'http://localhost:3000');
			const response = await handle({
				event: {
					request: new Request(target, {
						method: 'POST',
						body: big,
						headers: {
							'content-type': 'text/plain',
							'content-length': String(big.length),
							origin: 'http://localhost:3000'
						}
					}),
					url: target,
					cookies: { get: () => undefined, getAll: () => [], set: () => {}, delete: () => {} },
					params: {},
					route: { id: null },
					locals: {},
					getClientAddress: () => '10.0.0.1',
					setHeaders: () => {},
					isDataRequest: false,
					isSubRequest: false
				} as unknown as RequestEvent,
				resolve: async () => new Response('resolved')
			});
			return response.status;
		};
		expect(await run('/login')).toBe(413);
		expect(await run('/settings?/changePassword')).toBe(413);
		expect(await run('/settings?/setAvatar')).not.toBe(413);
	});
});

describe('undo delete (izgah-ui-v5.md §10.3)', () => {
	async function sharedLink(url: string) {
		const author = await createUser('Gul');
		const created = await createLinkShare({
			actor: { id: author.id, role: author.role },
			url
		});
		return { author, shareId: created.share.id, resourceId: created.share.resourceId };
	}

	it('restores a share deleted moments ago for its author', async () => {
		const { author, shareId } = await sharedLink('https://undo.example.test/a');
		await softDeleteLinkShare({ actor: { id: author.id, role: author.role }, shareId });

		await restoreLinkShare({ actor: { id: author.id, role: author.role }, shareId });
		const [row] = await testDb.select().from(linkShares).where(eq(linkShares.id, shareId));
		expect(row.deletedAt).toBeNull();
	});

	it('refuses other members, active shares and deletes older than the window', async () => {
		const { author, shareId } = await sharedLink('https://undo.example.test/b');
		const other = await createUser('Hale');
		const admin = await createUser('Ilgaz', 'admin');
		const statusOf = async (fn: () => Promise<unknown>) => {
			try {
				await fn();
				return 200;
			} catch (error) {
				return error instanceof LinkServiceError ? error.status : 500;
			}
		};

		expect(
			await statusOf(() =>
				restoreLinkShare({ actor: { id: author.id, role: author.role }, shareId })
			)
		).toBe(404);

		const deleted = await softDeleteLinkShare({
			actor: { id: author.id, role: author.role },
			shareId
		});
		expect(
			await statusOf(() => restoreLinkShare({ actor: { id: other.id, role: other.role }, shareId }))
		).toBe(403);
		expect(
			await statusOf(() =>
				restoreLinkShare({
					actor: { id: author.id, role: author.role },
					shareId,
					now: new Date(deleted.deletedAt.getTime() + RESTORE_WINDOW_MS + 1)
				})
			)
		).toBe(409);
		expect(
			await statusOf(() => restoreLinkShare({ actor: { id: admin.id, role: 'admin' }, shareId }))
		).toBe(200);
	});

	it('re-queues the unfurl when the delete detached the thumbnail', async () => {
		const { author, shareId, resourceId } = await sharedLink('https://undo.example.test/c');
		const [asset] = await testDb
			.insert(mediaAssets)
			.values({
				assetKey: 'a'.repeat(64),
				mimeType: 'image/webp',
				byteSize: 10,
				width: 10,
				height: 10,
				refCount: 1
			})
			.returning();
		await testDb
			.update(canonicalResources)
			.set({ thumbnailAssetKey: asset.assetKey, unfurlStatus: 'ready' })
			.where(eq(canonicalResources.id, resourceId));
		await testDb
			.update(unfurlJobs)
			.set({ status: 'completed', attempts: 1 })
			.where(eq(unfurlJobs.resourceId, resourceId));

		await softDeleteLinkShare({ actor: { id: author.id, role: author.role }, shareId });
		const restored = await restoreLinkShare({
			actor: { id: author.id, role: author.role },
			shareId
		});

		expect(restored.unfurlRequeued).toBe(true);
		const [resource] = await testDb
			.select()
			.from(canonicalResources)
			.where(eq(canonicalResources.id, resourceId));
		expect(resource.unfurlStatus).toBe('queued');
		const [job] = await testDb
			.select()
			.from(unfurlJobs)
			.where(eq(unfurlJobs.resourceId, resourceId));
		expect([job.status, job.attempts]).toEqual(['queued', 0]);
	});

	it('is reachable as the feed action ?/restoreShare', async () => {
		const { author, shareId } = await sharedLink('https://undo.example.test/d');
		await softDeleteLinkShare({ actor: { id: author.id, role: author.role }, shareId });
		const { _feedShareActions } = await import('../../src/routes/(app)/+page.server');
		const body = new FormData();
		body.set('shareId', shareId);
		const result = await _feedShareActions.restoreShare(
			actionEvent({
				url: '/?/restoreShare',
				user: { id: author.id, name: author.name, email: author.email, role: author.role },
				body
			}) as never
		);
		expect(result).toEqual({ success: true, formType: 'restoreShare', shareId });
	});
});
