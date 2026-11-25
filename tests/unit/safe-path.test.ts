import { describe, expect, it } from 'vitest';
import { sanitizeInternalPath } from '../../src/lib/server/http/safe-path';

describe('sanitizeInternalPath', () => {
	it('keeps ordinary same-origin paths with query and hash', () => {
		expect(sanitizeInternalPath('/settings/api-keys?tab=active#keys')).toBe(
			'/settings/api-keys?tab=active#keys'
		);
		expect(sanitizeInternalPath('/sections/yapay-zeka')).toBe('/sections/yapay-zeka');
	});

	it.each([
		'https://evil.com/phish',
		'//evil.com',
		'/\\evil.com',
		'javascript:alert(1)',
		'/.//evil.com/x',
		'/..//evil.com',
		'/%2e//evil.com',
		'/./\\evil.com',
		'/a/../..//evil.com',
		'/\tevil',
		''
	])('rejects %j', (input) => {
		expect(sanitizeInternalPath(input)).toBe('/');
	});

	it('rejects non-string input and uses the provided fallback', () => {
		expect(sanitizeInternalPath(null, { fallback: '/resources/abc' })).toBe('/resources/abc');
		expect(sanitizeInternalPath('/.//evil.com', { fallback: '/resources/abc' })).toBe(
			'/resources/abc'
		);
	});

	it('strips one-shot params and drops the hash when asked', () => {
		expect(
			sanitizeInternalPath('/?type=video&edit=1&compose=1#share-1', {
				stripParams: ['compose', 'edit', 'delete'],
				keepHash: false
			})
		).toBe('/?type=video');
	});

	it('refuses disallowed paths', () => {
		expect(sanitizeInternalPath('/login?next=/x', { disallowPaths: ['/login'] })).toBe('/');
	});
});
