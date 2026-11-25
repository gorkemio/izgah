import { readFileSync } from 'node:fs';
import { loadEnv } from 'vite';
import { defineConfig } from 'wxt';

const DEFAULT_LOCAL_ORIGIN = 'http://localhost:3000';
const DEFAULT_GECKO_ID = 'extension@izgah.com';
const LOCAL_HTTP_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

const ICONS = {
	16: 'icons/icon-16.png',
	32: 'icons/icon-32.png',
	48: 'icons/icon-48.png',
	128: 'icons/icon-128.png'
} as const;

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
	version: string;
};

/**
 * Resolves and validates the build-time Izgah server origin.
 */
export function resolveBuildOrigin(rawOrigin?: string): string {
	const trimmed = rawOrigin?.trim() ?? '';
	if (trimmed === '') {
		return DEFAULT_LOCAL_ORIGIN;
	}

	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		throw new Error(`Invalid WXT_IZGAH_ORIGIN value: "${trimmed}". Expected a valid URL.`);
	}

	if (parsed.username !== '' || parsed.password !== '') {
		throw new Error('WXT_IZGAH_ORIGIN cannot contain embedded credentials.');
	}

	const isHttps = parsed.protocol === 'https:';
	const isLocalHttp =
		parsed.protocol === 'http:' && LOCAL_HTTP_HOSTNAMES.has(parsed.hostname.toLowerCase());

	if (!isHttps && !isLocalHttp) {
		throw new Error(
			`Unsupported WXT_IZGAH_ORIGIN protocol "${parsed.protocol}" for host "${parsed.hostname}". Use https:// or localhost http://.`
		);
	}

	return parsed.origin;
}

/**
 * Converts an origin URL to a portless MV3 API host permission pattern.
 */
export function toHostPermissionPattern(buildOrigin: string): string {
	const originUrl = new URL(buildOrigin);
	return `${originUrl.protocol}//${originUrl.hostname}/api/v1/*`;
}

/**
 * Resolves the Firefox Gecko add-on identifier.
 */
export function resolveGeckoId(rawGeckoId?: string): string {
	const trimmed = rawGeckoId?.trim() ?? '';
	return trimmed !== '' ? trimmed : DEFAULT_GECKO_ID;
}

function readWxtEnv(mode: string): Record<string, string> {
	return loadEnv(mode, process.cwd(), 'WXT_');
}

/**
 * Store builds (WXT_IZGAH_STORE_BUILD=1) ship one extension for every Izgah instance: no built-in
 * server address and no host permission; members enter their instance in the options page and
 * requests use the server's /api/v1 CORS headers (docs/designs/izgah-i18n-oss.md §7).
 */
export function isStoreBuild(env: Record<string, string | undefined>): boolean {
	return (env.WXT_IZGAH_STORE_BUILD ?? process.env.WXT_IZGAH_STORE_BUILD ?? '').trim() === '1';
}

export default defineConfig({
	srcDir: 'src',
	publicDir: 'public',
	imports: false,
	manifestVersion: 3,
	manifest: ({ browser, mode }) => {
		const env = readWxtEnv(mode);
		const storeBuild = isStoreBuild(env);
		const buildOrigin = resolveBuildOrigin(env.WXT_IZGAH_ORIGIN ?? process.env.WXT_IZGAH_ORIGIN);
		const hostPermissions = storeBuild ? [] : [toHostPermissionPattern(buildOrigin)];

		return {
			name: '__MSG_extName__',
			description: '__MSG_extDescription__',
			default_locale: 'en',
			version: pkg.version,
			permissions: ['activeTab', 'contextMenus', 'storage'],
			...(hostPermissions.length > 0 ? { host_permissions: hostPermissions } : {}),
			icons: ICONS,
			action: {
				default_title: '__MSG_actionTitle__',
				default_icon: ICONS
			},
			commands: {
				_execute_action: {
					suggested_key: {
						default: 'Alt+Shift+I',
						mac: 'Alt+Shift+I'
					},
					description: '__MSG_commandOpen__'
				}
			},
			content_security_policy: {
				extension_pages: "script-src 'self'; object-src 'none'"
			},
			...(browser === 'firefox'
				? {
						browser_specific_settings: {
							gecko: {
								id: resolveGeckoId(env.WXT_GECKO_ID ?? process.env.WXT_GECKO_ID),
								strict_min_version: '128.0',
								data_collection_permissions: {
									required: ['none']
								}
							} as Record<string, unknown>
						}
					}
				: {})
		};
	},
	vite: ({ mode }) => {
		const env = readWxtEnv(mode);
		const buildOrigin = isStoreBuild(env)
			? ''
			: resolveBuildOrigin(env.WXT_IZGAH_ORIGIN ?? process.env.WXT_IZGAH_ORIGIN);
		return {
			define: {
				__IZGAH_DEFAULT_ORIGIN__: JSON.stringify(buildOrigin)
			}
		};
	},
	zip: {
		excludeSources: ['safari/**', 'coverage/**', 'playwright-report/**', 'test-results/**', '.env*']
	}
});
