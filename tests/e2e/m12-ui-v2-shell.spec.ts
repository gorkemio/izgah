import crypto from 'node:crypto';
import { expect, test, type BrowserContext } from '@playwright/test';
import { makeSignature } from 'better-auth/crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../../src/lib/server/db/schema';
import { canonicalResources, linkShares, sessions, users } from '../../src/lib/server/db/schema';
import { assertTestDatabaseUrl, migrateTestDb } from '../setup/db';

const AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? 'test-only-secret-key-at-least-32-chars!!';

// Playwright reuses one worker across spec files and m5 closes the shared test connection in its
// afterAll, so this spec owns its own pool (same pattern as m6/m7).
const localSql = postgres(assertTestDatabaseUrl(process.env.TEST_DATABASE_URL), {
	max: 4,
	onnotice: () => {}
});
const testDb = drizzle(localSql, { schema });

async function resetTestDb(): Promise<void> {
	await localSql`
		TRUNCATE TABLE
			public.notifications,
			public.resource_comments,
			public.resource_likes,
			public.search_logs,
			public.audit_logs,
			public.link_share_sections,
			public.link_shares,
			public.unfurl_jobs,
			public.canonical_resources,
			public.media_assets,
			public.sections,
			public.api_keys,
			public.invite_tokens,
			public.verifications,
			public.accounts,
			public.sessions,
			public.users
		RESTART IDENTITY CASCADE
	`;
}

async function seedUserWithSession(options: { name: string; email: string }) {
	const [user] = await testDb
		.insert(users)
		.values({
			name: options.name,
			email: options.email.toLowerCase(),
			emailVerified: true,
			role: 'member',
			isActive: true,
			authVersion: 1
		})
		.returning({ id: users.id, name: users.name });

	const sessionToken = crypto.randomBytes(32).toString('base64url');
	await testDb.insert(sessions).values({
		token: sessionToken,
		userId: user.id,
		expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
		userAuthVersion: 1
	});
	const signature = await makeSignature(sessionToken, AUTH_SECRET);
	return { ...user, cookieValue: `${sessionToken}.${signature}` };
}

async function attachSessionCookie(context: BrowserContext, cookieValue: string): Promise<void> {
	await context.clearCookies();
	await context.addCookies([
		{
			name: 'better-auth.session_token',
			value: cookieValue,
			domain: '127.0.0.1',
			path: '/',
			httpOnly: true,
			sameSite: 'Lax'
		}
	]);
}

/** Seeds `total` ready shares, newest first, one per resource. Returns resource ids newest first. */
async function seedFeed(authorId: string, total: number): Promise<string[]> {
	const resourceIds: string[] = [];
	const base = Date.now();
	for (let i = 0; i < total; i += 1) {
		const [resource] = await testDb
			.insert(canonicalResources)
			.values({
				canonicalUrl: `https://akis.example/yazi-${i}`,
				domain: 'akis.example',
				unfurlStatus: 'ready',
				title: `Akış yazısı ${i}`
			})
			.returning({ id: canonicalResources.id });
		await testDb.insert(linkShares).values({
			resourceId: resource.id,
			authorId,
			rawUrl: `https://akis.example/yazi-${i}`,
			isFeedVisible: true,
			sourceChannel: 'web',
			createdAt: new Date(base - i * 60_000)
		});
		resourceIds.push(resource.id);
	}
	return resourceIds;
}

