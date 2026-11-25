import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
	plugins: [WxtVitest()],
	define: {
		__IZGAH_DEFAULT_ORIGIN__: JSON.stringify('http://localhost:3000')
	},
	test: {
		include: ['tests/unit/**/*.test.ts'],
		setupFiles: ['tests/setup-locale.ts'],
		environment: 'jsdom'
	}
});
