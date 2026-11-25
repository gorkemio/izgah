import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import type http from 'node:http';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import type { RequestEvent } from '@sveltejs/kit';
import { eq, sql } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handle } from '../../src/hooks.server';
import { createApiKey } from '../../src/lib/server/auth/api-keys';
import { consumeInviteToken, createInviteToken } from '../../src/lib/server/auth/tokens';
import { closeDb } from '../../src/lib/server/db/client';
import {
	canonicalResources,
	mediaAssets,
	unfurlJobs,
	users,
	type UserRole
} from '../../src/lib/server/db/schema';
import { createLinkShare, softDeleteLinkShare } from '../../src/lib/server/links/service';
import {
	cleanupOrphanMediaAssets,
	detectRasterFormat,
	hasSufficientMediaDiskSpace,
	ORPHAN_MEDIA_MAX_AGE_MS,
	processAndWriteThumbnailToDisk,
	resolveMediaAssetPath,
	UnsupportedMediaFormatError
} from '../../src/lib/server/media/storage';
import {
	resetCircuitBreakers,
	recordHostStatus,
	CIRCUIT_BREAKER_FAILURE_THRESHOLD
} from '../../src/lib/server/unfurl/circuit-breaker';
import {
	resetDefaultSafeFetchTestHooks,
	type DnsAddressRecord,
	type TestConnectTarget
} from '../../src/lib/server/unfurl/safe-fetch';
import {
	claimNextUnfurlJob,
	completeClaimedJobInTx,
	runSingleUnfurlPass,
	startUnfurlWorker,
	stopUnfurlWorker
} from '../../src/lib/server/unfurl/worker';
import { POST as linksPost } from '../../src/routes/api/v1/links/+server';
import { GET as mediaThumbnailGet } from '../../src/routes/media/thumbnails/[assetKey]/+server';
import { closeTestDb, migrateTestDb, resetTestDb, testDb } from '../setup/db';

interface CertBundle {
	dir: string;
	key: Buffer;
	cert: Buffer;
}

function generateTestCertificates(): CertBundle {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'izgah-m4-int-ssl-'));
	const keyPath = path.join(dir, 'key.pem');
	const certPath = path.join(dir, 'cert.pem');
	const san = [
		'DNS:media.example.test',
		'DNS:haber.example.com.tr',
		'DNS:www.youtube.com',
		'DNS:dedup-a.example.test',
		'DNS:dedup-b.example.test',
		'DNS:retry.example.test',
		'DNS:cb.example.test',
		'DNS:bigimg.example.test',
		'DNS:lowdisk.example.test',
		'DNS:slow.example.test'
	].join(',');

	execFileSync(
		'openssl',
		[
			'req',
			'-x509',
			'-newkey',
			'rsa:2048',
			'-nodes',
			'-keyout',
			keyPath,
			'-out',
			certPath,
			'-days',
			'1',
			'-subj',
			'/CN=media.example.test',
			'-addext',
			`subjectAltName=${san}`
		],
		{ stdio: 'ignore' }
	);

	return {
		dir,
		key: fs.readFileSync(keyPath),
		cert: fs.readFileSync(certPath)
	};
}

function createMockCookies(cookieHeader?: string) {
	const jar = new Map<string, string>();
	if (cookieHeader) {
		for (const part of cookieHeader.split(';')) {
			const trimmed = part.trim();
			const eqIdx = trimmed.indexOf('=');
			if (eqIdx > 0) {
				jar.set(trimmed.slice(0, eqIdx), trimmed.slice(eqIdx + 1));
			}
		}
	}

	return {
		get(name: string) {
			return jar.get(name);
		},
		getAll() {
			return Array.from(jar.entries()).map(([name, value]) => ({ name, value }));
		},
		set(name: string, value: string) {
			jar.set(name, value);
		},
		delete(name: string) {
			jar.delete(name);
		},
		serialize(name: string, value: string) {
			return `${name}=${value}`;
		}
	};
}

function extractCookiePairFromSetCookies(setCookieHeaders: string[]): string {
	return setCookieHeaders
		.map((header) => header.split(';')[0]?.trim() ?? '')
		.filter(Boolean)
		.join('; ');
}

