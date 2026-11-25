import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const isDockerSmoke = process.env.PLAYWRIGHT_DOCKER_SMOKE === '1';
const testDatabaseUrl =
	process.env.TEST_DATABASE_URL ?? 'postgresql://izgah:izgah@127.0.0.1:5432/izgah_test';
const mediaStorageDir = process.env.MEDIA_STORAGE_DIR ?? './.local-data/test-thumbnails';
const authSecret = process.env.BETTER_AUTH_SECRET ?? 'test-only-secret-key-at-least-32-chars!!';

process.env.TEST_DATABASE_URL = testDatabaseUrl;
process.env.DATABASE_URL = testDatabaseUrl;
process.env.MEDIA_STORAGE_DIR = mediaStorageDir;
process.env.BETTER_AUTH_SECRET = authSecret;

const definedEnv: Record<string, string> = Object.fromEntries(
	Object.entries(process.env).filter(
		(entry): entry is [string, string] => typeof entry[1] === 'string'
	)
);

let firefoxHomeDir: string | null = null;
if (process.platform === 'darwin') {
	firefoxHomeDir = path.join(os.tmpdir(), 'izgah-pw-firefox-home');
	fs.mkdirSync(firefoxHomeDir, { recursive: true });
}

export default defineConfig({
	testDir: './tests/e2e',
	testIgnore: isDockerSmoke ? [] : ['**/m8-docker-smoke.spec.ts'],
	fullyParallel: false,
	workers: 1,
	forbidOnly: Boolean(process.env.CI),
	retries: process.env.CI ? 1 : 0,
	reporter: 'list',
	use: {
		baseURL: process.env.ORIGIN ?? 'http://127.0.0.1:4173',
		trace: 'on-first-retry'
	},
	webServer: isDockerSmoke
		? undefined
		: {
				command: 'pnpm exec vite dev --host 127.0.0.1 --port 4173 --strictPort',
				url: 'http://127.0.0.1:4173/healthz',
				reuseExistingServer: false,
				timeout: 60_000,
				env: {
					...process.env,
					NODE_ENV: 'test',
					PLAYWRIGHT_E2E: '1',
					// Existing specs assert the Turkish accessible-name contract (izgah-i18n-oss.md §8).
					DEFAULT_LOCALE: 'tr',
					APP_TIME_ZONE: 'Europe/Istanbul',
					INSTANCE_NAME: 'İzgah',
					ADMIN_BOOTSTRAP_EMAIL: '',
					TEST_DATABASE_URL: testDatabaseUrl,
					DATABASE_URL: testDatabaseUrl,
					BETTER_AUTH_SECRET: authSecret,
					ORIGIN: process.env.ORIGIN ?? 'http://127.0.0.1:4173',
					MEDIA_STORAGE_DIR: mediaStorageDir
				}
			},
	// Desktop projects skip @mobile scenarios; the phone projects run only those, with real
	// device emulation (touch, mobile UA, 375–393px viewports) instead of setViewportSize.
	projects: [
		{
			name: 'chromium',
			grepInvert: /@mobile/,
			use: { ...devices['Desktop Chrome'] }
		},
		{
			name: 'firefox',
			grepInvert: /@mobile/,
			use: {
				...devices['Desktop Firefox'],
				...(firefoxHomeDir
					? {
							launchOptions: {
								env: {
									...definedEnv,
									HOME: firefoxHomeDir,
									CFFIXED_USER_HOME: firefoxHomeDir
								}
							}
						}
					: {})
			}
		},
		{
			name: 'webkit',
			grepInvert: /@mobile/,
			use: { ...devices['Desktop Safari'] }
		},
		{
			name: 'mobile-chromium',
			grep: /@mobile/,
			use: { ...devices['Pixel 7'] }
		},
		{
			name: 'mobile-webkit',
			grep: /@mobile/,
			use: { ...devices['iPhone 13'] }
		}
	]
});
