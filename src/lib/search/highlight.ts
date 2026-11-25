export interface HighlightPart {
	text: string;
	match: boolean;
}

const MIN_TERM_LENGTH = 2;
const MAX_TERMS = 8;

/**
 * Folds one character for accent- and case-insensitive matching that mirrors the server's
 * `unaccent` + Turkish search (ı/i, ş/s, ğ/g, ü/u, ö/o, ç/c). Always returns exactly one
 * character so indices in the folded string line up with the original text.
 */
function foldChar(char: string): string {
	const lower = char.toLocaleLowerCase('tr');
	if (lower === 'ı') {
		return 'i';
	}
	const stripped = lower.normalize('NFD').replace(/\p{M}/gu, '');
	return stripped.length === 1 ? stripped : lower.length === 1 ? lower : char;
}

function fold(text: string): string {
	let out = '';
	for (const char of text) {
		// Astral characters (emoji) never match a term; keep their UTF-16 length.
		out += char.length === 1 ? foldChar(char) : char;
	}
	return out;
}

/** Search terms from a websearch-style query: quotes, `-` exclusions and OR are dropped. */
export function highlightTerms(query: string): string[] {
	const terms = new Set<string>();
	for (const raw of query.split(/\s+/)) {
		if (raw.startsWith('-')) {
			continue;
		}
		const term = fold(raw.replace(/^["'(]+|["'),.;:!?]+$/g, ''));
		if (term.length >= MIN_TERM_LENGTH && term !== 'or') {
			terms.add(term);
		}
		if (terms.size >= MAX_TERMS) {
			break;
		}
	}
	return [...terms];
}

/**
 * Splits plain text into matched / unmatched parts for rendering with <mark> (no {@html}).
 * Overlapping matches are merged; longer terms win at the same position.
 */
export function splitHighlights(text: string, terms: readonly string[]): HighlightPart[] {
	if (!text || terms.length === 0) {
		return text ? [{ text, match: false }] : [];
	}
	const folded = fold(text);
	const ranges: Array<[number, number]> = [];
	const ordered = [...terms].sort((a, b) => b.length - a.length);
	for (const term of ordered) {
		let from = 0;
		while (from <= folded.length - term.length) {
			const index = folded.indexOf(term, from);
			if (index === -1) {
				break;
			}
			ranges.push([index, index + term.length]);
			from = index + term.length;
		}
	}
	if (ranges.length === 0) {
		return [{ text, match: false }];
	}
	ranges.sort((a, b) => a[0] - b[0]);
	const merged: Array<[number, number]> = [];
	for (const range of ranges) {
		const last = merged.at(-1);
		if (last && range[0] <= last[1]) {
			last[1] = Math.max(last[1], range[1]);
		} else {
			merged.push([...range]);
		}
	}
	const parts: HighlightPart[] = [];
	let cursor = 0;
	for (const [start, end] of merged) {
		if (start > cursor) {
			parts.push({ text: text.slice(cursor, start), match: false });
		}
		parts.push({ text: text.slice(start, end), match: true });
		cursor = end;
	}
	if (cursor < text.length) {
		parts.push({ text: text.slice(cursor), match: false });
	}
	return parts;
}
