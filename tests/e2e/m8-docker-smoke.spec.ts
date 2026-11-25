import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import sharp from 'sharp';
import * as schema from '../../src/lib/server/db/schema';
import {
	canonicalResources,
	linkShares,
	sections,
	unfurlJobs,
	users
} from '../../src/lib/server/db/schema';
import { assertTestDatabaseUrl, migrateTestDb } from '../setup/db';

const APP_IMAGE = 'izgah-core:test';
const FIXTURE_IMAGE = 'node:22-bookworm-slim';
const FIXTURE_HOST = 'fixture.izgah.example';
const AUTH_SECRET = 'docker-smoke-test-secret-at-least-32-chars!!';

const testDatabaseUrl = assertTestDatabaseUrl(process.env.TEST_DATABASE_URL);
const smokeSql = postgres(testDatabaseUrl, {
	max: 4,
	onnotice: () => {}
});
const smokeDb = drizzle(smokeSql, { schema });

function runDocker(args: string[], options?: { allowFailure?: boolean }): string {
	try {
		return execFileSync('docker', args, {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe']
		}).trim();
	} catch (error) {
		if (options?.allowFailure) {
			return '';
		}
		const err = error as { status?: number; stderr?: string; stdout?: string; message?: string };
		throw new Error(
			`docker ${args.join(' ')} failed (exit ${err.status ?? 'unknown'}): ${err.stderr ?? err.message ?? ''}`
		);
	}
}

function reserveFreePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = net.createServer();
		server.unref();
		server.on('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			if (!address || typeof address === 'string') {
				server.close(() => reject(new Error('Failed to reserve local TCP port')));
				return;
			}
			const { port } = address;
			server.close((closeErr) => {
				if (closeErr) {
					reject(closeErr);
				} else {
					resolve(port);
				}
			});
		});
	});
}

async function startLocalTlsReverseProxy(targetPort: number): Promise<{
	port: number;
	baseUrl: string;
	close: () => Promise<void>;
}> {
	const certDir = fs.mkdtempSync(path.join(os.tmpdir(), 'izgah-smoke-tls-'));
	const keyPath = path.join(certDir, 'key.pem');
	const certPath = path.join(certDir, 'cert.pem');

	try {
		execFileSync(
			'openssl',
			[
				'req',
				'-x509',
				'-newkey',
				'rsa:2048',
				'-nodes',
				'-sha256',
				'-days',
				'1',
				'-subj',
				'/CN=127.0.0.1',
				'-keyout',
				keyPath,
				'-out',
				certPath
			],
			{ stdio: ['ignore', 'ignore', 'pipe'] }
		);

		const server = https.createServer(
			{
				key: fs.readFileSync(keyPath),
				cert: fs.readFileSync(certPath)
			},
			(clientReq, clientRes) => {
				const upstreamReq = http.request(
					{
						hostname: '127.0.0.1',
						port: targetPort,
						path: clientReq.url ?? '/',
						method: clientReq.method ?? 'GET',
						headers: {
							...clientReq.headers,
							'x-forwarded-proto': 'https',
							'x-forwarded-for': '127.0.0.1'
						}
					},
					(upstreamRes) => {
						clientRes.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
						upstreamRes.pipe(clientRes);
					}
				);

				upstreamReq.on('error', () => {
					if (!clientRes.headersSent) {
						clientRes.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
					}
					clientRes.end('Bad Gateway');
				});

				clientReq.on('error', () => {
					upstreamReq.destroy();
				});

				clientReq.pipe(upstreamReq);
			}
		);

		const port = await new Promise<number>((resolve, reject) => {
			server.once('error', reject);
			server.listen(0, '127.0.0.1', () => {
				server.removeListener('error', reject);
				const address = server.address();
				if (!address || typeof address === 'string') {
					reject(new Error('Failed to bind local TLS reverse proxy'));
					return;
				}
				resolve(address.port);
			});
		});

		return {
			port,
			baseUrl: `https://127.0.0.1:${port}`,
			close: async () => {
				try {
					server.closeAllConnections?.();
					await new Promise<void>((resolve) => {
						server.close(() => resolve());
					});
				} finally {
					fs.rmSync(certDir, { recursive: true, force: true });
				}
			}
		};
	} catch (error) {
		fs.rmSync(certDir, { recursive: true, force: true });
		throw error;
	}
}

