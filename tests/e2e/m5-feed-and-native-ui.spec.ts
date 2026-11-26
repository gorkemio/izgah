import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { makeSignature } from 'better-auth/crypto';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import {
	canonicalResources,
	inviteTokens,
	linkShares,
	linkShareSections,
	mediaAssets,
	sections,
	sessions,
	unfurlJobs,
	users,
	type ContentType,
	type UserRole
} from '../../src/lib/server/db/schema';
import { closeTestDb, migrateTestDb, resetTestDb, testDb } from '../setup/db';

const AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? 'test-only-secret-key-at-least-32-chars!!';
const MEDIA_STORAGE_DIR = path.resolve(
	process.env.MEDIA_STORAGE_DIR ?? './.local-data/test-thumbnails'
);

function sha256Hex(value: string | Buffer): string {
	return crypto.createHash('sha256').update(value).digest('hex');
}

async function seedUserWithSession(options: {
	name: string;
	email: string;
	role?: UserRole;
}): Promise<{ id: string; name: string; email: string; role: UserRole; cookieValue: string }> {
	const [user] = await testDb
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
	await testDb.insert(sessions).values({
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
	const [section] = await testDb
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

async function simulateUnfurlReadyForUrl(canonicalUrl: string, title: string): Promise<void> {
	const asset = await createMockWebpThumbnailOnDisk('Izgah');

	await testDb
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

	const [updatedResource] = await testDb
		.update(canonicalResources)
		.set({
			unfurlStatus: 'ready',
			title,
			description: 'Otomatik çekilen zengin bağlantı açıklaması.',
			siteName: 'Örnek Yayın',
			thumbnailAssetKey: asset.assetKey,
			updatedAt: new Date()
		})
		.where(eq(canonicalResources.canonicalUrl, canonicalUrl))
		.returning({ id: canonicalResources.id });

	if (updatedResource) {
		await testDb
			.update(unfurlJobs)
			.set({
				status: 'completed',
				updatedAt: new Date()
			})
			.where(eq(unfurlJobs.resourceId, updatedResource.id));
	}
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

test.describe('Milestone M5 — Web Feed, Sections & Native Platform UI', () => {
	test.beforeAll(async () => {
		await migrateTestDb();
	});

	test.beforeEach(async () => {
		await resetTestDb();
		await fs.rm(MEDIA_STORAGE_DIR, { recursive: true, force: true });
		await fs.mkdir(MEDIA_STORAGE_DIR, { recursive: true });
	});

	test.afterAll(async () => {
		await closeTestDb();
	});

	test('CUJ 1: invite acceptance, personal API key creation, and revoke dialog Esc/autofocus', async ({
		page
	}) => {
		const [invitedUser] = await testDb
			.insert(users)
			.values({
				name: 'Davetli Üye',
				email: 'davetli@izgah.test',
				emailVerified: false,
				role: 'member',
				isActive: true,
				authVersion: 1
			})
			.returning();

		const rawToken = crypto.randomBytes(32).toString('base64url');
		await testDb.insert(inviteTokens).values({
			tokenHash: sha256Hex(rawToken),
			userId: invitedUser.id,
			purpose: 'invite',
			createdById: null,
			expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
		});

		await page.goto(`/auth/accept-invite?token=${encodeURIComponent(rawToken)}`);
		await expect(page.getByRole('heading', { name: 'İzgah Davetini Kabul Et' })).toBeVisible();

		await page.getByLabel('Ad Soyad').fill('Zeynep Kaya');
		await page.getByLabel('Yeni Parola').fill('CokGucluParola123!');
		await page.getByRole('button', { name: 'Daveti Kabul Et ve Giriş Yap' }).click();

		await page.waitForURL('**/');
		await expect(page.getByRole('heading', { name: 'Ana Akış' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Link Paylaş' })).toBeVisible();

		// Settings live in the rail's account menu (izgah-ui-v2 §6).
		await page.getByRole('button', { name: 'Hesap menüsü' }).click();
		await page.getByRole('link', { name: 'Ayarlar', exact: true }).click();
		await page.waitForURL('**/settings');
		await page.getByRole('link', { name: 'API Anahtarları' }).click();
		await page.waitForURL('**/settings/api-keys');
		await expect(page.getByRole('button', { name: 'Link Paylaş' })).toBeVisible();

		await expect(page.getByRole('heading', { name: 'Kişisel API Anahtarları' })).toBeVisible();

		await page.getByLabel('Anahtar Adı').fill('Masaüstü Firefox Eklentisi');
		await page.getByRole('button', { name: 'Yeni API Anahtarı Üret' }).click();

		await expect(page.getByText('Yeni API Anahtarınız Oluşturuldu:')).toBeVisible();
		const createdRawKey = await page.locator('#new-api-key-value').textContent();
		expect(createdRawKey?.trim()).toMatch(/^izk_/);

		// Cancel revoke with Esc and confirm safe "Vazgeç" autofocus
		await page.getByRole('button', { name: 'İptal Et' }).first().click();
		const revokeDialog = page.getByRole('dialog', { name: 'API Anahtarını İptal Et' });
		await expect(revokeDialog).toBeVisible();
		await expect(revokeDialog.getByRole('button', { name: 'Vazgeç' })).toBeFocused();

		await page.keyboard.press('Escape');
		await expect(revokeDialog).toBeHidden();
		await expect(
			page.locator('.key-list').getByText('Masaüstü Firefox Eklentisi', { exact: true })
		).toBeVisible();

		// Confirm revoke
		await page.getByRole('button', { name: 'İptal Et' }).first().click();
		await expect(revokeDialog).toBeVisible();
		await revokeDialog.getByRole('button', { name: 'Anahtarı İptal Et' }).click();

		await expect(revokeDialog).toBeHidden();
		await expect(page.getByText('Seçilen API anahtarı iptal edildi.')).toBeVisible();
	});

	test('CUJ 2: WhatsApp extraction, live fallback-to-thumbnail card upgrade, @container/:has(), 360px layout, and duplicate check', async ({
		page,
		context
	}) => {
		await page.setViewportSize({ width: 1280, height: 800 });

		const member = await seedUserWithSession({
			name: 'Ayşe Demir',
			email: 'ayse@izgah.test',
			role: 'member'
		});
		const admin = await seedUserWithSession({
			name: 'Yönetici',
			email: 'admin@izgah.test',
			role: 'admin'
		});
		const section = await seedSection({
			slug: 'tasarim',
			name: 'Tasarım',
			createdById: admin.id
		});

		// Unauthenticated internal check returns 401
		const unauthCheck = await page.request.get(
			'/api/internal/links/check?url=https://ornek.dev/test'
		);
		expect(unauthCheck.status()).toBe(401);

		await attachSessionCookie(context, member.cookieValue);
		await gotoHydrated(page, '/');

		await page.getByRole('button', { name: 'Link Paylaş' }).click();
		await expect(page.locator('#share-composer-inline input[name="url"]')).toBeFocused();

		const urlField = page.locator('#share-composer-inline input[name="url"]');
		const noteField = page.locator('#share-composer-inline textarea[name="note"]');

		await urlField.fill('Bunu mutlaka okuyun https://ornek.dev/makale?utm_source=whatsapp');
		await expect(urlField).toHaveValue('https://ornek.dev/makale?utm_source=whatsapp');
		await expect(noteField).toHaveValue('Bunu mutlaka okuyun');

		await page.locator('#share-composer-inline').getByLabel(section.name).check();
		await page.locator('#share-composer-inline button[type="submit"]').click();

		await expect(page.locator('#share-composer-inline input[name="url"]')).toHaveValue('');

		const card = page.locator('article.share-card').first();
		await expect(card).toBeVisible();
		await expect(card.getByText('Önizleme hazırlanıyor')).toBeVisible();
		await expect(card.locator('.link-attachment img.card-thumbnail')).toHaveCount(0);

		// The thumbnail column now lives in the link attachment (izgah-ui-v2 §7).
		const attachment = card.locator('.link-attachment');
		const fallbackCols = await attachment.evaluate(
			(el) => getComputedStyle(el).gridTemplateColumns.split(/\s+/).length
		);
		expect(fallbackCols).toBe(1);

		// Simulate background unfurl worker completing and wait for 3s visibility-aware invalidate('app:feed') poll
		await simulateUnfurlReadyForUrl('https://ornek.dev/makale', 'Modern Web Tasarım İlkeleri');

		const cardThumb = card.locator('.link-attachment img.card-thumbnail');
		await expect(cardThumb).toBeVisible({ timeout: 10_000 });
		await expect(card.getByRole('heading', { name: 'Modern Web Tasarım İlkeleri' })).toBeVisible();
		await expect(card.getByText('Önizleme hazırlanıyor')).toHaveCount(0);

		await expect
			.poll(() =>
				cardThumb.evaluate((img) => (img instanceof HTMLImageElement ? img.naturalWidth : 0))
			)
			.toBeGreaterThan(0);

		const wideColumns = await attachment.evaluate(
			(el) => getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).length
		);
		expect(wideColumns).toBe(2);

		// The share trigger focuses the inline form again; typing runs the debounced duplicate check.
		await page.getByRole('button', { name: 'Link Paylaş' }).click();
		await expect(urlField).toBeFocused();
		await urlField.fill('https://ornek.dev/makale?fbclid=ignored');
		await expect(page.getByText('Bu bağlantı daha önce paylaşıldı')).toBeVisible({
			timeout: 5_000
		});
		await expect(page.getByText('İlk paylaşan: Ayşe Demir')).toBeVisible();
		await urlField.fill('');
		await expect(page.getByText('Bu bağlantı daha önce paylaşıldı')).toHaveCount(0);
		// The mobile tab bar hides while a text field has focus; leave the composer first.
		await urlField.blur();

		// 360px mobile layout: the thumbnail stays small on the right (izgah-ui-v4 §3), no overflow
		await page.setViewportSize({ width: 360, height: 740 });
		await expect
			.poll(() =>
				attachment.evaluate((el) => getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/))
			)
			.toEqual([expect.any(String), '88px']);

		const overflow = await page.evaluate(() => ({
			scrollWidth: document.documentElement.scrollWidth,
			innerWidth: window.innerWidth
		}));
		expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth);

		// Below 768px the bottom tab bar is the only "Ana gezinme"; sections are reached via /sections.
		const mobileNav = page.getByRole('navigation', { name: 'Ana gezinme' });
		await expect(mobileNav).toHaveCount(1);
		await mobileNav.getByRole('link', { name: 'Bölümler' }).click();
		await page.waitForURL('**/sections');
		await page.getByRole('link', { name: 'Tasarım' }).click();
		await page.waitForURL('**/sections/tasarim');
		await expect(
			page.getByRole('heading', { level: 1, name: 'Tasarım', exact: true })
		).toBeVisible();
	});

	test('CUJ 4: silent resource creation requires section, hides from /, promotes on member reshare, and marks original deleted', async ({
		page,
		context
	}) => {
		const admin = await seedUserWithSession({
			name: 'Admin Kullanıcı',
			email: 'admin-cuj4@izgah.test',
			role: 'admin'
		});
		const member = await seedUserWithSession({
			name: 'Elif Yılmaz',
			email: 'elif@izgah.test',
			role: 'member'
		});
		const archSection = await seedSection({
			slug: 'mimari',
			name: 'Mimari',
			createdById: admin.id
		});

		await attachSessionCookie(context, admin.cookieValue);
		await gotoHydrated(page, '/');

		await page.getByRole('button', { name: 'Link Paylaş' }).click();
		await page
			.locator('#share-composer-inline input[name="url"]')
			.fill('https://ornek.dev/gizli-kilavuz');
		await page.locator('#share-composer-inline input[name="silentMode"]').check();
		await page.locator('#share-composer-inline button[type="submit"]').click();
		await expect(page.locator('#share-composer-inline [role="alert"]')).toContainText(
			'Sessiz kaynak için en az bir bölüm seçmelisiniz.'
		);

		await page.locator('#share-composer-inline').getByLabel(archSection.name).check();
		await page.locator('#share-composer-inline button[type="submit"]').click();
		await expect(page.locator('#share-composer-inline input[name="url"]')).toHaveValue('');

		// Silent resource must NOT appear in main feed /
		await expect(page.locator('article.share-card')).toHaveCount(0);

		// Appears on section page with the "sessiz" mark in its künye line
		await gotoHydrated(page, '/sections/mimari');
		const silentCard = page.locator('article.share-card').first();
		await expect(silentCard).toBeVisible();
		await expect(silentCard.locator('.badge-silent', { hasText: /^\W*sessiz\W*$/ })).toBeVisible();

		// Switch to member: share same URL visibly -> appears on main feed with first-share notice
		await attachSessionCookie(context, member.cookieValue);
		await gotoHydrated(page, '/');
		await page.getByRole('button', { name: 'Link Paylaş' }).click();
		await page
			.locator('#share-composer-inline input[name="url"]')
			.fill('https://ornek.dev/gizli-kilavuz');
		await page.locator('#share-composer-inline textarea[name="note"]').fill('Üye tavsiyesi');
		await page.locator('#share-composer-inline button[type="submit"]').click();
		await expect(page.locator('#share-composer-inline input[name="url"]')).toHaveValue('');

		const promotedCard = page.locator('article.share-card').first();
		await expect(promotedCard).toBeVisible();
		await expect(promotedCard.getByText('ilk: Admin Kullanıcı')).toBeVisible();

		// Admin soft-deletes the original share -> remaining card shows "Orijinal gönderi silindi"
		await attachSessionCookie(context, admin.cookieValue);
		await gotoHydrated(page, '/sections/mimari');
		const adminOriginalCard = page
			.locator('article.share-card')
			.filter({ has: page.locator('.badge-silent') });
		await adminOriginalCard.getByRole('button', { name: 'Paylaşım işlemleri' }).click();
		await adminOriginalCard.locator('..').getByRole('button', { name: 'Sil' }).click();
		const deleteDialog = page.locator('dialog[open]');
		await expect(deleteDialog.getByRole('button', { name: 'Vazgeç' })).toBeFocused();
		await deleteDialog.getByRole('button', { name: 'Paylaşımı Sil' }).click();
		await expect(deleteDialog).toBeHidden();

		await gotoHydrated(page, '/');
		await expect(
			page.locator('article.share-card').first().getByText('Orijinal gönderi silindi')
		).toBeVisible();
	});

	test('Native <dialog> dirty guard & Esc behavior + [popover="auto"] keyboard and scroll dismissal', async ({
		page,
		context
	}) => {
		const member = await seedUserWithSession({
			name: 'Mehmet Öztürk',
			email: 'mehmet@izgah.test',
			role: 'member'
		});
		await seedSection({
			slug: 'genel',
			name: 'Genel',
			createdById: member.id
		});

		const [res] = await testDb
			.insert(canonicalResources)
			.values({
				canonicalUrl: 'https://ornek.dev/test-kart',
				domain: 'ornek.dev',
				contentType: 'web',
				unfurlStatus: 'ready',
				title: 'Popover ve Dialog Test Kartı'
			})
			.returning();

		// Seed 12 shares so page is scrollable to test scroll-dismiss on popover
		const now = Date.now();
		for (let i = 0; i < 12; i += 1) {
			await testDb.insert(linkShares).values({
				resourceId: res.id,
				authorId: member.id,
				rawUrl: `https://ornek.dev/test-kart?i=${i}`,
				note: `Not ${i}`,
				isFeedVisible: true,
				sourceChannel: 'web',
				createdAt: new Date(now - i * 1000)
			});
		}

		await attachSessionCookie(context, member.cookieValue);
		await gotoHydrated(page, '/');

		// With the inline form scrolled out of view, the share trigger opens the dialog (Karar 1).
		await page.evaluate(() => window.scrollTo(0, 600));
		await expect
			.poll(() =>
				page
					.locator('#share-composer-inline')
					.evaluate((el) => el.getBoundingClientRect().bottom < 0)
			)
			.toBe(true);

		// Clean composer dialog closes directly on Esc and resets returnValue
		await page.getByRole('button', { name: 'Link Paylaş' }).click();
		const composerDialog = page.locator('#share-composer-dialog');
		await expectDialogOpenWithContain(page, '#share-composer-dialog');
		await page.keyboard.press('Escape');
		await expect(composerDialog).toBeHidden();

		const cleanReturnVal = await composerDialog.evaluate(
			(el) => (el as HTMLDialogElement).returnValue
		);
		expect(cleanReturnVal).toBe('');

		// Dirty composer intercepts Esc with reserved-space confirmation (no button jump)
		await page.getByRole('button', { name: 'Link Paylaş' }).click();
		await composerDialog.locator('input[name="url"]').fill('https://ornek.dev/taslak');
		await page.keyboard.press('Escape');

		await expect(composerDialog).toBeVisible();
		const discardBtn = composerDialog.getByRole('button', { name: 'Değişiklikleri sil ve kapat' });
		const continueBtn = composerDialog.getByRole('button', { name: 'Düzenlemeye devam et' });
		await expect(continueBtn).toBeVisible();
		await expect(continueBtn).toBeFocused();
		await expect(discardBtn).toBeVisible();

		await continueBtn.click();
		await expect(composerDialog).toBeVisible();
		await expect(discardBtn).toBeHidden();

		await composerDialog.getByRole('button', { name: 'Vazgeç' }).click();
		await expect(discardBtn).toBeVisible();
		await discardBtn.click();
		await expect(composerDialog).toBeHidden();
		// Let the scroll back to the top settle so its scroll event cannot dismiss the next popover.
		await page.evaluate(
			() =>
				new Promise<void>((resolve) => {
					window.scrollTo(0, 0);
					requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
				})
		);
		await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
		await page.waitForTimeout(200);

		// PopoverPanel attribute check (no role="menu" / aria-haspopup), keyboard toggle & scroll dismiss
		const firstTrigger = page.locator('article.share-card').first().getByRole('button', {
			name: 'Paylaşım işlemleri'
		});
		const attrs = await firstTrigger.evaluate((btn) => ({
			hasPopup: btn.hasAttribute('aria-haspopup'),
			popoverTarget: btn.getAttribute('popovertarget')
		}));
		expect(attrs.hasPopup).toBe(false);
		expect(attrs.popoverTarget).toBeTruthy();

		await firstTrigger.focus();
		await page.keyboard.press('Enter');

		const panel = page.locator(`#${attrs.popoverTarget}`);
		await expect(panel).toBeVisible();

		const panelCheck = await panel.evaluate((el) => {
			const rect = el.getBoundingClientRect();
			return {
				role: el.getAttribute('role'),
				menuitemCount: el.querySelectorAll('[role="menuitem"]').length,
				withinViewport:
					rect.left >= 0 &&
					rect.top >= 0 &&
					rect.right <= window.innerWidth &&
					rect.bottom <= window.innerHeight
			};
		});
		expect(panelCheck.role).toBeNull();
		expect(panelCheck.menuitemCount).toBe(0);
		expect(panelCheck.withinViewport).toBe(true);

		// Scrolling window dismisses popover
		await page.evaluate(() => window.scrollBy(0, 150));
		await expect(panel).toBeHidden();

		// Open again and dismiss with Esc
		await page.evaluate(
			() =>
				new Promise<void>((resolve) => {
					window.scrollTo(0, 0);
					requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
				})
		);
		await firstTrigger.focus();
		await page.keyboard.press('Space');
		await expect(panel).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(panel).toBeHidden();
	});

	test('Cursor pagination (Load More), content type filter, and pathname-only focus transfer', async ({
		page,
		context
	}) => {
		const member = await seedUserWithSession({
			name: 'Canan Aydın',
			email: 'canan@izgah.test',
			role: 'member'
		});
		const section = await seedSection({
			slug: 'video-arsivi',
			name: 'Video Arşivi',
			createdById: member.id
		});

		const baseTime = Date.now();
		for (let i = 0; i < 27; i += 1) {
			const contentType: ContentType = i < 2 ? 'video' : 'web';
			const [res] = await testDb
				.insert(canonicalResources)
				.values({
					canonicalUrl: `https://ornek.dev/kaynak-${i}`,
					domain: 'ornek.dev',
					contentType,
					unfurlStatus: 'ready',
					title: `Kaynak ${String(i + 1).padStart(2, '0')}`
				})
				.returning();

			const [share] = await testDb
				.insert(linkShares)
				.values({
					resourceId: res.id,
					authorId: member.id,
					rawUrl: `https://ornek.dev/kaynak-${i}`,
					isFeedVisible: true,
					sourceChannel: 'web',
					createdAt: new Date(baseTime - i * 60_000)
				})
				.returning();

			await testDb.insert(linkShareSections).values({
				shareId: share.id,
				sectionId: section.id
			});
		}

		await attachSessionCookie(context, member.cookieValue);
		await gotoHydrated(page, '/');

		await expect(page.locator('article.share-card')).toHaveCount(25);
		const loadMoreLink = page.getByRole('link', { name: 'Daha fazla yükle' });
		await expect(loadMoreLink).toBeVisible();
		await loadMoreLink.scrollIntoViewIfNeeded();
		await page.evaluate(
			() =>
				new Promise<void>((resolve) => {
					requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
				})
		);
		await loadMoreLink.click();

		await expect(page.locator('article.share-card')).toHaveCount(27);
		await expect(loadMoreLink).toBeHidden();

		// Same-pathname query filter must NOT steal focus onto <h1>
		await page.locator('details.feed-filter > summary').click();
		const videoFilterLink = page
			.getByRole('navigation', { name: 'İçerik türü süzgeci' })
			.getByRole('link', { name: 'Video' });
		await videoFilterLink.focus();
		await videoFilterLink.click();
		await page.waitForURL('**/?type=video');
		await expect(page.locator('article.share-card')).toHaveCount(2);

		const mainHeading = page.locator('#main-content h1');
		await expect(mainHeading).not.toBeFocused();

		// Pathname transition (to section page) MUST move focus to #main-content h1[tabindex="-1"]
		await page
			.getByRole('navigation', { name: 'Ana gezinme' })
			.getByRole('link', { name: 'Video Arşivi' })
			.click();
		await page.waitForURL('**/sections/video-arsivi');
		await expect(page.locator('#main-content h1')).toBeFocused();
	});

	test('Full CRUD works with JavaScript disabled (progressive enhancement fallback)', async ({
		browser
	}) => {
		const member = await seedUserWithSession({
			name: 'NoJS Üyesi',
			email: 'nojs@izgah.test',
			role: 'member'
		});
		const section = await seedSection({
			slug: 'yazilim',
			name: 'Yazılım',
			createdById: member.id
		});

		const noJsContext = await browser.newContext({ javaScriptEnabled: false });
		await attachSessionCookie(noJsContext, member.cookieValue);
		const page = await noJsContext.newPage();

		try {
			await page.goto('/');
			// Without JS the rail's share trigger is a GET form button to /?compose=1 (izgah-ui-v2 §6).
			await page.getByRole('button', { name: 'Link Paylaş' }).click();
			await page.waitForURL('**/?compose=1');

			await page.locator('input[name="url"]').fill('https://ornek.dev/js-kapali');
			await page.locator('textarea[name="note"]').fill('JS olmadan ilk not');
			await page.getByLabel(section.name).check();
			await page.getByRole('button', { name: 'İz bırak', exact: true }).click();

			await page.waitForURL((url) => url.pathname === '/' && !url.searchParams.has('compose'));
			const card = page.locator('article.share-card').first();
			await expect(card.getByText('JS olmadan ilk not')).toBeVisible();

			// Native HTML [popover="auto"] overflow works even with JS off
			await card.getByRole('button', { name: 'Paylaşım işlemleri' }).click();
			await page.locator('a.card-menu-item', { hasText: 'Düzenle' }).click();
			await page.waitForURL((url) => url.searchParams.has('edit'));

			await page.locator('.inline-card-panel textarea[name="note"]').fill('JS olmadan güncel not');
			await page.getByRole('button', { name: 'Değişiklikleri Kaydet' }).click();

			await page.waitForURL((url) => url.pathname === '/' && !url.searchParams.has('edit'));
			await expect(
				page.locator('article.share-card').first().getByText('JS olmadan güncel not')
			).toBeVisible();

			// Delete without JS
			await page
				.locator('article.share-card')
				.first()
				.getByRole('button', { name: 'Paylaşım işlemleri' })
				.click();
			await page.locator('a.card-menu-item', { hasText: 'Sil' }).click();
			await page.waitForURL((url) => url.searchParams.has('delete'));

			await page
				.locator('.inline-card-panel')
				.getByRole('button', { name: 'Paylaşımı Sil' })
				.click();
			await page.waitForURL((url) => url.pathname === '/' && !url.searchParams.has('delete'));
			await expect(page.locator('article.share-card')).toHaveCount(0);
		} finally {
			await noJsContext.close();
		}
	});
});
