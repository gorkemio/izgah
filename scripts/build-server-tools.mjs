/**
 * Bundles the server-side tools that run outside SvelteKit: build/migrate.js (container start-up
 * migrations) and build/cli.js (create-admin / reset-admin). Runs after `vite build` (see the
 * `build` script) and stubs the SvelteKit `$app/env` module those entry points import. `#lib/*`
 * resolves through the `imports` field of package.json, which esbuild supports natively.
 */
import fs from 'node:fs';
import { build } from 'esbuild';

/** @type {import('esbuild').Plugin} */
const sveltekitEnvStub = {
	name: 'izgah-sveltekit-env',
	setup(builder) {
		// $app/env is only available inside SvelteKit; these tools always run as built production
		// code outside the browser.
		builder.onResolve({ filter: /^\$app\/env$/ }, () => ({
			path: '$app/env',
			namespace: 'sveltekit-env'
		}));
		builder.onLoad({ filter: /.*/, namespace: 'sveltekit-env' }, () => ({
			contents:
				'export const building = false; export const dev = false; export const browser = false; export const version = "0";',
			loader: 'js'
		}));
	}
};

/** @type {import('esbuild').BuildOptions} */
const common = {
	bundle: true,
	platform: 'node',
	target: 'node22',
	format: 'esm',
	packages: 'external',
	plugins: [sveltekitEnvStub]
};

await build({
	...common,
	entryPoints: ['src/lib/server/db/migrate.ts'],
	outfile: 'build/migrate.js'
});
if (fs.existsSync('src/cli.ts')) {
	await build({ ...common, entryPoints: ['src/cli.ts'], outfile: 'build/cli.js' });
}
