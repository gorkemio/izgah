import { describe, expect, it } from 'vitest';
import {
	formatDate,
	formatDateTime,
	formatDateTimeWithSeconds,
	formatWhen
} from '../../src/lib/format/date';

describe('Europe/Istanbul date formatting', () => {
	// 22:30 UTC on 19 November is 01:30 on 20 November in Istanbul (UTC+3).
	const lateUtc = '2026-11-19T22:30:05Z';

	it('renders Istanbul wall time regardless of the server time zone', () => {
		expect(formatDateTime(lateUtc)).toMatch(/20 Kas 2026/);
		expect(formatDateTime(lateUtc)).toMatch(/01:30/);
		expect(formatDateTimeWithSeconds(lateUtc)).toMatch(/01:30:05/);
	});

	it('uses the Istanbul calendar day for date-only output', () => {
		expect(formatDate(lateUtc)).toBe(formatDate(new Date('2026-11-20T12:00:00Z')));
	});

	it('shows one date and time, with the year only when it differs', () => {
		const now = '2026-11-25T12:00:00Z';
		expect(formatWhen(lateUtc, now)).toBe('20 Kas 01:30');
		expect(formatWhen('2025-03-04T09:05:00Z', now)).toBe('4 Mar 2025 12:05');
		expect(formatWhen('not-a-date', now)).toBe('not-a-date');
	});

	it('falls back to the raw input for invalid dates', () => {
		expect(formatDateTime('not-a-date')).toBe('not-a-date');
	});
});
