import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter({
			out: 'build'
		}),
		csrf: {
			trustedOrigins: []
		},
		// Enforced Content-Security-Policy (docs/designs/izgah-ui-v2.md §11). Kit adds a nonce to
		// its hydration script on SSR pages and hashes on prerendered ones. Verified against the
		// production image by the CSP scenario in tests/e2e/m8-docker-smoke.spec.ts.
		csp: {
			mode: 'auto',
			directives: {
				'default-src': ['self'],
				'script-src': ['self'],
				'style-src': ['self', 'unsafe-inline'],
				'img-src': ['self', 'data:'],
				'font-src': ['self'],
				'connect-src': ['self'],
				'object-src': ['none'],
				'base-uri': ['none'],
				'form-action': ['self'],
				'frame-ancestors': ['none']
			}
		}
	}
};

export default config;
