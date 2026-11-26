/**
 * Shared, locale-aware date formatting for server and client (docs/designs/izgah-i18n-oss.md §3).
 *
 * The production container runs in UTC while a team usually lives in one time zone. Formatting
 * without an explicit `timeZone` rendered server-side times hours off (sometimes on the wrong day)
 * and then flipped during hydration. Every user-facing date goes through these helpers, which pin
 * the instance's `APP_TIME_ZONE` and the active locale so SSR, hydration and JS-off users all see
 * the same value.
 */
import { getLocale, INTL_LOCALE, t, type Locale } from '#lib/i18n/index.ts';
import { appTimeZone } from '#lib/instance.ts';

type DateInput = Date | string | number;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(
	options: Intl.DateTimeFormatOptions,
	locale: Locale = getLocale()
): Intl.DateTimeFormat {
	const timeZone = appTimeZone();
	const cacheKey = `${locale}|${timeZone}|${JSON.stringify(options)}`;
	let cached = formatterCache.get(cacheKey);
	if (!cached) {
		cached = new Intl.DateTimeFormat(INTL_LOCALE[locale], { ...options, timeZone });
		formatterCache.set(cacheKey, cached);
	}
	return cached;
}

function toDate(value: DateInput): Date | null {
	const date = value instanceof Date ? value : new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

function formatWith(options: Intl.DateTimeFormatOptions, value: DateInput): string {
	const date = toDate(value);
	return date ? formatter(options).format(date) : String(value);
}

/** "Nov 20, 2026, 2:32 PM" / "20 Kas 2026 14:32" */
export function formatDateTime(value: DateInput): string {
	return formatWith({ dateStyle: 'medium', timeStyle: 'short' }, value);
}

/** "Nov 20, 2026, 2:32:05 PM" / "20 Kas 2026 14:32:05" */
export function formatDateTimeWithSeconds(value: DateInput): string {
	return formatWith({ dateStyle: 'medium', timeStyle: 'medium' }, value);
}

/** "Nov 20, 2026" / "20 Kas 2026" */
export function formatDate(value: DateInput): string {
	return formatWith({ dateStyle: 'medium' }, value);
}

/** "14:32" — 24-hour clock in every locale, matching the mono meta style. */
export function formatTime(value: DateInput): string {
	return formatWith({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }, value);
}

// Static names keep labels identical on the server and in every browser (ICU data differs).
const MONTHS: Record<Locale, readonly string[]> = {
	en: [
		'January',
		'February',
		'March',
		'April',
		'May',
		'June',
		'July',
		'August',
		'September',
		'October',
		'November',
		'December'
	],
	tr: [
		'Ocak',
		'Şubat',
		'Mart',
		'Nisan',
		'Mayıs',
		'Haziran',
		'Temmuz',
		'Ağustos',
		'Eylül',
		'Ekim',
		'Kasım',
		'Aralık'
	]
};
const SHORT_MONTHS: Record<Locale, readonly string[]> = {
	en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
	tr: ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']
};
const WEEKDAYS: Record<Locale, readonly string[]> = {
	en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
	tr: ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi']
};

/** Calendar day in the instance time zone as `YYYY-MM-DD`. */
export function dayKey(value: DateInput): string {
	const date = toDate(value);
	if (!date) {
		return '';
	}
	const parts = Object.fromEntries(
		formatter({ year: 'numeric', month: '2-digit', day: '2-digit' }, 'en')
			.formatToParts(date)
			.map((part) => [part.type, part.value])
	);
	return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Today's day key; computed in `load` so SSR and hydration agree. */
export function todayKey(now: DateInput = new Date()): string {
	return dayKey(now);
}

function dayKeyToUtcNoon(key: string): number {
	const [year, month, day] = key.split('-').map(Number);
	return Date.UTC(year, month - 1, day, 12);
}

function dayMonth(locale: Locale, day: number, month: string): string {
	return locale === 'en' ? `${month} ${day}` : `${day} ${month}`;
}

/** "Today", "Yesterday", weekday for the last week, otherwise "November 18" (+ year when different). */
export function dayLabel(key: string, today: string): string {
	if (!key || !today) {
		return '';
	}
	const locale = getLocale();
	const diffDays = Math.round((dayKeyToUtcNoon(today) - dayKeyToUtcNoon(key)) / 86_400_000);
	if (diffDays === 0) {
		return t('date.today');
	}
	if (diffDays === 1) {
		return t('date.yesterday');
	}
	const [year, month, day] = key.split('-').map(Number);
	if (diffDays > 1 && diffDays < 7) {
		return WEEKDAYS[locale][new Date(dayKeyToUtcNoon(key)).getUTCDay()];
	}
	const base = dayMonth(locale, day, MONTHS[locale][month - 1]);
	if (year === Number(today.slice(0, 4))) {
		return base;
	}
	return locale === 'en' ? `${base}, ${year}` : `${base} ${year}`;
}

/**
 * The full date beside a day heading for the last week (izgah-ui-v4 §4): "25 Kasım Çarşamba" /
 * "Wednesday, November 25" after "Bugün" and "Dün", the date alone after a weekday; older headings
 * already are a date, so they get none.
 */
export function dayDetail(key: string, today: string): string {
	if (!key || !today) {
		return '';
	}
	const diffDays = Math.round((dayKeyToUtcNoon(today) - dayKeyToUtcNoon(key)) / 86_400_000);
	if (diffDays < 0 || diffDays >= 7) {
		return '';
	}
	const locale = getLocale();
	const [, month, day] = key.split('-').map(Number);
	const date = dayMonth(locale, day, MONTHS[locale][month - 1]);
	if (diffDays >= 2) {
		return date;
	}
	const weekday = WEEKDAYS[locale][new Date(dayKeyToUtcNoon(key)).getUTCDay()];
	return locale === 'en' ? `${weekday}, ${date}` : `${date} ${weekday}`;
}

/** One short date for the whole UI: "12 Kas" / "Nov 12", with the year only when it differs. */
export function formatShortDate(value: DateInput, now: DateInput = new Date()): string {
	const key = dayKey(value);
	if (!key) {
		return String(value);
	}
	const locale = getLocale();
	const [year, month, day] = key.split('-').map(Number);
	const base = dayMonth(locale, day, SHORT_MONTHS[locale][month - 1]);
	if (year === Number(dayKey(now).slice(0, 4))) {
		return base;
	}
	return locale === 'en' ? `${base}, ${year}` : `${base} ${year}`;
}

/**
 * Date and time for lists, comments, notifications and admin tables: "25 Kas 17:20" /
 * "Nov 25, 17:20", with the year only when it differs (izgah-ui-v4 §10).
 */
export function formatWhen(value: DateInput, now: DateInput = new Date()): string {
	if (!toDate(value)) {
		return String(value);
	}
	const date = formatShortDate(value, now);
	const time = formatTime(value);
	return getLocale() === 'en' ? `${date}, ${time}` : `${date} ${time}`;
}

/** Short "Nov 20" / "20 Kas" label for a `YYYY-MM-DD` key (feed rail heading). */
export function formatDayKeyShort(key: string): string {
	const parts = key.split('-').map(Number);
	if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) {
		return '';
	}
	const locale = getLocale();
	const month = SHORT_MONTHS[locale][parts[1] - 1];
	return month ? dayMonth(locale, parts[2], month) : '';
}
