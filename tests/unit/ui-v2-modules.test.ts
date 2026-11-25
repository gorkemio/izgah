import { describe, expect, it } from 'vitest';
import { resolveShortcut, type ShortcutEventLike } from '../../src/lib/client/keyboard-filter';
import { groupByDay } from '../../src/lib/feed/group-by-day';
import { mergeRefreshedFirstPage } from '../../src/lib/feed/merge';
import { dayKey, dayLabel, formatTime, todayKey } from '../../src/lib/format/date';
import { extractShareFromText, firstUriFromUriList } from '../../src/lib/share/paste';

describe('Istanbul day keys and labels', () => {
	it('switches day at Istanbul midnight (21:00Z), not UTC midnight', () => {
		expect(dayKey('2026-11-19T20:59:59Z')).toBe('2026-11-19');
		expect(dayKey('2026-11-19T21:00:00Z')).toBe('2026-11-20');
		expect(formatTime('2026-11-19T21:05:00Z')).toBe('00:05');
	});

	it('labels days with static Turkish names', () => {
		const today = '2026-11-20';
		expect(dayLabel('2026-11-20', today)).toBe('Bugün');
		expect(dayLabel('2026-11-19', today)).toBe('Dün');
		expect(dayLabel('2026-11-17', today)).toBe('Salı');
		expect(dayLabel('2026-11-10', today)).toBe('10 Kasım');
		expect(dayLabel('2025-12-31', '2026-01-05')).toBe('Çarşamba');
		expect(dayLabel('2025-12-01', '2026-01-05')).toBe('1 Aralık 2025');
		expect(todayKey(new Date('2026-12-31T21:30:00Z'))).toBe('2027-01-01');
	});

	it('groups consecutive items by day', () => {
		const groups = groupByDay(
			[
				{ id: 'a', createdAt: '2026-11-20T09:00:00Z' },
				{ id: 'b', createdAt: '2026-11-19T22:00:00Z' },
				{ id: 'c', createdAt: '2026-11-19T10:00:00Z' }
			],
			'2026-11-20'
		);
		expect(groups.map((group) => [group.label, group.items.map((item) => item.id)])).toEqual([
			['Bugün', ['a', 'b']],
			['Dün', ['c']]
		]);
	});
});

describe('mergeRefreshedFirstPage', () => {
	const item = (id: string, minute: number) => ({
		id,
		createdAt: `2026-11-20T10:${String(minute).padStart(2, '0')}:00.000Z`
	});

	it('keeps appended pages and carries items pushed out by new shares', () => {
		const previous = [item('p3', 30), item('p2', 20), item('p1', 10)];
		const appended = [item('a2', 5), item('a1', 1)];
		const fresh = [item('new', 40), item('p3', 30), item('p2', 20)];
		const result = mergeRefreshedFirstPage({
			previousFirstPage: previous,
			appended,
			freshFirstPage: fresh,
			pageSize: 3
		});
		expect(result.reset).toBe(false);
		expect(result.appended.map((entry) => entry.id)).toEqual(['p1', 'a2', 'a1']);
	});

	it('drops items deleted inside the refreshed window', () => {
		const previous = [item('p3', 30), item('p2', 20), item('p1', 10)];
		const fresh = [item('p3', 30), item('p1', 10), item('a2', 5)];
		const result = mergeRefreshedFirstPage({
			previousFirstPage: previous,
			appended: [item('a2', 5), item('a1', 1)],
			freshFirstPage: fresh,
			pageSize: 3
		});
		expect(result.appended.map((entry) => entry.id)).toEqual(['a1']);
	});

	it('resets when more than a full page of new items arrived', () => {
		const previous = [item('p2', 20), item('p1', 10)];
		const fresh = [item('n3', 50), item('n2', 45)];
		const result = mergeRefreshedFirstPage({
			previousFirstPage: previous,
			appended: [item('a1', 1)],
			freshFirstPage: fresh,
			pageSize: 2
		});
		expect(result.reset).toBe(true);
	});
});

describe('paste extraction', () => {
	it('splits a WhatsApp message into URL and note', () => {
		const pasted = extractShareFromText('Şuna bakın https://github.com/sveltejs/kit?utm_source=x');
		expect(pasted?.url).toContain('https://github.com/sveltejs/kit');
		expect(pasted?.host).toBe('github.com');
		expect(pasted?.note).toBe('Şuna bakın');
		expect(extractShareFromText('bağlantı yok burada')).toBeNull();
	});

	it('reads the first non-comment line of text/uri-list', () => {
		expect(firstUriFromUriList('# yorum\r\nhttps://a.example/x\r\nhttps://b.example')).toBe(
			'https://a.example/x'
		);
		expect(firstUriFromUriList('# yalnız yorum')).toBeNull();
	});
});

describe('resolveShortcut', () => {
	const base: ShortcutEventLike = {
		key: 'j',
		ctrlKey: false,
		metaKey: false,
		altKey: false,
		shiftKey: false,
		isComposing: false,
		keyCode: 74,
		defaultPrevented: false,
		target: null
	};
	const on = { enabled: true, overlayOpen: false };

	it('accepts Turkish Q shifted symbols and Caps Lock letters', () => {
		expect(resolveShortcut({ ...base, key: '/', shiftKey: true }, on)).toBe('/');
		expect(resolveShortcut({ ...base, key: '?', shiftKey: true }, on)).toBe('?');
		expect(resolveShortcut({ ...base, key: 'J' }, on)).toBe('j');
		expect(resolveShortcut({ ...base, key: 'J', shiftKey: true }, on)).toBeNull();
	});

	it('ignores modifiers, IME composition, handled events, overlays and the off switch', () => {
		expect(resolveShortcut({ ...base, ctrlKey: true }, on)).toBeNull();
		expect(resolveShortcut({ ...base, altKey: true, ctrlKey: true }, on)).toBeNull();
		expect(resolveShortcut({ ...base, isComposing: true }, on)).toBeNull();
		expect(resolveShortcut({ ...base, keyCode: 229 }, on)).toBeNull();
		expect(resolveShortcut({ ...base, defaultPrevented: true }, on)).toBeNull();
		expect(resolveShortcut(base, { enabled: true, overlayOpen: true })).toBeNull();
		expect(resolveShortcut(base, { enabled: false, overlayOpen: false })).toBeNull();
		expect(resolveShortcut({ ...base, key: 'x' }, on)).toBeNull();
	});
});
