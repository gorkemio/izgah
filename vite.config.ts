import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	build: {
		// Never inline web fonts as data: URIs (docs/designs/izgah-ui-v2.md §2): they must be
		// served from 'self' so the Faz 8 CSP (font-src 'self') and the preload links keep working.
		assetsInlineLimit: (filePath) => (filePath.endsWith('.woff2') ? false : undefined)
	},
	ssr: {
		external: ['better-auth']
	}
});
