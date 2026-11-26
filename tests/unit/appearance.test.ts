import { describe, expect, it } from 'vitest';
import {
	fillAppearancePlaceholders,
	PALETTE_COOKIES,
	parsePalette,
	parseThemePreference,
	shouldPreload
} from '../../src/lib/server/http/theme';
import {
	colorSchemeFor,
	DARK_THEME_VALUES,
	DEFAULT_PALETTE,
	parseAllowed,
	pickAllowed
} from '../../src/lib/types/appearance';

describe('appearance whitelists & font preload (docs/designs/izgah-ui-v4.md §1–§2, izgah-themes.md §3)', () => {
	it('pickAllowed and parseAllowed accept only listed strings', () => {
		const values = ['a', 'b'] as const;
		expect(pickAllowed(values, 'b', 'a')).toBe('b');
		expect(pickAllowed(values, 'c', 'a')).toBe('a');
		expect(pickAllowed(values, null, 'a')).toBe('a');
		expect(parseAllowed(values, 'a')).toBe('a');
		expect(parseAllowed(values, ' a')).toBeNull();
		expect(parseAllowed(values, undefined)).toBeNull();
	});

	it('has one accent and no dim palette (izgah-ui-v4.md §1, §8)', () => {
		expect(DARK_THEME_VALUES).toEqual(['default', 'contrast']);
		expect(DEFAULT_PALETTE).toEqual({ lightTheme: 'default', darkTheme: 'default' });
	});

	it('parsePalette reads each cookie and falls back per field', () => {
		const jar: Record<string, string> = {
			[PALETTE_COOKIES.lightTheme]: 'contrast',
			[PALETTE_COOKIES.darkTheme]: '"><img src=x>'
		};
		expect(parsePalette((name) => jar[name])).toEqual({
			lightTheme: 'contrast',
			darkTheme: 'default'
		});
		expect(parsePalette(() => undefined)).toEqual(DEFAULT_PALETTE);
	});

	it('falls back the removed dim palette and ignores old accent cookies', () => {
		const jar: Record<string, string> = {
			[PALETTE_COOKIES.darkTheme]: 'dim',
			izgah_accent: 'plum'
		};
		expect(parsePalette((name) => jar[name])).toEqual(DEFAULT_PALETTE);
		expect(PALETTE_COOKIES).not.toHaveProperty('accent');
	});

	it('maps the mode to the color-scheme meta content', () => {
		expect(colorSchemeFor('system')).toBe('light dark');
		expect(colorSchemeFor('light')).toBe('light');
		expect(colorSchemeFor('dark')).toBe('dark');
	});

	it('fills every placeholder once and leaves later occurrences untouched', () => {
		const html =
			'<html data-theme="%izgah.theme%" data-light-theme="%izgah.lightTheme%"' +
			' data-dark-theme="%izgah.darkTheme%">' +
			'<meta name="color-scheme" content="%izgah.colorScheme%">%izgah.theme%';
		expect(
			fillAppearancePlaceholders(html, parseThemePreference('light'), {
				lightTheme: 'default',
				darkTheme: 'contrast'
			})
		).toBe(
			'<html data-theme="light" data-light-theme="default" data-dark-theme="contrast">' +
				'<meta name="color-scheme" content="light">%izgah.theme%'
		);
	});

	it('preloads Atkinson Hyperlegible Next normal latin/latin-ext fonts and skips italics and old fonts', () => {
		const font = (file: string) =>
			shouldPreload({ type: 'font', path: `/_app/immutable/assets/${file}.abc.woff2` });
		expect(font('atkinson-hyperlegible-next-latin-wght-normal')).toBe(true);
		expect(font('atkinson-hyperlegible-next-latin-ext-wght-normal')).toBe(true);
		expect(font('atkinson-hyperlegible-next-latin-wght-italic')).toBe(false);
		expect(font('geist-latin-wght-normal')).toBe(false);
		expect(font('newsreader-latin-opsz-normal')).toBe(false);
		expect(shouldPreload({ type: 'js', path: '/_app/immutable/entry/start.js' })).toBe(true);
		expect(shouldPreload({ type: 'css', path: '/_app/immutable/assets/0.css' })).toBe(true);
	});
});
