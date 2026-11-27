import crypto from 'node:crypto';
import { expect, test, type BrowserContext } from '@playwright/test';
import { makeSignature } from 'better-auth/crypto';
import { and, count, eq, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../../src/lib/server/db/schema';
import {
	canonicalResources,
	inviteTokens,
	linkShares,
	resourceComments,
	resourceLikes,
	sessions,
	users
} from '../../src/lib/server/db/schema';
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

test.describe('Review fixes — feed state, navigation and no-JS flows', () => {
	test.beforeAll(async () => {
		await migrateTestDb();
	});

	test.beforeEach(async () => {
		await resetTestDb();
	});

	test.afterAll(async () => {
		await localSql.end({ timeout: 5 });
	});

	test('liking a card on an appended page keeps the "Daha fazla yükle" pages', async ({
		page,
		context
	}) => {
		const member = await seedUserWithSession({ name: 'Sayfa Okuru', email: 'okur@izgah.test' });
		const resourceIds = await seedFeed(member.id, 27);
		await attachSessionCookie(context, member.cookieValue);

		await page.goto('/');
		await expect(page.locator('html[data-hydrated]')).toHaveCount(1);
		const cards = page.locator('article.share-card');
		await expect(cards).toHaveCount(25);
		// Playwright's own scroll-into-view does not move the page in WebKit with the sticky rail;
		// the native API does (and is what real navigation uses), so scroll natively first.
		const loadMore = page.getByRole('link', { name: 'Daha fazla yükle' });
		await loadMore.evaluate((el) => el.scrollIntoView({ block: 'center' }));
		await loadMore.click();
		await expect(cards).toHaveCount(27);

		const lastLike = cards.nth(26).locator('button[aria-pressed]');
		await lastLike.evaluate((el) => el.scrollIntoView({ block: 'center' }));
		await lastLike.click();
		await expect(lastLike).toHaveAttribute('aria-pressed', 'true');
		await expect(lastLike).toHaveAccessibleName(/^1 beğeni/);

		// Give any (former) feed invalidation time to land, then the appended page must still be there.
		await page.waitForTimeout(1_000);
		await expect(cards).toHaveCount(27);

		const [likeRow] = await testDb
			.select({ value: count() })
			.from(resourceLikes)
			.where(eq(resourceLikes.resourceId, resourceIds[26]));
		expect(Number(likeRow.value)).toBe(1);
	});

	test('Back from a resource page keeps the feed scroll position', async ({ page, context }) => {
		const member = await seedUserWithSession({ name: 'Kaydıran', email: 'kaydiran@izgah.test' });
		const resourceIds = await seedFeed(member.id, 25);
		await attachSessionCookie(context, member.cookieValue);

		await page.goto('/');
		await expect(page.locator('html[data-hydrated]')).toHaveCount(1);
		const lastCard = page.locator('article.share-card').last();
		await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
		await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(400);
		const scrolledTo = await page.evaluate(() => window.scrollY);
		expect(scrolledTo).toBeGreaterThan(400);

		// content-visibility: auto cards settle their real size after scrolling; wait until the link
		// is in the viewport before clicking so the click lands on it.
		const commentsLink = lastCard.locator('a.card-discussion-link');
		await expect
			.poll(async () => {
				await commentsLink.evaluate((el) => el.scrollIntoView({ block: 'center' }));
				return commentsLink.evaluate((el) => {
					const rect = el.getBoundingClientRect();
					return rect.top >= 0 && rect.bottom <= window.innerHeight;
				});
			})
			.toBe(true);
		await commentsLink.click();
		// toHaveURL polls the URL; waitForURL also waits for a load event that WebKit does not fire
		// for same-document navigations here.
		await expect(page).toHaveURL(new RegExp(`/resources/${resourceIds[24]}(#comments)?$`));
		await expect(page.getByRole('heading', { level: 1, name: 'Akış yazısı 24' })).toBeVisible();
		await page.goBack({ waitUntil: 'commit' });
		await expect(page).toHaveURL(/\/$/);
		await expect
			.poll(() => page.evaluate(() => window.scrollY), { timeout: 5_000 })
			.toBeGreaterThan(scrolledTo / 2);
	});

	test('Back after "Daha fazla yükle" restores the loaded pages and position', async ({
		page,
		context
	}) => {
		const member = await seedUserWithSession({ name: 'Geri Dönen', email: 'geri@izgah.test' });
		const resourceIds = await seedFeed(member.id, 30);
		await attachSessionCookie(context, member.cookieValue);

		await page.goto('/');
		await expect(page.locator('html[data-hydrated]')).toHaveCount(1);
		// content-visibility cards settle their size while scrolling (WebKit): re-scroll until the
		// link stays in view before clicking it.
		const loadMore = page.getByRole('link', { name: 'Daha fazla yükle' });
		await expect
			.poll(async () => {
				await loadMore.evaluate((el) => el.scrollIntoView({ block: 'center' }));
				return loadMore.evaluate((el) => {
					const rect = el.getBoundingClientRect();
					return rect.top >= 0 && rect.bottom <= window.innerHeight;
				});
			})
			.toBe(true);
		await loadMore.click();
		await expect(page.locator('article.share-card')).toHaveCount(30);

		const lastLink = page.locator('article.share-card').last().locator('a.card-discussion-link');
		await expect
			.poll(async () => {
				await lastLink.evaluate((el) => el.scrollIntoView({ block: 'center' }));
				return lastLink.evaluate((el) => {
					const rect = el.getBoundingClientRect();
					return rect.top >= 0 && rect.bottom <= window.innerHeight;
				});
			})
			.toBe(true);
		const scrolledTo = await page.evaluate(() => window.scrollY);
		await lastLink.click();
		await expect(page).toHaveURL(new RegExp(`/resources/${resourceIds[29]}(#comments)?$`));

		await page.goBack({ waitUntil: 'commit' });
		await expect(page).toHaveURL(/\/$/);
		await expect(page.locator('article.share-card')).toHaveCount(30);
		await expect
			.poll(() => page.evaluate(() => window.scrollY), { timeout: 5_000 })
			.toBeGreaterThan(scrolledTo * 0.8);
	});

	test('pressing Enter twice posts a single comment', async ({ page, context }) => {
		const member = await seedUserWithSession({ name: 'Yorumcu', email: 'yorumcu@izgah.test' });
		const [resourceId] = await seedFeed(member.id, 1);
		await attachSessionCookie(context, member.cookieValue);

		await page.goto(`/resources/${resourceId}`);
		await expect(page.locator('html[data-hydrated]')).toHaveCount(1);
		const textarea = page.getByLabel('Yorumunuz');
		await textarea.fill('Tek sefer gönderilmeli');
		await textarea.press('Enter');
		await textarea.press('Enter');

		await expect(page.getByRole('heading', { level: 2, name: 'Yorumlar (1)' })).toBeVisible();
		await page.waitForTimeout(1_000);
		const [commentRow] = await testDb
			.select({ value: count() })
			.from(resourceComments)
			.where(and(eq(resourceComments.resourceId, resourceId), isNull(resourceComments.deletedAt)));
		expect(Number(commentRow.value)).toBe(1);
	});

	test('a failed login without JavaScript shows the error instead of a server error', async ({
		browser
	}) => {
		const context = await browser.newContext({ javaScriptEnabled: false });
		const page = await context.newPage();
		await page.goto('/login');
		await page.getByLabel('E-posta adresi').fill('kimse@izgah.test');
		await page.getByLabel('Parola', { exact: true }).fill('YanlisParola12345');
		const [response] = await Promise.all([
			page.waitForResponse(
				(res) => res.url().includes('/login') && res.request().method() === 'POST'
			),
			page.getByRole('button', { name: 'Giriş yap' }).click()
		]);
		expect(response.status()).toBeLessThan(500);
		await expect(page.getByText('E-posta adresi veya parola hatalı.')).toBeVisible();
		await context.close();
	});

	test('text typed before hydration survives on the login, invite and reset forms', async ({
		page
	}) => {
		const [invited] = await testDb
			.insert(users)
			.values({
				name: 'Davetli',
				email: 'davetli@izgah.test',
				emailVerified: false,
				role: 'member',
				isActive: true,
				authVersion: 1
			})
			.returning({ id: users.id });
		const tokenFor = async (purpose: 'invite' | 'password_reset') => {
			const rawToken = crypto.randomBytes(32).toString('base64url');
			await testDb.insert(inviteTokens).values({
				tokenHash: crypto.createHash('sha256').update(rawToken).digest('hex'),
				userId: invited.id,
				purpose,
				createdById: null,
				expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
			});
			return encodeURIComponent(rawToken);
		};

		// Holds every script back until the fields are filled, so the typing lands on the
		// server-rendered markup and hydration runs afterwards.
		const openBeforeHydration = async (url: string) => {
			const held: Array<() => void> = [];
			let released = false;
			await page.unrouteAll();
			await page.route('**/*', async (route) => {
				if (!released && route.request().resourceType() === 'script') {
					await new Promise<void>((resolve) => held.push(resolve));
				}
				await route.continue();
			});
			await page.goto(url, { waitUntil: 'commit' });
			return () => {
				released = true;
				for (const resolve of held) {
					resolve();
				}
			};
		};

		const expectTypingSurvivesHydration = async (
			url: string,
			fields: Array<{ label: string; value: string }>
		) => {
			const releaseScripts = await openBeforeHydration(url);
			for (const { label, value } of fields) {
				await page.getByLabel(label, { exact: true }).fill(value);
			}
			releaseScripts();
			// The password toggle only reacts once the page has hydrated.
			await expect(async () => {
				await page.getByRole('button', { name: 'Göster' }).click({ timeout: 1_000 });
				await expect(page.getByRole('button', { name: 'Gizle' })).toBeVisible({ timeout: 500 });
			}).toPass();
			for (const { label, value } of fields) {
				await expect(page.getByLabel(label, { exact: true })).toHaveValue(value);
			}
		};

		await expectTypingSurvivesHydration('/login', [
			{ label: 'E-posta adresi', value: 'erken@izgah.test' },
			{ label: 'Parola', value: 'ErkenParola123' }
		]);
		await expectTypingSurvivesHydration(`/auth/accept-invite?token=${await tokenFor('invite')}`, [
			{ label: 'Ad soyad', value: 'Erken Yazan' },
			{ label: 'Yeni parola', value: 'ErkenParola123' }
		]);
		await expectTypingSurvivesHydration(
			`/auth/reset-password?token=${await tokenFor('password_reset')}`,
			[{ label: 'Yeni parola', value: 'ErkenParola123' }]
		);
	});
});