function createMockEvent(options: {
	url: string;
	method?: string;
	headers?: HeadersInit;
	jsonBody?: unknown;
	params?: Record<string, string>;
}): RequestEvent {
	const fullUrl = new URL(options.url, 'http://localhost:5173');
	const method = options.method ?? 'GET';
	const headers = new Headers(options.headers);
	let body: string | undefined;
	if (options.jsonBody !== undefined) {
		if (!headers.has('Content-Type')) {
			headers.set('Content-Type', 'application/json');
		}
		body = JSON.stringify(options.jsonBody);
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
		params: options.params ?? {},
		route: { id: null },
		locals: {
			requestId: 'req_m4_test',
			user: null,
			session: null,
			authChannel: null,
			apiKeyId: null
		},
		platform: undefined,
		isDataRequest: false,
		isSubRequest: false,
		getClientAddress: () => '10.20.30.55',
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

async function dispatchLinksPost(options: { headers?: HeadersInit; jsonBody?: unknown }) {
	const event = createMockEvent({
		url: '/api/v1/links',
		method: 'POST',
		headers: options.headers,
		jsonBody: options.jsonBody
	});
	return handle({
		event,
		resolve: async (ev) => linksPost(ev as Parameters<typeof linksPost>[0])
	});
}

async function dispatchMediaGet(options: { assetKey: string; headers?: HeadersInit }) {
	const event = createMockEvent({
		url: `/media/thumbnails/${options.assetKey}`,
		method: 'GET',
		headers: options.headers,
		params: { assetKey: options.assetKey }
	});
	return handle({
		event,
		resolve: async (ev) => {
			ev.params = { assetKey: options.assetKey };
			return mediaThumbnailGet(ev as Parameters<typeof mediaThumbnailGet>[0]);
		}
	});
}

async function seedUserWithSessionAndKey(input: { name: string; email: string; role: UserRole }) {
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
	const apiKey = await createApiKey(user.id, `${input.name} Key`);

	return { user, cookie, rawApiKey: apiKey.rawKey };
}

async function waitFor<T>(fn: () => Promise<T | null>, timeoutMs = 4000): Promise<T> {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		const value = await fn();
		if (value !== null) {
			return value;
		}
		await new Promise((r) => setTimeout(r, 40));
	}
	throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

describe('M4 Unfurl Worker, Media Storage, and /media/thumbnails/[assetKey]', () => {
	let certBundle: CertBundle;
	let httpsServer: https.Server;
	let httpsPort = 0;
	let mediaDir = '';
	let prevMediaStorageDir: string | undefined;

	let httpsHandler: (
		req: http.IncomingMessage,
		res: http.ServerResponse
	) => void | Promise<void> = (_req, res) => {
		res.writeHead(404).end();
	};

	const publicLookup = async (): Promise<DnsAddressRecord[]> => [
		{ address: '93.184.216.34', family: 4 }
	];

	const localConnectOverride = (_target: TestConnectTarget) => ({
		connectAddress: '127.0.0.1',
		port: httpsPort,
		ca: certBundle.cert,
		rejectUnauthorized: true
	});

	beforeAll(async () => {
		await migrateTestDb();
		certBundle = generateTestCertificates();
		mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'izgah-m4-media-'));
		prevMediaStorageDir = process.env.MEDIA_STORAGE_DIR;
		process.env.MEDIA_STORAGE_DIR = mediaDir;

		const sharedCtx = tls.createSecureContext({
			key: certBundle.key,
			cert: certBundle.cert
		});
		httpsServer = https.createServer(
			{
				key: certBundle.key,
				cert: certBundle.cert,
				SNICallback(_servername, cb) {
					cb(null, sharedCtx);
				}
			},
			(req, res) => httpsHandler(req, res)
		);

		await new Promise<void>((resolve) => {
			httpsServer.listen(0, '127.0.0.1', () => {
				httpsPort = (httpsServer.address() as AddressInfo).port;
				resolve();
			});
		});
	});

	beforeEach(async () => {
		await stopUnfurlWorker({ timeoutMs: 2000 });
		await resetTestDb();
		resetCircuitBreakers();
		resetDefaultSafeFetchTestHooks();

		const entries = await fsPromises.readdir(mediaDir);
		for (const entry of entries) {
			await fsPromises.rm(path.join(mediaDir, entry), { recursive: true, force: true });
		}

		httpsHandler = (_req, res) => {
			res.writeHead(404).end();
		};
	});

	afterEach(async () => {
		await stopUnfurlWorker({ timeoutMs: 2000 });
		resetDefaultSafeFetchTestHooks();
	});

	afterAll(async () => {
		await stopUnfurlWorker({ timeoutMs: 2000 });
		await new Promise<void>((resolve) => httpsServer.close(() => resolve()));
		fs.rmSync(certBundle.dir, { recursive: true, force: true });
		fs.rmSync(mediaDir, { recursive: true, force: true });
		if (prevMediaStorageDir === undefined) {
			delete process.env.MEDIA_STORAGE_DIR;
		} else {
			process.env.MEDIA_STORAGE_DIR = prevMediaStorageDir;
		}
		await closeDb();
		await closeTestDb();
	});

	describe('Sharp configuration, magic bytes, EXIF rotation, pixel limit, and low-disk OR check', () => {
		it('enforces sharp cache(false) and concurrency(2)', () => {
			expect(sharp.concurrency()).toBe(2);
			expect(sharp.cache()).toMatchObject({
				memory: { max: 0 },
				files: { max: 0 },
				items: { max: 0 }
			});
		});

		it('rejects SVG and HTML payloads via magic bytes', async () => {
			const svg = Buffer.from(
				'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
			);
			const html = Buffer.from('<!doctype html><html><body>not an image</body></html>');

			expect(detectRasterFormat(svg)).toBeNull();
			expect(detectRasterFormat(html)).toBeNull();

			await expect(processAndWriteThumbnailToDisk(svg)).rejects.toBeInstanceOf(
				UnsupportedMediaFormatError
			);
			await expect(processAndWriteThumbnailToDisk(html)).rejects.toBeInstanceOf(
				UnsupportedMediaFormatError
			);
		});

		it('normalizes EXIF orientation (.rotate()), strips EXIF metadata, resizes <=1200x630, and writes sharded WebP', async () => {
			// Landscape 1600x800 with EXIF orientation 6 (90° CW) becomes portrait 800x1600,
			// which scaled inside 1200x630 yields width=315, height=630.
			const landscapeWithExif = await sharp({
				create: {
					width: 1600,
					height: 800,
					channels: 3,
					background: { r: 30, g: 140, b: 220 }
				}
			})
				.withMetadata({ orientation: 6 })
				.jpeg({ quality: 90 })
				.toBuffer();

			const result = await processAndWriteThumbnailToDisk(landscapeWithExif, {
				storageDir: mediaDir
			});
			expect(result.status).toBe('stored');
			if (result.status !== 'stored') {
				return;
			}

			expect(result.asset.assetKey).toMatch(/^[0-9a-f]{64}$/);
			expect(result.asset.width).toBe(315);
			expect(result.asset.height).toBe(630);
			expect(result.asset.filePath).toBe(
				path.join(mediaDir, result.asset.assetKey.slice(0, 2), `${result.asset.assetKey}.webp`)
			);

			const diskBytes = await fsPromises.readFile(result.asset.filePath);
			expect(detectRasterFormat(diskBytes)).toBe('webp');
			const diskMeta = await sharp(diskBytes).metadata();
			expect(diskMeta.format).toBe('webp');
			expect(diskMeta.width).toBe(315);
			expect(diskMeta.height).toBe(630);
			expect(diskMeta.exif).toBeUndefined();
		});

		it('rejects images exceeding limitInputPixels while worker preserves page metadata without thumbnail', async () => {
			const hugePng = await sharp({
				create: {
					width: 7000,
					height: 6000,
					channels: 3,
					background: { r: 240, g: 240, b: 240 }
				},
				limitInputPixels: false
			})
				.png({ compressionLevel: 9 })
				.toBuffer();

			await expect(processAndWriteThumbnailToDisk(hugePng)).rejects.toThrow();

			const member = await seedUserWithSessionAndKey({
				name: 'Pix Member',
				email: 'pix@izgah.test',
				role: 'member'
			});

			httpsHandler = (req, res) => {
				if (req.url === '/huge-img-page') {
					res
						.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
						.end(
							`<html><head><title>Büyük Görselli Sayfa</title><meta property="og:image" content="https://bigimg.example.test/huge.png" /></head></html>`
						);
					return;
				}
				if (req.url === '/huge.png') {
					res.writeHead(200, { 'Content-Type': 'image/png' }).end(hugePng);
					return;
				}
				res.writeHead(404).end();
			};

			const created = await createLinkShare({
				actor: { id: member.user.id, role: member.user.role },
				url: 'https://bigimg.example.test/huge-img-page'
			});

			const pass = await runSingleUnfurlPass({
				adapterOptions: {
					safeFetchOptions: {
						lookup: publicLookup,
						testConnectOverride: localConnectOverride
					}
				}
			});
			expect(pass.results).toEqual(['completed']);

			const [resource] = await testDb
				.select()
				.from(canonicalResources)
				.where(eq(canonicalResources.id, created.share.resourceId));
			expect(resource.unfurlStatus).toBe('ready');
			expect(resource.title).toBe('Büyük Görselli Sayfa');
			expect(resource.thumbnailAssetKey).toBeNull();
		});

		it('enforces low-disk OR condition (freeBytes OR freeRatio) and skips image storage without failing unfurl', async () => {
			const smallPng = await sharp({
				create: { width: 200, height: 100, channels: 3, background: { r: 10, g: 90, b: 50 } }
			})
				.png()
				.toBuffer();

			// Condition 1: freeBytes < 512 MiB even though freeRatio is 50%
			const lowBytesOnly = await hasSufficientMediaDiskSpace({
				storageDir: mediaDir,
				statfs: async () => ({
					bsize: 1024 * 1024,
					blocks: 800,
					bavail: 400
				})
			});
			expect(lowBytesOnly.ok).toBe(false);

			// Condition 2: freeRatio < 15% even though freeBytes is 1 GiB
			const lowRatioOnly = await hasSufficientMediaDiskSpace({
				storageDir: mediaDir,
				statfs: async () => ({
					bsize: 1024 * 1024,
					blocks: 20_480,
					bavail: 1024
				})
			});
			expect(lowRatioOnly.ok).toBe(false);

			const member = await seedUserWithSessionAndKey({
				name: 'Disk Member',
				email: 'disk@izgah.test',
				role: 'member'
			});

			httpsHandler = (req, res) => {
				if (req.url === '/post') {
					res
						.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
						.end(
							`<html><head><title>Düşük Disk Testi</title><meta property="og:image" content="https://lowdisk.example.test/cover.png" /></head></html>`
						);
					return;
				}
				res.writeHead(200, { 'Content-Type': 'image/png' }).end(smallPng);
			};

			const created = await createLinkShare({
				actor: { id: member.user.id, role: member.user.role },
				url: 'https://lowdisk.example.test/post'
			});

			const pass = await runSingleUnfurlPass({
				adapterOptions: {
					safeFetchOptions: {
						lookup: publicLookup,
						testConnectOverride: localConnectOverride
					}
				},
				mediaOptions: {
					storageDir: mediaDir,
					statfs: async () => ({
						bsize: 1024 * 1024,
						blocks: 20_480,
						bavail: 1024
					})
				}
			});
			expect(pass.results).toEqual(['completed']);

			const [resource] = await testDb
				.select()
				.from(canonicalResources)
				.where(eq(canonicalResources.id, created.share.resourceId));
			expect(resource.unfurlStatus).toBe('ready');
			expect(resource.title).toBe('Düşük Disk Testi');
			expect(resource.thumbnailAssetKey).toBeNull();
			expect(await fsPromises.readdir(mediaDir)).toHaveLength(0);
		});
	});

	describe('Media deduplication, ref_count lifecycle, orphan cleanup, and /media/thumbnails/[assetKey]', () => {
		it('deduplicates identical WebP assets, tracks ref_count across soft deletes, cleans orphans after 24h, and enforces /media auth & security headers', async () => {
			const sharedPng = await sharp({
				create: { width: 400, height: 210, channels: 3, background: { r: 200, g: 60, b: 40 } }
			})
				.png()
				.toBuffer();

			httpsHandler = (req, res) => {
				if (req.headers.host === 'dedup-a.example.test' && req.url === '/p1') {
					res
						.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
						.end(
							`<html><head><title>Kaynak A</title><meta property="og:image" content="https://media.example.test/shared.png" /></head></html>`
						);
					return;
				}
				if (req.headers.host === 'dedup-b.example.test' && req.url === '/p2') {
					res
						.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
						.end(
							`<html><head><title>Kaynak B</title><meta property="og:image" content="https://media.example.test/shared.png" /></head></html>`
						);
					return;
				}
				if (req.url === '/shared.png') {
					res.writeHead(200, { 'Content-Type': 'image/png' }).end(sharedPng);
					return;
				}
				res.writeHead(404).end();
			};

			const member = await seedUserWithSessionAndKey({
				name: 'Media Member',
				email: 'media-member@izgah.test',
				role: 'member'
			});

			const shareA = await createLinkShare({
				actor: { id: member.user.id, role: member.user.role },
				url: 'https://dedup-a.example.test/p1'
			});
			const shareB = await createLinkShare({
				actor: { id: member.user.id, role: member.user.role },
				url: 'https://dedup-b.example.test/p2'
			});

			const pass = await runSingleUnfurlPass({
				adapterOptions: {
					safeFetchOptions: {
						lookup: publicLookup,
						testConnectOverride: localConnectOverride
					}
				}
			});
			expect(pass.results).toEqual(['completed', 'completed']);

			const [resA] = await testDb
				.select()
				.from(canonicalResources)
				.where(eq(canonicalResources.id, shareA.share.resourceId));
			const [resB] = await testDb
				.select()
				.from(canonicalResources)
				.where(eq(canonicalResources.id, shareB.share.resourceId));

			expect(resA.thumbnailAssetKey).toMatch(/^[0-9a-f]{64}$/);
			expect(resB.thumbnailAssetKey).toBe(resA.thumbnailAssetKey);

			const assetKey = resA.thumbnailAssetKey as string;
			const [assetRow] = await testDb
				.select()
				.from(mediaAssets)
				.where(eq(mediaAssets.assetKey, assetKey));
			expect(assetRow.refCount).toBe(2);
			expect(assetRow.orphanedAt).toBeNull();

			const diskPath = resolveMediaAssetPath(assetKey, mediaDir);
			const diskBytes = await fsPromises.readFile(diskPath);

			// Route auth & header checks on /media/thumbnails/[assetKey]
			const unauthRes = await dispatchMediaGet({ assetKey });
			expect(unauthRes.status).toBe(401);
			expect(unauthRes.headers.get('location')).toBeNull();

			const badKeyRes = await dispatchMediaGet({
				assetKey: 'invalid-key',
				headers: { Cookie: member.cookie }
			});
			expect(badKeyRes.status).toBe(400);

			const missingRes = await dispatchMediaGet({
				assetKey: '0'.repeat(64),
				headers: { Cookie: member.cookie }
			});
			expect(missingRes.status).toBe(404);

			const cookieRes = await dispatchMediaGet({
				assetKey,
				headers: { Cookie: member.cookie }
			});
			expect(cookieRes.status).toBe(200);
			expect(cookieRes.headers.get('content-type')).toBe('image/webp');
			expect(cookieRes.headers.get('cache-control')).toBe('private, max-age=86400, immutable');
			expect(cookieRes.headers.get('x-content-type-options')).toBe('nosniff');
			expect(cookieRes.headers.get('content-security-policy')).toBe("default-src 'none'");
			expect(Number(cookieRes.headers.get('content-length'))).toBe(diskBytes.length);
			expect(Buffer.from(await cookieRes.arrayBuffer())).toEqual(diskBytes);

			const bearerRes = await dispatchMediaGet({
				assetKey,
				headers: { Authorization: `Bearer ${member.rawApiKey}` }
			});
			expect(bearerRes.status).toBe(200);
			expect(Buffer.from(await bearerRes.arrayBuffer())).toEqual(diskBytes);

			// Soft-delete share A -> ref_count drops to 1
			await softDeleteLinkShare({
				actor: { id: member.user.id, role: 'member' },
				shareId: shareA.share.id
			});
			const [afterDeleteA] = await testDb
				.select()
				.from(mediaAssets)
				.where(eq(mediaAssets.assetKey, assetKey));
			expect(afterDeleteA.refCount).toBe(1);
			expect(afterDeleteA.orphanedAt).toBeNull();

			// Soft-delete share B -> ref_count drops to 0, orphaned_at set, resource detached
			await softDeleteLinkShare({
				actor: { id: member.user.id, role: 'member' },
				shareId: shareB.share.id
			});
			const [afterDeleteB] = await testDb
				.select()
				.from(mediaAssets)
				.where(eq(mediaAssets.assetKey, assetKey));
			expect(afterDeleteB.refCount).toBe(0);
			expect(afterDeleteB.orphanedAt).not.toBeNull();

			const [resBAfterDelete] = await testDb
				.select()
				.from(canonicalResources)
				.where(eq(canonicalResources.id, shareB.share.resourceId));
			expect(resBAfterDelete.thumbnailAssetKey).toBeNull();

			// Grace period <24h keeps orphan intact
			const prematureCleanup = await cleanupOrphanMediaAssets({
				olderThanMs: ORPHAN_MEDIA_MAX_AGE_MS,
				storageDir: mediaDir,
				now: new Date()
			});
			expect(prematureCleanup.deletedCount).toBe(0);
			await expect(fsPromises.stat(diskPath)).resolves.toBeDefined();

			// After 24h+1min, orphan row and file are deleted
			const expiredCleanup = await cleanupOrphanMediaAssets({
				olderThanMs: ORPHAN_MEDIA_MAX_AGE_MS,
				storageDir: mediaDir,
				now: new Date(Date.now() + ORPHAN_MEDIA_MAX_AGE_MS + 60_000)
			});
			expect(expiredCleanup.deletedCount).toBe(1);
			expect(expiredCleanup.assetKeys).toEqual([assetKey]);
			await expect(fsPromises.stat(diskPath)).rejects.toMatchObject({ code: 'ENOENT' });

			const remainingAssets = await testDb
				.select()
				.from(mediaAssets)
				.where(eq(mediaAssets.assetKey, assetKey));
			expect(remainingAssets).toHaveLength(0);
		});
	});

	describe('Queue semantics: POST /api/v1/links live worker, lease fencing, retries, circuit breaker, singleton & drain', () => {
		it('processes POST /api/v1/links end-to-end with globalThis singleton worker, upgrades web->article, populates search_vector, and drains on stop()', async () => {
			const coverPng = await sharp({
				create: { width: 800, height: 420, channels: 3, background: { r: 15, g: 80, b: 140 } }
			})
				.png()
				.toBuffer();

			httpsHandler = (req, res) => {
				if (req.url === '/yazilar/modern-web') {
					res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(
						`<html><head>
							<meta property="og:type" content="article" />
							<meta property="og:title" content="İstanbul Teknoloji Notları" />
							<meta property="og:description" content="SvelteKit ve PostgreSQL arama test özeti" />
							<meta property="og:site_name" content="Haber Örnek" />
							<meta property="og:image" content="https://haber.example.com.tr/cover.png" />
						</head></html>`
					);
					return;
				}
				if (req.url === '/cover.png') {
					res.writeHead(200, { 'Content-Type': 'image/png' }).end(coverPng);
					return;
				}
				res.writeHead(404).end();
			};

			const member = await seedUserWithSessionAndKey({
				name: 'Live Worker Member',
				email: 'live-worker@izgah.test',
				role: 'member'
			});

			const worker1 = startUnfurlWorker({
				concurrency: 2,
				pollIntervalMs: 60_000,
				adapterOptions: {
					safeFetchOptions: {
						lookup: publicLookup,
						testConnectOverride: localConnectOverride
					}
				},
				mediaOptions: { storageDir: mediaDir }
			});
			const worker2 = startUnfurlWorker({ concurrency: 5 });
			expect(worker2).toBe(worker1);
			expect(worker1.isRunning()).toBe(true);

			const res = await dispatchLinksPost({
				headers: { Authorization: `Bearer ${member.rawApiKey}` },
				jsonBody: {
					url: 'https://haber.example.com.tr/yazilar/modern-web',
					note: 'Harika yazı'
				}
			});
			expect(res.status).toBe(201);
			const body = (await res.json()) as {
				share: { resourceId: string };
			};

			const completedResource = await waitFor(async () => {
				const [row] = await testDb
					.select()
					.from(canonicalResources)
					.where(eq(canonicalResources.id, body.share.resourceId));
				return row && row.unfurlStatus === 'ready' ? row : null;
			});

			expect(completedResource.title).toBe('İstanbul Teknoloji Notları');
			expect(completedResource.description).toBe('SvelteKit ve PostgreSQL arama test özeti');
			expect(completedResource.siteName).toBe('Haber Örnek');
			expect(completedResource.contentType).toBe('article');
			expect(completedResource.thumbnailAssetKey).toMatch(/^[0-9a-f]{64}$/);

			// Verify PostgreSQL search_vector trigger updated tsvector for Turkish unaccented query
			const searchMatch = await testDb
				.select({ id: canonicalResources.id })
				.from(canonicalResources)
				.where(
					sql`${canonicalResources.id} = ${completedResource.id} AND ${canonicalResources.searchVector} @@ websearch_to_tsquery('simple', 'istanbul')`
				);
			expect(searchMatch).toHaveLength(1);

			await stopUnfurlWorker({ timeoutMs: 2000 });
			expect(worker1.isRunning()).toBe(false);
		});

		it('reclaims expired 90s leases with a new lock_token and fences stale lock_token completions', async () => {
			httpsHandler = (_req, res) => {
				res
					.writeHead(200, { 'Content-Type': 'text/html' })
					.end('<html><head><title>Yeni Başlık</title></head></html>');
			};

			const member = await seedUserWithSessionAndKey({
				name: 'Lease Member',
				email: 'lease@izgah.test',
				role: 'member'
			});

			const share = await createLinkShare({
				actor: { id: member.user.id, role: member.user.role },
				url: 'https://haber.example.com.tr/lease-check'
			});

			const t0 = new Date(Date.now() + 1_000);
			const claimed1 = await claimNextUnfurlJob(t0);
			expect(claimed1).not.toBeNull();
			if (!claimed1) return;
			expect(claimed1.attempts).toBe(1);

			// Advance clock past the 90s lease duration (not yet at max attempts=3)
			const tExpired = new Date(t0.getTime() + 90_001);
			const claimed2 = await claimNextUnfurlJob(tExpired);
			expect(claimed2).not.toBeNull();
			if (!claimed2) return;
			expect(claimed2.id).toBe(claimed1.id);
			expect(claimed2.attempts).toBe(2);
			expect(claimed2.lockToken).not.toBe(claimed1.lockToken);

			// Stale worker finishing with old lockToken must be fenced out
			const staleOutcome = await completeClaimedJobInTx({
				jobId: claimed1.id,
				resourceId: share.share.resourceId,
				lockToken: claimed1.lockToken,
				metadata: {
					title: 'BAYAT İŞÇİ BAŞLIĞI',
					description: null,
					siteName: null,
					providerMeta: null,
					thumbnailUrl: null,
					ogType: null
				},
				storedAsset: null
			});
			expect(staleOutcome).toEqual({ applied: false, fencedOut: true });

			const [afterStale] = await testDb
				.select()
				.from(canonicalResources)
				.where(eq(canonicalResources.id, share.share.resourceId));
			expect(afterStale.title).toBeNull();

			// New lease holder succeeds
			const freshOutcome = await completeClaimedJobInTx({
				jobId: claimed2.id,
				resourceId: share.share.resourceId,
				lockToken: claimed2.lockToken,
				metadata: {
					title: 'Güncel İşçi Başlığı',
					description: null,
					siteName: null,
					providerMeta: null,
					thumbnailUrl: null,
					ogType: null
				},
				storedAsset: null
			});
			expect(freshOutcome).toEqual({ applied: true, fencedOut: false });
		});

		it('applies 30s / 2m backoff on upstream 5xx and marks job dead + resource failed on 3rd failure', async () => {
			httpsHandler = (_req, res) => {
				res.writeHead(503).end('upstream unavailable');
			};

			const member = await seedUserWithSessionAndKey({
				name: 'Retry Member',
				email: 'retry@izgah.test',
				role: 'member'
			});

			const share = await createLinkShare({
				actor: { id: member.user.id, role: member.user.role },
				url: 'https://retry.example.test/failing'
			});

			// Attempt 1 -> queued (+30s)
			const pass1 = await runSingleUnfurlPass({
				adapterOptions: {
					safeFetchOptions: {
						lookup: publicLookup,
						testConnectOverride: localConnectOverride
					}
				}
			});
			expect(pass1.results).toEqual(['requeued']);
			const [job1] = await testDb
				.select()
				.from(unfurlJobs)
				.where(eq(unfurlJobs.resourceId, share.share.resourceId));
			expect(job1.status).toBe('queued');
			expect(job1.attempts).toBe(1);
			const delay1Ms = job1.nextRunAt.getTime() - job1.updatedAt.getTime();
			expect(delay1Ms).toBeGreaterThanOrEqual(29_000);
			expect(delay1Ms).toBeLessThanOrEqual(31_000);

			// Make attempt 2 due immediately
			await testDb
				.update(unfurlJobs)
				.set({ nextRunAt: new Date(Date.now() - 1000) })
				.where(eq(unfurlJobs.id, job1.id));

			const pass2 = await runSingleUnfurlPass({
				adapterOptions: {
					safeFetchOptions: {
						lookup: publicLookup,
						testConnectOverride: localConnectOverride
					}
				}
			});
			expect(pass2.results).toEqual(['requeued']);
			const [job2] = await testDb.select().from(unfurlJobs).where(eq(unfurlJobs.id, job1.id));
			expect(job2.status).toBe('queued');
			expect(job2.attempts).toBe(2);
			const delay2Ms = job2.nextRunAt.getTime() - job2.updatedAt.getTime();
			expect(delay2Ms).toBeGreaterThanOrEqual(119_000);
			expect(delay2Ms).toBeLessThanOrEqual(121_000);

			// Make attempt 3 due immediately -> dead + failed
			await testDb
				.update(unfurlJobs)
				.set({ nextRunAt: new Date(Date.now() - 1000) })
				.where(eq(unfurlJobs.id, job1.id));

			const pass3 = await runSingleUnfurlPass({
				adapterOptions: {
					safeFetchOptions: {
						lookup: publicLookup,
						testConnectOverride: localConnectOverride
					}
				}
			});
			expect(pass3.results).toEqual(['dead']);

			const [job3] = await testDb.select().from(unfurlJobs).where(eq(unfurlJobs.id, job1.id));
			expect(job3.status).toBe('dead');
			expect(job3.attempts).toBe(3);

			const [resAfter3] = await testDb
				.select()
				.from(canonicalResources)
				.where(eq(canonicalResources.id, share.share.resourceId));
			expect(resAfter3.unfurlStatus).toBe('failed');
		});

		it('completes immediately as plain domain fallback when host circuit breaker is open', async () => {
			for (let i = 0; i < CIRCUIT_BREAKER_FAILURE_THRESHOLD; i += 1) {
				recordHostStatus('cb.example.test', 429);
			}

			const member = await seedUserWithSessionAndKey({
				name: 'Circuit Member',
				email: 'cb@izgah.test',
				role: 'member'
			});

			const share = await createLinkShare({
				actor: { id: member.user.id, role: member.user.role },
				url: 'https://cb.example.test/post'
			});

			let networkHit = false;
			const pass = await runSingleUnfurlPass({
				adapterOptions: {
					safeFetchOptions: {
						lookup: async () => {
							networkHit = true;
							return publicLookup();
						},
						testConnectOverride: localConnectOverride
					}
				}
			});
			expect(pass.results).toEqual(['completed']);
			expect(networkHit).toBe(false);

			const [resource] = await testDb
				.select()
				.from(canonicalResources)
				.where(eq(canonicalResources.id, share.share.resourceId));
			expect(resource.unfurlStatus).toBe('ready');
			expect(resource.title).toBeNull();
			expect(resource.domain).toBe('cb.example.test');
		});

		it('drains an active in-flight unfurl job cleanly on stopUnfurlWorker()', async () => {
			let requestEnteredServer!: () => void;
			const enteredPromise = new Promise<void>((resolve) => {
				requestEnteredServer = resolve;
			});
			let releaseResponse!: () => void;
			const releasePromise = new Promise<void>((resolve) => {
				releaseResponse = resolve;
			});

			httpsHandler = async (_req, res) => {
				requestEnteredServer();
				await releasePromise;
				res
					.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
					.end('<html><head><title>Zarif Kapanış Sayfası</title></head></html>');
			};

			const member = await seedUserWithSessionAndKey({
				name: 'Drain Member',
				email: 'drain@izgah.test',
				role: 'member'
			});

			const share = await createLinkShare({
				actor: { id: member.user.id, role: member.user.role },
				url: 'https://slow.example.test/drain-me'
			});

			const worker = startUnfurlWorker({
				concurrency: 1,
				pollIntervalMs: 50,
				adapterOptions: {
					safeFetchOptions: {
						lookup: publicLookup,
						testConnectOverride: localConnectOverride
					}
				},
				mediaOptions: { storageDir: mediaDir }
			});

			await enteredPromise;
			expect(worker.activeJobCount()).toBe(1);

			const stopPromise = stopUnfurlWorker({ timeoutMs: 2000 });
			setTimeout(() => releaseResponse(), 40);
			await stopPromise;
			expect(worker.isRunning()).toBe(false);
			expect(worker.activeJobCount()).toBe(0);

			const [resource] = await testDb
				.select()
				.from(canonicalResources)
				.where(eq(canonicalResources.id, share.share.resourceId));
			expect(resource.unfurlStatus).toBe('ready');
			expect(resource.title).toBe('Zarif Kapanış Sayfası');
		});
	});
});