test.describe('UI v2 shell — rail, bottom tab bar, /sections and theme cookie', () => {
	test.beforeAll(async () => {
		await migrateTestDb();
	});

	test.beforeEach(async () => {
		await resetTestDb();
	});

	test.afterAll(async () => {
		await localSql.end({ timeout: 5 });
	});

	test('mobile: one "Ana gezinme", visible bell, tab bar hides while typing', async ({
		page,
		context
	}) => {
		const member = await seedUserWithSession({ name: 'Mobil Üye', email: 'mobil@izgah.test' });
		await seedFeed(member.id, 2);
		await attachSessionCookie(context, member.cookieValue);
		await page.setViewportSize({ width: 375, height: 812 });

		await page.goto('/');
		await expect(page.locator('html[data-hydrated]')).toHaveCount(1);
		const nav = page.getByRole('navigation', { name: 'Ana gezinme' });
		await expect(nav).toHaveCount(1);
		await expect(nav.getByRole('link', { name: 'Akış' })).toHaveAttribute('aria-current', 'page');
		await expect(page.getByRole('button', { name: /^Bildirimler/ })).toBeVisible();
		await expect(page.getByRole('search', { name: 'Site içi arama' })).toHaveCount(0);

		await page.goto('/search');
		await expect(page.locator('html[data-hydrated]')).toHaveCount(1);
		await expect(nav).toBeVisible();
		await page.getByRole('searchbox').first().focus();
		await expect(nav).toBeHidden();
	});

	test('/sections lists sections without JavaScript', async ({ browser }) => {
		const member = await seedUserWithSession({ name: 'JS Kapalı', email: 'jskapali@izgah.test' });
		await testDb.insert(schema.sections).values({
			slug: 'arayuz',
			name: 'Arayüz Tasarımı',
			description: 'Tasarım notları',
			createdById: member.id
		});
		const context = await browser.newContext({ javaScriptEnabled: false });
		await attachSessionCookie(context, member.cookieValue);
		const page = await context.newPage();
		await page.goto('/sections');
		await expect(page.getByRole('heading', { level: 1, name: 'Bölümler' })).toBeVisible();
		await expect(page.getByText('Tasarım notları')).toBeVisible();
		await page.getByRole('link', { name: 'Arayüz Tasarımı' }).first().click();
		await expect(page).toHaveURL(/\/sections\/arayuz$/);
		await context.close();
	});

	test('theme cookie renders data-theme on first paint and the account menu switches it', async ({
		page,
		context
	}) => {
		const member = await seedUserWithSession({ name: 'Tema Seçen', email: 'tema@izgah.test' });
		await attachSessionCookie(context, member.cookieValue);
		await context.addCookies([
			{ name: 'izgah_theme', value: 'dark', domain: '127.0.0.1', path: '/' }
		]);
		const response = await page.goto('/');
		expect(await response?.text()).toContain('data-theme="dark"');
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

		await expect(page.locator('html[data-hydrated]')).toHaveCount(1);
		await page.getByRole('button', { name: 'Hesap menüsü' }).click();
		await page.getByRole('radio', { name: 'Açık' }).check();
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
		await expect
			.poll(async () => (await context.cookies()).find((c) => c.name === 'izgah_theme')?.value)
			.toBe('light');
	});
	test('no-JS inline composer on a section page: preset section, field error, then share', async ({
		browser
	}) => {
		const member = await seedUserWithSession({ name: 'Form Yazan', email: 'form@izgah.test' });
		await testDb.insert(schema.sections).values({
			slug: 'okuma',
			name: 'Okuma Listesi',
			createdById: member.id
		});
		const context = await browser.newContext({ javaScriptEnabled: false });
		await attachSessionCookie(context, member.cookieValue);
		const page = await context.newPage();
		await page.goto('/sections/okuma');

		const composer = page.locator('#share-composer-inline');
		await expect(composer).toHaveCount(1);
		await expect(page.locator('form[action$="?/createShare"]')).toHaveCount(1);

		const url = composer.locator('input[name="url"]');
		await url.fill('ftp://ornek.dev/dosya');
		await expect(composer.getByLabel('Okuma Listesi')).toBeChecked();
		const failed = page.waitForResponse((r) => r.request().method() === 'POST');
		await composer.locator('button[type="submit"]').click();
		expect((await failed).status()).toBeLessThan(500);
		await expect(
			composer.getByText('Yalnızca http ve https bağlantıları desteklenir.').first()
		).toBeVisible();
		await expect(composer.getByLabel('Okuma Listesi')).toBeChecked();

		await composer.locator('input[name="url"]').fill('https://ornek.dev/js-siz');
		await composer.locator('button[type="submit"]').click();
		await expect(page).toHaveURL(/\/sections\/okuma/);
		await expect(page.locator('article.share-card')).toHaveCount(1);
		await context.close();
	});

	test('paste outside text fields fills the inline composer (Chromium)', async ({
		page,
		context,
		browserName
	}) => {
		test.skip(browserName !== 'chromium', 'Document paste is progressive enhancement (§8.1).');
		const member = await seedUserWithSession({ name: 'Yapıştıran', email: 'paste@izgah.test' });
		await attachSessionCookie(context, member.cookieValue);
		await page.goto('/');
		await expect(page.locator('html[data-hydrated]')).toHaveCount(1);

		await page.evaluate(() => {
			const data = new DataTransfer();
			data.setData('text/plain', 'Şuna bakın https://ornek.dev/yapistir');
			document.body.dispatchEvent(
				new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
			);
		});

		const composer = page.locator('#share-composer-inline');
		await expect(composer.locator('input[name="url"]')).toHaveValue('https://ornek.dev/yapistir');
		await expect(composer.locator('textarea[name="note"]')).toHaveValue('Şuna bakın');
		await expect(composer.locator('textarea[name="note"]')).toBeFocused();
		await expect(page.locator('#share-composer-dialog')).toBeHidden();
	});

	test('/settings Görünüm: theme and shortcut switch; phones get Oturum actions', async ({
		page,
		context
	}) => {
		const member = await seedUserWithSession({ name: 'Ayar Yapan', email: 'ayar@izgah.test' });
		await attachSessionCookie(context, member.cookieValue);
		await page.goto('/settings');
		await expect(page.locator('html[data-hydrated]')).toHaveCount(1);

		const appearance = page.getByRole('region', { name: 'Görünüm' });
		await appearance.getByRole('radio', { name: 'Koyu' }).check();
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
		await expect
			.poll(async () => (await context.cookies()).find((c) => c.name === 'izgah_theme')?.value)
			.toBe('dark');

		await appearance.getByLabel('Tek tuşlu kısayollar').uncheck();
		await expect(page.locator('html')).toHaveAttribute('data-shortcuts', 'off');
		await expect(page.getByRole('region', { name: 'Oturum' })).toBeHidden();

		await page.setViewportSize({ width: 375, height: 812 });
		const session = page.getByRole('region', { name: 'Oturum' });
		await expect(session).toBeVisible();
		await expect(session.getByRole('button', { name: 'Çıkış yap' })).toBeVisible();
	});

	test('/settings Görünüm: palettes apply without reload and persist (izgah-themes §5, izgah-ui-v4 §1)', async ({
		page,
		context
	}) => {
		const member = await seedUserWithSession({ name: 'Palet Seçen', email: 'palet@izgah.test' });
		await attachSessionCookie(context, member.cookieValue);
		await page.goto('/settings');
		await expect(page.locator('html[data-hydrated]')).toHaveCount(1);
		const html = page.locator('html');
		await expect(html).toHaveAttribute('data-dark-theme', 'default');
		await expect(html).not.toHaveAttribute('data-accent', /.*/);

		const appearance = page.getByRole('region', { name: 'Görünüm' });
		await appearance
			.getByRole('group', { name: 'Koyu tema' })
			.getByRole('radio', { name: 'Yüksek kontrast' })
			.check();
		await appearance
			.getByRole('group', { name: 'Açık tema' })
			.getByRole('radio', { name: 'Yüksek kontrast' })
			.check();
		await expect(html).toHaveAttribute('data-dark-theme', 'contrast');
		await expect(html).toHaveAttribute('data-light-theme', 'contrast');
		await expect
			.poll(async () =>
				Object.fromEntries(
					(await context.cookies())
						.filter((c) => c.name.startsWith('izgah_theme_'))
						.map((c) => [c.name, c.value])
				)
			)
			.toEqual({ izgah_theme_light: 'contrast', izgah_theme_dark: 'contrast' });
		// The mode picker is untouched by palette changes.
		await expect(html).toHaveAttribute('data-theme', 'system');

		const response = await page.reload();
		expect(await response?.text()).toContain('data-dark-theme="contrast"');
		await expect(
			appearance
				.getByRole('group', { name: 'Koyu tema' })
				.getByRole('radio', { name: 'Yüksek kontrast' })
		).toBeChecked();
	});

	test('/settings Görünüm: palette form works without JavaScript', async ({ browser }) => {
		const member = await seedUserWithSession({
			name: 'JSsiz Palet',
			email: 'jssiz-palet@izgah.test'
		});
		const context = await browser.newContext({ javaScriptEnabled: false });
		await attachSessionCookie(context, member.cookieValue);
		const page = await context.newPage();
		await page.goto('/settings');
		const form = page.getByTestId('palette-form');
		await form
			.getByRole('group', { name: 'Koyu tema' })
			.getByRole('radio', { name: 'Yüksek kontrast' })
			.check();
		await form.getByRole('button', { name: 'Uygula' }).click();
		await expect(page).toHaveURL(/\/settings$/);
		await expect(page.locator('html')).toHaveAttribute('data-dark-theme', 'contrast');
		await context.close();
	});

	test('unknown pages render the error page inside the app shell (F14)', async ({
		page,
		context
	}) => {
		const member = await seedUserWithSession({ name: 'Kaybolan', email: 'kayip@izgah.test' });
		await attachSessionCookie(context, member.cookieValue);
		await page.setViewportSize({ width: 1280, height: 800 });
		const response = await page.goto('/resources/00000000-0000-4000-8000-000000000000');
		expect(response?.status()).toBe(404);
		await expect(page.locator('#main-content h1')).toHaveText('Sayfa bulunamadı');
		await expect(page).toHaveTitle('Sayfa bulunamadı — İzgah');
		await expect(page.getByRole('navigation', { name: 'Ana gezinme' })).toBeVisible();
		await page.getByRole('link', { name: 'Akışa dön' }).click();
		await expect(page).toHaveURL(/\/$/);
	});

	test('/search marks matches, pages past 25 results and keeps the scope radio group (F15)', async ({
		page,
		context
	}) => {
		const member = await seedUserWithSession({ name: 'Arayan Üye', email: 'arayan@izgah.test' });
		await testDb.insert(schema.sections).values({
			slug: 'genel',
			name: 'Genel',
			createdById: member.id
		});
		for (let i = 0; i < 27; i += 1) {
			const [resource] = await testDb
				.insert(canonicalResources)
				.values({
					canonicalUrl: `https://ara.example/tasarim-${i}`,
					domain: 'ara.example',
					unfurlStatus: 'ready',
					title: `Tasarım sistemi notu ${i}`
				})
				.returning({ id: canonicalResources.id });
			await testDb.insert(linkShares).values({
				resourceId: resource.id,
				authorId: member.id,
				rawUrl: `https://ara.example/tasarim-${i}`,
				isFeedVisible: true,
				sourceChannel: 'web'
			});
		}
		await attachSessionCookie(context, member.cookieValue);
		await page.goto('/search?q=tasarim');
		await expect(page.locator('html[data-hydrated]')).toHaveCount(1);

		await expect(page.locator('.search-summary')).toContainText('27 sonuç bulundu');
		await expect(page.locator('article.share-card')).toHaveCount(25);
		await expect(page.locator('article.share-card').first().locator('mark.hl')).toHaveText(
			'Tasarım'
		);
		await expect(page.locator('input[type="radio"][name="scope"]')).toHaveCount(2);

		const pagination = page.getByRole('navigation', { name: 'Arama sayfalaması' });
		await expect(pagination).toContainText('Sayfa 1 / 2');
		await pagination.getByRole('link', { name: 'Sonraki sayfa' }).click();
		await expect(page).toHaveURL(/page=2/);
		await expect(page.locator('article.share-card')).toHaveCount(2);
		await expect(pagination.getByRole('link', { name: 'Önceki sayfa' })).toBeVisible();
	});

	test('admin without JavaScript: deactivate a member, rename and delete a section (F8)', async ({
		browser
	}) => {
		const admin = await seedUserWithSession({
			name: 'Yönetici Kişi',
			email: 'yonetici@izgah.test'
		});
		await localSql`UPDATE public.users SET role = 'admin' WHERE id = ${admin.id}`;
		const member = await seedUserWithSession({ name: 'Ayrılan Üye', email: 'ayrilan@izgah.test' });
		await testDb.insert(schema.sections).values({
			slug: 'gecici',
			name: 'Geçici Bölüm',
			createdById: admin.id
		});

		const context = await browser.newContext({ javaScriptEnabled: false });
		await attachSessionCookie(context, admin.cookieValue);
		const page = await context.newPage();

		await page.goto('/admin/users');
		const memberRow = page.getByRole('row').filter({ hasText: 'ayrilan@izgah.test' });
		await memberRow.getByRole('link', { name: /Pasifleştir/ }).click();
		await expect(page).toHaveURL(new RegExp(`disable=${member.id}`));
		const confirm = page.getByRole('region', { name: 'Üyeyi Pasifleştir' });
		await expect(confirm).toContainText('Ayrılan Üye');
		await confirm.getByRole('button', { name: 'Evet, Pasifleştir' }).click();
		await expect(page.getByRole('row').filter({ hasText: 'ayrilan@izgah.test' })).toContainText(
			'Pasif'
		);

		await page.goto('/admin/sections');
		const sectionRow = page.getByRole('row').filter({ hasText: 'Geçici Bölüm' });
		await sectionRow.getByRole('link', { name: /Düzenle/ }).click();
		const editPanel = page.getByRole('region', { name: /Bölümü Düzenle/ });
		await editPanel.getByLabel('Bölüm Adı').fill('Kalıcı Bölüm');
		await editPanel.getByRole('button', { name: 'Değişiklikleri Kaydet' }).click();
		await expect(page.getByRole('row').filter({ hasText: 'Kalıcı Bölüm' })).toHaveCount(1);

		await page.goto('/admin/sections');
		await page
			.getByRole('row')
			.filter({ hasText: 'Kalıcı Bölüm' })
			.getByRole('link', { name: /Sil/ })
			.click();
		await page
			.getByRole('region', { name: /Bölümü Sil/ })
			.getByRole('button', { name: 'Evet, Bölümü Sil' })
			.click();
		await expect(page.getByRole('row').filter({ hasText: 'Kalıcı Bölüm' })).toHaveCount(0);
		await context.close();
	});

	test('⌘K CommandPalette: opens via shortcut, filters sections/actions, live-searches without logging, closes on Esc', async ({
		page,
		context
	}) => {
		const member = await seedUserWithSession({ name: 'Komut Üyesi', email: 'komut@izgah.test' });
		await testDb.insert(schema.sections).values({
			slug: 'arayuz',
			name: 'Arayüz Tasarımı',
			createdById: member.id
		});
		const [resource] = await testDb
			.insert(canonicalResources)
			.values({
				canonicalUrl: 'https://studio.example/sveltekit-rehberi',
				domain: 'studio.example',
				unfurlStatus: 'ready',
				title: 'SvelteKit Stüdyo Rehberi'
			})
			.returning({ id: canonicalResources.id });
		await testDb.insert(linkShares).values({
			resourceId: resource.id,
			authorId: member.id,
			rawUrl: 'https://studio.example/sveltekit-rehberi',
			isFeedVisible: true,
			sourceChannel: 'web'
		});

		await attachSessionCookie(context, member.cookieValue);
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.goto('/');
		await expect(page.locator('html[data-hydrated]')).toHaveCount(1);

		await page.keyboard.press('Control+k');
		const dialog = page.locator('#command-palette-dialog');
		await expect(dialog).toBeVisible();
		const input = dialog.getByRole('combobox', { name: 'Bağlantı, bölüm veya eylem ara' });
		await expect(input).toBeFocused();

		const listbox = dialog.getByRole('listbox', { name: 'Komut paleti sonuçları' });
		await input.fill('ayar');
		await expect(listbox.getByRole('option', { name: /Ayarlar ve görünüm/ })).toBeVisible();

		await input.fill('arayuz');
		await expect(listbox.getByRole('option', { name: /Arayüz Tasarımı/ })).toBeVisible();

		await input.fill('Stüdyo');
		await expect(listbox.getByRole('option', { name: /SvelteKit Stüdyo Rehberi/ })).toBeVisible();

		const logRows = await testDb.select().from(schema.searchLogs);
		expect(logRows).toHaveLength(0);

		await page.keyboard.press('Escape');
		await expect(dialog).toBeHidden();
	});

	test('SidePeekDialog: "Önizle" opens right drawer with JS and navigates to /resources/[id] without JS', async ({
		browser,
		page,
		context
	}) => {
		const member = await seedUserWithSession({ name: 'Önizleyen', email: 'onizle@izgah.test' });
		const [resource] = await testDb
			.insert(canonicalResources)
			.values({
				canonicalUrl: 'https://studio.example/side-peek-yazisi',
				domain: 'studio.example',
				unfurlStatus: 'ready',
				title: 'Yandan Önizleme Yazısı',
				description: 'Çekmece özeti açıklaması'
			})
			.returning({ id: canonicalResources.id });
		await testDb.insert(linkShares).values({
			resourceId: resource.id,
			authorId: member.id,
			rawUrl: 'https://studio.example/side-peek-yazisi',
			note: 'Hızlı bakış ekip notu',
			isFeedVisible: true,
			sourceChannel: 'web'
		});
		await testDb.insert(schema.resourceComments).values({
			resourceId: resource.id,
			authorId: member.id,
			body: 'Çekmecede görünen yorum'
		});

		await attachSessionCookie(context, member.cookieValue);
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.goto('/');
		await expect(page.locator('html[data-hydrated]')).toHaveCount(1);

		const card = page.locator('article.share-card').first();
		await card.getByRole('link', { name: /^Önizle —/ }).click();

		// From 1280px the preview is a docked, non-modal reading pane (izgah-ui-v4 §3).
		const drawer = page.locator('dialog.side-peek-dialog');
		await expect(drawer).toBeVisible();
		await expect(drawer).toHaveClass(/is-docked/);
		await expect(page.locator('dialog:modal')).toHaveCount(0);
		await expect(page).toHaveURL(/\/$/);
		await expect(drawer).toContainText('Yandan Önizleme Yazısı');
		await expect(drawer).toContainText('Hızlı bakış ekip notu');
		await expect(drawer).toContainText('Çekmecede görünen yorum');
		await expect(drawer.getByRole('link', { name: 'Tam sayfada aç' })).toHaveAttribute(
			'href',
			`/resources/${resource.id}`
		);

		await page.keyboard.press('Escape');
		await expect(drawer).toBeHidden();

		// Below 1280px the same preview is a modal side drawer.
		await page.setViewportSize({ width: 1100, height: 800 });
		await card.getByRole('link', { name: /^Önizle —/ }).click();
		await expect(drawer).toBeVisible();
		await expect(drawer).not.toHaveClass(/is-docked/);
		await expect(page.locator('dialog:modal')).toHaveCount(1);
		await page.keyboard.press('Escape');
		await expect(drawer).toBeHidden();

		const noJsContext = await browser.newContext({
			javaScriptEnabled: false,
			viewport: { width: 1280, height: 800 }
		});
		await attachSessionCookie(noJsContext, member.cookieValue);
		const noJsPage = await noJsContext.newPage();
		await noJsPage.goto('/');
		await noJsPage
			.locator('article.share-card')
			.first()
			.getByRole('link', { name: /^Önizle —/ })
			.click();
		await expect(noJsPage).toHaveURL(new RegExp(`/resources/${resource.id}$`));
		await expect(noJsPage.locator('#main-content h1')).toHaveText('Yandan Önizleme Yazısı');
		await noJsContext.close();
	});
});
