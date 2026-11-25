import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import tseslint from 'typescript-eslint';
import svelteConfig from './svelte.config.js';

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
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: {
				parser: tseslint.parser,
				svelteConfig
			}
		},
		rules: {
			'no-undef': 'off'
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
