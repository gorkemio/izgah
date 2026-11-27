import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import tseslint from 'typescript-eslint';
import { loadConfig } from '@sveltejs/load-config';

const svelteConfig = (await loadConfig('./', { traverse: false }))?.config;

export default tseslint.config(
	{
		ignores: [
			'.claude/**',
			'.svelte-kit/**',
			'build/**',
			'node_modules/**',
			'drizzle/**',
			'.local-data/**',
			'playwright-report/**',
			'test-results/**',
			'extensions/**'
		]
	},
	js.configs.recommended,
	...tseslint.configs.recommended,
	...svelte.configs['flat/recommended'],
	...svelte.configs['flat/prettier'],
	{
		languageOptions: {
			globals: {
				process: 'readonly',
				console: 'readonly',
				URL: 'readonly'
			}
		}
	},
	{
		files: ['**/*.ts'],
		rules: {
			'no-undef': 'off'
		}
	},
	{
		// izgah.com's script runs as a plain browser script.
		files: ['site/**/*.js'],
		languageOptions: {
			globals: {
				document: 'readonly',
				navigator: 'readonly',
				Element: 'readonly',
				setTimeout: 'readonly',
				clearTimeout: 'readonly'
			}
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: {
				parser: tseslint.parser,
				svelteConfig
			}
		},
		rules: {
			'no-undef': 'off',
			// Rules added by eslint-plugin-svelte 3's recommended set. Izgah is always served from the
			// site root (no `paths.base`), so resolve() adds nothing; the reactivity/snippet rules are
			// style preferences to adopt in a separate change, not part of the dependency upgrade.
			'svelte/no-navigation-without-resolve': 'off',
			'svelte/prefer-svelte-reactivity': 'off',
			'svelte/no-useless-children-snippet': 'off',
			'svelte/prefer-writable-derived': 'off',
			'svelte/no-useless-mustaches': 'off'
		}
	},
	{
		rules: {
			'@typescript-eslint/no-unused-vars': [
				'error',
				{
					argsIgnorePattern: '^_',
					varsIgnorePattern: '^_'
				}
			]
		}
	}
);
