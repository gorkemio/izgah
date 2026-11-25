import { describe, expect, it } from 'vitest';
import { highlightTerms, splitHighlights } from '../../src/lib/search/highlight';

const marked = (text: string, query: string) =>
	splitHighlights(text, highlightTerms(query))
		.map((part) => (part.match ? `[${part.text}]` : part.text))
		.join('');

describe('search highlight', () => {
	it('drops exclusions, OR, quotes and one-letter terms', () => {
		expect(highlightTerms('"dağıtık mimari" -java OR a svelte')).toEqual([
			'dagitik',
			'mimari',
			'svelte'
		]);
	});

	it('matches case- and accent-insensitively without shifting indices', () => {
		expect(marked('Dağıtık Mimari ve İSTANBUL', 'dagitik istanbul')).toBe(
			'[Dağıtık] Mimari ve [İSTANBUL]'
		);
		expect(marked('Tasarım notları', 'TASARIM')).toBe('[Tasarım] notları');
	});

	it('merges overlapping matches and keeps plain text intact', () => {
		expect(marked('sveltejs/kit', 'svelte sveltejs')).toBe('[sveltejs]/kit');
		expect(marked('<dialog> & Vec<T>', 'dialog')).toBe('<[dialog]> & Vec<T>');
		expect(marked('emoji 🚀 svelte', 'svelte')).toBe('emoji 🚀 [svelte]');
	});

	it('returns the text unchanged without terms or matches', () => {
		expect(splitHighlights('metin', [])).toEqual([{ text: 'metin', match: false }]);
		expect(marked('metin', 'yok')).toBe('metin');
	});
});
