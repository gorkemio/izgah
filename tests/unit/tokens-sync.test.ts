import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { OUTPUTS, readTokens, renderAll } from '../../scripts/tokens/build';

const tokens = readTokens();
const rendered = renderAll(tokens);

/** Collects `--name: value` pairs of the first `:root { … }` block outside any @media rule. */
function topLevelRoot(css: string): Record<string, string> {
	const match = /^:root \{([\s\S]*?)^\}/m.exec(css);
	if (!match) {
		throw new Error('missing top-level :root block');
	}
	return Object.fromEntries(
		[...match[1].matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()])
	);
}

describe('Künye tokens come from one source (tokens/kunye.json)', () => {
	it.each(Object.entries(OUTPUTS))('%s palette (%s) matches a fresh render', (key, file) => {
		const onDisk = fs.readFileSync(path.resolve(file), 'utf8');
		expect(onDisk, `${file} is out of date: run \`pnpm tokens\``).toBe(
			rendered[key as keyof typeof OUTPUTS]
		);
	});

	it('gives the extension and the site the same light palette as the app', () => {
		const light = tokens.palettes.light.default;
		for (const key of ['extension', 'site'] as const) {
			const root = topLevelRoot(rendered[key]);
			for (const role of ['bg', 'text', 'text-secondary', 'text-muted', 'line', 'link', 'danger']) {
				expect(root[`--color-${role}`], `${key} --color-${role}`).toBe(light[role]);
			}
			expect(root['--color-accent']).toBe(light.link);
		}
	});

	it('defines the same roles in every palette', () => {
		const roles = Object.keys(tokens.palettes.light.default).sort();
		for (const scheme of ['light', 'dark'] as const) {
			for (const name of ['default', 'contrast'] as const) {
				expect(Object.keys(tokens.palettes[scheme][name]).sort(), `${scheme}/${name}`).toEqual(
					roles
				);
			}
		}
	});
});
