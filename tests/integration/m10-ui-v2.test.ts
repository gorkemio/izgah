import type { RequestEvent } from '@sveltejs/kit';
import { isActionFailure, isRedirect } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { handle } from '../../src/hooks.server';
import { actions as settingsActions } from '../../src/routes/(app)/settings/+page.server';

interface CookieSet {
	name: string;
	value: string;
	options: Record<string, unknown>;
}

function createEvent(options: {
	url: string;
	method?: string;
	cookies?: Record<string, string>;
	headers?: HeadersInit;
	formEntries?: Record<string, string>;
	user?: boolean;
}): { event: RequestEvent; cookiesSet: CookieSet[] } {
	const fullUrl = new URL(options.url, 'http://localhost:3000');
	const headers = new Headers(options.headers);
	let body: string | undefined;
	if (options.formEntries) {
		body = new URLSearchParams(options.formEntries).toString();
		headers.set('content-type', 'application/x-www-form-urlencoded');
	}
	const request = new Request(fullUrl, {
		method: options.method ?? (body ? 'POST' : 'GET'),
		headers,
		...(body ? { body } : {})
	});
	const cookieJar = { ...(options.cookies ?? {}) };
	const cookiesSet: CookieSet[] = [];
	const event = {
		request,
		url: fullUrl,
		cookies: {
			get: (name: string) => cookieJar[name],
			getAll: () => Object.entries(cookieJar).map(([name, value]) => ({ name, value })),
			set: (name: string, value: string, cookieOptions: Record<string, unknown>) => {
				cookieJar[name] = value;
				cookiesSet.push({ name, value, options: cookieOptions });
			},
			delete: () => {},
			serialize: () => ''
		},
		params: {},
		route: { id: null },
		locals: {
			requestId: 'req_test_ui_v2',
			user: options.user
				? { id: 'user-1', name: 'Üye', email: 'uye@izgah.test', role: 'member', authVersion: 1 }
				: null,
			session: null,
			authChannel: null,
			apiKeyId: null
		},
		platform: undefined,
		isDataRequest: false,
		isSubRequest: false,
		getClientAddress: () => '10.0.0.1',
		setHeaders: () => {},
		fetch,
		depends: () => {},
		parent: async () => ({}),
		untrack: <T>(fn: () => T) => fn()
	} as unknown as RequestEvent;
	return { event, cookiesSet };
}

const THEME_ONLY_TEMPLATE =
	'<html lang="tr" data-theme="%izgah.theme%"><body>%izgah.theme%</body></html>';

async function renderShell(cookies?: Record<string, string>, template = THEME_ONLY_TEMPLATE) {
	const { event } = createEvent({ url: '/login', cookies });
	let preloadDecisions: Array<[string, string, boolean]> = [];
	const response = await handle({
		event,
		resolve: async (_event, options) => {
			const transformed =
				(await options?.transformPageChunk?.({
					html: template,
					done: true
				})) ?? '';
			const preload = options?.preload;
			preloadDecisions = [
				['font', '/_app/immutable/assets/atkinson-hyperlegible-next-latin-wght-normal.abc.woff2'],
				[
					'font',
					'/_app/immutable/assets/atkinson-hyperlegible-next-latin-ext-wght-normal.abc.woff2'
				],
				['font', '/_app/immutable/assets/atkinson-hyperlegible-next-latin-wght-italic.abc.woff2'],
				['font', '/_app/immutable/assets/geist-latin-wght-normal.abc.woff2'],
				['font', '/_app/immutable/assets/newsreader-latin-opsz-normal.abc.woff2'],
				['font', '/_app/immutable/assets/jetbrains-mono-latin-wght-normal.abc.woff2'],
				['js', '/_app/immutable/entry/start.js']
			].map(([type, path]) => [
				type,
				path,
				preload ? preload({ type, path, filename: path.split('/').pop() ?? '' } as never) : false
			]);
			return new Response(transformed, { headers: { 'content-type': 'text/html' } });
		}
	});
	return { html: await response.text(), preloadDecisions };
}

describe('UI v3 theme cookie and font preload (docs/designs/izgah-ui-v3.md §2, izgah-ui-v2.md §9)', () => {
	it('writes the cookie theme into <html data-theme> (first occurrence only)', async () => {
		const { html } = await renderShell({ izgah_theme: 'dark' });
		expect(html).toContain('<html lang="tr" data-theme="dark">');
		expect(html).toContain('<body>%izgah.theme%</body>');
	});

	it('falls back to system for missing or forged cookie values', async () => {
		expect((await renderShell()).html).toContain('data-theme="system"');
		expect((await renderShell({ izgah_theme: '"><script>x</script>' })).html).toContain(
			'data-theme="system"'
		);
	});

	it('preloads only the Atkinson Hyperlegible Next normal latin and latin-ext fonts', async () => {
		const { preloadDecisions } = await renderShell();
		expect(preloadDecisions.map(([, , decision]) => decision)).toEqual([
			true,
			true,
			false,
			false,
			false,
			false,
			true
		]);
	});

	it('setTheme stores a whitelisted value and redirects back without JS', async () => {
		const { event, cookiesSet } = createEvent({
			url: '/settings?/setTheme',
			formEntries: { theme: 'dark', returnTo: '/sections/arayuz' },
			user: true
		});
		let thrown: unknown;
		try {
			await settingsActions.setTheme(event as Parameters<typeof settingsActions.setTheme>[0]);
		} catch (error) {
			thrown = error;
		}
		expect(isRedirect(thrown) && thrown.location).toBe('/sections/arayuz');
		expect(cookiesSet).toHaveLength(1);
		expect(cookiesSet[0]).toMatchObject({
			name: 'izgah_theme',
			value: 'dark',
			options: { path: '/', httpOnly: true, sameSite: 'lax' }
		});
	});

	it('setTheme returns the value to enhanced submissions and rejects unknown values', async () => {
		const enhanced = createEvent({
			url: '/settings?/setTheme',
			formEntries: { theme: 'light', returnTo: '//evil.example' },
			headers: { 'x-sveltekit-action': 'true' },
			user: true
		});
		const result = await settingsActions.setTheme(
			enhanced.event as Parameters<typeof settingsActions.setTheme>[0]
		);
		expect(result).toMatchObject({ theme: 'light' });

		const invalid = createEvent({
			url: '/settings?/setTheme',
			formEntries: { theme: 'neon' },
			user: true
		});
		const failure = await settingsActions.setTheme(
			invalid.event as Parameters<typeof settingsActions.setTheme>[0]
		);
		expect(isActionFailure(failure)).toBe(true);
		expect(invalid.cookiesSet).toHaveLength(0);
	});
});

