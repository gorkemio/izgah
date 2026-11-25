export const MAX_URL_LENGTH = 2048;

export interface ExtractedUrlFromText {
	url: string | null;
	suggestedNote: string | null;
}

const URL_CANDIDATE_REGEX = /https?:\/\/[^\s<>"'`]+/gi;
const ALWAYS_STRIP_TRAILING_CHARS = new Set(['.', ',', ';', ':', '!', '?']);
const MATCHED_CLOSING_PAIRS: ReadonlyArray<{ open: string; close: string }> = [
	{ open: '(', close: ')' },
	{ open: '[', close: ']' },
	{ open: '{', close: '}' }
];
const WRAPPER_PAIRS: ReadonlyArray<{ open: string; close: string }> = [
	{ open: '(', close: ')' },
	{ open: '[', close: ']' },
	{ open: '<', close: '>' }
];

function asciiLower(value: string): string {
	return value.replace(/[A-Z]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 32));
}

function countChar(text: string, target: string): number {
	let total = 0;
	for (let i = 0; i < text.length; i += 1) {
		if (text[i] === target) {
			total += 1;
		}
	}
	return total;
}

function trimTrailingProsePunctuation(rawCandidate: string): string {
	let candidate = rawCandidate;

	while (candidate.length > 0) {
		const lastChar = candidate[candidate.length - 1];
		if (ALWAYS_STRIP_TRAILING_CHARS.has(lastChar)) {
			candidate = candidate.slice(0, -1);
			continue;
		}

		const pair = MATCHED_CLOSING_PAIRS.find((entry) => entry.close === lastChar);
		if (pair && countChar(candidate, pair.close) > countChar(candidate, pair.open)) {
			candidate = candidate.slice(0, -1);
			continue;
		}

		break;
	}

	return candidate;
}

function isValidHttpUrlCandidate(candidate: string): boolean {
	if (candidate.length === 0 || candidate.length > MAX_URL_LENGTH) {
		return false;
	}
	if (/^https?:\/\/[^/?#]*@/i.test(candidate)) {
		return false;
	}

	let parsed: URL;
	try {
		parsed = new URL(candidate);
	} catch {
		return false;
	}

	const protocol = asciiLower(parsed.protocol);
	if (protocol !== 'http:' && protocol !== 'https:') {
		return false;
	}
	if (!parsed.hostname || parsed.username !== '' || parsed.password !== '') {
		return false;
	}

	return true;
}

function normalizeSuggestedNote(remainingText: string): string | null {
	const cleaned = remainingText
		.split(/\r?\n/)
		.map((line) => line.replace(/[ \t]+/g, ' ').trim())
		.join('\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();

	return cleaned.length > 0 ? cleaned : null;
}

/**
 * Extracts the first valid HTTP(S) URL from pasted text (such as WhatsApp messages)
 * and proposes the remaining non-empty text as a share note.
 */
export function extractFirstUrlFromText(input: string): ExtractedUrlFromText {
	if (typeof input !== 'string' || input.trim().length === 0) {
		return { url: null, suggestedNote: null };
	}

	URL_CANDIDATE_REGEX.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = URL_CANDIDATE_REGEX.exec(input)) !== null) {
		const candidate = trimTrailingProsePunctuation(match[0]);
		if (!isValidHttpUrlCandidate(candidate)) {
			continue;
		}

		let removeStart = match.index;
		let removeEnd = match.index + candidate.length;

		const prevChar = removeStart > 0 ? input[removeStart - 1] : '';
		const nextChar = removeEnd < input.length ? input[removeEnd] : '';
		if (WRAPPER_PAIRS.some((pair) => pair.open === prevChar && pair.close === nextChar)) {
			removeStart -= 1;
			removeEnd += 1;
		}

		const before = input.slice(0, removeStart);
		const after = input.slice(removeEnd);
		const isStandaloneLine = /(?:^|\r?\n)[ \t]*$/.test(before) && /^[ \t]*(?:\r?\n|$)/.test(after);

		let remaining: string;
		if (isStandaloneLine) {
			const cleanBefore = before.replace(/[ \t]+$/, '');
			if (/^[ \t]*\r?\n/.test(after)) {
				remaining = cleanBefore + after.replace(/^[ \t]*\r?\n/, '');
			} else {
				remaining = cleanBefore.replace(/\r?\n$/, '') + after.replace(/^[ \t]+/, '');
			}
		} else {
			remaining = `${before} ${after}`;
		}

		return {
			url: candidate,
			suggestedNote: normalizeSuggestedNote(remaining)
		};
	}

	return {
		url: null,
		suggestedNote: normalizeSuggestedNote(input)
	};
}
