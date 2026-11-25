import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, expect, test, type BrowserContext, type Worker } from '@playwright/test';

const EXTENSION_PATH = path.resolve(import.meta.dirname, '../../.output/chrome-mv3');
const ADMIN_TOKEN = 'izk_admin_valid_token_e2e';
const MEMBER_TOKEN = 'izk_member_valid_token_e2e';

interface ChromeWorkerApi {
	runtime: {
		lastError?: { message?: string };
	};
	contextMenus: {
		update(id: string, props: { title: string }, callback: () => void): void;
	};
	storage: {
		session: {
			get(keys: string): Promise<Record<string, unknown>>;
			set(items: Record<string, unknown>): Promise<void>;
		};
	};
}

interface MockPostScenario {
	status: number;
	requestId?: string;
	retryAfter?: string;
	body: Record<string, unknown>;
}

interface RecordedRequest {
	method: string;
	path: string;
	authorization: string | undefined;
	clientName: string | undefined;
	clientVersion: string | undefined;
	jsonBody: Record<string, unknown> | null;
}

interface MockServerController {
	customOrigin: string;
	localhostOrigin: string;
	requests: RecordedRequest[];
	setPostScenario(scenario: MockPostScenario | null): void;
	close(): Promise<void>;
}

function writeJsonResponse(
	res: http.ServerResponse,
	status: number,
	body: unknown,
	extraHeaders: Record<string, string> = {}
) {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		'Content-Type': 'application/json; charset=utf-8',
		'Cache-Control': 'no-store',
		'Access-Control-Allow-Origin': '*',
		'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
		'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Client-Name, X-Client-Version',
		'Access-Control-Expose-Headers': 'X-Request-Id',
		...extraHeaders
	});
	res.end(payload);
}

async function listenDualStackOrLoopback(server: http.Server): Promise<number> {
	const tryListen = (options: { port: number; host: string; ipv6Only?: boolean }) =>
		new Promise<void>((resolve, reject) => {
			const onError = (err: Error) => {
				server.removeListener('listening', onListening);
				reject(err);
			};
			const onListening = () => {
				server.removeListener('error', onError);
				resolve();
			};
			server.once('error', onError);
			server.once('listening', onListening);
			server.listen(options);
		});

	try {
		await tryListen({ port: 0, host: '::', ipv6Only: false });
	} catch {
		await tryListen({ port: 0, host: '127.0.0.1' });
	}

	const addr = server.address();
	if (!addr || typeof addr === 'string') {
		throw new Error('Failed to resolve mock server address.');
	}
	return addr.port;
}