describe('Named themes: palette cookies and setPalette (docs/designs/izgah-ui-v4.md §1, izgah-themes.md §3)', () => {
	const APPEARANCE_TEMPLATE =
		'<html lang="tr" data-theme="%izgah.theme%" data-light-theme="%izgah.lightTheme%"' +
		' data-dark-theme="%izgah.darkTheme%">' +
		'<head><meta name="color-scheme" content="%izgah.colorScheme%" /></head></html>';
	type SetPaletteEvent = Parameters<typeof settingsActions.setPalette>[0];

	it('writes the palette cookies and the colour scheme into the document', async () => {
		const { html } = await renderShell(
			{
				izgah_theme: 'dark',
				izgah_theme_light: 'contrast',
				izgah_theme_dark: 'contrast'
			},
			APPEARANCE_TEMPLATE
		);
		expect(html).toContain(
			'<html lang="tr" data-theme="dark" data-light-theme="contrast" data-dark-theme="contrast">'
		);
		expect(html).toContain('<meta name="color-scheme" content="dark" />');
	});

	it('falls back to the default palette for missing, forged, or removed (dim) values', async () => {
		const { html } = await renderShell(
			{ izgah_theme_dark: '"><script>x</script>', izgah_accent: 'orange' },
			APPEARANCE_TEMPLATE
		);
		expect(html).toContain(
			'data-theme="system" data-light-theme="default" data-dark-theme="default"'
		);
		expect(html).toContain('<meta name="color-scheme" content="light dark" />');
		expect(html).not.toContain('<script>');
		expect(html).not.toContain('data-accent');

		const legacy = await renderShell({ izgah_theme_dark: 'dim' }, APPEARANCE_TEMPLATE);
		expect(legacy.html).toContain('data-dark-theme="default"');
	});

	it('setPalette stores both palette cookies and redirects back without JS', async () => {
		const { event, cookiesSet } = createEvent({
			url: '/settings?/setPalette',
			formEntries: {
				lightTheme: 'contrast',
				darkTheme: 'contrast',
				returnTo: '/settings'
			},
			user: true
		});
		let thrown: unknown;
		try {
			await settingsActions.setPalette(event as SetPaletteEvent);
		} catch (error) {
			thrown = error;
		}
		expect(isRedirect(thrown) && thrown.location).toBe('/settings');
		expect(cookiesSet.map(({ name, value }) => [name, value])).toEqual([
			['izgah_theme_light', 'contrast'],
			['izgah_theme_dark', 'contrast']
		]);
		for (const cookie of cookiesSet) {
			expect(cookie.options).toMatchObject({
				path: '/',
				httpOnly: true,
				sameSite: 'lax',
				maxAge: 60 * 60 * 24 * 365
			});
		}
	});

	it('setPalette returns the palette to enhanced submissions and sanitises returnTo', async () => {
		const enhanced = createEvent({
			url: '/settings?/setPalette',
			formEntries: { lightTheme: 'default', darkTheme: 'contrast' },
			headers: { 'x-sveltekit-action': 'true' },
			user: true
		});
		expect(await settingsActions.setPalette(enhanced.event as SetPaletteEvent)).toMatchObject({
			palette: { lightTheme: 'default', darkTheme: 'contrast' }
		});

		const offsite = createEvent({
			url: '/settings?/setPalette',
			formEntries: {
				lightTheme: 'default',
				darkTheme: 'default',
				returnTo: '//evil.example'
			},
			user: true
		});
		let thrown: unknown;
		try {
			await settingsActions.setPalette(offsite.event as SetPaletteEvent);
		} catch (error) {
			thrown = error;
		}
		expect(isRedirect(thrown) && thrown.location).toBe('/settings');
	});

	it('setPalette rejects unknown, legacy, or missing values without writing any cookie', async () => {
		const invalidEntries: Array<Record<string, string>> = [
			{ lightTheme: 'default', darkTheme: 'sepia' },
			{ lightTheme: 'default', darkTheme: 'dim' },
			{ lightTheme: 'neon', darkTheme: 'default' },
			{ darkTheme: 'default' }
		];
		for (const formEntries of invalidEntries) {
			const invalid = createEvent({ url: '/settings?/setPalette', formEntries, user: true });
			const failure = await settingsActions.setPalette(invalid.event as SetPaletteEvent);
			expect(isActionFailure(failure)).toBe(true);
			expect(invalid.cookiesSet).toHaveLength(0);
		}
	});

	it('setPalette requires a session', async () => {
		const { event, cookiesSet } = createEvent({
			url: '/settings?/setPalette',
			formEntries: { lightTheme: 'default', darkTheme: 'default' }
		});
		await expect(settingsActions.setPalette(event as SetPaletteEvent)).rejects.toMatchObject({
			status: 401
		});
		expect(cookiesSet).toHaveLength(0);
	});
});
