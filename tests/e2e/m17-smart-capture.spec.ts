import crypto from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test, type BrowserContext } from '@playwright/test';
import { makeSignature } from 'better-auth/crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../../src/lib/server/db/schema';
import {
	canonicalResources,
	enrichmentJobs,
	linkShareSections,
	linkShares,
	sections,
	sessions,
	shareSectionSuggestions,
	users,
	type UserRole
} from '../../src/lib/server/db/schema';
import { assertTestDatabaseUrl, migrateTestDb } from '../setup/db';

/**
 * Smart capture end to end (docs/designs/izgah-smart-capture.md §13): an admin connects a local
 * fake OpenAI-compatible server, a link gets an AI section suggestion, the author adds it with
 * and without JavaScript, and members cannot open /admin/ai.
 */

const AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? 'test-only-secret-key-at-least-32-chars!!';
const localSql = postgres(assertTestDatabaseUrl(process.env.TEST_DATABASE_URL), {
	max: 4,
	onnotice: () => {}
});
const localDb = drizzle(localSql, { schema });

let fakeServer: http.Server;
let fakeBaseUrl = '';

function startFakeProvider(): Promise<void> {
	fakeServer = http.createServer((request, response) => {
		let raw = '';
		request.on('data', (chunk) => (raw += chunk));
		request.on('end', () => {
			const body = JSON.parse(raw || '{}') as {
				messages?: Array<{ content: string }>;
				response_format?: { json_schema?: { name?: string } };
			};
			let answer: unknown;
			if (body.response_format?.json_schema?.name === 'connection_test') {
				answer = { ok: true };
			} else {
				const key = /(s\d+): Tasarım/.exec(body.messages?.[1]?.content ?? '')?.[1] ?? 's1';
				answer = {
					language: 'en',
					summary: 'A guide to typography for the web.',
					keywords: ['tipografi', 'typography'],
					sections: [{ key, confidence: 'medium' }]
				};
			}
			response.writeHead(200, { 'content-type': 'application/json' });
			response.end(
				JSON.stringify({
					choices: [{ message: { content: JSON.stringify(answer) } }],
					usage: { prompt_tokens: 10, completion_tokens: 5 }
				})
			);
		});
	});
	return new Promise((resolve) => {
		fakeServer.listen(0, '127.0.0.1', () => {
			fakeBaseUrl = `http://127.0.0.1:${(fakeServer.address() as AddressInfo).port}/v1`;
			resolve();
		});
	});
}

async function seedUserWithSession(name: string, role: UserRole) {
	const [user] = await localDb
		.insert(users)
		.values({
			name,
			email: `${name.toLowerCase()}-${crypto.randomUUID()}@example.com`,
			emailVerified: true,
			role,
			isActive: true,
			authVersion: 1
		})
		.returning({ id: users.id });
	const token = crypto.randomBytes(32).toString('base64url');
	await localDb.insert(sessions).values({
		token,
		userId: user.id,
		expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
		userAuthVersion: 1
	});
	return { id: user.id, cookieValue: `${token}.${await makeSignature(token, AUTH_SECRET)}` };
}

