import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setFallbackLocale } from '../../src/lib/i18n';
import {
	dayLabel,
	formatDate,
	formatDayKeyShort,
	formatTime,
	formatWhen
} from '../../src/lib/format/date';
import { contentTypeLabel } from '../../src/lib/types/feed';

// The default (base) locale is English; tests normally run in Turkish (tests/setup/locale.ts).
describe('English base locale', () => {
	beforeAll(() => setFallbackLocale('en'));
	afterAll(() => setFallbackLocale('tr'));

	it('formats day labels in English', () => {
		expect(dayLabel('2026-11-25', '2026-11-25')).toBe('Today');
		expect(dayLabel('2026-11-24', '2026-11-25')).toBe('Yesterday');
		expect(dayLabel('2026-11-24', '2026-11-27')).toBe('Tuesday');
		expect(dayLabel('2026-10-18', '2026-11-25')).toBe('October 18');
		expect(dayLabel('2025-10-18', '2026-11-25')).toBe('October 18, 2025');
		expect(formatDayKeyShort('2026-11-20')).toBe('Nov 20');
	});

	it('formats dates in the instance time zone', () => {
		// 21:30 UTC is 00:30 the next day in Europe/Istanbul (tests/setup/locale.ts).
		expect(formatDate('2026-11-20T21:30:00Z')).toBe('Nov 21, 2026');
		expect(formatTime('2026-11-20T21:30:00Z')).toBe('00:30');
		expect(formatWhen('2026-11-20T21:30:00Z', '2026-11-25T12:00:00Z')).toBe('Nov 21, 00:30');
	});

	it('labels content types', () => {
		expect(contentTypeLabel('article')).toBe('Article');
		expect(contentTypeLabel('unknown')).toBe('Web');
	});
});
