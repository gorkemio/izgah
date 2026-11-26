import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	DARK_THEME_VALUES,
	LIGHT_THEME_VALUES,
	type DarkTheme,
	type LightTheme
} from '../../src/lib/types/appearance';

interface CssRule {
	media: string | null;
	selectors: string[];
	decls: Record<string, string>;
}

// The palette slots are generated from tokens/kunye.json (scripts/tokens/build.ts); tokens.css maps
// them into the semantic layer. Read both, palette first, as app.css imports them.
const rawCss = ['src/lib/styles/palette.css', 'src/lib/styles/tokens.css']
	.map((file) => fs.readFileSync(path.resolve(file), 'utf8'))
	.join('\n')
	.replace(/\/\*[\s\S]*?\*\//g, '');

/** Parses top-level and @layer/@media rules in tokens.css with brace-depth tracking. */
function parseCssRules(input: string, media: string | null = null): CssRule[] {
	const rules: CssRule[] = [];
	let index = 0;

	while (index < input.length) {
		while (index < input.length && /\s/.test(input[index])) {
			index += 1;
		}
		if (index >= input.length) {
			break;
		}

		const braceStart = input.indexOf('{', index);
		if (braceStart === -1) {
			break;
		}
		const header = input.slice(index, braceStart).trim();

		let depth = 1;
		let cursor = braceStart + 1;
		while (cursor < input.length && depth > 0) {
			if (input[cursor] === '{') {
				depth += 1;
			} else if (input[cursor] === '}') {
				depth -= 1;
			}
			cursor += 1;
		}
		const body = input.slice(braceStart + 1, cursor - 1);
		index = cursor;

		if (header.startsWith('@layer')) {
			rules.push(...parseCssRules(body, media));
		} else if (header.startsWith('@media')) {
			const condition = header.slice('@media'.length).trim();
			rules.push(...parseCssRules(body, media ? `${media} and ${condition}` : condition));
		} else if (!header.startsWith('@')) {
			const decls: Record<string, string> = {};
			for (const decl of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
				decls[decl[1]] = decl[2].trim();
			}
			rules.push({
				media,
				selectors: header.split(',').map((part) => part.trim()),
				decls
			});
		}
	}

	return rules;
}

const parsedRules = parseCssRules(rawCss);

function collectDecls(selector: string, media: string | null = null): Record<string, string> {
	const merged: Record<string, string> = {};
	for (const rule of parsedRules) {
		if (rule.media !== media) {
			continue;
		}
		if (!rule.selectors.includes(selector)) {
			continue;
		}
		Object.assign(merged, rule.decls);
	}
	if (Object.keys(merged).length === 0) {
		throw new Error(`missing CSS block ${selector}${media ? ` in @media ${media}` : ''}`);
	}
	return merged;
}

const rootDecls = collectDecls(':root');

function resolveVar(value: string, scope: Record<string, string>, depth = 0): string {
	if (depth > 8) {
		throw new Error(`cyclic CSS var reference: ${value}`);
	}
	const trimmed = value.trim();
	const match = /^var\(\s*(--[\w-]+)\s*\)$/.exec(trimmed);
	if (!match) {
		return trimmed;
	}
	const target = scope[match[1]] ?? rootDecls[match[1]];
	if (!target) {
		throw new Error(`unresolved CSS custom property ${match[1]}`);
	}
	return resolveVar(target, scope, depth + 1);
}

function resolveBlock(selector: string, media: string | null = null): Record<string, string> {
	const raw = collectDecls(selector, media);
	const resolved: Record<string, string> = {};
	for (const [key, value] of Object.entries(raw)) {
		if (value.startsWith('var(')) {
			resolved[key] = resolveVar(value, raw).toLowerCase();
		} else {
			resolved[key] = value.toLowerCase();
		}
	}
	return resolved;
}

function luminance(hex: string): number {
	if (!/^#[0-9a-f]{6}$/i.test(hex)) {
		throw new Error(`expected 6-digit hex color, received "${hex}"`);
	}
	const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
	const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

/** Resolves semantic tokens for one scheme and palette; the accent is the palette's link blue. */
function resolveSemanticTokens(
	scheme: 'light' | 'dark',
	paletteSlots: Record<string, string>
): Record<string, string> {
	const slot = (name: string) => {
		const value = paletteSlots[`--${scheme}-${name}`];
		expect(value, `--${scheme}-${name}`).toBeDefined();
		return value;
	};
	const rootSlot = (name: string) =>
		resolveVar(`var(--${name}-${scheme})`, rootDecls).toLowerCase();

	const link = slot('link');
	return {
		'--color-bg': slot('bg'),
		'--color-surface-1': slot('surface-1'),
		'--color-surface-2': slot('surface-2'),
		'--color-surface-3': slot('surface-3'),
		'--color-text': slot('text'),
		'--color-text-secondary': slot('text-secondary'),
		'--color-text-muted': slot('text-muted'),
		'--color-line': slot('line'),
		'--color-line-strong': slot('line-strong'),
		'--color-danger': slot('danger'),
		'--color-on-danger': slot('on-danger'),
		'--color-ok-soft': slot('ok-soft'),
		'--color-ok-text': slot('ok-text'),
		'--color-warn-soft': slot('warn-soft'),
		'--color-warn-text': slot('warn-text'),
		'--color-link': link,
		'--color-visited': slot('visited'),
		'--color-accent': link,
		'--color-on-accent': rootSlot('on-accent'),
		'--color-accent-soft': rootSlot('accent-soft'),
		'--color-accent-text': link,
		'--color-focus-inner': slot('focus-inner'),
		'--color-focus-outer': link,
		'--color-highlight-bg': slot('highlight-bg'),
		'--color-highlight-fg': slot('highlight-fg')
	};
}

const lightPalettes = Object.fromEntries(
	LIGHT_THEME_VALUES.map((name) => [name, resolveBlock(`[data-light-theme='${name}']`)])
) as Record<LightTheme, Record<string, string>>;
const darkPalettes = Object.fromEntries(
	DARK_THEME_VALUES.map((name) => [name, resolveBlock(`[data-dark-theme='${name}']`)])
) as Record<DarkTheme, Record<string, string>>;

const surfaces = ['--color-bg', '--color-surface-1', '--color-surface-2'] as const;

const aaTextPairs: Array<[string, string]> = [
	...surfaces.flatMap((surface): Array<[string, string]> => [
		['--color-text', surface],
		['--color-text-secondary', surface],
		['--color-text-muted', surface],
		['--color-danger', surface],
		['--color-link', surface],
		['--color-visited', surface]
	]),
	// Primary buttons are ink with paper text (izgah-ui-v4.md §1).
	['--color-bg', '--color-text'],
	['--color-on-danger', '--color-danger'],
	['--color-on-accent', '--color-accent'],
	['--color-accent-text', '--color-accent-soft'],
	['--color-highlight-fg', '--color-highlight-bg'],
	['--color-highlight-fg', '--color-bg'],
	['--color-ok-text', '--color-ok-soft'],
	['--color-warn-text', '--color-warn-soft']
];

const aaUiPairs: Array<[string, string]> = surfaces.flatMap((surface): Array<[string, string]> => [
	['--color-line-strong', surface],
	['--color-focus-inner', surface],
	['--color-focus-outer', surface]
]);

const combinations = [
	...LIGHT_THEME_VALUES.map((name) => ['light', name, lightPalettes[name]] as const),
	...DARK_THEME_VALUES.map((name) => ['dark', name, darkPalettes[name]] as const)
].map(([scheme, name, slots]) => ({
	label: `${scheme}/${name}`,
	scheme,
	name,
	slots,
	tokens: resolveSemanticTokens(scheme, slots)
}));

describe('Künye token contrast (docs/designs/izgah-ui-v4.md §1)', () => {
	it('covers 2 light and 2 dark palettes with ink-and-paper defaults and one accent', () => {
		expect(combinations).toHaveLength(4);
		const resolvedRoot = resolveBlock(':root');
		expect(resolvedRoot['--light-bg']).toBe('#ffffff');
		expect(resolvedRoot['--dark-bg']).toBe('#0f0f10');
		expect(resolvedRoot['--light-link']).toBe('#1f3fd0');
		expect(resolvedRoot['--dark-link']).toBe('#9db7ff');
		expect(resolvedRoot['--shadow-sm']).toBe('none');
		expect(resolvedRoot['--shadow-xs']).toBe('none');
	});

	it('keeps every corner radius at 3px or less', () => {
		for (const name of [
			'--radius-xs',
			'--radius-sm',
			'--radius-md',
			'--radius-lg',
			'--radius-pill'
		]) {
			const value = rootDecls[name];
			expect(value, name).toMatch(/^\d+px$/);
			expect(Number.parseInt(value, 10), name).toBeLessThanOrEqual(3);
		}
	});

	for (const { label, tokens } of combinations) {
		it.each(aaTextPairs)(`${label}: %s on %s meets WCAG 2.2 AA (>= 4.5:1)`, (fg, bg) => {
			expect(contrast(tokens[fg], tokens[bg])).toBeGreaterThanOrEqual(4.5);
		});

		it.each(aaUiPairs)(`${label}: %s on %s meets WCAG 2.2 non-text (>= 3:1)`, (fg, bg) => {
			expect(contrast(tokens[fg], tokens[bg])).toBeGreaterThanOrEqual(3);
		});
	}

	it.each(combinations.filter(({ name }) => name === 'contrast'))(
		'$label: reaches AAA (>= 7:1) text/danger/link, >= 4.5:1 rules, and zero shadows',
		({ scheme, slots, tokens }) => {
			for (const surface of surfaces) {
				for (const fg of [
					'--color-text',
					'--color-text-secondary',
					'--color-text-muted',
					'--color-danger',
					'--color-link'
				]) {
					expect(
						contrast(tokens[fg], tokens[surface]),
						`${fg} on ${surface}`
					).toBeGreaterThanOrEqual(7);
				}
			}
			expect(
				contrast(tokens['--color-on-danger'], tokens['--color-danger'])
			).toBeGreaterThanOrEqual(7);
			expect(contrast(tokens['--color-line'], tokens['--color-bg'])).toBeGreaterThanOrEqual(4.5);

			expect(slots[`--${scheme}-shadow-lg`]).toBe('none');
		}
	);

	it('removes dialog and popover shadows under prefers-contrast: more and forced-colors: active', () => {
		const contrastMedia = parsedRules.find(
			(rule) =>
				rule.media?.includes('prefers-contrast: more') &&
				rule.media?.includes('forced-colors: active')
		);
		expect(contrastMedia).toBeDefined();
		for (const key of ['--light-shadow-lg', '--dark-shadow-lg', '--shadow-lg']) {
			expect(contrastMedia!.decls[key], key).toBe('none');
		}
	});
});