async function startMockIzgahServer(): Promise<MockServerController> {
	let nextPostScenario: MockPostScenario | null = null;
	const requests: RecordedRequest[] = [];

	const server = http.createServer((req, res) => {
		const reqUrl = new URL(req.url ?? '/', 'http://127.0.0.1');

		if (req.method === 'OPTIONS') {
			res.writeHead(204, {
				'Access-Control-Allow-Origin': '*',
				'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
				'Access-Control-Allow-Headers':
					'Authorization, Content-Type, X-Client-Name, X-Client-Version',
				'Access-Control-Expose-Headers': 'X-Request-Id'
			});
			res.end();
			return;
		}

		const chunks: Buffer[] = [];
		req.on('data', (chunk: Buffer) => chunks.push(chunk));
		req.on('end', () => {
			const rawBody = Buffer.concat(chunks).toString('utf8').trim();
			let parsedBody: Record<string, unknown> | null = null;
			if (rawBody !== '') {
				parsedBody = JSON.parse(rawBody) as Record<string, unknown>;
			}

			const authHeader = req.headers.authorization;
			const clientNameRaw = req.headers['x-client-name'];
			const clientVersionRaw = req.headers['x-client-version'];
			const clientName = Array.isArray(clientNameRaw) ? clientNameRaw[0] : clientNameRaw;
			const clientVersion = Array.isArray(clientVersionRaw)
				? clientVersionRaw[0]
				: clientVersionRaw;

			requests.push({
				method: req.method ?? 'GET',
				path: reqUrl.pathname + reqUrl.search,
				authorization: authHeader,
				clientName,
				clientVersion,
				jsonBody: parsedBody
			});

			const bearerToken = authHeader?.startsWith('Bearer ')
				? authHeader.slice('Bearer '.length).trim()
				: '';

			if (bearerToken !== ADMIN_TOKEN && bearerToken !== MEMBER_TOKEN) {
				writeJsonResponse(
					res,
					401,
					{
						error: {
							code: 'UNAUTHORIZED',
							message: 'Invalid API key',
							requestId: 'req-e2e-401'
						}
					},
					{ 'X-Request-Id': 'req-e2e-401' }
				);
				return;
			}

			const userProfile =
				bearerToken === ADMIN_TOKEN
					? {
							id: 'usr-admin-1',
							name: 'İzgah Admin',
							email: 'admin@izgah.local',
							role: 'admin'
						}
					: {
							id: 'usr-member-1',
							name: 'İzgah Üye',
							email: 'uye@izgah.local',
							role: 'member'
						};

			if (req.method === 'GET' && reqUrl.pathname === '/api/v1/me') {
				writeJsonResponse(res, 200, { user: userProfile }, { 'X-Request-Id': 'req-me-ok' });
				return;
			}

			if (req.method === 'GET' && reqUrl.pathname === '/api/v1/sections') {
				writeJsonResponse(
					res,
					200,
					{
						sections: [
							{
								id: 'sec-web',
								slug: 'web-standartlari',
								name: 'Web Standartları',
								description: 'Modern tarayıcı API kaynakları',
								sortOrder: 1
							},
							{
								id: 'sec-rust',
								slug: 'sistem-programlama',
								name: 'Sistem Programlama',
								description: null,
								sortOrder: 2
							}
						]
					},
					{ 'X-Request-Id': 'req-sections-ok' }
				);
				return;
			}

			if (req.method === 'GET' && reqUrl.pathname === '/api/v1/links/check') {
				const rawUrl = reqUrl.searchParams.get('url') ?? '';
				if (rawUrl.includes('silent-duplicate')) {
					writeJsonResponse(res, 200, {
						exists: true,
						canonicalUrl: 'https://example.com/silent-duplicate',
						rawUrl,
						suggestedContentType: 'article',
						resource: {
							id: 'res-silent-1',
							title: 'Sessiz Kaynak Rehberi',
							likeCount: 0,
							commentCount: 0
						},
						sharesSummary: {
							totalCount: 1,
							firstShare: {
								authorName: 'İzgah Admin',
								createdAt: '2026-11-19T09:00:00Z',
								isFeedVisible: false,
								sectionNames: ['Web Standartları']
							}
						}
					});
					return;
				}

				if (rawUrl.includes('duplicate-post')) {
					writeJsonResponse(res, 200, {
						exists: true,
						canonicalUrl: 'https://example.com/duplicate-post',
						rawUrl,
						suggestedContentType: 'article',
						resource: {
							id: 'res-dup-1',
							title: 'Web Platformu Standartları',
							likeCount: 4,
							commentCount: 1
						},
						sharesSummary: {
							totalCount: 2,
							firstShare: {
								authorName: 'Ayşe Yılmaz',
								createdAt: '2026-11-18T10:00:00Z',
								isFeedVisible: true,
								sectionNames: ['Web Standartları']
							}
						}
					});
					return;
				}

				writeJsonResponse(res, 200, {
					exists: false,
					canonicalUrl: rawUrl,
					rawUrl,
					suggestedContentType: 'article'
				});
				return;
			}

			if (req.method === 'POST' && reqUrl.pathname === '/api/v1/links') {
				if (nextPostScenario) {
					const scenario = nextPostScenario;
					nextPostScenario = null;
					const headers: Record<string, string> = {};
					if (scenario.requestId) {
						headers['X-Request-Id'] = scenario.requestId;
					}
					if (scenario.retryAfter) {
						headers['Retry-After'] = scenario.retryAfter;
					}
					writeJsonResponse(res, scenario.status, scenario.body, headers);
					return;
				}

				const isFeedVisible =
					parsedBody && typeof parsedBody.isFeedVisible === 'boolean'
						? parsedBody.isFeedVisible
						: true;
				const url =
					parsedBody && typeof parsedBody.url === 'string'
						? parsedBody.url
						: 'https://example.com/';

				writeJsonResponse(
					res,
					201,
					{
						share: {
							id: `shr-${requests.length}`,
							resourceId: `res-${requests.length}`,
							canonicalUrl: url.split('#')[0] ?? url,
							rawUrl: url,
							isFeedVisible,
							createdAt: '2026-11-20T03:00:00Z'
						},
						unfurlStatus: 'pending',
						duplicate: false
					},
					{ 'X-Request-Id': 'req-post-ok' }
				);
				return;
			}

			writeJsonResponse(
				res,
				404,
				{
					error: {
						code: 'NOT_FOUND',
						message: 'Unknown route',
						requestId: 'req-404'
					}
				},
				{ 'X-Request-Id': 'req-404' }
			);
		});
	});

	const port = await listenDualStackOrLoopback(server);

	return {
		customOrigin: `http://127.0.0.1:${port}`,
		localhostOrigin: `http://localhost:${port}`,
		requests,
		setPostScenario(scenario) {
			nextPostScenario = scenario;
		},
		close() {
			return new Promise((resolve, reject) => {
				server.close((err) => (err ? reject(err) : resolve()));
			});
		}
	};
}

