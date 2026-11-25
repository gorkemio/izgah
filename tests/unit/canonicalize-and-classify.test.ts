import { describe, expect, it } from 'vitest';
import { extractFirstUrlFromText, MAX_URL_LENGTH } from '../../src/lib/links/parse-url';
import type { ContentType } from '../../src/lib/server/db/schema';
import { canonicalizeUrl, UrlCanonicalizeError } from '../../src/lib/server/links/canonicalize';
import { classifyContentType } from '../../src/lib/server/links/classify';

interface CanonicalizeAndClassifyRow {
	label: string;
	input: string;
	ogType?: string;
	expectedRawUrl: string;
	expectedCanonicalUrl: string;
	expectedDomain: string;
	expectedContentType: ContentType;
}

const CANONICALIZE_AND_CLASSIFY_TABLE: CanonicalizeAndClassifyRow[] = [
	{
		label: 'Turkish uppercase ASCII host + İ/ı path normalization (no Turkish locale I->ı bug)',
		input: 'HTTPS://ISTANBUL.GOV.TR/İçerik/ısparta/',
		expectedRawUrl: 'https://istanbul.gov.tr/%C4%B0%C3%A7erik/%C4%B1sparta',
		expectedCanonicalUrl: 'https://istanbul.gov.tr/%C4%B0%C3%A7erik/%C4%B1sparta',
		expectedDomain: 'istanbul.gov.tr',
		expectedContentType: 'web'
	},
	{
		label: 'Turkish IDN İSTANBUL.gov.tr host converts to Punycode ASCII',
		input: 'https://İSTANBUL.gov.tr/İçerik/ısparta/',
		expectedRawUrl: 'https://xn--istanbul-o0e.gov.tr/%C4%B0%C3%A7erik/%C4%B1sparta',
		expectedCanonicalUrl: 'https://xn--istanbul-o0e.gov.tr/%C4%B0%C3%A7erik/%C4%B1sparta',
		expectedDomain: 'xn--istanbul-o0e.gov.tr',
		expectedContentType: 'web'
	},
	{
		label:
			'Turkish IDN ışıltı.örnek.com.tr + default port :80 + /blog/ article segment + trailing slash',
		input: 'HTTP://ışıltı.örnek.com.tr:80/blog/yazı-1/',
		expectedRawUrl: 'http://xn--lt-gpaac6y.xn--rnek-4qa.com.tr/blog/yaz%C4%B1-1',
		expectedCanonicalUrl: 'http://xn--lt-gpaac6y.xn--rnek-4qa.com.tr/blog/yaz%C4%B1-1',
		expectedDomain: 'xn--lt-gpaac6y.xn--rnek-4qa.com.tr',
		expectedContentType: 'article'
	},
	{
		label: 'Turkish İzgah domain + query + hash preserved on rawUrl and stripped on canonicalUrl',
		input: 'https://İzgah.örnek.tr:443/İçerik/ısparta?konu=İletişim&a=1#Bölüm',
		expectedRawUrl:
			'https://xn--izgah-7fd.xn--rnek-4qa.tr/%C4%B0%C3%A7erik/%C4%B1sparta?konu=%C4%B0leti%C5%9Fim&a=1#B%C3%B6l%C3%BCm',
		expectedCanonicalUrl:
			'https://xn--izgah-7fd.xn--rnek-4qa.tr/%C4%B0%C3%A7erik/%C4%B1sparta?a=1&konu=%C4%B0leti%C5%9Fim',
		expectedDomain: 'xn--izgah-7fd.xn--rnek-4qa.tr',
		expectedContentType: 'web'
	},
	{
		label: 'General domain preserves www. prefix, keeps root trailing slash, strips default :443',
		input: 'https://www.example.com:443/',
		expectedRawUrl: 'https://www.example.com/',
		expectedCanonicalUrl: 'https://www.example.com/',
		expectedDomain: 'example.com',
		expectedContentType: 'web'
	},
	{
		label: 'General domain preserves www. prefix and strips non-root trailing slash',
		input: 'https://www.example.com/rehber/',
		expectedRawUrl: 'https://www.example.com/rehber',
		expectedCanonicalUrl: 'https://www.example.com/rehber',
		expectedDomain: 'example.com',
		expectedContentType: 'web'
	},
	{
		label: 'Custom port :8443 is preserved while global tracking params are stripped',
		input:
			'https://docs.example.com:8443/guide/?utm_source=nl&utm_medium=email&fbclid=1&gclid=2&igshid=3&mc_cid=4&mc_eid=5&ref_src=6&ref_url=7&z=2&a=1#top',
		expectedRawUrl: 'https://docs.example.com:8443/guide?z=2&a=1#top',
		expectedCanonicalUrl: 'https://docs.example.com:8443/guide?a=1&z=2',
		expectedDomain: 'docs.example.com',
		expectedContentType: 'web'
	},
	{
		label: 'Preserves ?si=, ?s=, and ?t= on non-scoped domains',
		input: 'https://example.com/query?si=keep&s=search&t=topic',
		expectedRawUrl: 'https://example.com/query?si=keep&s=search&t=topic',
		expectedCanonicalUrl: 'https://example.com/query?s=search&si=keep&t=topic',
		expectedDomain: 'example.com',
		expectedContentType: 'web'
	},
	{
		label:
			'YouTube watch preserves ?t=120 and #hash on rawUrl, strips ?si=, strips t/start on canonicalUrl',
		input: 'https://youtube.com/watch?v=dQw4w9WgXcQ&t=120&si=share123&utm_source=x#bolum',
		expectedRawUrl: 'https://youtube.com/watch?v=dQw4w9WgXcQ&t=120#bolum',
		expectedCanonicalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
		expectedDomain: 'youtube.com',
		expectedContentType: 'video'
	},
	{
		label:
			'youtu.be short link preserves ?t=45 on rawUrl and canonicalizes to www.youtube.com/watch',
		input: 'https://youtu.be/dQw4w9WgXcQ?t=45&si=abc',
		expectedRawUrl: 'https://youtu.be/dQw4w9WgXcQ?t=45',
		expectedCanonicalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
		expectedDomain: 'youtube.com',
		expectedContentType: 'video'
	},
	{
		label: 'YouTube shorts link canonicalizes to www.youtube.com/watch?v=...',
		input: 'https://m.youtube.com/shorts/shortId99?si=abc&start=10',
		expectedRawUrl: 'https://m.youtube.com/shorts/shortId99?start=10',
		expectedCanonicalUrl: 'https://www.youtube.com/watch?v=shortId99',
		expectedDomain: 'youtube.com',
		expectedContentType: 'video'
	},
	{
		label: 'YouTube handle path normalizes mobile hostname to https://www.youtube.com',
		input: 'http://m.youtube.com/@sveltejs?si=track&v=unused',
		expectedRawUrl: 'http://m.youtube.com/@sveltejs?v=unused',
		expectedCanonicalUrl: 'https://www.youtube.com/@sveltejs?v=unused',
		expectedDomain: 'youtube.com',
		expectedContentType: 'web'
	},
	{
		label: 'Spotify track strips ?si= tracking parameter',
		input: 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=trackshare',
		expectedRawUrl: 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT',
		expectedCanonicalUrl: 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT',
		expectedDomain: 'open.spotify.com',
		expectedContentType: 'web'
	},
	{
		label: 'Vimeo and Instagram reels classify as video',
		input: 'https://vimeo.com/123456789/',
		expectedRawUrl: 'https://vimeo.com/123456789',
		expectedCanonicalUrl: 'https://vimeo.com/123456789',
		expectedDomain: 'vimeo.com',
		expectedContentType: 'video'
	},
	{
		label: 'Instagram reel classifies as video',
		input: 'https://www.instagram.com/reel/CxYz123/?igshid=track',
		expectedRawUrl: 'https://www.instagram.com/reel/CxYz123',
		expectedCanonicalUrl: 'https://www.instagram.com/reel/CxYz123',
		expectedDomain: 'instagram.com',
		expectedContentType: 'video'
	},
	{
		label: 'twitter.com status with /photo/1, ?s=, ?t= normalizes to x.com status',
		input: 'https://twitter.com/sveltejs/status/1800000000000/photo/1?s=20&t=abc123',
		expectedRawUrl: 'https://twitter.com/sveltejs/status/1800000000000/photo/1',
		expectedCanonicalUrl: 'https://x.com/sveltejs/status/1800000000000',
		expectedDomain: 'x.com',
		expectedContentType: 'social'
	},
	{
		label: 'mobile.twitter.com status with /video/2 normalizes to x.com status',
		input: 'https://mobile.twitter.com/izgah/status/99887766/video/2?s=46',
		expectedRawUrl: 'https://mobile.twitter.com/izgah/status/99887766/video/2',
		expectedCanonicalUrl: 'https://x.com/izgah/status/99887766',
		expectedDomain: 'x.com',
		expectedContentType: 'social'
	},
	{
		label: 'www.x.com status normalizes to x.com',
		input: 'https://www.x.com/izgah/status/11223344/',
		expectedRawUrl: 'https://www.x.com/izgah/status/11223344',
		expectedCanonicalUrl: 'https://x.com/izgah/status/11223344',
		expectedDomain: 'x.com',
		expectedContentType: 'social'
	},
	{
		label: 'Instagram post classifies as social',
		input: 'https://www.instagram.com/p/AbCdEf123/',
		expectedRawUrl: 'https://www.instagram.com/p/AbCdEf123',
		expectedCanonicalUrl: 'https://www.instagram.com/p/AbCdEf123',
		expectedDomain: 'instagram.com',
		expectedContentType: 'social'
	},
	{
		label: 'Bluesky post classifies as social',
		input: 'https://bsky.app/profile/alice.bsky.social/post/3kabcdef',
		expectedRawUrl: 'https://bsky.app/profile/alice.bsky.social/post/3kabcdef',
		expectedCanonicalUrl: 'https://bsky.app/profile/alice.bsky.social/post/3kabcdef',
		expectedDomain: 'bsky.app',
		expectedContentType: 'social'
	},
	{
		label: 'LinkedIn posts URL classifies as social',
		input: 'https://www.linkedin.com/posts/jane-doe_activity-12345/?utm_source=share',
		expectedRawUrl: 'https://www.linkedin.com/posts/jane-doe_activity-12345',
		expectedCanonicalUrl: 'https://www.linkedin.com/posts/jane-doe_activity-12345',
		expectedDomain: 'linkedin.com',
		expectedContentType: 'social'
	},
	{
		label: 'GitHub www + .git suffix normalizes to github.com/owner/repo and classifies as repo',
		input: 'https://www.github.com/sveltejs/kit.git/',
		expectedRawUrl: 'https://www.github.com/sveltejs/kit.git',
		expectedCanonicalUrl: 'https://github.com/sveltejs/kit',
		expectedDomain: 'github.com',
		expectedContentType: 'repo'
	},
	{
		label: 'GitHub issues URL is not repo and falls back to web',
		input: 'https://github.com/sveltejs/kit/issues/1',
		expectedRawUrl: 'https://github.com/sveltejs/kit/issues/1',
		expectedCanonicalUrl: 'https://github.com/sveltejs/kit/issues/1',
		expectedDomain: 'github.com',
		expectedContentType: 'web'
	},
	{
		label: 'GitHub pull/releases URLs are not repo and fall back to web',
		input: 'https://github.com/sveltejs/kit/pull/2',
		expectedRawUrl: 'https://github.com/sveltejs/kit/pull/2',
		expectedCanonicalUrl: 'https://github.com/sveltejs/kit/pull/2',
		expectedDomain: 'github.com',
		expectedContentType: 'web'
	},
	{
		label: 'GitLab two-segment root classifies as repo',
		input: 'https://gitlab.com/org-name/project-name/',
		expectedRawUrl: 'https://gitlab.com/org-name/project-name',
		expectedCanonicalUrl: 'https://gitlab.com/org-name/project-name',
		expectedDomain: 'gitlab.com',
		expectedContentType: 'repo'
	},
	{
		label: 'Article domains: medium.com subdomain',
		input: 'https://engineering.medium.com/deep-dive-123',
		expectedRawUrl: 'https://engineering.medium.com/deep-dive-123',
		expectedCanonicalUrl: 'https://engineering.medium.com/deep-dive-123',
		expectedDomain: 'engineering.medium.com',
		expectedContentType: 'article'
	},
	{
		label: 'Article domains: substack.com subdomain',
		input: 'https://newsletter.substack.com/p/issue-42',
		expectedRawUrl: 'https://newsletter.substack.com/p/issue-42',
		expectedCanonicalUrl: 'https://newsletter.substack.com/p/issue-42',
		expectedDomain: 'newsletter.substack.com',
		expectedContentType: 'article'
	},
	{
		label: 'Article domains: dev.to and hashnode.dev',
		input: 'https://dev.to/author/postgresql-indexing-1a2b',
		expectedRawUrl: 'https://dev.to/author/postgresql-indexing-1a2b',
		expectedCanonicalUrl: 'https://dev.to/author/postgresql-indexing-1a2b',
		expectedDomain: 'dev.to',
		expectedContentType: 'article'
	},
	{
		label: 'Article domains: *.hashnode.dev',
		input: 'https://notlar.hashnode.dev/turkce-arama',
		expectedRawUrl: 'https://notlar.hashnode.dev/turkce-arama',
		expectedCanonicalUrl: 'https://notlar.hashnode.dev/turkce-arama',
		expectedDomain: 'notlar.hashnode.dev',
		expectedContentType: 'article'
	},
	{
		label: 'Article path segment /articles/ classifies as article',
		input: 'https://example.org/tr/articles/web-standartlari',
		expectedRawUrl: 'https://example.org/tr/articles/web-standartlari',
		expectedCanonicalUrl: 'https://example.org/tr/articles/web-standartlari',
		expectedDomain: 'example.org',
		expectedContentType: 'article'
	},
	{
		label: 'Article path segment /writing/ classifies as article',
		input: 'https://personalsite.dev/writing/svelte-5-runes',
		expectedRawUrl: 'https://personalsite.dev/writing/svelte-5-runes',
		expectedCanonicalUrl: 'https://personalsite.dev/writing/svelte-5-runes',
		expectedDomain: 'personalsite.dev',
		expectedContentType: 'article'
	},
	{
		label: 'Blog index path /blog without child slug stays web',
		input: 'https://example.org/blog/',
		expectedRawUrl: 'https://example.org/blog',
		expectedCanonicalUrl: 'https://example.org/blog',
		expectedDomain: 'example.org',
		expectedContentType: 'web'
	},
	{
		label: 'og:type = article promotes general web URL to article',
		input: 'https://example.org/duyuru-2026',
		ogType: 'article',
		expectedRawUrl: 'https://example.org/duyuru-2026',
		expectedCanonicalUrl: 'https://example.org/duyuru-2026',
		expectedDomain: 'example.org',
		expectedContentType: 'article'
	}
];

