import { describe, expect, it } from 'vitest';
import {
	fillAppearancePlaceholders,
	PALETTE_COOKIES,
	parsePalette,
	parseThemePreference,
	shouldPreload
} from '../../src/lib/server/http/theme';
import {
	ACCENT_VALUES,
	colorSchemeFor,
	DEFAULT_PALETTE,
	parseAllowed,
	pickAllowed
} from '../../src/lib/types/appearance';

describe('appearance whitelists & font preload (docs/designs/izgah-ui-v3.md §1–§2, izgah-themes.md §3)', () => {
	it('pickAllowed and parseAllowed accept only listed strings', () => {
		const values = ['a', 'b'] as const;
		expect(pickAllowed(values, 'b', 'a')).toBe('b');
		expect(pickAllowed(values, 'c', 'a')).toBe('a');
		expect(pickAllowed(values, null, 'a')).toBe('a');
		expect(parseAllowed(values, 'a')).toBe('a');
		expect(parseAllowed(values, ' a')).toBeNull();
		expect(parseAllowed(values, undefined)).toBeNull();
	});

	it('exposes v3 Studio accent values with teal as default', () => {
		expect(ACCENT_VALUES).toEqual(['teal', 'cobalt', 'terracotta', 'plum']);
		expect(DEFAULT_PALETTE).toEqual({
			lightTheme: 'default',
			darkTheme: 'default',
			accent: 'teal'
		});
	});

	it('parsePalette reads each cookie and falls back per field', () => {
		const jar: Record<string, string> = {
			[PALETTE_COOKIES.lightTheme]: 'contrast',
			[PALETTE_COOKIES.darkTheme]: '"><img src=x>',
			[PALETTE_COOKIES.accent]: 'plum'
		};
		expect(parsePalette((name) => jar[name])).toEqual({
			lightTheme: 'contrast',
			darkTheme: 'default',
			accent: 'plum'
		});
		expect(parsePalette(() => undefined)).toEqual(DEFAULT_PALETTE);
	});

	it('falls back legacy v2 accent cookies (lime/cyan/pink/blue) cleanly to teal', () => {
		for (const legacy of ['lime', 'cyan', 'pink', 'blue']) {
			expect(
				parsePalette((name) => (name === PALETTE_COOKIES.accent ? legacy : undefined))
			).toEqual({
				lightTheme: 'default',
				darkTheme: 'default',
				accent: 'teal'
			});
		}
	});

	it('maps the mode to the color-scheme meta content', () => {
		expect(colorSchemeFor('system')).toBe('light dark');
		expect(colorSchemeFor('light')).toBe('light');
		expect(colorSchemeFor('dark')).toBe('dark');
	});

	it('fills every placeholder once and leaves later occurrences untouched', () => {
		const html =
			'<html data-theme="%izgah.theme%" data-light-theme="%izgah.lightTheme%"' +
			' data-dark-theme="%izgah.darkTheme%" data-accent="%izgah.accent%">' +
			'<meta name="color-scheme" content="%izgah.colorScheme%">%izgah.accent%';
		expect(
			fillAppearancePlaceholders(html, parseThemePreference('light'), {
				lightTheme: 'default',
				darkTheme: 'dim',
				accent: 'cobalt'
			})
		).toBe(
			'<html data-theme="light" data-light-theme="default" data-dark-theme="dim" data-accent="cobalt">' +
				'<meta name="color-scheme" content="light">%izgah.accent%'
		);
	});

	it('preloads Geist and Newsreader normal latin/latin-ext fonts and skips italic/mono/legacy fonts', () => {
		expect(
			shouldPreload({
				type: 'font',
				path: '/_app/immutable/assets/geist-latin-wght-normal.abc.woff2'
			})
		).toBe(true);
		expect(
			shouldPreload({
				type: 'font',
				path: '/_app/immutable/assets/geist-latin-ext-wght-normal.abc.woff2'
			})
		).toBe(true);
		expect(
			shouldPreload({
				type: 'font',
				path: '/_app/immutable/assets/newsreader-latin-opsz-normal.abc.woff2'
			})
		).toBe(true);
		expect(
			shouldPreload({
				type: 'font',
				path: '/_app/immutable/assets/newsreader-latin-ext-opsz-normal.abc.woff2'
			})
		).toBe(true);
		expect(
			shouldPreload({
				type: 'font',
				path: '/_app/immutable/assets/newsreader-latin-opsz-italic.abc.woff2'
			})
		).toBe(false);
		expect(
			shouldPreload({
				type: 'font',
				path: '/_app/immutable/assets/jetbrains-mono-latin-wght-normal.abc.woff2'
			})
		).toBe(false);
		expect(
			shouldPreload({
				type: 'font',
				path: '/_app/immutable/assets/schibsted-grotesk-latin-wght-normal.abc.woff2'
			})
		).toBe(false);
		expect(shouldPreload({ type: 'js', path: '/_app/immutable/entry/start.js' })).toBe(true);
		expect(shouldPreload({ type: 'css', path: '/_app/immutable/assets/0.css' })).toBe(true);
	});
});
