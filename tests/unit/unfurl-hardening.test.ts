import { describe, expect, it } from 'vitest';
import { isLoginWallRedirect } from '../../src/lib/server/unfurl/adapters/html-meta';
import { sanitizeMetadataField } from '../../src/lib/server/unfurl/adapters/types';

describe('sanitizeMetadataField', () => {
	it.each([
		['Use <dialog> today', 'Use <dialog> today'],
		['Vec<T> in Rust', 'Vec<T> in Rust'],
		['Result<T, E> explained', 'Result<T, E> explained'],
		['Why a<b matters', 'Why a<b matters'],
		['Tom &amp; Jerry', 'Tom &amp; Jerry'],
		['  Fazla   boşluk\n\tvar  ', 'Fazla boşluk var']
	])('keeps plain text %j intact', (input, expected) => {
		expect(sanitizeMetadataField(input, 300)).toBe(expected);
	});

	it.each([
		['<script>bad()</script>Temiz özet', 'Temiz özet'],
		['<b>Kalın</b> başlık', 'Kalın başlık'],
		['<a href="https://x.test">bağlantı</a> metni', 'bağlantı metni'],
		['Önce<br>sonra', 'Önce sonra'],
		['<!-- yorum -->Görünür', 'Görünür']
	])('strips real markup from %j', (input, expected) => {
		expect(sanitizeMetadataField(input, 300)).toBe(expected);
	});

	it('truncates by code points', () => {
		expect(sanitizeMetadataField('ğüşıöç'.repeat(10), 5)).toBe('ğüşıö');
	});
});

describe('safeFetch DNS budget', () => {
	it('fails with TIMEOUT when DNS resolution hangs past the total timeout', async () => {
		const { safeFetchText, SafeFetchError } =
			await import('../../src/lib/server/unfurl/safe-fetch');
		const started = Date.now();
		const attempt = safeFetchText('https://yavas-dns.example/', {
			totalTimeoutMs: 150,
			lookup: () => new Promise(() => {})
		});
		await expect(attempt).rejects.toBeInstanceOf(SafeFetchError);
		await expect(attempt).rejects.toMatchObject({ code: 'TIMEOUT' });
		expect(Date.now() - started).toBeLessThan(2_000);
	});
});

describe('ensureMediaAssetFileInTx', () => {
	it('restores a thumbnail file removed by a concurrent orphan cleanup', async () => {
		const fs = await import('node:fs/promises');
		const os = await import('node:os');
		const path = await import('node:path');
		const { ensureMediaAssetFileInTx } = await import('../../src/lib/server/media/storage');

		const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'izgah-media-'));
		const filePath = path.join(dir, 'ab', `${'ab'.padEnd(64, 'c')}.webp`);
		const data = Buffer.from('RIFF....WEBP');

		await ensureMediaAssetFileInTx({
			assetKey: 'ab'.padEnd(64, 'c'),
			byteSize: data.byteLength,
			width: 1,
			height: 1,
			filePath,
			data
		});

		expect(await fs.readFile(filePath)).toEqual(data);
		await fs.rm(dir, { recursive: true, force: true });
	});
});

describe('isLoginWallRedirect', () => {
	it.each([
		['https://www.instagram.com/p/abc/', 'https://www.instagram.com/accounts/login/?next=/p/abc/'],
		['https://www.linkedin.com/posts/ekip-123', 'https://www.linkedin.com/authwall?trk=gf'],
		[
			'https://www.linkedin.com/in/someone',
			'https://www.linkedin.com/uas/login?session_redirect=x'
		],
		['https://x.com/someone/status/1', 'https://x.com/i/flow/login?redirect_after_login=%2F'],
		['https://example.com/post', 'https://example.com/signin/']
	])('treats %s -> %s as a sign-in wall', (original, final) => {
		expect(isLoginWallRedirect(new URL(original), new URL(final))).toBe(true);
	});

	it.each([
		// Same path, or a link that already pointed at the login page.
		['https://x.com/i/flow/login', 'https://x.com/i/flow/login'],
		['https://www.linkedin.com/authwall', 'https://www.linkedin.com/authwall/next'],
		// Look-alike paths are not walls: matching is per whole path segment.
		['https://example.com/a', 'https://example.com/loginhelp'],
		['https://example.com/a', 'https://example.com/authwalls/guide'],
		['https://example.com/a', 'https://example.com/i/flow/logins']
	])('keeps %s -> %s as a normal redirect', (original, final) => {
		expect(isLoginWallRedirect(new URL(original), new URL(final))).toBe(false);
	});
});