async function signIn(context: BrowserContext, cookieValue: string) {
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

/** A share whose preview is already done, plus a queued enrichment job. */
async function seedReadyShare(authorId: string, url: string, title: string) {
	const [resource] = await localDb
		.insert(canonicalResources)
		.values({
			canonicalUrl: url,
			domain: new URL(url).hostname,
			contentType: 'web',
			unfurlStatus: 'ready',
			title
		})
		.returning({ id: canonicalResources.id });
	const [share] = await localDb
		.insert(linkShares)
		.values({ resourceId: resource.id, authorId, rawUrl: url, note: `Not: ${title}` })
		.returning({ id: linkShares.id });
	await localDb.insert(enrichmentJobs).values({ resourceId: resource.id });
	return { shareId: share.id, resourceId: resource.id };
}

async function waitForSuggestion(shareId: string) {
	await expect
		.poll(
			async () =>
				(
					await localDb
						.select()
						.from(shareSectionSuggestions)
						.where(eq(shareSectionSuggestions.shareId, shareId))
				).length,
			{ timeout: 20_000 }
		)
		.toBe(1);
}

test.describe('M17 smart capture', () => {
	test.beforeAll(async () => {
		await migrateTestDb();
		await startFakeProvider();
	});

	test.afterAll(async () => {
		await new Promise((resolve) => fakeServer.close(resolve));
		await localSql.end({ timeout: 5 });
	});

	test.beforeEach(async () => {
		await localSql`
			TRUNCATE TABLE public.users, public.canonical_resources, public.media_assets, public.ai_usage_daily
			RESTART IDENTITY CASCADE
		`;
	});

	test('admin connects a local model; the author adds the AI suggestion with and without JavaScript', async ({
		browser
	}) => {
		const admin = await seedUserWithSession('Admin', 'admin');
		const member = await seedUserWithSession('Elif', 'member');
		const [design] = await localDb
			.insert(sections)
			.values({ name: 'Tasarım', slug: 'tasarim', createdById: admin.id })
			.returning({ id: sections.id });

		const adminContext = await browser.newContext();
		await signIn(adminContext, admin.cookieValue);
		const adminPage = await adminContext.newPage();
		await adminPage.goto('/admin/ai');
		await expect(adminPage.locator('#main-content h1')).toHaveText('Akıllı ekleme');
		// Fill only after hydration; otherwise hydration resets the SSR inputs (seen in WebKit).
		await expect(adminPage.locator('html[data-hydrated]')).toHaveCount(1);
		await adminPage.getByLabel('Yeni linklerde yapay zekâ kullan').check();
		await adminPage.getByRole('radio', { name: /Özel adres/ }).check();
		await adminPage.getByLabel('Taban adres (yalnızca özel adres için)').fill(fakeBaseUrl);
		await adminPage.getByLabel('Model', { exact: true }).fill('fake-model');
		await adminPage.getByRole('button', { name: 'Kaydet' }).first().click();
		await expect(adminPage.getByText('Ayarlar kaydedildi.')).toBeVisible();
		await adminPage.getByRole('button', { name: 'Bağlantıyı sına' }).click();
		await expect(adminPage.getByText(/Bağlantı çalışıyor/)).toBeVisible();

		// Seed after the settings exist, then save again: saving wakes the enrichment worker.
		const withJs = await seedReadyShare(
			member.id,
			'https://practicaltypography.com/',
			'Practical Typography'
		);
		const withoutJs = await seedReadyShare(
			member.id,
			'https://typographyforlawyers.com/',
			'Typography for Lawyers'
		);
		await adminPage.getByRole('button', { name: 'Kaydet' }).first().click();
		await expect(adminPage.getByText('Ayarlar kaydedildi.')).toBeVisible();
		await waitForSuggestion(withJs.shareId);
		await waitForSuggestion(withoutJs.shareId);
		await adminContext.close();

		const memberContext = await browser.newContext();
		await signIn(memberContext, member.cookieValue);
		const page = await memberContext.newPage();
		await page.goto('/');
		await expect(page.locator('html[data-hydrated]')).toHaveCount(1);
		const card = page.locator(`article#share-${withJs.shareId}`);
		await expect(card.getByText('Öneri:')).toBeVisible();
		await card.getByRole('button', { name: 'Tasarım bölümüne ekle' }).click();
		await expect(card.getByText('Öneri:')).toHaveCount(0);
		await expect
			.poll(async () =>
				(
					await localDb
						.select()
						.from(linkShareSections)
						.where(eq(linkShareSections.shareId, withJs.shareId))
				).map((row) => row.sectionId)
			)
			.toEqual([design.id]);

		const response = await page.goto('/admin/ai');
		expect(response?.status()).toBe(403);
		await memberContext.close();

		const noJsContext = await browser.newContext({ javaScriptEnabled: false });
		await signIn(noJsContext, member.cookieValue);
		const noJsPage = await noJsContext.newPage();
		await noJsPage.goto('/');
		await noJsPage
			.locator(`article#share-${withoutJs.shareId}`)
			.getByRole('button', { name: 'Tasarım bölümüne ekle' })
			.click();
		await noJsPage.waitForURL('**/');
		await expect(
			noJsPage.locator(`article#share-${withoutJs.shareId}`).getByText('Öneri:')
		).toHaveCount(0);
		const linked = await localDb
			.select()
			.from(linkShareSections)
			.where(eq(linkShareSections.shareId, withoutJs.shareId));
		expect(linked.map((row) => row.sectionId)).toEqual([design.id]);
		await noJsContext.close();
	});
});
