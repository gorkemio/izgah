import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
	{
		ignores: [
			'.output/**',
			'.wxt/**',
			'safari/**',
			'node_modules/**',
			'coverage/**',
			'playwright-report/**',
			'test-results/**'
		]
	},
	js.configs.recommended,
	...tseslint.configs.recommended,
	{
		languageOptions: {
			globals: {
				process: 'readonly',
				console: 'readonly',
				URL: 'readonly',
				Buffer: 'readonly'
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
