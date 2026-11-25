import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit({
			preprocess: vitePreprocess(),
			adapter: adapter({ out: 'build' }),
			csrf: { trustedOrigins: [] },
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
		})
	],
	build: {
		// Never inline web fonts as data: URIs (docs/designs/izgah-ui-v2.md §2): they must be
		// served from 'self' so the Faz 8 CSP (font-src 'self') and the preload links keep working.
		assetsInlineLimit: (filePath) => (filePath.endsWith('.woff2') ? false : undefined)
	},
	ssr: {
		external: ['better-auth']
	}
});
