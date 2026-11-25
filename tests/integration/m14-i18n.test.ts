import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb } from '../../src/lib/server/db/client';
import { canonicalResources, linkShares, users } from '../../src/lib/server/db/schema';
import { getLocale, t } from '../../src/lib/i18n';
import { resolveRequestLocale, runWithLocale } from '../../src/lib/server/i18n';
import { resetSearchLogDedupe, searchResources } from '../../src/lib/server/search/service';
import { closeTestDb, migrateTestDb, resetTestDb, testDb } from '../setup/db';

function cookies(values: Record<string, string>) {
	return { get: (name: string) => values[name] };
}

describe('i18n on the server (docs/designs/izgah-i18n-oss.md)', () => {
	beforeAll(async () => {
		await migrateTestDb();
	});

	beforeEach(async () => {
		await resetTestDb();
		resetSearchLogDedupe();
	});

	afterAll(async () => {
		await closeDb();
		await closeTestDb();
	});

	it('resolves the locale from the cookie, then the instance default', () => {
		expect(resolveRequestLocale(cookies({ izgah_locale: 'en' }))).toBe('en');
		expect(resolveRequestLocale(cookies({ izgah_locale: 'tr' }))).toBe('tr');
		// Unsupported or missing values fall back to DEFAULT_LOCALE (tr in tests).
		expect(resolveRequestLocale(cookies({ izgah_locale: 'xx' }))).toBe('tr');
		expect(resolveRequestLocale(cookies({}))).toBe('tr');
	});

	it('scopes the locale to the request, including across awaits', async () => {
		const inEnglish = await runWithLocale('en', async () => {
			await new Promise((resolve) => setTimeout(resolve, 5));
			return { locale: getLocale(), text: t('error.notFound') };
		});
		expect(inEnglish).toEqual({ locale: 'en', text: 'Page not found' });
		expect(getLocale()).toBe('tr');
		expect(t('error.notFound')).toBe('Sayfa bulunamadı');
	});

	it('matches English word forms through the english search dictionary', async () => {
		const [author] = await testDb
			.insert(users)
			.values({ name: 'Reader', email: 'reader@izgah.test', role: 'member' })
			.returning({ id: users.id });
		const [resource] = await testDb
			.insert(canonicalResources)
			.values({
				canonicalUrl: 'https://farm.example/care-guide',
				domain: 'farm.example',
				unfurlStatus: 'ready',
				title: 'Caring for a pony in winter'
			})
			.returning({ id: canonicalResources.id });
		await testDb.insert(linkShares).values({
			resourceId: resource.id,
			authorId: author.id,
			rawUrl: 'https://farm.example/care-guide',
			isFeedVisible: true,
			note: 'Field studies from the stables'
		});

		const byTitle = await searchResources({ userId: author.id, query: 'ponies', recordLog: false });
		expect(byTitle.totalCount).toBe(1);

		const byNote = await searchResources({ userId: author.id, query: 'study', recordLog: false });
		expect(byNote.totalCount).toBe(1);
	});
});
