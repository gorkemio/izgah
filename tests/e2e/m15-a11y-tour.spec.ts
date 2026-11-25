import crypto from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
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

const WIDTHS = [375, 768, 1280] as const;
const THEMES = ['light', 'dark'] as const;

// Faz 8 tour (izgah-ui-v2 §5 Verification): every main screen at phone, tablet and desktop widths
// in both themes, a keyboard-only pass and reduced motion. Runs in the desktop projects.
test.describe('UI v2 visual and accessibility tour', () => {
	test.beforeAll(async () => {
		await migrateTestDb();
	});

	test.beforeEach(async () => {
		await resetTestDb();
	});

	test.afterAll(async () => {
		await localSql.end({ timeout: 5 });
	});

	test('main screens at 375 / 768 / 1280 px in light and dark: no overflow, theme, one h1', async ({
		browser
	}) => {
		test.setTimeout(120_000);
		const admin = await seedUserWithSession({ name: 'Tur Yöneticisi', email: 'tur@izgah.test' });
		await localSql`UPDATE public.users SET role = 'admin' WHERE id = ${admin.id}`;
		await testDb.insert(schema.sections).values({
			slug: 'tur',
			name: 'Tur Bölümü',
			createdById: admin.id
		});
		const resourceId = await seedShare(
			admin.id,
			'tur-yazisi',
			'Uzun başlıklı bir tur yazısı: senkronizasyon, çakışma çözümü ve yerel öncelikli yazılım'
		);
		const paths = [
			'/',
			'/sections',
			'/sections/tur',
			`/resources/${resourceId}`,
			'/search?q=senkronizasyon',
			'/settings',
			'/settings/api-keys',
			'/admin/users',
			'/admin/sections'
		];

		for (const theme of THEMES) {
			for (const width of WIDTHS) {
				const context = await browser.newContext({ viewport: { width, height: 900 } });
				await attachSessionCookie(context, admin.cookieValue);
				await context.addCookies([
					{ name: 'izgah_theme', value: theme, domain: '127.0.0.1', path: '/' }
				]);
				const page = await context.newPage();
				for (const path of paths) {
					const label = `${path} @ ${width}px ${theme}`;
					const response = await page.goto(path);
					expect(response?.status(), label).toBe(200);
					await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
					await expect(page.locator('h1'), label).toHaveCount(1);
					await expectNoHorizontalOverflow(page, label);
				}
				await context.close();
			}
		}
	});

	test('named themes resolve their palette on first paint (izgah-ui-v3 §1, izgah-themes §1–§2)', async ({
		browser
	}) => {
		const member = await seedUserWithSession({ name: 'Tema Turu', email: 'tema-tur@izgah.test' });
		const cases = [
			{
				cookies: { izgah_theme: 'light', izgah_theme_light: 'contrast' },
				colorScheme: 'dark' as const,
				bg: 'rgb(255, 255, 255)',
				text: 'rgb(0, 0, 0)',
				accent: 'rgb(15, 118, 110)'
			},
			{
				cookies: { izgah_theme: 'dark', izgah_theme_dark: 'dim', izgah_accent: 'plum' },
				colorScheme: 'light' as const,
				bg: 'rgb(26, 28, 32)',
				text: 'rgb(239, 239, 237)',
				accent: 'rgb(196, 181, 253)'
			},
			{
				// System mode follows the OS scheme and picks the chosen dark palette.
				cookies: { izgah_theme_dark: 'contrast', izgah_accent: 'terracotta' },
				colorScheme: 'dark' as const,
				bg: 'rgb(0, 0, 0)',
				text: 'rgb(255, 255, 255)',
				accent: 'rgb(251, 146, 60)'
			}
		];
		for (const { cookies, colorScheme, bg, text, accent } of cases) {
			const context = await browser.newContext({
				colorScheme,
				viewport: { width: 1280, height: 900 }
			});
			await attachSessionCookie(context, member.cookieValue);
			await context.addCookies(
				Object.entries(cookies).map(([name, value]) => ({
					name,
					value,
					domain: '127.0.0.1',
					path: '/'
				}))
			);
			const page = await context.newPage();
			for (const path of ['/', '/settings']) {
				const label = `${path} ${JSON.stringify(cookies)}`;
				expect((await page.goto(path))?.status(), label).toBe(200);
				const resolved = await page.evaluate(() => {
					const probe = document.createElement('div');
					probe.style.background = 'var(--color-accent)';
					document.body.append(probe);
					const html = getComputedStyle(document.documentElement);
					const result = {
						bg: html.backgroundColor,
						text: html.color,
						accent: getComputedStyle(probe).backgroundColor
					};
					probe.remove();
					return result;
				});
				expect(resolved, label).toEqual({ bg, text, accent });
				await expect(page.locator('h1'), label).toHaveCount(1);
				await expectNoHorizontalOverflow(page, label);
			}
			await context.close();
		}
	});

	test('keyboard only: skip link first, visible focus ring, main content reachable', async ({
		page,
		context,
		browserName
	}) => {
		// Safari only tabs to links with Option+Tab unless "Press Tab to highlight" is enabled.
		const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
		const member = await seedUserWithSession({ name: 'Klavyeci', email: 'klavyeci@izgah.test' });
		await seedShare(member.id, 'klavye', 'Klavye ile okunan yazı');
		await attachSessionCookie(context, member.cookieValue);
		await page.goto('/');
		await expect(page.locator('html[data-hydrated]')).toHaveCount(1);

		await page.keyboard.press(tab);
		const skip = page.getByRole('link', { name: 'Ana içeriğe geç' });
		await expect(skip).toBeFocused();
		await expect(skip).toBeInViewport();
		await page.keyboard.press('Enter');
		await expect(page.locator('#main-content')).toBeFocused();

		// The next Tab stop is inside the main column, and it shows the two-layer focus ring.
		await page.keyboard.press(tab);
		const ring = await page.evaluate(() => {
			const active = document.activeElement as HTMLElement | null;
			return {
				inMain: Boolean(active?.closest('#main-content')),
				boxShadow: active ? getComputedStyle(active).boxShadow : 'none'
			};
		});
		expect(ring.inMain).toBe(true);
		expect(ring.boxShadow).not.toBe('none');
	});

	test('reduced motion: transitions and view transition animations are off', async ({
		browser
	}) => {
		const member = await seedUserWithSession({ name: 'Sakin Üye', email: 'sakin@izgah.test' });
		const context = await browser.newContext({ reducedMotion: 'reduce' });
		await attachSessionCookie(context, member.cookieValue);
		const page = await context.newPage();
		await page.goto('/');
		await expect(page.locator('html[data-hydrated]')).toHaveCount(1);
		const motion = await page.evaluate(() => {
			const button = document.querySelector('.btn') as HTMLElement;
			const root = getComputedStyle(document.documentElement);
			return {
				duration: getComputedStyle(button).transitionDuration,
				token: root.getPropertyValue('--dur-fast').trim(),
				alias: root.getPropertyValue('--dur-1').trim()
			};
		});
		expect(motion.token).toBe('0ms');
		expect(motion.alias).toBe('0ms');
		expect(motion.duration.split(',').every((value) => parseFloat(value) === 0)).toBe(true);
		await context.close();
	});

	test('axe color-contrast passes with 0 violations across all 5 Studio palettes', async ({
		browser
	}) => {
		test.setTimeout(120_000);
		const admin = await seedUserWithSession({
			name: 'Kontrast Yöneticisi',
			email: 'kontrast@izgah.test'
		});
		await localSql`UPDATE public.users SET role = 'admin' WHERE id = ${admin.id}`;
		const [sec] = await testDb
			.insert(schema.sections)
			.values({
				slug: 'tasarim',
				name: 'Tasarım',
				description: 'Görsel sistem notları',
				createdById: admin.id
			})
			.returning({ id: schema.sections.id });
		const [resource] = await testDb
			.insert(canonicalResources)
			.values({
				canonicalUrl: 'https://studio.example/kontrast-yazisi',
				domain: 'studio.example',
				unfurlStatus: 'ready',
				title: 'İzgah Stüdyo Renk Kontrastı Rehberi',
				description: 'Açık, koyu, loş ve yüksek kontrast paletlerinin doğrulaması'
			})
			.returning({ id: canonicalResources.id });
		const [share] = await testDb
			.insert(linkShares)
			.values({
				resourceId: resource.id,
				authorId: admin.id,
				rawUrl: 'https://studio.example/kontrast-yazisi',
				note: 'Ekip için okunaklılık ve erişilebilirlik kontrol listesi',
				isFeedVisible: true,
				sourceChannel: 'web'
			})
			.returning({ id: linkShares.id });
		await testDb.insert(schema.linkShareSections).values({ shareId: share.id, sectionId: sec.id });
		await testDb.insert(schema.resourceComments).values({
			resourceId: resource.id,
			authorId: admin.id,
			body: 'Tüm paletlerde yüksek okunaklılık.'
		});

		const palettes: Array<{
			label: string;
			colorScheme: 'light' | 'dark';
			cookies: Record<string, string>;
		}> = [
			{
				label: 'light/default',
				colorScheme: 'light',
				cookies: { izgah_theme: 'light', izgah_theme_light: 'default', izgah_accent: 'teal' }
			},
			{
				label: 'light/contrast',
				colorScheme: 'light',
				cookies: { izgah_theme: 'light', izgah_theme_light: 'contrast', izgah_accent: 'teal' }
			},
			{
				label: 'dark/default',
				colorScheme: 'dark',
				cookies: { izgah_theme: 'dark', izgah_theme_dark: 'default', izgah_accent: 'teal' }
			},
			{
				label: 'dark/dim',
				colorScheme: 'dark',
				cookies: { izgah_theme: 'dark', izgah_theme_dark: 'dim', izgah_accent: 'teal' }
			},
			{
				label: 'dark/contrast',
				colorScheme: 'dark',
				cookies: { izgah_theme: 'dark', izgah_theme_dark: 'contrast', izgah_accent: 'teal' }
			}
		];

		const routes = ['/', '/settings', `/resources/${resource.id}`, '/admin/users'];

		for (const palette of palettes) {
			const context = await browser.newContext({
				colorScheme: palette.colorScheme,
				viewport: { width: 1280, height: 900 }
			});
			await attachSessionCookie(context, admin.cookieValue);
			await context.addCookies(
				Object.entries(palette.cookies).map(([name, value]) => ({
					name,
					value,
					domain: '127.0.0.1',
					path: '/'
				}))
			);
			const page = await context.newPage();
			for (const route of routes) {
				const response = await page.goto(route);
				expect(response?.status(), `${palette.label} ${route}`).toBe(200);
				await expect(page.locator('html[data-hydrated]')).toHaveCount(1);
				const results = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
				const summary = results.violations.map((v) => ({
					id: v.id,
					nodes: v.nodes.map((n) => ({
						target: n.target,
						html: n.html,
						failureSummary: n.failureSummary
					}))
				}));
				expect(summary, `axe color-contrast on ${palette.label} ${route}`).toEqual([]);
			}
			await context.close();
		}
	});
});
