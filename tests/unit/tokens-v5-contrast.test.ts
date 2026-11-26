import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	readTokens,
	v5ContrastPalette,
	v5Palette,
	type Palette,
	type Scheme
} from '../../scripts/tokens/build';

/*
 * UI v5 "Fener" contrast rules (docs/designs/izgah-ui-v5.md §2.3), checked on the token source for
 * every theme candidate and both high contrast palettes.
 */
const tokens = readTokens();
const SCHEMES: Scheme[] = ['light', 'dark'];

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

/** Text and its background. */
const TEXT_PAIRS: [string, string][] = [
	['foreground', 'background'],
	['foreground', 'card'],
	['foreground', 'popover'],
	['foreground', 'surface-raised'],
	['muted-foreground', 'background'],
	['muted-foreground', 'card'],
	['muted-foreground', 'muted'],
	['card-foreground', 'card'],
	['popover-foreground', 'popover'],
	['primary-foreground', 'primary'],
	['secondary-foreground', 'secondary'],
	['accent-foreground', 'accent'],
	['destructive-foreground', 'destructive'],
	['sidebar-foreground', 'sidebar'],
	['sidebar-primary-foreground', 'sidebar-primary'],
	['sidebar-accent-foreground', 'sidebar-accent'],
	['brand-foreground', 'brand-1'],
	['brand-foreground', 'brand-2'],
	['brand-foreground', 'brand-3'],
	['link', 'background'],
	['link', 'card'],
	['visited', 'background'],
	['visited', 'card'],
	['highlight-foreground', 'highlight'],
	['success-foreground', 'success'],
	['success', 'success-soft'],
	['warning-foreground', 'warning'],
	['warning', 'warning-soft'],
	['info-foreground', 'info'],
	['info', 'info-soft'],
	...Array.from({ length: 8 }, (_, i): [string, string] => ['avatar-foreground', `avatar-${i + 1}`])
];

/** Control boundaries, focus rings and filled buttons against their surface (WCAG 1.4.11). */
const UI_PAIRS: [string, string][] = [
	['input', 'background'],
	['input', 'card'],
	['ring', 'background'],
	['ring', 'card'],
	['primary', 'background']
];

function expectPairs(label: string, palette: Palette, textMin: number): void {
	for (const [fg, bg] of TEXT_PAIRS) {
		expect(palette[fg], `${label} ${fg}`).toBeDefined();
		expect(palette[bg], `${label} ${bg}`).toBeDefined();
		expect(contrast(palette[fg], palette[bg]), `${label} ${fg} on ${bg}`).toBeGreaterThanOrEqual(
			textMin
		);
	}
	for (const [fg, bg] of UI_PAIRS) {
		expect(contrast(palette[fg], palette[bg]), `${label} ${fg} on ${bg}`).toBeGreaterThanOrEqual(3);
	}
}

describe('UI v5 palettes meet the contrast rules (izgah-ui-v5.md §2.3)', () => {
	const themes = Object.keys(tokens.v5.themes);

	it('has a default theme among the candidates', () => {
		expect(themes).toContain(tokens.v5.default);
	});

	for (const theme of themes) {
		for (const scheme of SCHEMES) {
			it(`${theme} / ${scheme}: text 4.5:1, controls 3:1`, () => {
				expectPairs(`${theme}/${scheme}`, v5Palette(tokens, theme, scheme), 4.5);
			});
		}
	}

	for (const scheme of SCHEMES) {
		it(`high contrast / ${scheme}: text 7:1, controls 3:1, no shadows`, () => {
			const palette = v5ContrastPalette(tokens, scheme);
			expectPairs(`contrast/${scheme}`, palette, 7);
			for (const role of ['shadow-sm', 'shadow-md', 'shadow-lg', 'shadow-xl']) {
				expect(palette[role], role).toBe('none');
			}
		});
	}

	it('gives every theme and scheme the same roles', () => {
		const roles = Object.keys(v5Palette(tokens, tokens.v5.default, 'light')).sort();
		for (const theme of themes) {
			for (const scheme of SCHEMES) {
				expect(Object.keys(v5Palette(tokens, theme, scheme)).sort(), `${theme}/${scheme}`).toEqual(
					roles
				);
			}
		}
		const contrastRoles = (scheme: Scheme) =>
			Object.keys(v5ContrastPalette(tokens, scheme))
				.filter((role) => !role.startsWith('shadow-'))
				.sort();
		const colourRoles = roles.filter((role) => !role.startsWith('shadow-'));
		expect(contrastRoles('light')).toEqual(colourRoles);
		expect(contrastRoles('dark')).toEqual(colourRoles);
	});

	it('uses the radius scale of §3.3', () => {
		const theme = fs.readFileSync(path.resolve('src/lib/styles/theme.css'), 'utf8');
		const radius = (name: string) =>
			new RegExp(`--radius-${name}:\\s*([^;]+);`).exec(theme)?.[1].trim();
		expect(radius('sm')).toBe('6px');
		expect(radius('md')).toBe('8px');
		expect(radius('lg')).toBe('12px');
		expect(radius('xl')).toBe('16px');
	});
});