describe('canonicalizeUrl and classifyContentType (pure functions)', () => {
	it.each(CANONICALIZE_AND_CLASSIFY_TABLE)(
		'$label',
		({
			input,
			ogType,
			expectedRawUrl,
			expectedCanonicalUrl,
			expectedDomain,
			expectedContentType
		}) => {
			const canonicalized = canonicalizeUrl(input);
			const contentType = classifyContentType(canonicalized.canonicalUrl, ogType);

			expect(canonicalized.rawUrl).toBe(expectedRawUrl);
			expect(canonicalized.canonicalUrl).toBe(expectedCanonicalUrl);
			expect(canonicalized.domain).toBe(expectedDomain);
			expect(contentType).toBe(expectedContentType);
		}
	);

	it.each([
		{ pathSegment: 'blog', expected: 'article' },
		{ pathSegment: 'post', expected: 'article' },
		{ pathSegment: 'posts', expected: 'article' },
		{ pathSegment: 'article', expected: 'article' },
		{ pathSegment: 'articles', expected: 'article' },
		{ pathSegment: 'news', expected: 'article' },
		{ pathSegment: 'writing', expected: 'article' }
	] as const)('recognizes /$pathSegment/ path segment as article', ({ pathSegment, expected }) => {
		const url = `https://example.net/${pathSegment}/ilk-yazi`;
		expect(classifyContentType(url)).toBe(expected);
	});

	it('enforces the 2048 character URL limit and rejects unsafe schemes and credentials', () => {
		const prefix = 'https://example.com/';
		const exact2048 = prefix + 'a'.repeat(MAX_URL_LENGTH - prefix.length);
		expect(exact2048.length).toBe(2048);
		expect(canonicalizeUrl(exact2048).canonicalUrl).toBe(exact2048);

		const tooLong2049 = exact2048 + 'a';
		expect(() => canonicalizeUrl(tooLong2049)).toThrowError(UrlCanonicalizeError);
		try {
			canonicalizeUrl(tooLong2049);
		} catch (error) {
			expect(error).toBeInstanceOf(UrlCanonicalizeError);
			expect((error as UrlCanonicalizeError).status).toBe(422);
			expect((error as UrlCanonicalizeError).code).toBe('URL_TOO_LONG');
		}

		// Percent-encoding expansion past 2048 characters is also rejected
		const expandsPast2048 = 'https://example.com/' + 'ç'.repeat(1100);
		expect(expandsPast2048.length).toBeLessThan(2048);
		expect(() => canonicalizeUrl(expandsPast2048)).toThrowError(UrlCanonicalizeError);

		for (const badUrl of [
			'',
			'   ',
			'ftp://example.com/file.tar.gz',
			'javascript:alert(1)',
			'mailto:test@example.com',
			'https://user:pass@example.com/secret',
			'https://user@example.com/secret',
			'https://@example.com/secret',
			'not a url'
		]) {
			expect(() => canonicalizeUrl(badUrl)).toThrowError(UrlCanonicalizeError);
		}
	});
});

