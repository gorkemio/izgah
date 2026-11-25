/**
 * Bundles the server-side tools that run outside SvelteKit: build/migrate.js (container start-up
 * migrations) and build/cli.js (create-admin / reset-admin). Runs after `vite build` (see the
 * `build` script) and resolves the two SvelteKit aliases those entry points use.
 */
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

/** @type {import('esbuild').Plugin} */
const sveltekitAliases = {
	name: 'izgah-sveltekit-aliases',
	setup(builder) {
		// $app/environment is only available inside SvelteKit; these tools always run as built
		// production code outside the browser.
		builder.onResolve({ filter: /^\$app\/environment$/ }, () => ({
			path: '$app/environment',
			namespace: 'sveltekit-env'
		}));
		builder.onLoad({ filter: /.*/, namespace: 'sveltekit-env' }, () => ({
			contents:
				'export const building = false; export const dev = false; export const browser = false; export const version = "0";',
			loader: 'js'
		}));
		builder.onResolve({ filter: /^\$lib\// }, (args) =>
			builder.resolve(path.resolve('src/lib', args.path.slice(5)), {
				kind: args.kind,
				resolveDir: process.cwd()
			})
		);
	}
};

/** @type {import('esbuild').BuildOptions} */
const common = {
	bundle: true,
	platform: 'node',
	target: 'node22',
	format: 'esm',
	packages: 'external',
	plugins: [sveltekitAliases]
};

await build({
	...common,
	entryPoints: ['src/lib/server/db/migrate.ts'],
	outfile: 'build/migrate.js'
});
if (fs.existsSync('src/cli.ts')) {
	await build({ ...common, entryPoints: ['src/cli.ts'], outfile: 'build/cli.js' });
}
