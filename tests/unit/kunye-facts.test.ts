import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { kunyeCase, resourceFacts } from '../../src/lib/format/kunye';
import { setFallbackLocale } from '../../src/lib/i18n';

// One künye line for the feed entry, the reading pane and the resource page (izgah-ui-v4 §4, §5).
describe('resourceFacts()', () => {
	it('lists site, type, language, stars and author in künye order (Turkish)', () => {
		const facts = resourceFacts({
			domain: 'github.com',
			contentType: 'repo',
			providerMeta: { language: 'Go', stars: 154_200, authorName: 'ollama' }
		});
		// Intl separates the compact suffix with a no-break space.
		expect(facts.map((part) => part.replace(/\s/g, ' '))).toEqual([
			'github.com',
			'repo',
			'Go',
			'154,2 B yıldız',
			'ollama'
		]);
	});

	it('leaves out missing facts and lower-cases the type', () => {
		expect(
			resourceFacts({ domain: 'web.dev', contentType: 'article', providerMeta: null })
		).toEqual(['web.dev', 'makale']);
	});

	it('lower-cases with the locale rules', () => {
		expect(kunyeCase('İPUCU')).toBe('ipucu');
	});

	describe('in English', () => {
		beforeAll(() => setFallbackLocale('en'));
		afterAll(() => setFallbackLocale('tr'));

		it('formats stars and the type label in English', () => {
			expect(
				resourceFacts({ domain: 'github.com', contentType: 'repo', providerMeta: { stars: 980 } })
			).toEqual(['github.com', 'repo', '980 stars']);
		});
	});
});
