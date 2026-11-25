import { describe, expect, it } from 'vitest';
import { detectModifierKey, modifierLabel, shortcutLabel } from '../../src/lib/platform';

function headers(values: Record<string, string>) {
	return new Headers(values);
}

describe('platform modifier detection', () => {
	it('prefers the Sec-CH-UA-Platform client hint', () => {
		expect(detectModifierKey(headers({ 'sec-ch-ua-platform': '"macOS"' }))).toBe('meta');
		expect(detectModifierKey(headers({ 'sec-ch-ua-platform': '"Windows"' }))).toBe('ctrl');
		expect(
			detectModifierKey(
				headers({ 'sec-ch-ua-platform': '"Linux"', 'user-agent': 'Macintosh; Intel Mac OS X' })
			)
		).toBe('ctrl');
	});

	it('falls back to the User-Agent', () => {
		expect(
			detectModifierKey(
				headers({ 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) Safari/605.1.15' })
			)
		).toBe('meta');
		expect(
			detectModifierKey(headers({ 'user-agent': 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)' }))
		).toBe('meta');
		expect(
			detectModifierKey(headers({ 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) Firefox/133.0' }))
		).toBe('ctrl');
		expect(detectModifierKey(headers({}))).toBe('ctrl');
	});

	it('formats labels', () => {
		expect(modifierLabel('meta')).toBe('⌘');
		expect(modifierLabel('ctrl')).toBe('Ctrl');
		expect(shortcutLabel('meta', 'K')).toBe('⌘K');
		expect(shortcutLabel('ctrl', 'K')).toBe('Ctrl+K');
	});
});
