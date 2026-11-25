import { INTL_LOCALE, type Locale } from './locales';

export type MessageParams = Record<string, string | number>;

const pluralRulesCache = new Map<string, Intl.PluralRules>();

function pluralRules(locale: Locale): Intl.PluralRules {
	let rules = pluralRulesCache.get(locale);
	if (!rules) {
		rules = new Intl.PluralRules(INTL_LOCALE[locale]);
		pluralRulesCache.set(locale, rules);
	}
	return rules;
}

/** Splits `one {…} other {…}` plural branches, honouring nested braces. */
function parseBranches(source: string): Map<string, string> {
	const branches = new Map<string, string>();
	let index = 0;
	while (index < source.length) {
		const open = source.indexOf('{', index);
		if (open === -1) {
			break;
		}
		const selector = source.slice(index, open).trim();
		let depth = 1;
		let cursor = open + 1;
		while (cursor < source.length && depth > 0) {
			if (source[cursor] === '{') depth += 1;
			if (source[cursor] === '}') depth -= 1;
			cursor += 1;
		}
		branches.set(selector, source.slice(open + 1, cursor - 1));
		index = cursor;
	}
	return branches;
}

function formatNumberValue(locale: Locale, value: string | number): string {
	return typeof value === 'number' ? value.toLocaleString(INTL_LOCALE[locale]) : value;
}

/**
 * Formats a message with a small ICU subset: `{name}` placeholders and
 * `{name, plural, =0 {…} one {# item} other {# items}}`, where `#` is the locale-formatted number.
 * Messages stay plain strings, so translators never touch code.
 */
export function formatMessage(
	locale: Locale,
	template: string,
	params: MessageParams = {}
): string {
	let output = '';
	let index = 0;
	while (index < template.length) {
		const open = template.indexOf('{', index);
		if (open === -1) {
			output += template.slice(index);
			break;
		}
		output += template.slice(index, open);
		let depth = 1;
		let cursor = open + 1;
		while (cursor < template.length && depth > 0) {
			if (template[cursor] === '{') depth += 1;
			if (template[cursor] === '}') depth -= 1;
			cursor += 1;
		}
		const body = template.slice(open + 1, cursor - 1);
		const [rawName, rawKind, ...rest] = body.split(',');
		const name = rawName.trim();
		const value = params[name];
		if (rawKind?.trim() === 'plural') {
			const count = typeof value === 'number' ? value : Number(value ?? 0);
			const branches = parseBranches(rest.join(','));
			const branch =
				branches.get(`=${count}`) ??
				branches.get(pluralRules(locale).select(count)) ??
				branches.get('other') ??
				'';
			output += formatMessage(
				locale,
				branch.replaceAll('#', formatNumberValue(locale, count)),
				params
			);
		} else {
			output += value === undefined ? `{${name}}` : formatNumberValue(locale, value);
		}
		index = cursor;
	}
	return output;
}

/** Placeholder names a template uses (including inside plural branches), for the parity test. */
export function placeholderNames(template: string): string[] {
	const names = new Set<string>();
	const collect = (source: string): void => {
		let index = 0;
		while (index < source.length) {
			const open = source.indexOf('{', index);
			if (open === -1) {
				return;
			}
			let depth = 1;
			let cursor = open + 1;
			while (cursor < source.length && depth > 0) {
				if (source[cursor] === '{') depth += 1;
				if (source[cursor] === '}') depth -= 1;
				cursor += 1;
			}
			const body = source.slice(open + 1, cursor - 1);
			const [rawName, rawKind, ...rest] = body.split(',');
			names.add(rawName.trim());
			if (rawKind?.trim() === 'plural') {
				for (const branch of parseBranches(rest.join(',')).values()) {
					collect(branch);
				}
			}
			index = cursor;
		}
	};
	collect(template);
	return [...names].sort();
}
