import { describe, expect, it } from 'vitest';
import { AVATAR_TONES, avatarTone, initials } from '../../src/lib/format/avatar';

describe('initials avatars (izgah-ui-v5.md §3.6)', () => {
	it('takes the first letters of the first and last word', () => {
		expect(initials('Priya Nair')).toBe('PN');
		expect(initials('Görkem İnanç Özdemir')).toBe('GÖ');
		expect(initials('maya')).toBe('M');
		expect(initials('  ')).toBe('');
	});

	it('upper-cases in the given locale', () => {
		expect(initials('ılgaz ince', 'tr')).toBe('Iİ');
		expect(initials('ılgaz ince', 'en')).toBe('II');
	});

	it('gives a stable tone between 1 and the number of tones', () => {
		const tone = avatarTone('5d0f9a6a-ea2c-45d4-b21a-f3ab4d0317b0');
		expect(tone).toBe(avatarTone('5d0f9a6a-ea2c-45d4-b21a-f3ab4d0317b0'));
		for (const id of ['a', 'b', 'demo-u1', 'seed-user-maya', crypto.randomUUID()]) {
			const value = avatarTone(id);
			expect(value).toBeGreaterThanOrEqual(1);
			expect(value).toBeLessThanOrEqual(AVATAR_TONES);
		}
	});
});
