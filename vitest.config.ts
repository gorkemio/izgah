import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

const testDatabaseUrl =
	process.env.TEST_DATABASE_URL ?? 'postgresql://izgah:izgah@127.0.0.1:5432/izgah_test';

export default defineConfig({
	plugins: [sveltekit()],
	test: {
		include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
		fileParallelism: false,
		environment: 'node',
		testTimeout: 30000,
		hookTimeout: 30000,
		setupFiles: ['tests/setup/locale.ts'],
		env: {
			DEFAULT_LOCALE: 'tr',
			APP_TIME_ZONE: 'Europe/Istanbul',
			INSTANCE_NAME: 'İzgah',
			NODE_ENV: 'test',
			TEST_DATABASE_URL: testDatabaseUrl,
			DATABASE_URL: testDatabaseUrl,
			BETTER_AUTH_SECRET:
				process.env.BETTER_AUTH_SECRET ?? 'test-only-secret-key-at-least-32-chars!!',
			ORIGIN: process.env.ORIGIN ?? 'http://localhost:3000',
			MEDIA_STORAGE_DIR: process.env.MEDIA_STORAGE_DIR ?? './.local-data/test-thumbnails'
		}
	}
});