describe('extractFirstUrlFromText (WhatsApp paste helper)', () => {
	it.each([
		{
			label: 'WhatsApp message with text before and after URL',
			input:
				'Harika bir yazı buldum: https://example.com/blog/svelte-5?utm_source=wa mutlaka okuyun!',
			expectedUrl: 'https://example.com/blog/svelte-5?utm_source=wa',
			expectedNote: 'Harika bir yazı buldum: mutlaka okuyun!'
		},
		{
			label: 'Multi-line WhatsApp paste keeps line structure without URL',
			input: 'Ekip, şunu inceleyelim\nhttps://github.com/sveltejs/kit\nYarın konuşuruz.',
			expectedUrl: 'https://github.com/sveltejs/kit',
			expectedNote: 'Ekip, şunu inceleyelim\nYarın konuşuruz.'
		},
		{
			label: 'Pure URL yields suggestedNote: null',
			input: '   https://www.youtube.com/watch?v=abc123   ',
			expectedUrl: 'https://www.youtube.com/watch?v=abc123',
			expectedNote: null
		},
		{
			label: 'Parenthesized URL removes surrounding parentheses cleanly',
			input: 'Kaynak (https://example.com/docs/intro).',
			expectedUrl: 'https://example.com/docs/intro',
			expectedNote: 'Kaynak .'
		},
		{
			label: 'Balanced parentheses inside Wikipedia URL stay intact',
			input: 'Detay: (https://en.wikipedia.org/wiki/Rust_(programming_language)) güzel özet.',
			expectedUrl: 'https://en.wikipedia.org/wiki/Rust_(programming_language)',
			expectedNote: 'Detay: güzel özet.'
		},
		{
			label: 'Skips credentialed URL and selects next valid URL',
			input: 'Yanlış https://user:pass@evil.com Doğru https://example.org/ok',
			expectedUrl: 'https://example.org/ok',
			expectedNote: 'Yanlış https://user:pass@evil.com Doğru'
		},
		{
			label: 'Text with no HTTP(S) URL returns null url and preserves note',
			input: 'Sadece metin ftp://example.com var',
			expectedUrl: null,
			expectedNote: 'Sadece metin ftp://example.com var'
		}
	])('$label', ({ input, expectedUrl, expectedNote }) => {
		expect(extractFirstUrlFromText(input)).toEqual({
			url: expectedUrl,
			suggestedNote: expectedNote
		});
	});
});
