import { describe, expect, it } from 'vitest';
import { highlightTerms, splitHighlights } from '../../src/lib/search/highlight';

describe('UI primitives & helpers', () => {
	it('folds Turkish diacritics when splitting terms for command palette highlights', () => {
		const terms = highlightTerms('arayuz');
		const parts = splitHighlights('Arayüz Tasarımı', terms);
		expect(parts).toEqual([
			{ text: 'Arayüz', match: true },
			{ text: ' Tasarımı', match: false }
		]);
	});
});