function createNonBlockedDockerNetwork(networkName: string): void {
	// safeFetch blocks RFC1918 (172.16/12, 192.168/16, 10/8), CGNAT (100.64/10), etc.
	// Use 100.63.<octet>.0/24 so fixture container IP stays outside every blocked CIDR.
	const candidateOctets = [241, 242, 243, 244, 245, 246];
	let lastError: unknown = null;

	for (const octet of candidateOctets) {
		try {
			runDocker([
				'network',
				'create',
				'--driver',
				'bridge',
				'--subnet',
				`100.63.${octet}.0/24`,
				networkName
			]);
			return;
		} catch (error) {
			lastError = error;
		}
	}

	throw new Error(
		`Unable to create isolated non-blocked Docker bridge network: ${
			lastError instanceof Error ? lastError.message : String(lastError)
		}`
	);
}

async function createSolidPngBase64(rgb: { r: number; g: number; b: number }): Promise<string> {
	const buf = await sharp({
		create: {
			width: 800,
			height: 420,
			channels: 3,
			background: rgb
		}
	})
		.png()
		.toBuffer();

	return buf.toString('base64');
}

function buildContainerDatabaseUrl(hostUrl: string): string {
	const parsed = new URL(hostUrl);
	if (
		parsed.hostname === '127.0.0.1' ||
		parsed.hostname === 'localhost' ||
		parsed.hostname === '::1'
	) {
		parsed.hostname = 'host.docker.internal';
	}
	return parsed.toString();
}

async function waitForHttpStatus(
	url: string,
	expectedStatus: number,
	timeoutMs = 30_000
): Promise<Response> {
	const deadline = Date.now() + timeoutMs;
	let lastError: unknown = null;

	while (Date.now() < deadline) {
		try {
			const response = await fetch(url);
			if (response.status === expectedStatus) {
				return response;
			}
			lastError = new Error(`Unexpected status ${response.status} from ${url}`);
		} catch (error) {
			lastError = error;
		}
		await new Promise((resolve) => setTimeout(resolve, 400));
	}

	throw new Error(
		`Timed out waiting for ${url} status ${expectedStatus}: ${
			lastError instanceof Error ? lastError.message : String(lastError)
		}`
	);
}

function readContainerLogs(containerName: string): string {
	return execFileSync('docker', ['logs', containerName], {
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe']
	});
}

function parseSetupUrlFromLogs(logs: string): string {
	for (const line of logs.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed.startsWith('{')) {
			continue;
		}
		try {
			const parsed = JSON.parse(trimmed) as { msg?: string; setupUrl?: string };
			if (
				parsed.msg === 'Initial admin bootstrap invite created' &&
				typeof parsed.setupUrl === 'string'
			) {
				return parsed.setupUrl;
			}
		} catch {
			// Ignore non-JSON lines if any
		}
	}
	throw new Error(`Could not find bootstrap setupUrl in container logs:\n${logs}`);
}

const FIXTURE_SERVER_SCRIPT = `
const http = require('node:http');
const cover1 = Buffer.from(process.env.COVER1_B64, 'base64');
const cover2 = Buffer.from(process.env.COVER2_B64, 'base64');
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }
  if (req.url === '/cover-1.png') {
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': cover1.length });
    res.end(cover1);
    return;
  }
  if (req.url === '/cover-2.png') {
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': cover2.length });
    res.end(cover2);
    return;
  }
  if (req.url === '/article-1') {
    const html = [
      '<!doctype html><html lang="tr"><head>',
      '<meta charset="utf-8">',
      '<title>Docker Duman Testi Makale 1</title>',
      '<meta property="og:title" content="Docker Duman Testi Makale 1">',
      '<meta property="og:description" content="Kalıcı hacim görsel doğrulama özeti.">',
      '<meta property="og:site_name" content="İzgah Fixture">',
      '<meta property="og:image" content="http://' + process.env.FIXTURE_HOST + '/cover-1.png">',
      '</head><body><p>Article 1</p></body></html>'
    ].join('');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }
  if (req.url === '/article-2') {
    const html = [
      '<!doctype html><html lang="tr"><head>',
      '<meta charset="utf-8">',
      '<title>Kira Kurtarma Makale 2</title>',
      '<meta property="og:title" content="Kira Kurtarma Makale 2">',
      '<meta property="og:description" content="90 sn kilit süresi dolmuş iş devralma özeti.">',
      '<meta property="og:site_name" content="İzgah Fixture">',
      '<meta property="og:image" content="http://' + process.env.FIXTURE_HOST + '/cover-2.png">',
      '</head><body><p>Article 2</p></body></html>'
    ].join('');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }
  res.writeHead(404);
  res.end('not found');
});
server.listen(80, '0.0.0.0', () => console.log('fixture ready'));
`;

