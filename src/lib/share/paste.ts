import { extractFirstUrlFromText } from '$lib/links/parse-url';

export interface PastedShare {
	url: string;
	/** Remaining text (e.g. a WhatsApp message around the link), offered as the note. */
	note: string | null;
	host: string;
}

/** Extracts the first http(s) URL from pasted plain text, or null when there is none. */
export function extractShareFromText(text: string): PastedShare | null {
	const { url, suggestedNote } = extractFirstUrlFromText(text);
	if (!url) {
		return null;
	}
	let host = '';
	try {
		host = new URL(url).hostname.replace(/^www\./, '');
	} catch {
		return null;
	}
	const note = suggestedNote?.trim() ? suggestedNote.trim() : null;
	return { url, note, host };
}

/** First non-comment line of a `text/uri-list` payload (RFC 2483). */
export function firstUriFromUriList(uriList: string): string | null {
	for (const line of uriList.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (trimmed && !trimmed.startsWith('#')) {
			return trimmed;
		}
	}
	return null;
}
