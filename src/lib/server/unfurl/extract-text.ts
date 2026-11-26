import { Parser } from 'htmlparser2';

/**
 * Readable page text for search and AI enrichment (docs/designs/izgah-smart-capture.md §4).
 * Fed with htmlparser2 events after </head>; prefers <article>/<main> when they hold enough text.
 */

export const MAX_CONTENT_TEXT_LENGTH = 20_000;
export const MAX_BODY_HTML_BYTES = 512 * 1024;
const MIN_MAIN_TEXT_LENGTH = 500;
/** Raw collection stops a little above the stored cap so whitespace collapsing has room. */
const COLLECT_LIMIT = MAX_CONTENT_TEXT_LENGTH * 2;

const SKIPPED_TAGS = new Set([
	'script',
	'style',
	'noscript',
	'template',
	'svg',
	'nav',
	'header',
	'footer',
	'aside',
	'form',
	'button',
	'select',
	'iframe',
	'canvas',
	'dialog'
]);

const BLOCK_TAGS = new Set([
	'p',
	'div',
	'br',
	'li',
	'ul',
	'ol',
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'section',
	'article',
	'main',
	'blockquote',
	'pre',
	'tr',
	'td',
	'th',
	'figcaption',
	'dt',
	'dd'
]);

const VOID_TAGS = new Set(['br', 'img', 'hr', 'input', 'meta', 'link', 'source', 'wbr']);

/** Control characters except tab/newline/carriage return become spaces. */
function replaceControlChars(text: string): string {
	let out = '';
	for (const char of text) {
		const code = char.charCodeAt(0);
		const isControl =
			(code < 0x20 && char !== '\n' && char !== '\t' && char !== '\r') || code === 0x7f;
		out += isControl ? ' ' : char;
	}
	return out;
}

function collapse(text: string): string {
	return replaceControlChars(text)
		.replace(/[^\S\n]+/g, ' ')
		.replace(/\s*\n\s*/g, '\n')
		.replace(/\n{2,}/g, '\n')
		.trim();
}

function truncate(text: string): string {
	if (text.length <= MAX_CONTENT_TEXT_LENGTH) {
		return text;
	}
	const cut = text.slice(0, MAX_CONTENT_TEXT_LENGTH);
	const lastSpace = cut.lastIndexOf(' ');
	return (lastSpace > MAX_CONTENT_TEXT_LENGTH * 0.9 ? cut.slice(0, lastSpace) : cut).trim();
}

export class ReadableTextCollector {
	#skipDepth = 0;
	#mainDepth = 0;
	#body = '';
	#main = '';

	openTag(name: string): void {
		if (SKIPPED_TAGS.has(name)) {
			if (!VOID_TAGS.has(name)) {
				this.#skipDepth += 1;
			}
			return;
		}
		if (name === 'article' || name === 'main') {
			this.#mainDepth += 1;
		}
		if (BLOCK_TAGS.has(name)) {
			this.#append('\n');
		}
	}

	closeTag(name: string): void {
		if (SKIPPED_TAGS.has(name)) {
			this.#skipDepth = Math.max(0, this.#skipDepth - 1);
			return;
		}
		if (name === 'article' || name === 'main') {
			this.#mainDepth = Math.max(0, this.#mainDepth - 1);
		}
		if (BLOCK_TAGS.has(name)) {
			this.#append('\n');
		}
	}

	text(chunk: string): void {
		if (this.#skipDepth > 0) {
			return;
		}
		this.#append(chunk);
	}

	/** Enough text collected; the caller may stop reading. */
	isFull(): boolean {
		return this.#body.length >= COLLECT_LIMIT;
	}

	result(): string | null {
		const main = collapse(this.#main);
		const text = main.length >= MIN_MAIN_TEXT_LENGTH ? main : collapse(this.#body);
		return text.length > 0 ? truncate(text) : null;
	}

	#append(value: string): void {
		if (this.#body.length < COLLECT_LIMIT) {
			this.#body += value;
		}
		if (this.#mainDepth > 0 && this.#main.length < COLLECT_LIMIT) {
			this.#main += value;
		}
	}
}

/** Parses a whole HTML document (tests and non-streaming callers). */
export function extractReadableTextFromHtml(html: string): string | null {
	const collector = new ReadableTextCollector();
	let inBody = false;
	const parser = new Parser(
		{
			onopentag(name) {
				if (name === 'body') {
					inBody = true;
				} else if (inBody) {
					collector.openTag(name);
				}
			},
			ontext(text) {
				if (inBody) {
					collector.text(text);
				}
			},
			onclosetag(name) {
				if (inBody && name !== 'body') {
					collector.closeTag(name);
				}
			}
		},
		{ decodeEntities: true, lowerCaseTags: true }
	);
	parser.write(html);
	parser.end();
	return collector.result();
}
