import { slugifySectionName } from '#lib/server/sections/slug.ts';

/**
 * `#section` hashtags in a share note (docs/designs/izgah-smart-capture.md §2).
 * A token matches a section by slug, by the slug of its name, or as a unique prefix (≥ 3 chars).
 * Matched sections are added; a trailing run of matched hashtags is removed from the note.
 */

export interface HashtagSection {
	id: string;
	slug: string;
	name: string;
}

export interface HashtagResult {
	note: string | null;
	sectionIds: string[];
}

const HASHTAG_PATTERN = /(^|\s)#([\p{L}\p{N}][\p{L}\p{N}_-]*)/gu;
const MIN_PREFIX_LENGTH = 3;

export function extractHashtagTokens(note: string): string[] {
	const tokens: string[] = [];
	for (const match of note.matchAll(HASHTAG_PATTERN)) {
		tokens.push(match[2]);
	}
	return tokens;
}

export function matchHashtag(token: string, sections: readonly HashtagSection[]): string | null {
	const key = slugifySectionName(token);
	if (!key) {
		return null;
	}
	const exact = sections.find(
		(section) => section.slug === key || slugifySectionName(section.name) === key
	);
	if (exact) {
		return exact.id;
	}
	if (key.length < MIN_PREFIX_LENGTH) {
		return null;
	}
	const prefixed = sections.filter(
		(section) => section.slug.startsWith(key) || slugifySectionName(section.name).startsWith(key)
	);
	return prefixed.length === 1 ? prefixed[0].id : null;
}

export function applyHashtags(
	note: string | null | undefined,
	sections: readonly HashtagSection[]
): HashtagResult {
	if (!note || sections.length === 0 || !note.includes('#')) {
		return { note: note ?? null, sectionIds: [] };
	}

	const sectionIds: string[] = [];
	const matchedTokens = new Set<string>();
	for (const token of extractHashtagTokens(note)) {
		const sectionId = matchHashtag(token, sections);
		if (sectionId) {
			matchedTokens.add(token);
			if (!sectionIds.includes(sectionId)) {
				sectionIds.push(sectionId);
			}
		}
	}
	if (sectionIds.length === 0) {
		return { note, sectionIds };
	}

	// Strip only the trailing run of matched hashtags ("Great intro #frontend #css").
	const words = note.trimEnd().split(/(\s+)/);
	let cut = words.length;
	for (let index = words.length - 1; index >= 0; index -= 1) {
		const word = words[index];
		if (/^\s+$/.test(word)) {
			continue;
		}
		const match = /^#([\p{L}\p{N}][\p{L}\p{N}_-]*)$/u.exec(word);
		if (!match || !matchedTokens.has(match[1])) {
			break;
		}
		cut = index;
	}
	const stripped = words.slice(0, cut).join('').trim();
	return { note: stripped === '' ? null : stripped, sectionIds };
}
