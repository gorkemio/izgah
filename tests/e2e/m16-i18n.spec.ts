import crypto from 'node:crypto';
import { expect, test, type BrowserContext } from '@playwright/test';
import { makeSignature } from 'better-auth/crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../../src/lib/server/db/schema';
import { sessions, users } from '../../src/lib/server/db/schema';
import { assertTestDatabaseUrl, migrateTestDb } from '../setup/db';

/*
 * English UI and language switching (docs/designs/izgah-i18n-oss.md §2, §8). The web server runs
 * with DEFAULT_LOCALE=tr for the older specs, so English is selected here through the cookie.
 */
const AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? 'test-only-secret-key-at-least-32-chars!!';
const localSql = postgres(assertTestDatabaseUrl(process.env.TEST_DATABASE_URL), {
	max: 4,
	onnotice: () => {}
});
const testDb = drizzle(localSql, { schema });

async function resetTestDb(): Promise<void> {
	await localSql`
		TRUNCATE TABLE
			public.notifications, public.resource_comments, public.resource_likes, public.search_logs,
			public.audit_logs, public.link_share_sections, public.link_shares, public.unfurl_jobs,
			public.canonical_resources, public.media_assets, public.sections, public.api_keys,
			public.invite_tokens, public.verifications, public.accounts, public.sessions, public.users
		RESTART IDENTITY CASCADE
	`;
}

async function seedSession(): Promise<string> {
	const [user] = await testDb
		.insert(users)
		.values({
			name: 'Language Tester',
			email: 'lang@izgah.test',
			emailVerified: true,
			role: 'member',
			isActive: true,
			authVersion: 1
		})
		.returning({ id: users.id });
	const token = crypto.randomBytes(32).toString('base64url');
	await testDb.insert(sessions).values({
		token,
		userId: user.id,
		expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
		userAuthVersion: 1
	});
	return `${token}.${await makeSignature(token, AUTH_SECRET)}`;
}

async function signIn(context: BrowserContext, cookieValue: string, locale?: 'en' | 'tr') {
	await context.clearCookies();
	await context.addCookies([
		{
			name: 'better-auth.session_token',
			value: cookieValue,
			domain: '127.0.0.1',
			path: '/',
			httpOnly: true,
			sameSite: 'Lax'
		},
		...(locale ? [{ name: 'izgah_locale', value: locale, domain: '127.0.0.1', path: '/' }] : [])
	]);
}

test.describe('English UI and language switching', () => {
	test.beforeAll(async () => {
		await migrateTestDb();
	});

	test.beforeEach(async () => {
		await resetTestDb();
	});

	test.afterAll(async () => {
		await localSql.end({ timeout: 5 });
	});

	test('the locale cookie renders the app in English with lang="en"', async ({ context, page }) => {
		await signIn(context, await seedSession(), 'en');
		await page.goto('/');
		await expect(page.locator('html')).toHaveAttribute('lang', 'en');
		await expect(page.locator('#main-content h1')).toHaveText('Feed');
		await expect(page.getByRole('navigation', { name: 'Main navigation' }).first()).toBeAttached();
		await expect(page).toHaveTitle(/^Feed — /);
		await expect(page.getByText('Nothing has been shared yet.')).toBeVisible();
	});

	test('switching the language in Settings reloads the app in that language', async ({
		context,
		page
	}) => {
		await signIn(context, await seedSession(), 'en');
		await page.goto('/settings');
		await expect(page.locator('#main-content h1')).toHaveText('Account settings');
		await expect(page.locator('html[data-hydrated]')).toHaveCount(1);

		await page.getByRole('radio', { name: 'Türkçe' }).check();
		await expect(page.locator('html')).toHaveAttribute('lang', 'tr');
		await expect(page.locator('#main-content h1')).toHaveText('Hesap ayarları');
		await expect(page.locator('html[data-hydrated]')).toHaveCount(1);

		await page.getByRole('radio', { name: 'English' }).check();
		await expect(page.locator('html')).toHaveAttribute('lang', 'en');
		await expect(page.locator('#main-content h1')).toHaveText('Account settings');
	});

	test('the language form works without JavaScript', async ({ browser }) => {
		const context = await browser.newContext({ javaScriptEnabled: false });
		await signIn(context, await seedSession());
		const page = await context.newPage();
		await page.goto('/settings');
		await expect(page.locator('html')).toHaveAttribute('lang', 'tr');

		const form = page.locator('form.locale-form');
		await form.getByRole('radio', { name: 'English' }).check();
		await form.getByRole('button', { name: 'Uygula' }).click();
		await expect(page.locator('html')).toHaveAttribute('lang', 'en');
		await expect(page.locator('#main-content h1')).toHaveText('Account settings');
		await context.close();
	});

	test('server-side errors follow the language', async ({ browser }) => {
		const context = await browser.newContext({ javaScriptEnabled: false });
		await context.addCookies([
			{ name: 'izgah_locale', value: 'en', domain: '127.0.0.1', path: '/' }
		]);
		const page = await context.newPage();
		await page.goto('/login');
		await expect(page.locator('html')).toHaveAttribute('lang', 'en');
		await page.getByLabel('Email address').fill('nobody@izgah.test');
		await page.getByLabel('Password', { exact: true }).fill('WrongPassword12345');
		await page.getByRole('button', { name: 'Sign in' }).click();
		await expect(page.getByText('The email address or password is incorrect.')).toBeVisible();
		await context.close();
	});
});
