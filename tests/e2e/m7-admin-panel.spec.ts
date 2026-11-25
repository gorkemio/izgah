import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { makeSignature } from 'better-auth/crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../../src/lib/server/db/schema';
import {
	canonicalResources,
	linkShareSections,
	linkShares,
	sections,
	sessions,
	unfurlJobs,
	users,
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

async function gotoHydrated(page: Page, url: string): Promise<void> {
	await page.goto(url, { waitUntil: 'networkidle' });
	// The app layout marks <html data-hydrated> once client code is running.
	await expect(page.locator('html[data-hydrated]')).toHaveCount(1);
	await expect(page.getByRole('button', { name: 'Link Paylaş' })).toBeVisible();
}

async function expectDialogOpenWithContain(dialog: ReturnType<Page['locator']>): Promise<void> {
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

test.describe('Milestone M7 — Admin Panel, Audit Logs & SQL Metrics E2E', () => {
	test.beforeAll(async () => {
		await migrateTestDb();
	});

	test.beforeEach(async () => {
		await resetLocalTestDb();
		await fs.rm(MEDIA_STORAGE_DIR, { recursive: true, force: true });
		await fs.mkdir(MEDIA_STORAGE_DIR, { recursive: true });
	});

	test.afterAll(async () => {
		await localSql.end();
	});

	test('enforces member 403 and hides Yönetim nav, while admin runs full CUJ 6 user invite -> API key -> role change -> disable lifecycle', async ({
		browser,
		page,
		context
	}) => {
		await page.setViewportSize({ width: 1280, height: 800 });

		const admin = await seedUserWithSession({
			name: 'Sistem Yöneticisi',
			email: 'admin-e2e@izgah.test',
			role: 'admin'
		});
		const member = await seedUserWithSession({
			name: 'Standart Üye',
			email: 'member-e2e@izgah.test',
			role: 'member'
		});
		const [generalSection] = await localDb
			.insert(sections)
			.values({
				slug: 'genel',
				name: 'Genel',
				sortOrder: 0,
				createdById: admin.id
			})
			.returning();

		// Member does not see "Yönetim" link and receives 403 on /admin/*
		await attachSessionCookie(context, member.cookieValue);
		await gotoHydrated(page, '/');
		await expect(page.getByRole('link', { name: 'Yönetim', exact: true })).toHaveCount(0);

		const memberAdminResp = await page.request.get('/admin/users');
		expect(memberAdminResp.status()).toBe(403);

		// Admin sees "Yönetim" link in the navigation rail and opens /admin/users
		await attachSessionCookie(context, admin.cookieValue);
		await gotoHydrated(page, '/');
		const adminNavLink = page
			.getByRole('banner')
			.getByRole('link', { name: 'Yönetim', exact: true });
		await expect(adminNavLink).toBeVisible();
		await adminNavLink.click();

		await page.waitForURL('**/admin/users');
		await expect(page.getByRole('button', { name: 'Link Paylaş' })).toBeVisible();
		await expect(adminNavLink).toHaveAttribute('aria-current', 'page');
		await expect(page.getByRole('heading', { name: 'Üye Yönetimi' })).toBeVisible();

		// Invite new member via forms-compliant radio role controls
		await page.getByLabel('Ad Soyad').fill('Zeynep Taslak');
		await page.getByLabel('E-posta').fill('zeynep@izgah.test');
		await page.getByLabel('Üye', { exact: true }).check();
		await page.getByRole('button', { name: 'Davet Oluştur' }).click();

		const linkDialog = page
			.locator('dialog')
			.filter({ hasText: 'Tek Kullanımlık Davet Bağlantısı' });
		await expectDialogOpenWithContain(linkDialog);

		const inviteUrl = (await linkDialog.locator('#issued-link-value').inputValue()).trim();
		expect(inviteUrl).toContain('/auth/accept-invite?token=');

		// Click copy button (command="--copy") and assert opacity-based status bubble becomes visible
		await linkDialog.getByRole('button', { name: 'Bağlantıyı Kopyala' }).click();
		const copyBubble = linkDialog.locator('.copy-bubble');
		await expect(copyBubble).toHaveCSS('opacity', '1');
		await expect(copyBubble).toHaveText(/Kopyalandı|Elle kopyalayın/);

		await linkDialog
			.locator('.dialog-footer')
			.getByRole('button', { name: 'Kapat', exact: true })
			.click();
		await expect(linkDialog).toBeHidden();

		// Invited user accepts invite in an isolated browser context, creates an API key, and shares a link
		const invitedContext = await browser.newContext();
		const invitedPage = await invitedContext.newPage();
		try {
			await invitedPage.goto(inviteUrl, { waitUntil: 'networkidle' });
			await expect(
				invitedPage.getByRole('heading', { name: 'İzgah Davetini Kabul Et' })
			).toBeVisible();
			const inviteNameInput = invitedPage.getByLabel('Ad Soyad');
			await inviteNameInput.fill('Zeynep Kaya');
			await expect(inviteNameInput).toHaveValue('Zeynep Kaya');
			await invitedPage.getByLabel('Yeni Parola').fill('CokGucluParola123!');
			await invitedPage.getByRole('button', { name: 'Daveti Kabul Et ve Giriş Yap' }).click();
			await invitedPage.waitForURL('**/');
			await expect(invitedPage.getByRole('button', { name: 'Link Paylaş' })).toBeVisible();

			await invitedPage.goto('/settings/api-keys', { waitUntil: 'networkidle' });
			const apiKeyNameInput = invitedPage.getByLabel('Anahtar Adı');
			await apiKeyNameInput.fill('CUJ6 Eklenti');
			await expect(apiKeyNameInput).toHaveValue('CUJ6 Eklenti');
			await invitedPage.getByRole('button', { name: 'Yeni API Anahtarı Üret' }).click();
			await expect(invitedPage.locator('#new-api-key-value')).toBeVisible();
			const rawApiKey = (await invitedPage.locator('#new-api-key-value').textContent())!.trim();
			expect(rawApiKey).toMatch(/^izk_/);

			// Confirm API key works while user is active AND post a link that stays in the archive
			const meActiveResp = await invitedPage.request.get('/api/v1/me', {
				headers: { Authorization: `Bearer ${rawApiKey}` }
			});
			expect(meActiveResp.status()).toBe(200);

			const sharePostResp = await invitedPage.request.post('/api/v1/links', {
				headers: {
					Authorization: `Bearer ${rawApiKey}`,
					'Content-Type': 'application/json'
				},
				data: {
					url: 'https://arsiv.example/zeynep-baglantisi',
					note: 'Arşivde kalması gereken link',
					sectionIds: [generalSection.id]
				}
			});
			expect(sharePostResp.status()).toBe(201);

			// Admin reloads /admin/users, changes Zeynep's role member -> admin -> member
			await page.reload({ waitUntil: 'networkidle' });
			await expect(page.getByRole('button', { name: 'Link Paylaş' })).toBeVisible();

			const zeynepRow = page.locator('tbody tr').filter({ hasText: 'zeynep@izgah.test' });
			await expect(zeynepRow).toContainText('Zeynep Kaya');

			await zeynepRow.getByLabel('Zeynep Kaya için rol').selectOption('admin');
			await zeynepRow.getByRole('button', { name: /Rolü Kaydet \(Zeynep Kaya\)/ }).click();
			await expect(page.locator('.banner-success')).toContainText('Yönetici olarak güncellendi');

			// Test destructive disable confirmation <dialog> autofocus on "Vazgeç" and Esc cancel
			await zeynepRow.getByRole('button', { name: /Pasifleştir \(Zeynep Kaya\)/ }).click();
			const disableDialog = page.locator('dialog').filter({ hasText: 'Üyeyi Pasifleştir' });
			await expectDialogOpenWithContain(disableDialog);
			await expect(disableDialog.getByRole('button', { name: 'Vazgeç' })).toBeFocused();

			await page.keyboard.press('Escape');
			await expect(disableDialog).toBeHidden();
			await expect(zeynepRow).toContainText('Aktif');

			// Now confirm disable
			await zeynepRow.getByRole('button', { name: /Pasifleştir \(Zeynep Kaya\)/ }).click();
			await expectDialogOpenWithContain(disableDialog);
			await disableDialog.getByRole('button', { name: 'Evet, Pasifleştir' }).click();
			await expect(disableDialog).toBeHidden();
			await expect(zeynepRow).toContainText('Pasif');

			// Disabled user's API key and browser session immediately return 401
			const meDisabledResp = await invitedPage.request.get('/api/v1/me', {
				headers: { Authorization: `Bearer ${rawApiKey}` }
			});
			expect(meDisabledResp.status()).toBe(401);

			const webDisabledResp = await invitedPage.goto('/');
			expect(webDisabledResp?.status()).toBe(401);

			// Archive share remains visible for team
			await gotoHydrated(page, '/');
			await expect(page.getByText('Arşivde kalması gereken link', { exact: true })).toBeVisible();
		} finally {
			await invitedContext.close();
		}
	});

	test('manages sections with Turkish slug & dynamic-sort moveBefore/focus, resolves silent conflicts, assigns unassigned, retries dead jobs, and renders responsive audit/metrics', async ({
		page,
		context
	}) => {
		await page.setViewportSize({ width: 1280, height: 800 });

		const admin = await seedUserWithSession({
			name: 'Panel Yöneticisi',
			email: 'panel-admin@izgah.test',
			role: 'admin'
		});
		const [secKeep] = await localDb
			.insert(sections)
			.values({
				slug: 'tasarim',
				name: 'Tasarım',
				sortOrder: 0,
				createdById: admin.id
			})
			.returning();
		const [secToDelete] = await localDb
			.insert(sections)
			.values({
				slug: 'arsiv-adayi',
				name: 'Arşiv Adayı',
				sortOrder: 1,
				createdById: admin.id
			})
			.returning();

		// Seed exclusive silent share in secToDelete + one unassigned share + one dead unfurl job
		await localDb.transaction(async (tx) => {
			const [resSilent] = await tx
				.insert(canonicalResources)
				.values({
					canonicalUrl: 'https://sessiz.example/ozel-not',
					domain: 'sessiz.example',
					title: 'Sessiz Kaynak Örneği',
					unfurlStatus: 'ready'
				})
				.returning();
			const [silentShare] = await tx
				.insert(linkShares)
				.values({
					resourceId: resSilent.id,
					authorId: admin.id,
					rawUrl: resSilent.canonicalUrl,
					note: 'Yalnız Arşiv Adayı bölümünde sessiz',
					isFeedVisible: false,
					sourceChannel: 'web'
				})
				.returning();
			await tx
				.insert(linkShareSections)
				.values({ shareId: silentShare.id, sectionId: secToDelete.id });

			const [resUnassigned] = await tx
				.insert(canonicalResources)
				.values({
					canonicalUrl: 'https://bolumsuz.example/makale',
					domain: 'bolumsuz.example',
					title: 'Bölümsüz Makale',
					unfurlStatus: 'ready'
				})
				.returning();
			await tx.insert(linkShares).values({
				resourceId: resUnassigned.id,
				authorId: admin.id,
				rawUrl: resUnassigned.canonicalUrl,
				note: 'Bölüme atanması gereken paylaşım',
				isFeedVisible: true,
				sourceChannel: 'api'
			});

			const [resDead] = await tx
				.insert(canonicalResources)
				.values({
					canonicalUrl: 'https://hatali.example/sayfa',
					domain: 'hatali.example',
					title: 'Hatalı Önizleme',
					unfurlStatus: 'failed'
				})
				.returning();
			await tx.insert(unfurlJobs).values({
				resourceId: resDead.id,
				targetUrl: resDead.canonicalUrl,
				status: 'dead',
				attempts: 3,
				lastErrorCode: 'HTTP_503',
				lastErrorMessage: 'Service unavailable'
			});
		});

		await attachSessionCookie(context, admin.cookieValue);
		await gotoHydrated(page, '/admin/sections');
		await expect(page.getByRole('heading', { name: 'Bölüm Yönetimi' })).toBeVisible();

		// Create section with Turkish chars and verify auto-generated slug preview
		const createSectionPanel = page.getByRole('region', { name: 'Yeni Bölüm Ekle' });
		await createSectionPanel.getByLabel('Bölüm Adı').fill('Çekirdek Öğrenme');
		await expect(createSectionPanel.getByLabel('URL Kısa Adı (Slug)')).toHaveValue(
			'cekirdek-ogrenme'
		);
		await createSectionPanel.getByRole('button', { name: 'Bölüm Ekle' }).click();

		const createdRow = page.locator('tbody tr').filter({ hasText: '/cekirdek-ogrenme' });
		await expect(createdRow).toBeVisible();

		// Tag DOM node identity before reordering with dynamic-sort
		const createdSectionId = (await createdRow.getAttribute('data-section-id'))!;
		await page.evaluate((id) => {
			(window as unknown as { __trackedRow?: Element | null }).__trackedRow =
				document.querySelector(`tr[data-section-id="${id}"]`);
		}, createdSectionId);

		const moveUpBtn = createdRow.getByRole('button', { name: /Yukarı taşı \(Çekirdek Öğrenme\)/ });
		await moveUpBtn.focus();
		await moveUpBtn.click();

		// Verify moved row became middle row (index 1) while preserving exact DOM node & focus
		await expect(page.locator('tbody tr').nth(1)).toHaveAttribute(
			'data-section-id',
			createdSectionId
		);
		const reorderChecks = await page.evaluate((id) => {
			const current = document.querySelector(`tr[data-section-id="${id}"]`);
			const prev = (window as unknown as { __trackedRow?: Element | null }).__trackedRow;
			const activeRowId = document.activeElement?.closest('tr')?.getAttribute('data-section-id');
			return {
				sameDomNode: current === prev,
				focusedInsideMovedRow: activeRowId === id
			};
		}, createdSectionId);
		expect(reorderChecks.sameDomNode).toBe(true);
		expect(reorderChecks.focusedInsideMovedRow).toBe(true);

		// Order persists across reload
		await page.reload({ waitUntil: 'networkidle' });
		await expect(page.getByRole('button', { name: 'Link Paylaş' })).toBeVisible();
		await expect(page.locator('tbody tr').nth(1)).toHaveAttribute(
			'data-section-id',
			createdSectionId
		);

		// Section delete blocked by exclusive silent share until resolved inside dialog
		const deleteCandidateRow = page.locator(`tr[data-section-id="${secToDelete.id}"]`);
		await deleteCandidateRow.getByRole('button', { name: /Sil \(Arşiv Adayı\)/ }).click();

		const deleteDialog = page.locator('dialog').filter({ hasText: 'Bölümü Sil' });
		await expectDialogOpenWithContain(deleteDialog);
		await expect(deleteDialog.getByRole('button', { name: 'Vazgeç' })).toBeFocused();
		await expect(deleteDialog.locator('.conflict-box')).toContainText('1 sessiz paylaşım');
		await expect(deleteDialog.getByRole('button', { name: 'Evet, Bölümü Sil' })).toBeDisabled();

		await deleteDialog.getByLabel('Hedef Bölüm').selectOption(secKeep.id);
		await deleteDialog.getByRole('button', { name: 'Sessiz Paylaşımları Taşı' }).click();

		await expect(deleteDialog.getByRole('button', { name: 'Evet, Bölümü Sil' })).toBeEnabled();
		await deleteDialog.getByRole('button', { name: 'Evet, Bölümü Sil' }).click();
		await expect(deleteDialog).toBeHidden();
		await expect(page.locator(`tr[data-section-id="${secToDelete.id}"]`)).toHaveCount(0);

		// Unassigned shares bulk assign
		await page.getByRole('link', { name: /Bölümsüzler/ }).click();
		await page.waitForURL('**/admin/unassigned');
		await expect(page.getByRole('button', { name: 'Link Paylaş' })).toBeVisible();
		await expect(page.getByText('Bölümsüz Makale', { exact: true })).toBeVisible();

		await page.getByRole('checkbox', { name: 'Tasarım', exact: true }).check();
		await page.getByLabel(/Bölümsüz Makale paylaşımını seç/).check();
		await page.getByRole('button', { name: 'Seçili Paylaşımları Bölümlere Ata' }).click();
		await expect(page.getByText('Şu anda bölümü olmayan aktif bir paylaşım yok.')).toBeVisible();

		// Dead unfurl job retry
		await page.getByRole('link', { name: /Önizleme Kuyruğu/ }).click();
		await page.waitForURL('**/admin/jobs');
		await expect(page.getByRole('button', { name: 'Link Paylaş' })).toBeVisible();
		await expect(page.getByText('https://hatali.example/sayfa')).toBeVisible();

		await page.getByRole('button', { name: /Yeniden Dene \(hatali\.example\)/ }).click();
		await expect(
			page.getByText('Şu anda başarısız (dead) durumda önizleme işi yok.')
		).toBeVisible();

		// Audit log viewer + @container narrow viewport check
		await page.getByRole('link', { name: 'Denetim Kaydı' }).click();
		await page.waitForURL('**/admin/audit');
		await expect(page.getByRole('button', { name: 'Link Paylaş' })).toBeVisible();
		await expect(
			page.locator('.responsive-audit-table').getByText('admin.section_reordered').first()
		).toBeVisible();

		await page.getByLabel('İşlem Türü').selectOption('admin.unfurl_job_retried');
		await page.getByRole('button', { name: 'Filtrele' }).click();
		await expect(page.locator('.responsive-audit-table tbody tr')).toHaveCount(1);

		await page.setViewportSize({ width: 390, height: 844 });
		await expect(page.locator('.responsive-audit-table thead')).toBeHidden();

		// Rolling 7d / 30d SQL metrics page
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.getByRole('link', { name: 'Ölçümler' }).click();
		await page.waitForURL('**/admin/metrics');
		await expect(page.getByRole('heading', { name: '1. Ay Kullanım Ölçümleri' })).toBeVisible();
		await expect(page.getByRole('row', { name: /Toplam Arama/ })).toBeVisible();
		await expect(page.getByRole('row', { name: /Web Kanalı Paylaşımları/ })).toBeVisible();

		// Check silent share moved into secKeep remained alive cleanly
		const stillExists = await localDb.query.canonicalResources.findFirst({
			where: eq(canonicalResources.canonicalUrl, 'https://sessiz.example/ozel-not')
		});
		expect(stillExists).toBeDefined();
	});
});
