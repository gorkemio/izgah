import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { makeSignature } from 'better-auth/crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import sharp from 'sharp';
import * as schema from '../../src/lib/server/db/schema';
import {
	canonicalResources,
	linkShareSections,
	linkShares,
	mediaAssets,
	sections,
	sessions,
	unfurlJobs,
	users,
	type ContentType,
	type UserRole
} from '../../src/lib/server/db/schema';
import { assertTestDatabaseUrl, migrateTestDb } from '../setup/db';

const AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? 'test-only-secret-key-at-least-32-chars!!';
const MEDIA_STORAGE_DIR = path.resolve(
	process.env.MEDIA_STORAGE_DIR ?? './.local-data/test-thumbnails'
);

const localDatabaseUrl = assertTestDatabaseUrl(process.env.TEST_DATABASE_URL);
const localSql = postgres(localDatabaseUrl, {
	max: 4,
	onnotice: () => {}
});
const localDb = drizzle(localSql, { schema });

async function resetLocalTestDb(): Promise<void> {
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

function sha256Hex(value: string | Buffer): string {
	return crypto.createHash('sha256').update(value).digest('hex');
}

async function seedUserWithSession(options: {
	name: string;
	email: string;
	role?: UserRole;
}): Promise<{ id: string; name: string; email: string; role: UserRole; cookieValue: string }> {
	const [user] = await localDb
		.insert(users)
		.values({
			name: options.name,
			email: options.email.toLowerCase(),
			emailVerified: true,
			role: options.role ?? 'member',
			isActive: true,
			authVersion: 1
		})
		.returning({
			id: users.id,
			name: users.name,
			email: users.email,
			role: users.role
		});

	const sessionToken = crypto.randomBytes(32).toString('base64url');
	await localDb.insert(sessions).values({
		token: sessionToken,
		userId: user.id,
		expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
		userAuthVersion: 1
	});

	const signature = await makeSignature(sessionToken, AUTH_SECRET);
	return {
		...user,
		cookieValue: `${sessionToken}.${signature}`
	};
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

async function seedSection(options: {
	slug: string;
	name: string;
	createdById: string;
	description?: string;
	sortOrder?: number;
}) {
	const [section] = await localDb
		.insert(sections)
		.values({
			slug: options.slug,
			name: options.name,
			description: options.description ?? null,
			sortOrder: options.sortOrder ?? 0,
			createdById: options.createdById
		})
		.returning();
	return section;
}

async function createMockWebpThumbnailOnDisk(label: string): Promise<{
	assetKey: string;
	width: number;
	height: number;
	byteSize: number;
}> {
	const width = 1200;
	const height = 630;
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
		<rect width="100%" height="100%" fill="#1e293b"/>
		<rect x="40" y="40" width="${width - 80}" height="${height - 80}" rx="24" fill="#2563eb"/>
		<text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#ffffff" font-size="48" font-family="sans-serif">${label}</text>
	</svg>`;

	const webpBuffer = await sharp(Buffer.from(svg, 'utf8')).webp({ quality: 80 }).toBuffer();
	const assetKey = sha256Hex(webpBuffer);
	const shardDir = path.join(MEDIA_STORAGE_DIR, assetKey.slice(0, 2));
	await fs.mkdir(shardDir, { recursive: true });
	await fs.writeFile(path.join(shardDir, `${assetKey}.webp`), webpBuffer);

	return {
		assetKey,
		width,
		height,
		byteSize: webpBuffer.byteLength
	};
}

async function simulateUnfurlReadyForUrl(canonicalUrl: string, title: string): Promise<string> {
	const asset = await createMockWebpThumbnailOnDisk('Izgah');

	await localDb
		.insert(mediaAssets)
		.values({
			assetKey: asset.assetKey,
			mimeType: 'image/webp',
			byteSize: asset.byteSize,
			width: asset.width,
			height: asset.height,
			refCount: 1
		})
		.onConflictDoNothing();

	const [updatedResource] = await localDb
		.update(canonicalResources)
		.set({
			unfurlStatus: 'ready',
			title,
			description: 'Otomatik çekilen zengin bağlantı açıklaması.',
			siteName: 'GitHub',
			thumbnailAssetKey: asset.assetKey,
			updatedAt: new Date()
		})
		.where(eq(canonicalResources.canonicalUrl, canonicalUrl))
		.returning({ id: canonicalResources.id });

	if (!updatedResource) {
		throw new Error(`Canonical resource not found for ${canonicalUrl}`);
	}

	await localDb
		.update(unfurlJobs)
		.set({
			status: 'completed',
			updatedAt: new Date()
		})
		.where(eq(unfurlJobs.resourceId, updatedResource.id));

	return updatedResource.id;
}

async function seedDirectShare(options: {
	authorId: string;
	canonicalUrl: string;
	domain: string;
	title: string;
	description?: string;
	contentType: ContentType;
	note?: string | null;
	sectionIds: string[];
}) {
	const [resource] = await localDb
		.insert(canonicalResources)
		.values({
			canonicalUrl: options.canonicalUrl,
			canonicalizerVersion: 1,
			domain: options.domain,
			contentType: options.contentType,
			contentTypeLocked: true,
			unfurlStatus: 'ready',
			title: options.title,
			description: options.description ?? null
		})
		.returning();

	const [share] = await localDb
		.insert(linkShares)
		.values({
			resourceId: resource.id,
			authorId: options.authorId,
			rawUrl: options.canonicalUrl,
			note: options.note ?? null,
			isFeedVisible: true,
			sourceChannel: 'web'
		})
		.returning();

	if (options.sectionIds.length > 0) {
		await localDb.insert(linkShareSections).values(
			options.sectionIds.map((sectionId) => ({
				shareId: share.id,
				sectionId
			}))
		);
	}

	return { resource, share };
}

async function gotoHydrated(page: Page, url: string): Promise<void> {
	await page.goto(url);
	// The app layout marks <html data-hydrated> once client code is running.
	await expect(page.locator('html[data-hydrated]')).toHaveCount(1);
	await expect(page.getByRole('button', { name: 'Link Paylaş' })).toBeVisible();
}

async function expectDialogOpenWithContain(page: Page, selector: string): Promise<void> {
	const dialog = page.locator(selector);
	await expect(dialog).toBeVisible();
	const result = await dialog.evaluate((el) => {
		const style = getComputedStyle(el);
		return {
			open: (el as HTMLDialogElement).open,
			overscrollBehavior: style.overscrollBehavior,
			hasRoleAttr: el.hasAttribute('role'),
			hasAriaModalAttr: el.hasAttribute('aria-modal')
		};
	});
	expect(result.open).toBe(true);
	expect(result.overscrollBehavior).toBe('contain');
	expect(result.hasRoleAttr).toBe(false);
	expect(result.hasAriaModalAttr).toBe(false);
}

test.describe('Milestone M6 — Discussion, Bilingual Search & Notifications', () => {
	test.beforeAll(async () => {
		await migrateTestDb();
	});

	test.beforeEach(async () => {
		await resetLocalTestDb();
		await fs.rm(MEDIA_STORAGE_DIR, { recursive: true, force: true });
		await fs.mkdir(MEDIA_STORAGE_DIR, { recursive: true });
	});

	test.afterAll(async () => {
		await localSql.end({ timeout: 5 });
	});

	test('CUJ 5: multi-user reshare, search deduplication, shared like, Enter comment, notification badge & mark-read', async ({
		browser,
		page,
		context
	}) => {
		const user1 = await seedUserWithSession({
			name: 'Alice Yılmaz',
			email: 'alice@izgah.test',
			role: 'admin'
		});
		const user2 = await seedUserWithSession({
			name: 'Bob Demir',
			email: 'bob@izgah.test',
			role: 'member'
		});
		const secEng = await seedSection({
			slug: 'muhendislik',
			name: 'Mühendislik',
			createdById: user1.id,
			sortOrder: 1
		});

		// User 1 shares link in browser context 1
		await attachSessionCookie(context, user1.cookieValue);
		await gotoHydrated(page, '/');
		await page.getByRole('button', { name: 'Link Paylaş' }).click();
		await expect(page.locator('#share-composer-inline input[name="url"]')).toBeFocused();
		await page
			.locator('#share-composer-inline input[name="url"]')
			.fill('https://github.com/sveltejs/kit?utm_source=x');
		await page.locator('#share-composer-inline textarea[name="note"]').fill('İlk paylaşım notu');
		await page.locator('#share-composer-inline').getByLabel(secEng.name).check();
		await page.locator('#share-composer-inline button[type="submit"]').click();
		await expect(page.locator('#share-composer-inline input[name="url"]')).toHaveValue('');
		await expect(page.locator('article.share-card')).toHaveCount(1);

		// User 2 opens a second isolated browser context and shares the same canonical URL with another tracker
		const context2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
		try {
			const page2 = await context2.newPage();
			await attachSessionCookie(context2, user2.cookieValue);
			await gotoHydrated(page2, '/');

			await page2.getByRole('button', { name: 'Link Paylaş' }).click();
			await expect(page2.locator('#share-composer-inline input[name="url"]')).toBeFocused();
			await page2
				.locator('#share-composer-inline input[name="url"]')
				.fill('https://github.com/sveltejs/kit?fbclid=feed456');
			await page2.locator('#share-composer-inline textarea[name="note"]').fill('Ben de öneriyorum');
			await page2.locator('#share-composer-inline').getByLabel(secEng.name).check();
			await page2.locator('#share-composer-inline button[type="submit"]').click();
			await expect(page2.locator('#share-composer-inline input[name="url"]')).toHaveValue('');

			const resourceId = await simulateUnfurlReadyForUrl(
				'https://github.com/sveltejs/kit',
				'SvelteKit — Web development, streamlined'
			);

			// User 2 searches for "sveltejs/kit" via header <search>
			const headerSearch = page2.getByRole('search', { name: 'Site içi arama' });
			await headerSearch.getByLabel('İzgah içinde ara').fill('sveltejs/kit');
			await headerSearch.getByRole('button', { name: 'Ara' }).click();
			await page2.waitForURL('**/search?**');

			await expect(page2.getByRole('heading', { level: 1, name: 'Arama' })).toBeVisible();
			// Deduplicated per canonical_resources.id
			const searchCards = page2.locator('article.share-card');
			await expect(searchCards).toHaveCount(1);

			// User 2 likes on the search card
			const searchLikeBtn = searchCards.first().locator('button[aria-pressed]');
			await expect(searchLikeBtn).toHaveAttribute('aria-pressed', 'false');
			await searchLikeBtn.click();
			await expect(searchLikeBtn).toHaveAttribute('aria-pressed', 'true');
			await expect(searchLikeBtn).toContainText('1 beğeni');

			// Navigate to canonical discussion page
			await searchCards.first().locator('a.card-discussion-link').click();
			// The comments link targets #comments (izgah-ui-v2 §7).
			await expect(page2).toHaveURL(new RegExp(`/resources/${resourceId}#comments$`));

			await expect(
				page2.getByRole('heading', { level: 1, name: /sveltekit|sveltejs\/kit/i })
			).toBeVisible();
			await expect(
				page2.getByRole('heading', { level: 2, name: 'Paylaşım Geçmişi' })
			).toBeVisible();
			await expect(
				page2.locator('section[aria-labelledby="resource-shares-heading"] .card-count')
			).toHaveText('2');

			// Add flat comment via Enter (ime-safe-enter-submit)
			const commentBox = page2.locator('#resource-new-comment-body');
			await commentBox.fill('Projede hemen kullanabiliriz.');
			await commentBox.press('Enter');

			await expect(page2.getByRole('heading', { level: 2, name: 'Yorumlar (1)' })).toBeVisible();
			await expect(page2.locator('.comment-list')).toContainText('Projede hemen kullanabiliriz.');

			// Return to / and verify BOTH share cards reflect shared 1 like + 1 comment
			await page2.getByRole('link', { name: 'Akışa dön' }).click();
			await page2.waitForURL('**/');
			const feedCards2 = page2.locator('article.share-card');
			await expect(feedCards2).toHaveCount(2);
			for (let i = 0; i < 2; i++) {
				await expect(feedCards2.nth(i).locator('button[aria-pressed]')).toContainText('1 beğeni');
				await expect(feedCards2.nth(i).locator('a.card-discussion-link')).toContainText('1 yorum');
			}
		} finally {
			await context2.close();
		}

		// User 1 checks NotificationBell badge & popover
		await page.reload();
		await expect(page.getByRole('button', { name: 'Link Paylaş' })).toBeVisible();

		const badge = page.locator('.notification-badge');
		await expect(badge).toBeVisible();
		await expect(badge).toHaveText('3');

		await page.getByRole('button', { name: /Bildirimler/ }).click();
		const popover = page.locator('#notification-bell-popover');
		await expect(popover).toBeVisible();
		await expect(popover).toContainText(
			'Bob Demir daha önce paylaştığın bağlantıyı yeniden paylaştı'
		);
		await expect(popover).toContainText('Bob Demir paylaştığın bağlantıyı beğendi');
		await expect(popover).toContainText('Bob Demir takip ettiğin kaynağa yorum yaptı');

		// Clicking comment notification marks it read and navigates to /resources/[id]
		await popover
			.getByRole('link', { name: /Bob Demir takip ettiğin kaynağa yorum yaptı/ })
			.click();
		await page.waitForURL('**/resources/**');
		// The resource route animates in with a view transition; until it finishes, <html>
		// intercepts pointer events and Playwright's click retries scroll the page, which closes
		// the freshly opened popover. The layout focuses the title once the transition is done.
		await expect(page.locator('#main-content h1')).toBeFocused();
		await expect(page.locator('.notification-badge')).toHaveText('2');

		// Mark all remaining notifications read
		await page.getByRole('button', { name: /Bildirimler/ }).click();
		await expect(popover).toBeVisible();
		await popover.getByRole('button', { name: 'Tümünü okundu işaretle' }).click();
		await expect(page.locator('.notification-badge')).toHaveCount(0);
		await expect(popover).toContainText('Okunmamış bildiriminiz yok.');
	});

	test('comment box honors IME composition safety, validate-input-after-interaction, accessible errors, inline edit & <dialog> delete', async ({
		page,
		context
	}) => {
		const author = await seedUserWithSession({
			name: 'Zeynep Kaya',
			email: 'zeynep@izgah.test',
			role: 'member'
		});
		const sec = await seedSection({
			slug: 'genel',
			name: 'Genel',
			createdById: author.id,
			sortOrder: 1
		});
		const { resource } = await seedDirectShare({
			authorId: author.id,
			canonicalUrl: 'https://developer.mozilla.org/en-US/docs/Web/HTML/Element/dialog',
			domain: 'developer.mozilla.org',
			title: 'HTML dialog element guide',
			contentType: 'article',
			sectionIds: [sec.id]
		});

		await attachSessionCookie(context, author.cookieValue);
		await gotoHydrated(page, `/resources/${resource.id}`);

		const textarea = page.locator('#resource-new-comment-body');
		const errorText = page.locator('#resource-new-comment-error');

		// Initial accessible state: aria-invalid="false", only hint in aria-describedby, error hidden
		await expect(textarea).toHaveAttribute('aria-invalid', 'false');
		await expect(textarea).toHaveAttribute('aria-describedby', 'resource-new-comment-hint');
		await expect(errorText).toBeHidden();

		// Blur without interacting keeps field clean
		await textarea.focus();
		await page.getByRole('heading', { level: 1 }).focus();
		await expect(textarea).toHaveAttribute('aria-invalid', 'false');
		await expect(errorText).toBeHidden();

		// Submitting invalid empty comment moves focus to textarea, toggles aria-invalid, and announces error
		await page.getByRole('button', { name: 'Yorum Gönder' }).click();
		await expect(textarea).toBeFocused();
		await expect(textarea).toHaveAttribute('aria-invalid', 'true');
		await expect(textarea).toHaveAttribute(
			'aria-describedby',
			'resource-new-comment-hint resource-new-comment-error'
		);
		await expect(errorText).toBeVisible();
		await expect(errorText).toContainText('Lütfen bir yorum yazın.');

		// Typing non-empty text clears error immediately
		await textarea.fill('Taslak metin');
		await expect(textarea).toHaveAttribute('aria-invalid', 'false');
		await expect(textarea).toHaveAttribute('aria-describedby', 'resource-new-comment-hint');
		await expect(errorText).toBeHidden();

		// IME composition Enter (both isComposing: true and Safari keyCode: 229) MUST NOT submit
		await textarea.evaluate((el) => {
			const evComposing = new KeyboardEvent('keydown', {
				key: 'Enter',
				isComposing: true,
				bubbles: true,
				cancelable: true
			});
			el.dispatchEvent(evComposing);

			const evSafari229 = new KeyboardEvent('keydown', {
				key: 'Enter',
				isComposing: false,
				bubbles: true,
				cancelable: true
			});
			Object.defineProperty(evSafari229, 'keyCode', { get: () => 229 });
			el.dispatchEvent(evSafari229);
		});

		// Comment list should still be empty
		await expect(page.getByText('Henüz yorum yok. İlk yorumu siz yazın.')).toBeVisible();

		// Normal Enter submits
		await textarea.press('Enter');
		await expect(page.locator('.comment-list')).toContainText('Taslak metin');
		await expect(page.getByRole('heading', { level: 2, name: 'Yorumlar (1)' })).toBeVisible();

		// Inline edit comment
		await page.getByRole('button', { name: '1. yorumu düzenle' }).click();
		const editBox = page.locator('.comment-edit-form textarea[name="body"]');
		await expect(editBox).toBeVisible();
		await editBox.fill('Güncellenmiş net yorum');
		await page.locator('.comment-edit-form').getByRole('button', { name: 'Kaydet' }).click();

		await expect(page.locator('.comment-list')).toContainText('Güncellenmiş net yorum');
		await expect(page.locator('.comment-list')).toContainText('(düzenlendi)');

		// Delete confirmation <dialog> autofocuses Cancel ("Vazgeç") and cancels cleanly on Escape
		await page.getByRole('button', { name: /Zeynep Kaya yorumunu sil/ }).click();
		await expectDialogOpenWithContain(page, '#delete-comment-dialog');
		await expect(
			page.locator('#delete-comment-dialog').getByRole('button', { name: 'Vazgeç' })
		).toBeFocused();
		await page.keyboard.press('Escape');
		await expect(page.locator('#delete-comment-dialog')).toBeHidden();
		await expect(page.locator('.comment-list')).toContainText('Güncellenmiş net yorum');

		// Confirm delete removes comment and drops counter back to 0
		await page.getByRole('button', { name: /Zeynep Kaya yorumunu sil/ }).click();
		await expectDialogOpenWithContain(page, '#delete-comment-dialog');
		await page
			.locator('#delete-comment-dialog')
			.getByRole('button', { name: 'Yorumu Sil' })
			.click();
		await expect(page.locator('#delete-comment-dialog')).toBeHidden();
		await expect(page.getByRole('heading', { level: 2, name: 'Yorumlar (0)' })).toBeVisible();
		await expect(page.getByText('Henüz yorum yok. İlk yorumu siz yazın.')).toBeVisible();
	});

	test('"Bu Bölüm" scoped search from section page, "Tüm İzgah" toggle & content type filter', async ({
		page,
		context
	}) => {
		const admin = await seedUserWithSession({
			name: 'Admin',
			email: 'admin-search@izgah.test',
			role: 'admin'
		});
		const secEng = await seedSection({
			slug: 'muhendislik',
			name: 'Mühendislik',
			createdById: admin.id,
			sortOrder: 1
		});
		const secDesign = await seedSection({
			slug: 'tasarim',
			name: 'Tasarım',
			createdById: admin.id,
			sortOrder: 2
		});

		await seedDirectShare({
			authorId: admin.id,
			canonicalUrl: 'https://github.com/org/eng-perf',
			domain: 'github.com',
			title: 'Veritabanı performans rehberi',
			contentType: 'repo',
			sectionIds: [secEng.id]
		});
		await seedDirectShare({
			authorId: admin.id,
			canonicalUrl: 'https://design.example/ui-performans',
			domain: 'design.example',
			title: 'Arayüz performans kılavuzu',
			contentType: 'article',
			sectionIds: [secDesign.id]
		});

		await attachSessionCookie(context, admin.cookieValue);
		await gotoHydrated(page, '/sections/muhendislik');

		const headerSearch = page.getByRole('search', { name: 'Site içi arama' });
		const scopeCheckbox = headerSearch.getByLabel('Bu Bölüm');
		await expect(scopeCheckbox).toBeVisible();
		await scopeCheckbox.check();
		await headerSearch.getByLabel('İzgah içinde ara').fill('performans');
		await headerSearch.getByRole('button', { name: 'Ara' }).click();

		await page.waitForURL(`**/search?**section=${secEng.id}**`);
		await expect(page.locator('.search-summary')).toContainText('1 sonuç bulundu');
		await expect(page.locator('.search-summary')).toContainText('Mühendislik bölümü');
		await expect(page.locator('article.share-card')).toHaveCount(1);
		await expect(page.locator('article.share-card')).toContainText('Veritabanı performans rehberi');

		// Switch radio on /search to "Tüm İzgah" and re-submit
		const searchForm = page.locator('main search .search-form');
		await searchForm.getByLabel('Tüm İzgah').check();
		await searchForm.getByRole('button', { name: 'Ara' }).click();

		await expect(page.locator('.search-summary')).toContainText('2 sonuç bulundu');
		await expect(page.locator('.search-summary')).toContainText('Tüm İzgah');
		await expect(page.locator('article.share-card')).toHaveCount(2);

		// Filter by content type "Repo"
		await page
			.getByRole('navigation', { name: 'İçerik türü süzgeci' })
			.getByRole('link', { name: 'Repo' })
			.click();
		await page.waitForURL('**/search?**type=repo**');
		await expect(page.locator('article.share-card')).toHaveCount(1);
		await expect(page.locator('article.share-card')).toContainText('Veritabanı performans rehberi');
	});

	test('notification polling runs at most every 60s on visible tab, 0 times while hidden, and respects 15s visibilitychange throttle + responsive viewports', async ({
		page,
		context
	}) => {
		const user = await seedUserWithSession({
			name: 'Kemal Polat',
			email: 'kemal@izgah.test',
			role: 'member'
		});
		const sec = await seedSection({
			slug: 'genel',
			name: 'Genel',
			createdById: user.id,
			sortOrder: 1
		});
		const { resource } = await seedDirectShare({
			authorId: user.id,
			canonicalUrl: 'https://example.org/polling-check',
			domain: 'example.org',
			title: 'Polling Doğrulama Kaynağı',
			contentType: 'web',
			sectionIds: [sec.id]
		});

		await attachSessionCookie(context, user.cookieValue);

		let notifPollCount = 0;
		page.on('request', (req) => {
			if (req.method() === 'GET' && new URL(req.url()).pathname === '/api/internal/notifications') {
				notifPollCount += 1;
			}
		});

		await page.clock.install({ time: Date.now() });
		await page.setViewportSize({ width: 1280, height: 800 });
		await gotoHydrated(page, '/');

		// 1 initial request on visible load
		await expect.poll(() => notifPollCount).toBe(1);

		// 1280px: the full rail with the site search is visible (no measuring logic any more).
		await expect(page.getByRole('search', { name: 'Site içi arama' })).toBeVisible();

		// 58s elapsed -> still 1 request
		await page.clock.runFor(58_000);
		expect(notifPollCount).toBe(1);

		// Reaching >= 60s -> fires poll #2
		await page.clock.runFor(3_000);
		await expect.poll(() => notifPollCount).toBe(2);

		// Switch tab to hidden and advance 3 minutes -> ZERO background requests
		await page.evaluate(() => {
			Object.defineProperty(document, 'visibilityState', {
				configurable: true,
				get: () => 'hidden'
			});
			document.dispatchEvent(new Event('visibilitychange'));
		});
		await page.clock.runFor(180_000);
		expect(notifPollCount).toBe(2);

		// Restore tab to visible after >= 15s -> triggers immediate refresh (#3)
		await page.evaluate(() => {
			Object.defineProperty(document, 'visibilityState', {
				configurable: true,
				get: () => 'visible'
			});
			document.dispatchEvent(new Event('visibilitychange'));
		});
		await expect.poll(() => notifPollCount).toBe(3);

		// Hide and restore within < 15s (5s) -> throttled, does NOT fire an immediate extra request
		await page.evaluate(() => {
			Object.defineProperty(document, 'visibilityState', {
				configurable: true,
				get: () => 'hidden'
			});
			document.dispatchEvent(new Event('visibilitychange'));
		});
		await page.clock.runFor(5_000);
		await page.evaluate(() => {
			Object.defineProperty(document, 'visibilityState', {
				configurable: true,
				get: () => 'visible'
			});
			document.dispatchEvent(new Event('visibilitychange'));
		});
		await page.clock.runFor(1_000);
		expect(notifPollCount).toBe(3);

		// 360px mobile overflow checks across /, /search, and /resources/[id]
		await page.setViewportSize({ width: 360, height: 740 });
		for (const targetUrl of ['/', '/search?q=polling', `/resources/${resource.id}`]) {
			await gotoHydrated(page, targetUrl);
			const overflow = await page.evaluate(() => ({
				scrollWidth: document.documentElement.scrollWidth,
				innerWidth: window.innerWidth
			}));
			expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth);
		}
	});
});