async function resolveExtensionWorker(context: BrowserContext): Promise<Worker> {
	const existing = context.serviceWorkers()[0];
	if (existing) {
		return existing;
	}
	return context.waitForEvent('serviceworker', { timeout: 10_000 });
}

test.describe('Izgah Browser Extension E2E (CUJ 1 - CUJ 5)', () => {
	let mockServer: MockServerController;
	let userDataDir = '';
	let context: BrowserContext | null = null;
	let serviceWorker: Worker;
	let extensionId = '';

	test.beforeAll(async () => {
		mockServer = await startMockIzgahServer();
	});

	test.afterAll(async () => {
		if (mockServer) {
			await mockServer.close();
		}
	});

	test.beforeEach(async () => {
		mockServer.requests.length = 0;
		mockServer.setPostScenario(null);
		userDataDir = mkdtempSync(path.join(tmpdir(), 'izgah-ext-e2e-'));

		context = await chromium.launchPersistentContext(userDataDir, {
			channel: 'chromium',
			headless: true,
			args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`]
		});

		serviceWorker = await resolveExtensionWorker(context);
		extensionId = new URL(serviceWorker.url()).hostname;
		await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	});

	test.afterEach(async () => {
		if (context) {
			await context.close();
			context = null;
		}
		if (userDataDir) {
			rmSync(userDataDir, { recursive: true, force: true });
			userDataDir = '';
		}
	});

	test('completes CUJ 1, CUJ 2, and CUJ 3 with custom CORS origin and right-click link handoff', async () => {
		if (!context) {
			throw new Error('BrowserContext was not initialized.');
		}

		const optionsUrl = `chrome-extension://${extensionId}/options.html`;
		const popupUrl = `chrome-extension://${extensionId}/popup.html`;

		// Verify service worker registered the right-click context menu item on install (onInstalled is async)
		await expect
			.poll(
				async () =>
					serviceWorker.evaluate(async () => {
						const chromeApi = (globalThis as unknown as { chrome: ChromeWorkerApi }).chrome;
						return new Promise<string | null>((resolve) => {
							chromeApi.contextMenus.update('share-to-izgah', { title: "İzgah'a paylaş" }, () => {
								resolve(chromeApi.runtime.lastError?.message ?? null);
							});
						});
					}),
				{ timeout: 5_000 }
			)
			.toBeNull();

		// Setup gate before credentials exist -> opening Options from setup button
		const page = context.pages()[0] ?? (await context.newPage());
		await page.goto(popupUrl);
		await expect(page.locator('#popup-setup-panel')).toBeVisible();

		const [optionsFromSetup] = await Promise.all([
			context.waitForEvent('page'),
			page.click('#popup-setup-options-btn')
		]);
		await optionsFromSetup.waitForLoadState('domcontentloaded');
		await expect(optionsFromSetup).toHaveURL(optionsUrl);

		// CUJ 1: Options validation, CORS note for custom origin, Test & Save, storage persistence
		await optionsFromSetup.fill('#server-origin', `${mockServer.customOrigin}/extra/path?q=1`);
		await optionsFromSetup.fill('#api-key', ADMIN_TOKEN);
		await expect(optionsFromSetup.locator('#options-cors-note')).toBeVisible();

		await optionsFromSetup.click('#test-connection-btn');
		await expect(optionsFromSetup.locator('#options-user-summary')).toContainText('İzgah Admin');
		await expect(optionsFromSetup.locator('#options-user-summary')).toContainText('Yönetici');

		await optionsFromSetup.click('#save-settings-btn');
		await expect(optionsFromSetup.locator('#options-status-text')).toContainText('kaydedildi');

		await optionsFromSetup.reload();
		await expect(optionsFromSetup.locator('#server-origin')).toHaveValue(mockServer.customOrigin);
		await expect(optionsFromSetup.locator('#api-key')).toHaveValue(ADMIN_TOKEN);
		await optionsFromSetup.close();

		const meReq = mockServer.requests.find((r) => r.path === '/api/v1/me');
		expect(meReq?.authorization).toBe(`Bearer ${ADMIN_TOKEN}`);
		expect(meReq?.clientName).toBe('izgah-chrome-extension');
		expect(meReq?.clientVersion).toBe('0.1.0');

		// CUJ 2 & CUJ 3: Right-click pending share handoff, duplicate warning, admin silent validation & 201
		await serviceWorker.evaluate(async () => {
			const chromeApi = (globalThis as unknown as { chrome: ChromeWorkerApi }).chrome;
			await chromeApi.storage.session.set({
				izgah_pending_share_v1: {
					url: 'https://example.com/duplicate-post#heading-2',
					title: 'Örnek Başlık',
					source: 'link',
					createdAt: Date.now()
				}
			});
		});

		await page.goto(`${popupUrl}?mode=standalone`);
		await expect(page.locator('html')).toHaveAttribute('data-standalone', 'true');
		await expect(page.locator('#share-url')).toHaveValue(
			'https://example.com/duplicate-post#heading-2'
		);
		await expect(page.locator('#share-source-badge')).toHaveText('Sağ tık: Bağlantı');
		await expect(page.locator('#duplicate-banner')).toBeVisible();
		await expect(page.locator('#duplicate-primary-text')).toContainText('Ayşe Yılmaz');
		await expect(page.locator('#duplicate-meta-text')).toContainText('Toplam 2 paylaşım');

		// Verify pending share was consumed one-shot
		const pendingAfterConsume = await serviceWorker.evaluate(async () => {
			const chromeApi = (globalThis as unknown as { chrome: ChromeWorkerApi }).chrome;
			const res = await chromeApi.storage.session.get('izgah_pending_share_v1');
			return res.izgah_pending_share_v1 ?? null;
		});
		expect(pendingAfterConsume).toBeNull();

		// Admin silent mode enforces >= 1 section before POST
		await expect(page.locator('#admin-silent-row')).toBeVisible();
		await page.check('#share-silent-mode');
		await expect(page.locator('#sections-legend')).toContainText('zorunlu');

		const postCountBeforeBlockedSubmit = mockServer.requests.filter(
			(r) => r.method === 'POST' && r.path === '/api/v1/links'
		).length;
		await page.click('#popup-submit-btn');
		await expect(page.locator('#sections-error')).toContainText(
			'Sessiz kaynak için en az bir konu bölümü seçmelisiniz.'
		);
		const postCountAfterBlockedSubmit = mockServer.requests.filter(
			(r) => r.method === 'POST' && r.path === '/api/v1/links'
		).length;
		expect(postCountAfterBlockedSubmit).toBe(postCountBeforeBlockedSubmit);

		await page.check('#popup-section-sec-web');
		await page.fill('#share-note', 'Sessiz referans bağlantısı');
		await page.click('#popup-submit-btn');

		await expect(page.locator('#popup-success-panel')).toBeVisible();
		await expect(page.locator('#popup-success-heading')).toContainText(
			"Bağlantı İzgah'a paylaşıldı"
		);
		await expect(page.locator('#popup-success-summary')).toContainText('sessiz kaynak');

		const silentPost = mockServer.requests
			.filter((r) => r.method === 'POST' && r.path === '/api/v1/links')
			.at(-1);
		expect(silentPost?.jsonBody).toEqual({
			url: 'https://example.com/duplicate-post#heading-2',
			note: 'Sessiz referans bağlantısı',
			sectionIds: ['sec-web'],
			isFeedVisible: false
		});
	});

	test('renders silent-resource duplicate warning and handles 422, 429 Retry-After, and 401 recovery (CUJ 3, CUJ 4, CUJ 5)', async () => {
		if (!context) {
			throw new Error('BrowserContext was not initialized.');
		}

		const optionsUrl = `chrome-extension://${extensionId}/options.html`;
		const popupUrl = `chrome-extension://${extensionId}/popup.html`;

		// Configure localhost origin (matches manifest host_permissions http://localhost/api/v1/*)
		const page = context.pages()[0] ?? (await context.newPage());
		await page.goto(optionsUrl);
		await page.fill('#server-origin', mockServer.localhostOrigin);
		await page.fill('#api-key', ADMIN_TOKEN);
		await page.click('#save-settings-btn');
		await expect(page.locator('#options-status-text')).toContainText('kaydedildi');

		// Silent-resource duplicate check via right-click page handoff
		await serviceWorker.evaluate(async () => {
			const chromeApi = (globalThis as unknown as { chrome: ChromeWorkerApi }).chrome;
			await chromeApi.storage.session.set({
				izgah_pending_share_v1: {
					url: 'https://example.com/silent-duplicate',
					title: 'Sessiz Kaynak Başlığı',
					source: 'page',
					createdAt: Date.now()
				}
			});
		});

		await page.goto(`${popupUrl}?mode=standalone`);
		await expect(page.locator('#share-source-badge')).toHaveText('Sağ tık: Sayfa');
		await expect(page.locator('#share-title-text')).toHaveText('Sessiz Kaynak Rehberi');
		await expect(page.locator('#duplicate-banner')).toBeVisible();
		await expect(page.locator('#duplicate-primary-text')).toContainText('İzgah Admin');
		await expect(page.locator('#duplicate-meta-text')).toContainText(
			'Yalnızca sessiz kaynak olarak kayıtlı (Web Standartları); normal paylaşım yaparsanız ana akışa da eklenir.'
		);

		// CUJ 4: 422 field error + requestId clipboard copy
		mockServer.setPostScenario({
			status: 422,
			requestId: 'req-e2e-422',
			body: {
				error: {
					code: 'VALIDATION_ERROR',
					message: 'Gönderilen alanlar doğrulanamadı.',
					requestId: 'req-e2e-422',
					details: {
						url: ['Bu alan adı sunucu politikası tarafından engellendi.']
					}
				}
			}
		});

		await page.fill('#share-url', 'https://example.com/blocked-url');
		await page.click('#popup-submit-btn');

		await expect(page.locator('#popup-error-banner')).toBeVisible();
		await expect(page.locator('#popup-request-id')).toHaveText('req-e2e-422');
		await expect(page.locator('#share-url')).toHaveAttribute('aria-invalid', 'true');

		await page.click('#popup-copy-btn');
		await expect(page.locator('#popup-copy-feedback')).toContainText('Kopyalandı');
		const copiedClipboardText = await page.evaluate(() => navigator.clipboard.readText());
		expect(copiedClipboardText).toBe('req-e2e-422');

		// 429 rate-limit response with Retry-After read under http://localhost/api/v1/* host_permissions
		mockServer.setPostScenario({
			status: 429,
			requestId: 'req-e2e-429',
			retryAfter: '45',
			body: {
				error: {
					code: 'RATE_LIMITED',
					message: 'Rate limit exceeded',
					requestId: 'req-e2e-429'
				}
			}
		});
		await page.click('#popup-submit-btn');
		await expect(page.locator('#popup-error-message')).toContainText('45 saniye');
		await expect(page.locator('#popup-request-id')).toHaveText('req-e2e-429');

		// 401 unauthorized response reveals options button
		mockServer.setPostScenario({
			status: 401,
			requestId: 'req-e2e-401',
			body: {
				error: {
					code: 'UNAUTHORIZED',
					message: 'Revoked key',
					requestId: 'req-e2e-401'
				}
			}
		});
		await page.click('#popup-submit-btn');
		await expect(page.locator('#popup-error-message')).toContainText('API anahtarınız');
		await expect(page.locator('#popup-auth-action-row')).toBeVisible();

		// CUJ 5: Update revoked key in Options with a member token and retry share cleanly
		const [optionsFromAuthError] = await Promise.all([
			context.waitForEvent('page'),
			page.click('#popup-error-options-btn')
		]);
		await optionsFromAuthError.waitForLoadState('domcontentloaded');
		await optionsFromAuthError.fill('#api-key', MEMBER_TOKEN);
		await optionsFromAuthError.click('#save-settings-btn');
		await expect(optionsFromAuthError.locator('#options-user-summary')).toContainText('Üye');
		await optionsFromAuthError.close();

		// Reopen popup fresh with member role and share a regular feed link
		await page.goto(popupUrl);
		await expect(page.locator('#admin-silent-row')).toBeHidden();
		await page.fill('#share-url', 'https://example.com/member-share');
		await page.click('#popup-submit-btn');

		await expect(page.locator('#popup-success-panel')).toBeVisible();
		await expect(page.locator('#popup-success-summary')).toContainText(
			'Bağlantı ana akışta yayınlandı.'
		);
	});
});
