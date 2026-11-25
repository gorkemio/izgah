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

async function seedShare(authorId: string, slug: string, title: string) {
	const url = `https://mobil.example/${slug}`;
	const [resource] = await testDb
		.insert(canonicalResources)
		.values({ canonicalUrl: url, domain: 'mobil.example', unfurlStatus: 'ready', title })
		.returning({ id: canonicalResources.id });
	await testDb.insert(linkShares).values({
		resourceId: resource.id,
		authorId,
		rawUrl: url,
		isFeedVisible: true,
		sourceChannel: 'web'
	});
	return resource.id;
}

async function expectNoHorizontalOverflow(page: import('@playwright/test').Page, label: string) {
	const overflow = await page.evaluate(() => ({
		scroll: document.documentElement.scrollWidth,
		inner: window.innerWidth
	}));
	expect(overflow.scroll, `horizontal overflow on ${label}`).toBeLessThanOrEqual(overflow.inner);
}

// Runs only in the mobile-chromium and mobile-webkit projects (real device emulation).
test.describe('UI v2 on phones @mobile', () => {
	test.beforeAll(async () => {
		await migrateTestDb();
	});

	test.beforeEach(async () => {
		await resetTestDb();
	});

	test.afterAll(async () => {
		await localSql.end({ timeout: 5 });
	});

	test('CUJ U4: tab bar to a section, preset section in the inline form, share @mobile', async ({
		page,
		context
	}) => {
		const member = await seedUserWithSession({ name: 'Telefon Üye', email: 'telefon@izgah.test' });
		await testDb.insert(schema.sections).values({
			slug: 'arayuz',
			name: 'Arayüz Tasarımı',
			createdById: member.id
		});
		await attachSessionCookie(context, member.cookieValue);
		await page.goto('/');
		await expect(page.locator('html[data-hydrated]')).toHaveCount(1);

		const tabBar = page.getByRole('navigation', { name: 'Ana gezinme' });
		await tabBar.getByRole('link', { name: 'Bölümler' }).tap();
		await expect(page).toHaveURL(/\/sections$/);
		await page.getByRole('link', { name: 'Arayüz Tasarımı' }).first().tap();
		await expect(page).toHaveURL(/\/sections\/arayuz$/);
		await expect(page.locator('html[data-hydrated]')).toHaveCount(1);

		const composer = page.locator('#share-composer-inline');
		const url = composer.locator('input[name="url"]');
		await url.tap();
		await expect(tabBar).toBeHidden();
		await url.fill('https://mobil.example/arayuz-notu');
		await expect(composer.getByLabel('Arayüz Tasarımı')).toBeChecked();
		await composer.locator('button[type="submit"]').tap();
		await expect(url).toHaveValue('');

		const card = page.locator('article.share-card').first();
		await expect(card).toBeVisible();
		await expect(card.getByRole('link', { name: 'Arayüz Tasarımı' })).toBeVisible();
		await url.blur();
		await expect(tabBar).toBeVisible();
	});

	test('tab bar "Paylaş": inline form on the feed, dialog elsewhere @mobile', async ({
		page,
		context
	}) => {
		const member = await seedUserWithSession({ name: 'Paylaşan Üye', email: 'mpaylas@izgah.test' });
		await attachSessionCookie(context, member.cookieValue);

		await page.goto('/');
		await expect(page.locator('html[data-hydrated]')).toHaveCount(1);
		const tabBar = page.getByRole('navigation', { name: 'Ana gezinme' });
		await page.getByRole('button', { name: 'Link Paylaş' }).tap();
		await expect(page.locator('#share-composer-inline input[name="url"]')).toBeFocused();
		await page.locator('#share-composer-inline input[name="url"]').blur();
		await expect(tabBar).toBeVisible();

		await page.goto('/settings');
		await expect(page.locator('html[data-hydrated]')).toHaveCount(1);
		await page.getByRole('button', { name: 'Link Paylaş' }).tap();
		await expect(page.locator('#share-composer-dialog')).toBeVisible();
	});

	test('one-line sticky comment form and no horizontal overflow on main pages @mobile', async ({
		page,
		context
	}) => {
		const member = await seedUserWithSession({ name: 'Okuyan Üye', email: 'mokur@izgah.test' });
		const resourceId = await seedShare(
			member.id,
			'uzun-baslik',
			'Çok uzun bir başlık: yerel öncelikli yazılım, senkronizasyon ve çakışma çözümü üzerine notlar'
		);
		await attachSessionCookie(context, member.cookieValue);

		for (const path of ['/', '/sections', '/search?q=senkronizasyon', '/settings']) {
			await page.goto(path);
			await expect(page.locator('html[data-hydrated]')).toHaveCount(1);
			await expectNoHorizontalOverflow(page, path);
		}

		await page.goto(`/resources/${resourceId}`);
		await expect(page.locator('html[data-hydrated]')).toHaveCount(1);
		await expectNoHorizontalOverflow(page, 'resource page');
		const form = page.locator('.comment-composer-form');
		const textarea = page.locator('#resource-new-comment-body');
		const box = await form.boundingBox();
		const viewport = page.viewportSize();
		expect(box && viewport && box.y + box.height).toBeLessThanOrEqual(viewport!.height);
		expect((await textarea.boundingBox())!.height).toBeLessThanOrEqual(48);

		await textarea.tap();
		await expect.poll(async () => (await textarea.boundingBox())!.height).toBeGreaterThan(60);
		await textarea.fill('Telefondan yorum');
		await page.getByRole('button', { name: 'Yorum Gönder' }).tap();
		await expect(page.locator('.comment-list')).toContainText('Telefondan yorum');
	});
});
