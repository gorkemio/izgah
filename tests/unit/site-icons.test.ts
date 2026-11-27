import { describe, expect, it } from 'vitest';
import { extractPngFromIco, isIco } from '../../src/lib/server/media/ico';
import { pickIconCandidates } from '../../src/lib/server/unfurl/adapters/html-meta';

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Builds an ICO container with the given entries (each either a PNG payload or BMP-like bytes). */
function ico(entries: { edge: number; payload: number[] }[]): Uint8Array {
	const header = 6 + entries.length * 16;
	const total = header + entries.reduce((sum, entry) => sum + entry.payload.length, 0);
	const bytes = new Uint8Array(total);
	const view = new DataView(bytes.buffer);
	view.setUint16(0, 0, true);
	view.setUint16(2, 1, true);
	view.setUint16(4, entries.length, true);
	let offset = header;
	entries.forEach((entry, i) => {
		const at = 6 + i * 16;
		bytes[at] = entry.edge === 256 ? 0 : entry.edge;
		bytes[at + 1] = entry.edge === 256 ? 0 : entry.edge;
		view.setUint32(at + 8, entry.payload.length, true);
		view.setUint32(at + 12, offset, true);
		bytes.set(entry.payload, offset);
		offset += entry.payload.length;
	});
	return bytes;
}

describe('site icon candidates (izgah-ui-v5.md §10.1)', () => {
	it('prefers Apple touch icons, then larger PNG icons, then /favicon.ico', () => {
		const urls = pickIconCandidates(
			[
				{ href: '/icon-16.png', apple: false, sizes: '16x16', type: 'image/png' },
				{ href: '/icon-32.png', apple: false, sizes: '32x32', type: 'image/png' },
				{ href: '/apple.png', apple: true, sizes: '180x180', type: '' }
			],
			'https://example.com/post/1'
		);
		expect(urls).toEqual([
			'https://example.com/apple.png',
			'https://example.com/icon-32.png',
			'https://example.com/icon-16.png',
			'https://example.com/favicon.ico'
		]);
	});

	it('never picks SVG icons or icons larger than 256px', () => {
		const urls = pickIconCandidates(
			[
				{ href: '/icon.svg', apple: false, sizes: 'any', type: 'image/svg+xml' },
				{ href: '/mask.svg?v=2', apple: false, sizes: '', type: '' },
				{ href: '/huge.png', apple: false, sizes: '512x512', type: 'image/png' }
			],
			'https://example.com/'
		);
		expect(urls).toEqual(['https://example.com/favicon.ico']);
	});

	it('keeps at most four candidates and resolves relative URLs against the page', () => {
		const links = Array.from({ length: 6 }, (_, i) => ({
			href: `icons/${i}.png`,
			apple: false,
			sizes: `${(i + 1) * 16}x${(i + 1) * 16}`,
			type: 'image/png'
		}));
		const urls = pickIconCandidates(links, 'https://example.com/blog/post');
		expect(urls).toHaveLength(4);
		expect(urls[0]).toBe('https://example.com/blog/icons/5.png');
	});
});

describe('ICO reading', () => {
	it('returns the largest embedded PNG and ignores BMP entries', () => {
		const small = [...PNG, 1, 1, 1];
		const large = [...PNG, 2, 2, 2, 2];
		const bmp = [0x28, 0, 0, 0, 9, 9];
		const file = ico([
			{ edge: 16, payload: small },
			{ edge: 48, payload: bmp },
			{ edge: 32, payload: large }
		]);
		expect(isIco(file)).toBe(true);
		expect(Array.from(extractPngFromIco(file) ?? [])).toEqual(large);
	});

	it('returns null for BMP-only icons and non-ICO bytes', () => {
		expect(extractPngFromIco(ico([{ edge: 16, payload: [0x28, 0, 0, 0] }]))).toBeNull();
		expect(extractPngFromIco(new Uint8Array(PNG))).toBeNull();
		expect(isIco(new Uint8Array([1, 2, 3]))).toBe(false);
	});
});