/** Collects securitypolicyviolation events on every document (izgah-ui-v2 §11). */
const CSP_COLLECTOR = `
	window.__cspViolations = [];
	window.addEventListener('securitypolicyviolation', (event) => {
		window.__cspViolations.push({
			directive: event.violatedDirective,
			blocked: event.blockedURI,
			sample: event.sample,
			page: location.pathname
		});
	});
`;

type CspViolation = { directive: string; blocked: string; sample: string; page: string };

async function readViolations(page: import('@playwright/test').Page): Promise<CspViolation[]> {
	return page.evaluate(
		() => (window as unknown as { __cspViolations?: CspViolation[] }).__cspViolations ?? []
	);
}

test.describe('Milestone M8 — Production Docker Smoke & Recovery', () => {
	test.use({ ignoreHTTPSErrors: true });

	test.afterAll(async () => {
		try {
			await migrateTestDb();
		} finally {
			await smokeSql.end({ timeout: 5 });
		}
	});

	test('production container boots via advisory-lock migrations, persists /data/thumbnails across restart, and recovers expired 90s unfurl leases', async ({
		page
	}, testInfo) => {
		test.setTimeout(150_000);
		await page.context().addInitScript(CSP_COLLECTOR);

		const runId = `${Date.now()}-${testInfo.project.name.toLowerCase()}-${crypto.randomBytes(3).toString('hex')}`;
		const networkName = `izgah-smoke-net-${runId}`;
		const volumeName = `izgah-smoke-vol-${runId}`;
		const fixtureContainer = `izgah-smoke-fixture-${runId}`;
		const appContainer = `izgah-smoke-app-${runId}`;

		const hostPort = await reserveFreePort();
		const containerHttpUrl = `http://127.0.0.1:${hostPort}`;
		const containerDbUrl = buildContainerDatabaseUrl(testDatabaseUrl);
		let tlsProxy: Awaited<ReturnType<typeof startLocalTlsReverseProxy>> | null = null;

		// Reset izgah_test to an empty schema so docker-entrypoint.sh exercises real initial migration.
		await smokeSql.unsafe('DROP SCHEMA IF EXISTS public CASCADE;');
		await smokeSql.unsafe('DROP SCHEMA IF EXISTS drizzle CASCADE;');
		await smokeSql.unsafe('CREATE SCHEMA public;');

		const [cover1B64, cover2B64] = await Promise.all([
			createSolidPngBase64({ r: 30, g: 64, b: 175 }),
			createSolidPngBase64({ r: 5, g: 150, b: 105 })
		]);

		try {
			tlsProxy = await startLocalTlsReverseProxy(hostPort);
			const baseUrl = tlsProxy.baseUrl;

			createNonBlockedDockerNetwork(networkName);
			runDocker(['volume', 'create', volumeName]);

			runDocker([
				'run',
				'-d',
				'--name',
				fixtureContainer,
				'--network',
				networkName,
				'--network-alias',
				FIXTURE_HOST,
				'-e',
				`FIXTURE_HOST=${FIXTURE_HOST}`,
				'-e',
				`COVER1_B64=${cover1B64}`,
				'-e',
				`COVER2_B64=${cover2B64}`,
				FIXTURE_IMAGE,
				'node',
				'-e',
				FIXTURE_SERVER_SCRIPT
			]);

			runDocker([
				'run',
				'-d',
				'--name',
				appContainer,
				'--network',
				networkName,
				'-p',
				`127.0.0.1:${hostPort}:3000`,
				'--add-host=host.docker.internal:host-gateway',
				'-v',
				`${volumeName}:/data/thumbnails`,
				'-e',
				`DATABASE_URL=${containerDbUrl}`,
				'-e',
				`BETTER_AUTH_SECRET=${AUTH_SECRET}`,
				'-e',
				`ORIGIN=${baseUrl}`,
				'-e',
				// The assertions below use the Turkish UI, like the cookie-based fixture of the other specs.
				'DEFAULT_LOCALE=tr',
				'-e',
				'INSTANCE_NAME=İzgah',
				'-e',
				'ADMIN_BOOTSTRAP_EMAIL=admin@izgah.test',
				APP_IMAGE
			]);

			// 1. Wait for /healthz and /readyz on the running production container
			const healthRes = await waitForHttpStatus(`${containerHttpUrl}/healthz`, 200, 40_000);
			expect(await healthRes.json()).toEqual({ status: 'ok' });

			const readyRes = await waitForHttpStatus(`${containerHttpUrl}/readyz`, 200, 15_000);
			expect(await readyRes.json()).toEqual({
				status: 'ready',
				checks: {
					database: 'ok',
					migrations: 'ok',
					storage: 'ok'
				}
			});

			// 2. Verify non-root node user, PID 1 exec node, excluded dev/secret files, and migration log
			expect(runDocker(['exec', appContainer, 'id', '-un'])).toBe('node');
			expect(runDocker(['exec', appContainer, 'id', '-u'])).not.toBe('0');
			expect(
				runDocker([
					'exec',
					appContainer,
					'node',
					'-e',
					"const fs = require('node:fs'); process.stdout.write(fs.readFileSync('/proc/1/comm', 'utf8').trim());"
				])
			).toBe('node');

			const fileAudit = JSON.parse(
				runDocker([
					'exec',
					appContainer,
					'node',
					'-e',
					`const fs = require('node:fs');
					const out = {
						envExists: fs.existsSync('/app/.env'),
						envExampleExists: fs.existsSync('/app/.env.example'),
						testsExists: fs.existsSync('/app/tests'),
						localDataExists: fs.existsSync('/app/.local-data'),
						preDeployExists: fs.existsSync('/app/scripts/pre-deploy-backup.sh'),
						offboxExists: fs.existsSync('/app/scripts/offbox-backup.sh'),
						buildIndexExists: fs.existsSync('/app/build/index.js'),
						buildMigrateExists: fs.existsSync('/app/build/migrate.js'),
						buildCliExists: fs.existsSync('/app/build/cli.js'),
						drizzleJournalExists: fs.existsSync('/app/drizzle/meta/_journal.json')
					};
					process.stdout.write(JSON.stringify(out));`
				])
			) as Record<string, boolean>;

			expect(fileAudit).toEqual({
				envExists: false,
				envExampleExists: false,
				testsExists: false,
				localDataExists: false,
				preDeployExists: false,
				offboxExists: false,
				buildIndexExists: true,
				buildMigrateExists: true,
				buildCliExists: true,
				drizzleJournalExists: true
			});

			const initialLogs = readContainerLogs(appContainer);
			expect(initialLogs).toContain('"msg":"Database migrations complete"');
			const journal = JSON.parse(fs.readFileSync('drizzle/meta/_journal.json', 'utf8')) as {
				entries: unknown[];
			};
			expect(initialLogs).toContain(`"appliedCount":${journal.entries.length}`);

			// 3. Complete initial admin bootstrap via logged one-time invite URL
			const setupUrl = parseSetupUrlFromLogs(initialLogs);
			expect(setupUrl.startsWith(`${baseUrl}/auth/accept-invite?token=`)).toBe(true);

			await page.goto(setupUrl);
			await expect(page.getByRole('heading', { name: 'İzgah Davetini Kabul Et' })).toBeVisible();
			await page.getByLabel('Ad Soyad').fill('Docker Admin');
			await page.getByLabel('Yeni Parola').fill('DockerAdminParola123!');
			await page.getByRole('button', { name: 'Daveti Kabul Et ve Giriş Yap' }).click();

			await page.waitForURL(`${baseUrl}/`);
			await expect(page.getByRole('heading', { name: 'Ana Akış' })).toBeVisible();

			// 4. Share a fixture link -> real safeFetch + sharp WebP writes to /data/thumbnails volume.
			// At the top of the feed the share trigger focuses the inline composer (izgah-ui-v2 Karar 1).
			await expect(page.locator('html[data-hydrated]')).toHaveCount(1);
			await page.getByRole('button', { name: 'Link Paylaş' }).click();
			const composer = page.locator('#share-composer-inline');
			await expect(composer.locator('input[name="url"]')).toBeFocused();
			await composer.locator('input[name="url"]').fill(`http://${FIXTURE_HOST}/article-1`);
			await composer.locator('button[type="submit"]').click();
			await expect(composer.locator('input[name="url"]')).toHaveValue('');

			const firstCard = page.locator('article.share-card').first();
			await expect(
				firstCard.getByRole('heading', { name: 'Docker Duman Testi Makale 1' })
			).toBeVisible({
				timeout: 15_000
			});
			const firstThumb = firstCard.locator('.link-attachment img.card-thumbnail');
			await expect(firstThumb).toBeVisible({ timeout: 15_000 });
			await expect
				.poll(() =>
					firstThumb.evaluate((img) => (img instanceof HTMLImageElement ? img.naturalWidth : 0))
				)
				.toBeGreaterThan(0);

			const [res1] = await smokeDb
				.select({
					id: canonicalResources.id,
					assetKey: canonicalResources.thumbnailAssetKey
				})
				.from(canonicalResources)
				.where(eq(canonicalResources.canonicalUrl, `http://${FIXTURE_HOST}/article-1`))
				.limit(1);

			expect(res1?.assetKey).toMatch(/^[0-9a-f]{64}$/);
			const assetKey1 = res1.assetKey!;
			const expectedVolumePath = `/data/thumbnails/${assetKey1.slice(0, 2)}/${assetKey1}.webp`;
			expect(
				runDocker([
					'exec',
					appContainer,
					'node',
					'-e',
					`const fs = require('node:fs'); process.stdout.write(String(fs.existsSync(${JSON.stringify(expectedVolumePath)})));`
				])
			).toBe('true');

			// 5. Stop container (exercises clean SIGTERM shutdown) and seed an expired 90s lease job
			runDocker(['stop', appContainer]);

			const [adminUser] = await smokeDb
				.select({ id: users.id })
				.from(users)
				.where(eq(users.email, 'admin@izgah.test'))
				.limit(1);
			expect(adminUser?.id).toBeTruthy();

			const [res2] = await smokeDb
				.insert(canonicalResources)
				.values({
					canonicalUrl: `http://${FIXTURE_HOST}/article-2`,
					domain: FIXTURE_HOST,
					contentType: 'web',
					unfurlStatus: 'running'
				})
				.returning({ id: canonicalResources.id });

			await smokeDb.insert(linkShares).values({
				resourceId: res2.id,
				authorId: adminUser.id,
				rawUrl: `http://${FIXTURE_HOST}/article-2`,
				note: 'Yeniden başlatma sonrası kira kurtarma paylaşımı',
				isFeedVisible: true,
				sourceChannel: 'web'
			});

			await smokeDb.insert(unfurlJobs).values({
				resourceId: res2.id,
				targetUrl: `http://${FIXTURE_HOST}/article-2`,
				status: 'running',
				attempts: 1,
				nextRunAt: new Date(Date.now() - 120_000),
				lockedUntil: new Date(Date.now() - 95_000),
				lockToken: 'crashed-container-lock-token'
			});

			// 6. Restart container -> verify persistent thumbnail survives & expired job is recovered
			runDocker(['start', appContainer]);
			const readyAfterRestart = await waitForHttpStatus(`${containerHttpUrl}/readyz`, 200, 30_000);
			expect(await readyAfterRestart.json()).toEqual({
				status: 'ready',
				checks: {
					database: 'ok',
					migrations: 'ok',
					storage: 'ok'
				}
			});

			await expect
				.poll(
					async () => {
						const [row] = await smokeDb
							.select({
								jobStatus: unfurlJobs.status,
								attempts: unfurlJobs.attempts,
								unfurlStatus: canonicalResources.unfurlStatus,
								assetKey: canonicalResources.thumbnailAssetKey,
								title: canonicalResources.title
							})
							.from(unfurlJobs)
							.innerJoin(canonicalResources, eq(canonicalResources.id, unfurlJobs.resourceId))
							.where(eq(unfurlJobs.resourceId, res2.id))
							.limit(1);
						return row;
					},
					{ timeout: 20_000 }
				)
				.toMatchObject({
					jobStatus: 'completed',
					attempts: 2,
					unfurlStatus: 'ready',
					title: 'Kira Kurtarma Makale 2'
				});

			const [recoveredRes2] = await smokeDb
				.select({ assetKey: canonicalResources.thumbnailAssetKey })
				.from(canonicalResources)
				.where(eq(canonicalResources.id, res2.id))
				.limit(1);
			expect(recoveredRes2?.assetKey).toMatch(/^[0-9a-f]{64}$/);

			// Reload authenticated browser view and confirm BOTH thumbnails load cleanly
			await page.goto(`${baseUrl}/`);
			const card1AfterRestart = page
				.locator('article.share-card')
				.filter({ hasText: 'Docker Duman Testi Makale 1' });
			const card2AfterRestart = page
				.locator('article.share-card')
				.filter({ hasText: 'Kira Kurtarma Makale 2' });

			await expect(card1AfterRestart).toBeVisible();
			await expect(card2AfterRestart).toBeVisible();

			await expect
				.poll(() =>
					card1AfterRestart
						.locator('.link-attachment img.card-thumbnail')
						.evaluate((img) => (img instanceof HTMLImageElement ? img.naturalWidth : 0))
				)
				.toBeGreaterThan(0);
			await expect
				.poll(() =>
					card2AfterRestart
						.locator('.link-attachment img.card-thumbnail')
						.evaluate((img) => (img instanceof HTMLImageElement ? img.naturalWidth : 0))
				)
				.toBeGreaterThan(0);

			// 7. Enforced CSP (izgah-ui-v2 §11): every HTML response carries the header and the main
			// routes, the dialog, a popover, a theme switch and a view transition raise no violation.
			const [cspSection] = await smokeDb
				.insert(sections)
				.values({ slug: 'csp-bolum', name: 'CSP Bölümü', createdById: adminUser.id })
				.returning({ slug: sections.slug });

			const visit = async (
				target: import('@playwright/test').Page,
				routePath: string,
				hydrated: boolean
			) => {
				const response = await target.goto(`${baseUrl}${routePath}`);
				const header = response?.headers()['content-security-policy'] ?? '';
				expect(header, `CSP header on ${routePath}`).toContain("default-src 'self'");
				expect(header).toContain("frame-ancestors 'none'");
				if (hydrated) {
					await expect(target.locator('html[data-hydrated]')).toHaveCount(1);
				}
			};

			const appRoutes = [
				'/',
				'/sections',
				`/sections/${cspSection.slug}`,
				`/resources/${res2.id}`,
				'/search?q=docker',
				'/settings',
				'/settings/api-keys',
				'/admin/users',
				'/admin/sections',
				'/admin/unassigned',
				'/admin/jobs',
				'/admin/audit',
				'/admin/metrics'
			];
			const violations: CspViolation[] = [];
			for (const routePath of appRoutes) {
				await visit(page, routePath, true);
				violations.push(...(await readViolations(page)));
			}

			// Interactions on the feed: dialog (scrolled feed), popover + theme switch, view transition.
			// Pages without the inline composer open the share dialog (Karar 1).
			await visit(page, '/settings', true);
			await page.getByRole('button', { name: 'Link Paylaş' }).click();
			await expect(page.locator('#share-composer-dialog')).toBeVisible();
			await page.keyboard.press('Escape');
			await expect(page.locator('#share-composer-dialog')).toBeHidden();
			violations.push(...(await readViolations(page)));
			await visit(page, '/', true);
			await page.getByRole('button', { name: /Hesap menüsü/ }).click();
			await page.getByRole('radio', { name: 'Koyu' }).check();
			await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
			await page.keyboard.press('Escape');
			await page.locator('article.share-card').first().locator('a.card-discussion-link').click();
			await expect(page).toHaveURL(/\/resources\//);
			violations.push(...(await readViolations(page)));

			const anonymous = await page.context().browser()!.newContext({ ignoreHTTPSErrors: true });
			try {
				await anonymous.addInitScript(CSP_COLLECTOR);
				const anonPage = await anonymous.newPage();
				for (const routePath of [
					'/login',
					'/auth/accept-invite?token=gecersiz-jeton',
					'/auth/reset-password?token=gecersiz-jeton'
				]) {
					await visit(anonPage, routePath, false);
					await anonPage.waitForLoadState('networkidle');
					violations.push(...(await readViolations(anonPage)));
				}
				// An unknown route renders the error page.
				const missing = await anonPage.goto(`${baseUrl}/olmayan-sayfa-csp`);
				expect(missing?.headers()['content-security-policy'] ?? '').toContain("default-src 'self'");
				violations.push(...(await readViolations(anonPage)));
			} finally {
				await anonymous.close();
			}

			expect(violations).toEqual([]);
		} finally {
			await tlsProxy?.close().catch(() => {});
			runDocker(['rm', '-f', appContainer], { allowFailure: true });
			runDocker(['rm', '-f', fixtureContainer], { allowFailure: true });
			runDocker(['volume', 'rm', '-f', volumeName], { allowFailure: true });
			runDocker(['network', 'rm', networkName], { allowFailure: true });
		}
	});
});
