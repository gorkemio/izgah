import { afterEach, describe, expect, it } from 'vitest';
import en from '../../public/_locales/en/messages.json';
import tr from '../../public/_locales/tr/messages.json';
import { localizeDocument, msg } from '../../src/lib/i18n';
import { normalizeServerOrigin } from '../../src/lib/url';

describe('extension i18n (izgah-i18n-oss.md §7)', () => {
	afterEach(() => {
		globalThis.__IZGAH_EXTENSION_LOCALE__ = 'tr';
	});

	it('ships the same keys and substitutions in every locale', () => {
		expect(Object.keys(tr).sort()).toEqual(Object.keys(en).sort());
		const subs = (text: string) => (text.match(/\$\d/g) ?? []).sort().join();
		const mismatched = Object.keys(en).filter(
			(key) =>
				subs((en as Record<string, { message: string }>)[key]!.message) !==
				subs((tr as Record<string, { message: string }>)[key]!.message)
		);
		expect(mismatched).toEqual([]);
	});

	it('translates messages and substitutions in English', () => {
		globalThis.__IZGAH_EXTENSION_LOCALE__ = 'en';
		expect(msg('share')).toBe('Share');
		expect(msg('errRetryAfter', 30)).toBe('Please wait 30 seconds and try again.');
		const result = normalizeServerOrigin('');
		expect(result.ok ? null : result.message).toBe('The Izgah server address cannot be empty.');
	});

	it('localizes data-i18n markup and sets the document language', () => {
		globalThis.__IZGAH_EXTENSION_LOCALE__ = 'en';
		document.body.innerHTML = `
			<h1 data-i18n="popupTitle">x</h1>
			<input data-i18n-attr="placeholder:urlPlaceholder aria-label:linkAddress" />
		`;
		localizeDocument(document);
		expect(document.documentElement.lang).toBe('en');
		expect(document.querySelector('h1')?.textContent).toBe('Share to Izgah');
		const input = document.querySelector('input');
		expect(input?.getAttribute('placeholder')).toBe('https://example.com/article');
		expect(input?.getAttribute('aria-label')).toBe('Link address');

		globalThis.__IZGAH_EXTENSION_LOCALE__ = 'tr';
		localizeDocument(document);
		expect(document.documentElement.lang).toBe('tr');
		expect(document.querySelector('h1')?.textContent).toBe("İzgah'a paylaş");
	});
});
