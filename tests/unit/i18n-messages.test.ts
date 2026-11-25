import { describe, expect, it } from 'vitest';
import { formatMessage, placeholderNames } from '../../src/lib/i18n/format';
import { cssText, isLocale, t, toLocale } from '../../src/lib/i18n';
import { en } from '../../src/lib/i18n/messages/en';
import { tr } from '../../src/lib/i18n/messages/tr';
import { dayLabel, formatDayKeyShort } from '../../src/lib/format/date';

describe('message catalogs (izgah-i18n-oss.md §1)', () => {
	it('have exactly the same keys in en and tr', () => {
		expect(Object.keys(tr).sort()).toEqual(Object.keys(en).sort());
	});

	it('use the same placeholders in every locale', () => {
		const mismatches = Object.keys(en).filter((key) => {
			const k = key as keyof typeof en;
			return placeholderNames(en[k]).join() !== placeholderNames(tr[k]).join();
		});
		expect(mismatches).toEqual([]);
	});

	it('have no empty translations', () => {
		const empty = Object.entries({ ...en, ...tr }).filter(([, value]) => value.trim() === '');
		expect(empty).toEqual([]);
	});
});

describe('formatMessage', () => {
	it('fills placeholders and formats numbers for the locale', () => {
		expect(formatMessage('en', 'Hello {name}', { name: 'Ada' })).toBe('Hello Ada');
		expect(formatMessage('en', '{count} items', { count: 1234 })).toBe('1,234 items');
		expect(formatMessage('tr', '{count} öğe', { count: 1234 })).toBe('1.234 öğe');
	});

	it('selects plural branches with Intl.PluralRules', () => {
		const template = '{count, plural, =0 {no likes} one {# like} other {# likes}}';
		expect(formatMessage('en', template, { count: 0 })).toBe('no likes');
		expect(formatMessage('en', template, { count: 1 })).toBe('1 like');
		expect(formatMessage('en', template, { count: 5 })).toBe('5 likes');
		expect(
			formatMessage('en', '{n, plural, one {# x} other {# xs}} of {total}', { n: 2, total: 9 })
		).toBe('2 xs of 9');
	});

	it('keeps unknown placeholders visible instead of dropping them', () => {
		expect(formatMessage('en', 'Hi {missing}')).toBe('Hi {missing}');
	});
});

describe('locale helpers', () => {
	it('normalizes raw values to supported locales', () => {
		expect(toLocale('tr-TR')).toBe('tr');
		expect(toLocale('EN_us')).toBe('en');
		expect(toLocale('de')).toBe('en');
		expect(toLocale(undefined, 'tr')).toBe('tr');
		expect(isLocale('tr')).toBe(true);
		expect(isLocale('fr')).toBe(false);
	});

	it('translates with an explicit locale and falls back to the default', () => {
		expect(t('nav.feed', undefined, { locale: 'en' })).toBe('Feed');
		expect(t('nav.feed', undefined, { locale: 'tr' })).toBe('Akış');
		// Tests run with DEFAULT_LOCALE=tr (tests/setup/locale.ts).
		expect(t('nav.feed')).toBe('Akış');
		expect(t('like.label', { count: 1, title: 'X' }, { locale: 'en' })).toBe('1 like — X');
		expect(t('like.label', { count: 3, title: 'X' }, { locale: 'tr' })).toBe('3 beğeni — X');
	});

	it('quotes text for CSS content properties', () => {
		expect(cssText('Durum')).toBe('"Durum"');
		expect(cssText('a "b"')).toBe('"a \\"b\\""');
	});
});

describe('localized day labels', () => {
	it('uses Turkish names in the Turkish test locale', () => {
		expect(dayLabel('2026-11-25', '2026-11-25')).toBe('Bugün');
		expect(dayLabel('2026-11-24', '2026-11-25')).toBe('Dün');
		expect(dayLabel('2026-11-24', '2026-11-27')).toBe('Salı');
		expect(dayLabel('2026-10-18', '2026-11-25')).toBe('18 Ekim');
		expect(dayLabel('2025-10-18', '2026-11-25')).toBe('18 Ekim 2025');
		expect(formatDayKeyShort('2026-11-20')).toBe('20 Kas');
	});
});
