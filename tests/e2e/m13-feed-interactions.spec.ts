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

async function seedShare(options: {
	authorId: string;
	slug: string;
	title: string;
	createdAt: Date;
}): Promise<{ shareId: string; resourceId: string; createdAt: string }> {
	const url = `https://akis.example/${options.slug}`;
	const [resource] = await testDb
		.insert(canonicalResources)
		.values({
			canonicalUrl: url,
			domain: 'akis.example',
			unfurlStatus: 'ready',
			title: options.title
		})
		.returning({ id: canonicalResources.id });
	const [share] = await testDb
		.insert(linkShares)
		.values({
			resourceId: resource.id,
			authorId: options.authorId,
			rawUrl: url,
			isFeedVisible: true,
			sourceChannel: 'web',
			createdAt: options.createdAt
		})
		.returning({ id: linkShares.id, createdAt: linkShares.createdAt });
	return { shareId: share.id, resourceId: resource.id, createdAt: share.createdAt.toISOString() };
}

const MINUTE = 60_000;

test.describe('UI v2 feed interactions — shortcuts, day groups, last visit, new-posts pill', () => {
	test.beforeAll(async () => {
		await migrateTestDb();
	});

	test.beforeEach(async () => {
		await resetTestDb();
	});

	test.afterAll(async () => {
		await localSql.end({ timeout: 5 });
	});

	test('CUJ U2: j/k/l/o/c, / and n, then ? turns single-key shortcuts off', async ({
		page,
		context
	}) => {
		const reader = await seedUserWithSession({ name: 'Klavye Okur', email: 'klavye@izgah.test' });
		const author = await seedUserWithSession({ name: 'Yazar Üye', email: 'yazar@izgah.test' });
		const now = Date.now();
		const shares: Awaited<ReturnType<typeof seedShare>>[] = [];
		for (let i = 0; i < 4; i += 1) {
			shares.push(
				await seedShare({
					authorId: author.id,
					slug: `kisayol-${i}`,
					title: `Kısayol yazısı ${i}`,
					createdAt: new Date(now - (i + 1) * MINUTE)
				})
			);
		}
		await context.route('https://akis.example/**', (route) =>
			route.fulfill({ status: 200, contentType: 'text/html', body: '<title>dış</title>' })
		);
		await attachSessionCookie(context, reader.cookieValue);
		await page.goto('/');
		await expect(page.locator('html[data-hydrated]')).toHaveCount(1);
		await expect(page.locator('html')).toHaveAttribute('data-shortcuts', 'on');

		const post = (index: number) => page.locator(`#share-${shares[index].shareId}`);
		await page.keyboard.press('j');
		await expect(post(0)).toBeFocused();
		await page.keyboard.press('j');
		await page.keyboard.press('j');
		await expect(post(2)).toBeFocused();
		await page.keyboard.press('k');
		await expect(post(1)).toBeFocused();

		const like = post(1).locator('[data-shortcut="like"]');
		await expect(like).toHaveAttribute('aria-pressed', 'false');
		await page.keyboard.press('l');
		await expect(like).toHaveAttribute('aria-pressed', 'true');
		await expect(post(1)).toBeFocused();

		const popupPromise = context.waitForEvent('page');
		await page.keyboard.press('o');
		const popup = await popupPromise;
		await expect.poll(() => popup.url()).toBe('https://akis.example/kisayol-1');
		await popup.close();

		await post(1).focus();
		await page.keyboard.press('c');
		await expect(page).toHaveURL(new RegExp(`/resources/${shares[1].resourceId}#comments$`));
		await page
			.getByRole('navigation', { name: 'Ana gezinme' })
			.getByRole('link', { name: 'Akış' })
			.click();
		await expect(post(0)).toBeVisible();

		await page.locator('body').click({ position: { x: 5, y: 5 } });
		await page.keyboard.press('/');
		await expect(page.locator('#rail-search-input')).toBeFocused();
		await page.locator('#rail-search-input').blur();

		await page.keyboard.press('n');
		await expect(page.locator('#share-composer-inline input[name="url"]')).toBeFocused();
		// Typing in a field never triggers shortcuts.
		await page.keyboard.type('jk');
		await expect(page.locator('#share-composer-inline input[name="url"]')).toHaveValue('jk');
		await page.locator('#share-composer-inline input[name="url"]').fill('');
		await page.locator('#share-composer-inline input[name="url"]').blur();

		await page.keyboard.press('?');
		const help = page.locator('#keyboard-help-dialog');
		await expect(help).toBeVisible();
		await expect(help.getByText('Sonraki / önceki gönderi')).toBeVisible();
		await help.getByLabel('Tek tuşlu kısayollar').uncheck();
		await expect(page.locator('html')).toHaveAttribute('data-shortcuts', 'off');
		await page.keyboard.press('Escape');
		await expect(help).toBeHidden();

		await post(0).focus();
		await page.keyboard.press('j');
		await expect(post(0)).toBeFocused();
		expect(await page.evaluate(() => localStorage.getItem('izgah:shortcuts'))).toBe('off');
	});

	test('posts are grouped under sticky day headings', async ({ page, context }) => {
		const member = await seedUserWithSession({ name: 'Gün Okur', email: 'gun@izgah.test' });
		const now = Date.now();
		await seedShare({
			authorId: member.id,
			slug: 'bugun',
			title: 'Bugünkü',
			createdAt: new Date(now - MINUTE)
		});
		await seedShare({
			authorId: member.id,
			slug: 'eski',
			title: 'Eski',
			createdAt: new Date(now - 49 * 60 * MINUTE)
		});
		await attachSessionCookie(context, member.cookieValue);
		await page.goto('/');

		const headings = page.locator('h2.day-heading');
		await expect(headings).toHaveCount(2);
		// "Bugün" followed by the full date on the same heading (izgah-ui-v4 §4).
		await expect(headings.first()).toHaveText(/^Bugün\b/);
		await expect(
			page.getByRole('region', { name: 'Bugün' }).locator('article.share-card')
		).toHaveCount(1);
		// The whole day row (heading, rule, count) sticks (izgah-ui-v5 §5.2).
		expect(
			await headings
				.first()
				.evaluate((el) => getComputedStyle(el.closest('.day-row') ?? el).position)
		).toBe('sticky');
	});

	test('CUJ U3: last-visit marker flags newer posts by others and advances on leave', async ({
		page,
		context
	}) => {
		const reader = await seedUserWithSession({ name: 'Geri Dönen', email: 'donen@izgah.test' });
		const other = await seedUserWithSession({ name: 'Ekip Üyesi', email: 'ekip@izgah.test' });
		const now = Date.now();
		const seen = await seedShare({
			authorId: other.id,
			slug: 'gorulen',
			title: 'Görülen',
			createdAt: new Date(now - 30 * MINUTE)
		});
		await seedShare({
			authorId: other.id,
			slug: 'daha-eski',
			title: 'Daha eski',
			createdAt: new Date(now - 40 * MINUTE)
		});
		const fresh1 = await seedShare({
			authorId: other.id,
			slug: 'yeni-1',
			title: 'Yeni 1',
			createdAt: new Date(now - 5 * MINUTE)
		});
		const fresh2 = await seedShare({
			authorId: other.id,
			slug: 'yeni-2',
			title: 'Yeni 2',
			createdAt: new Date(now - 4 * MINUTE)
		});
		const own = await seedShare({
			authorId: reader.id,
			slug: 'kendi',
			title: 'Kendi',
			createdAt: new Date(now - 3 * MINUTE)
		});

		await context.addInitScript((lastSeen) => {
			if (!sessionStorage.getItem('izgah-test-seeded')) {
				localStorage.setItem('izgah:lastSeen:feed', lastSeen);
				sessionStorage.setItem('izgah-test-seeded', '1');
			}
		}, seen.createdAt);
		await attachSessionCookie(context, reader.cookieValue);
		await page.goto('/');
		await expect(page.locator('html[data-hydrated]')).toHaveCount(1);

		await expect(page.locator(`#share-${fresh1.shareId} .unseen-pill`)).toHaveCount(1);
		await expect(page.locator(`#share-${fresh2.shareId} .unseen-pill`)).toHaveCount(1);
		await expect(page.locator(`#share-${own.shareId} .unseen-pill`)).toHaveCount(0);
		await expect(page.locator('.unseen-pill')).toHaveCount(2);

		const marker = page.locator('li.is-first-seen');
		await expect(marker).toHaveCount(1);
		await expect(marker.locator(`#share-${seen.shareId}`)).toHaveCount(1);
		await expect(marker.locator('.last-seen-label')).toContainText('Son ziyaretinden önceki');

		// Leaving the feed (client-side navigation) advances the marker to the newest post.
		await page
			.getByRole('navigation', { name: 'Ana gezinme' })
			.getByRole('link', { name: 'Tüm bölümler' })
			.click();
		await expect(page).toHaveURL(/\/sections$/);
		await expect
			.poll(() => page.evaluate(() => localStorage.getItem('izgah:lastSeen:feed')))
			.toBe(own.createdAt);
	});

	test('CUJ U3: the new-posts pill appears within 60 s and loads the new post', async ({
		page,
		context
	}) => {
		const reader = await seedUserWithSession({ name: 'Bekleyen', email: 'bekleyen@izgah.test' });
		const other = await seedUserWithSession({ name: 'Paylaşan', email: 'paylasan@izgah.test' });
		await seedShare({
			authorId: other.id,
			slug: 'mevcut',
			title: 'Mevcut',
			createdAt: new Date(Date.now() - 10 * MINUTE)
		});
		await attachSessionCookie(context, reader.cookieValue);
		await page.clock.install();
		await page.goto('/');
		await expect(page.locator('html[data-hydrated]')).toHaveCount(1);

		const incoming = await seedShare({
			authorId: other.id,
			slug: 'taze',
			title: 'Taze paylaşım',
			createdAt: new Date()
		});
		const pill = page.getByRole('button', { name: '1 yeni paylaşım' });
		await expect(pill).toHaveCount(0);
		await page.clock.fastForward(61_000);
		await expect(pill).toBeVisible();

		await pill.click();
		await expect(page.locator(`#share-${incoming.shareId}`)).toBeFocused();
		await expect(page.locator('article.share-card').first()).toHaveAttribute(
			'id',
			`share-${incoming.shareId}`
		);
		await expect(pill).toHaveCount(0);
	});
});
