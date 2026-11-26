import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import Skeleton from '../../src/lib/components/ui/Skeleton.svelte';
import { highlightTerms, splitHighlights } from '../../src/lib/search/highlight';

describe('UI primitives & helpers', () => {
	it('renders Skeleton lines as decorative placeholders', () => {
		const { body } = render(Skeleton, { props: { variant: 'line', lines: 3 } });
		expect(body).toContain('aria-hidden="true"');
		expect(body.match(/skeleton-line/g)).toHaveLength(3);
	});

	it('folds Turkish diacritics when splitting terms for command palette highlights', () => {
		const terms = highlightTerms('arayuz');
		const parts = splitHighlights('Arayüz Tasarımı', terms);
		expect(parts).toEqual([
			{ text: 'Arayüz', match: true },
			{ text: ' Tasarımı', match: false }
		]);
	});
});
