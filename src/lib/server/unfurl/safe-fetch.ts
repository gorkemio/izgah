import dns from 'node:dns';
import net from 'node:net';
import { domainToASCII } from 'node:url';
import { Agent, buildConnector, fetch as undiciFetch, type Dispatcher } from 'undici';
import { MAX_URL_LENGTH } from '$lib/links/parse-url';
import { asciiLower } from '$lib/server/links/canonicalize';
import { t } from '$lib/i18n';

export const UNFURL_USER_AGENT = 'IzgahUnfurl/1.0';
export const DEFAULT_MAX_REDIRECTS = 3;
export const DEFAULT_CONNECT_TIMEOUT_MS = 4_000;
export const DEFAULT_TOTAL_TIMEOUT_MS = 8_000;
export const MAX_TEXT_BYTES = 2 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/**
 * Single source of truth for blocked IPv4 and IPv6 CIDR ranges (Technical Plan §5).
 */
export const BLOCKED_IPV4_CIDRS = [
	'0.0.0.0/8',
	'10.0.0.0/8',
	'100.64.0.0/10',
	'127.0.0.0/8',
	'169.254.0.0/16',
	'172.16.0.0/12',
	'192.0.0.0/24',
	'192.0.2.0/24',
	'192.168.0.0/16',
	'198.18.0.0/15',
	'198.51.100.0/24',
	'203.0.113.0/24',
	'224.0.0.0/4',
	'240.0.0.0/4',
	'255.255.255.255/32'
] as const;

export const BLOCKED_IPV6_CIDRS = [
	'::/128',
	'::1/128',
	// IPv4-compatible addresses (deprecated, RFC 4291): ::7f00:1 would reach 127.0.0.1 on some stacks.
	'::/96',
	'::ffff:0:0/96',
	'64:ff9b::/96',
	'64:ff9b:1::/48',
	// Discard-only prefix (RFC 6666).
	'100::/64',
	'2001::/32',
	'2001:db8::/32',
	'2002::/16',
	'fc00::/7',
	// Site-local (deprecated, RFC 3879); still routed internally on some networks.
	'fec0::/10',
	'fe80::/10',
	'ff00::/8'
] as const;

// Keep IPv4 and IPv6 BlockLists separate: in Node.js net.BlockList, adding ::ffff:0:0/96
// causes blockList.check(ipv4, 'ipv4') to match every IPv4 address.
const ipv4BlockList = new net.BlockList();
for (const cidr of BLOCKED_IPV4_CIDRS) {
	const [address, prefix] = cidr.split('/');
	ipv4BlockList.addSubnet(address, Number(prefix), 'ipv4');
}

const ipv6BlockList = new net.BlockList();
for (const cidr of BLOCKED_IPV6_CIDRS) {
	const [address, prefix] = cidr.split('/');
	ipv6BlockList.addSubnet(address, Number(prefix), 'ipv6');
}

export type SafeFetchErrorCode =
	| 'INVALID_URL'
	| 'UNSUPPORTED_SCHEME'
	| 'CREDENTIALS_NOT_ALLOWED'
	| 'BLOCKED_PORT'
	| 'INVALID_HOSTNAME'
	| 'DNS_RESOLUTION_FAILED'
	| 'BLOCKED_IP'
	| 'TOO_MANY_REDIRECTS'
	| 'INVALID_REDIRECT'
	| 'TIMEOUT'
	| 'RESPONSE_TOO_LARGE'
	| 'NETWORK_ERROR';

export class SafeFetchError extends Error {
	readonly code: SafeFetchErrorCode;

	constructor(code: SafeFetchErrorCode, message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = 'SafeFetchError';
		this.code = code;
	}
}

export interface DnsAddressRecord {
	address: string;
	family: 4 | 6;
}

export type DnsLookupFn = (hostname: string) => Promise<DnsAddressRecord[]>;

export interface TestConnectTarget {
	url: URL;
	pinnedAddress: string;
	pinnedFamily: 4 | 6;
	servername: string | null;
}

export interface TestConnectOverride {
	connectAddress: string;
	port: number;
	ca?: string | Buffer;
	rejectUnauthorized?: boolean;
}

export type TestConnectOverrideFn = (
	target: TestConnectTarget
) => TestConnectOverride | null | undefined;

export interface SafeFetchOptions {
	method?: 'GET' | 'HEAD';
	headers?: Record<string, string>;
	maxRedirects?: number;
	connectTimeoutMs?: number;
	totalTimeoutMs?: number;
	maxBytes?: number;
	allowEarlyStopExceedingContentLength?: boolean;
	signal?: AbortSignal;
	lookup?: DnsLookupFn;
	testConnectOverride?: TestConnectOverrideFn;
}

export interface SafeFetchStreamResult {
	status: number;
	headers: Headers;
	finalUrl: URL;
	readChunks(
		onChunk: (chunk: Uint8Array) => boolean | void | Promise<boolean | void>
	): Promise<{ truncatedByCaller: boolean; totalBytes: number }>;
	close(): Promise<void>;
}

const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);

interface SafeFetchTestHooks {
	lookup?: DnsLookupFn;
	testConnectOverride?: TestConnectOverrideFn;
}

const TEST_HOOKS_SYMBOL = Symbol.for('izgah.unfurl.safeFetchTestHooks');

function getDefaultTestHooksStore(): SafeFetchTestHooks {
	const g = globalThis as Record<PropertyKey, unknown>;
	if (!g[TEST_HOOKS_SYMBOL] || typeof g[TEST_HOOKS_SYMBOL] !== 'object') {
		g[TEST_HOOKS_SYMBOL] = {};
	}
	return g[TEST_HOOKS_SYMBOL] as SafeFetchTestHooks;
}

export function setDefaultSafeFetchTestHooks(hooks: SafeFetchTestHooks): void {
	const store = getDefaultTestHooksStore();
	store.lookup = hooks.lookup;
	store.testConnectOverride = hooks.testConnectOverride;
}

export function resetDefaultSafeFetchTestHooks(): void {
	const store = getDefaultTestHooksStore();
	delete store.lookup;
	delete store.testConnectOverride;
}

/**
 * Checks whether an IPv4 or IPv6 literal falls inside any blocked CIDR range in §5.
 */
export function isBlockedIpAddress(ip: string): boolean {
	if (typeof ip !== 'string') {
		return true;
	}
	const trimmed = ip.trim();
	if (!trimmed || trimmed.includes('%')) {
		return true;
	}

	const family = net.isIP(trimmed);
	if (family === 4) {
		return ipv4BlockList.check(trimmed, 'ipv4');
	}
	if (family === 6) {
		return ipv6BlockList.check(trimmed, 'ipv6');
	}
	return true;
}

function stripIpv6Brackets(hostname: string): string {
	if (hostname.startsWith('[') && hostname.endsWith(']')) {
		return hostname.slice(1, -1);
	}
	return hostname;
}

/**
 * Validates scheme (http/https), port (80/443), credentials absence, length, and hostname.
 */
export function validateSafeFetchUrl(rawInput: string | URL): URL {
	const rawString = typeof rawInput === 'string' ? rawInput.trim() : rawInput.toString();
	if (!rawString || rawString.length > MAX_URL_LENGTH) {
		throw new SafeFetchError('INVALID_URL', 'The URL is invalid or longer than 2048 characters.');
	}

	const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(rawString);
	if (schemeMatch) {
		const lowerScheme = asciiLower(schemeMatch[1]);
		if (lowerScheme !== 'http' && lowerScheme !== 'https') {
			throw new SafeFetchError(
				'UNSUPPORTED_SCHEME',
				'Only the http and https schemes are allowed.'
			);
		}
	}

	let parsed: URL;
	try {
		parsed = new URL(rawString);
	} catch {
		throw new SafeFetchError('INVALID_URL', 'The URL could not be parsed.');
	}

	const protocol = asciiLower(parsed.protocol);
	if (protocol !== 'http:' && protocol !== 'https:') {
		throw new SafeFetchError('UNSUPPORTED_SCHEME', 'Only the http and https schemes are allowed.');
	}

	if (parsed.username !== '' || parsed.password !== '' || /^https?:\/\/[^/?#]*@/i.test(rawString)) {
		throw new SafeFetchError('CREDENTIALS_NOT_ALLOWED', 'URLs with credentials are rejected.');
	}

	if (parsed.port !== '' && parsed.port !== '80' && parsed.port !== '443') {
		throw new SafeFetchError('BLOCKED_PORT', 'Only ports 80 and 443 are allowed.');
	}

	const bareHost = stripIpv6Brackets(parsed.hostname);
	if (!bareHost) {
		throw new SafeFetchError('INVALID_HOSTNAME', t('link.noHost'));
	}

	if (!parsed.hostname.startsWith('[')) {
		const asciiHost = domainToASCII(bareHost);
		if (!asciiHost) {
			throw new SafeFetchError('INVALID_HOSTNAME', t('link.hostAscii'));
		}
		parsed.hostname = asciiLower(asciiHost);
	} else {
		parsed.hostname = asciiLower(parsed.hostname);
	}

	return parsed;
}

async function systemDnsLookup(hostname: string): Promise<DnsAddressRecord[]> {
	const results = await dns.promises.lookup(hostname, { all: true, verbatim: true });
	return results.map((entry) => ({
		address: entry.address,
		family: entry.family === 6 ? 6 : 4
	}));
}

async function lookupWithinBudget(
	lookupFn: DnsLookupFn,
	bareHostname: string,
	timeoutMs: number
): Promise<DnsAddressRecord[]> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() => reject(new SafeFetchError('TIMEOUT', `DNS resolution timed out: ${bareHostname}`)),
			Math.max(0, timeoutMs)
		);
		timer.unref?.();
	});
	try {
		return await Promise.race([lookupFn(bareHostname), timeout]);
	} finally {
		if (timer !== undefined) {
			clearTimeout(timer);
		}
	}
}

async function resolveAndValidateHost(
	bareHostname: string,
	lookupFn: DnsLookupFn,
	timeoutMs: number
): Promise<DnsAddressRecord> {
	const literalFamily = net.isIP(bareHostname);
	if (literalFamily === 4 || literalFamily === 6) {
		if (isBlockedIpAddress(bareHostname)) {
			throw new SafeFetchError('BLOCKED_IP', `Engelli IP adresi reddedildi: ${bareHostname}`);
		}
		return {
			address: bareHostname,
			family: literalFamily
		};
	}

	let records: DnsAddressRecord[];
	try {
		// dns.lookup has no signal/timeout of its own; keep it inside the total time budget.
		records = await lookupWithinBudget(lookupFn, bareHostname, timeoutMs);
	} catch (error) {
		if (error instanceof SafeFetchError) {
			throw error;
		}
		throw new SafeFetchError('DNS_RESOLUTION_FAILED', `DNS resolution failed: ${bareHostname}`, {
			cause: error
		});
	}

	if (!Array.isArray(records) || records.length === 0) {
		throw new SafeFetchError('DNS_RESOLUTION_FAILED', `No DNS record found: ${bareHostname}`);
	}

	for (const record of records) {
		if (!record || isBlockedIpAddress(record.address)) {
			throw new SafeFetchError(
				'BLOCKED_IP',
				`Private or reserved IP address blocked: ${record?.address ?? 'unknown'}`
			);
		}
	}

	return {
		address: records[0].address,
		family: records[0].family === 6 ? 6 : 4
	};
}

function createPinnedLookupCallback(address: string, family: 4 | 6): net.LookupFunction {
	const fn = (
		_hostname: string,
		optionsOrCb:
			| { all?: boolean }
			| ((err: NodeJS.ErrnoException | null, addr?: unknown, fam?: number) => void),
		maybeCb?: (err: NodeJS.ErrnoException | null, addr: unknown, fam?: number) => void
	) => {
		const cb = typeof optionsOrCb === 'function' ? optionsOrCb : maybeCb;
		const wantsAll =
			typeof optionsOrCb === 'object' && optionsOrCb !== null && Boolean(optionsOrCb.all);
		if (!cb) {
			return;
		}
		if (wantsAll) {
			cb(null, [{ address, family }]);
			return;
		}
		cb(null, address, family);
	};
	return fn as unknown as net.LookupFunction;
}

function createPinnedDispatcher(options: {
	url: URL;
	bareHostname: string;
	pinned: DnsAddressRecord;
	connectTimeoutMs: number;
	remainingMs: number;
	testConnectOverride?: TestConnectOverrideFn;
}): Dispatcher {
	const isHttps = asciiLower(options.url.protocol) === 'https:';
	const servername = isHttps && net.isIP(options.bareHostname) === 0 ? options.bareHostname : null;

	const override = options.testConnectOverride?.({
		url: options.url,
		pinnedAddress: options.pinned.address,
		pinnedFamily: options.pinned.family,
		servername
	});

	if (override) {
		const overrideFamily: 4 | 6 = net.isIP(override.connectAddress) === 6 ? 6 : 4;
		const pinnedLookup = createPinnedLookupCallback(override.connectAddress, overrideFamily);
		const connector = buildConnector({
			autoSelectFamily: false,
			lookup: pinnedLookup,
			timeout: Math.min(options.connectTimeoutMs, options.remainingMs),
			...(override.ca ? { ca: override.ca } : {}),
			...(override.rejectUnauthorized !== undefined
				? { rejectUnauthorized: override.rejectUnauthorized }
				: {})
		});

		return new Agent({
			connectTimeout: Math.min(options.connectTimeoutMs, options.remainingMs),
			headersTimeout: options.remainingMs,
			bodyTimeout: options.remainingMs,
			connect(connectOpts, callback) {
				connector(
					{
						...connectOpts,
						hostname: options.bareHostname,
						host: options.url.host,
						port: String(override.port),
						...(servername ? { servername } : {})
					},
					callback
				);
			}
		});
	}

	const pinnedLookup = createPinnedLookupCallback(options.pinned.address, options.pinned.family);

	return new Agent({
		connectTimeout: Math.min(options.connectTimeoutMs, options.remainingMs),
		headersTimeout: options.remainingMs,
		bodyTimeout: options.remainingMs,
		connect: {
			autoSelectFamily: false,
			lookup: pinnedLookup
		}
	});
}

function buildRequestHeaders(customHeaders?: Record<string, string>): Headers {
	const headers = new Headers();
	if (customHeaders) {
		for (const [key, value] of Object.entries(customHeaders)) {
			headers.set(key, value);
		}
	}
	headers.set('User-Agent', UNFURL_USER_AGENT);
	return headers;
}

function isAbortLikeError(error: unknown): boolean {
	if (!(error instanceof Error)) {
		return false;
	}
	return error.name === 'AbortError' || error.name === 'TimeoutError';
}

function mapFetchFailure(
	error: unknown,
	totalTimedOut: boolean,
	callerAborted: boolean
): SafeFetchError {
	if (error instanceof SafeFetchError) {
		return error;
	}
	if (totalTimedOut) {
		return new SafeFetchError('TIMEOUT', 'The outbound request exceeded the total timeout.', {
			cause: error
		});
	}
	if (callerAborted || isAbortLikeError(error)) {
		return new SafeFetchError('TIMEOUT', 'The outbound request timed out or was cancelled.', {
			cause: error
		});
	}

	if (error && typeof error === 'object' && 'cause' in error) {
		const cause = (error as { cause?: { code?: string; name?: string } }).cause;
		if (
			cause &&
			(cause.code === 'UND_ERR_CONNECT_TIMEOUT' ||
				cause.code === 'UND_ERR_HEADERS_TIMEOUT' ||
				cause.code === 'UND_ERR_BODY_TIMEOUT')
		) {
			return new SafeFetchError('TIMEOUT', 'The connection or response timed out.', {
				cause: error
			});
		}
	}

	return new SafeFetchError(
		'NETWORK_ERROR',
		error instanceof Error ? error.message : 'The outbound network request failed.',
		{ cause: error }
	);
}

/**
 * Performs an SSRF-safe HTTP(S) fetch with strict CIDR blocking, pinned DNS lookup,
 * preserved TLS SNI, manual redirect validation (max 3 hops), timeouts, and streaming byte limits.
 */
export async function safeFetchStream(
	inputUrl: string | URL,
	options: SafeFetchOptions = {}
): Promise<SafeFetchStreamResult> {
	const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
	const connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
	const totalTimeoutMs = options.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS;
	const maxBytes = options.maxBytes ?? MAX_TEXT_BYTES;
	const method = options.method ?? 'GET';

	const hooks = getDefaultTestHooksStore();
	const lookupFn = options.lookup ?? hooks.lookup ?? systemDnsLookup;
	const testConnectOverride = options.testConnectOverride ?? hooks.testConnectOverride;

	let currentUrl = validateSafeFetchUrl(inputUrl);
	const requestHeaders = buildRequestHeaders(options.headers);

	const deadlineAt = Date.now() + totalTimeoutMs;
	const controller = new AbortController();
	let totalTimedOut = false;
	let callerAborted = false;

	const totalTimer = setTimeout(() => {
		totalTimedOut = true;
		controller.abort(new SafeFetchError('TIMEOUT', 'The total timeout elapsed.'));
	}, totalTimeoutMs);

	const onCallerAbort = () => {
		callerAborted = true;
		controller.abort(options.signal?.reason);
	};

	if (options.signal) {
		if (options.signal.aborted) {
			clearTimeout(totalTimer);
			throw new SafeFetchError('TIMEOUT', 'The request was cancelled.');
		}
		options.signal.addEventListener('abort', onCallerAbort, { once: true });
	}

	const cleanupControllerListeners = () => {
		clearTimeout(totalTimer);
		if (options.signal) {
			options.signal.removeEventListener('abort', onCallerAbort);
		}
	};

	let redirects = 0;

	try {
		while (true) {
			const remainingMs = deadlineAt - Date.now();
			if (remainingMs <= 0) {
				totalTimedOut = true;
				throw new SafeFetchError('TIMEOUT', 'The total timeout elapsed.');
			}

			const validatedUrl = validateSafeFetchUrl(currentUrl);
			const bareHostname = stripIpv6Brackets(validatedUrl.hostname);
			const pinned = await resolveAndValidateHost(bareHostname, lookupFn, remainingMs);

			const agent = createPinnedDispatcher({
				url: validatedUrl,
				bareHostname,
				pinned,
				connectTimeoutMs,
				remainingMs,
				testConnectOverride
			});

			let hopResponse: Awaited<ReturnType<typeof undiciFetch>>;
			try {
				hopResponse = await undiciFetch(validatedUrl.toString(), {
					method,
					headers: requestHeaders,
					redirect: 'manual',
					dispatcher: agent as unknown as Parameters<typeof undiciFetch>[1] extends infer R
						? R extends { dispatcher?: infer D }
							? D
							: never
						: never,
					signal: controller.signal
				});
			} catch (error) {
				await agent.close().catch(() => {});
				throw mapFetchFailure(error, totalTimedOut, callerAborted);
			}

			if (REDIRECT_STATUS_CODES.has(hopResponse.status)) {
				const location = hopResponse.headers.get('location')?.trim() ?? '';
				await hopResponse.body?.cancel().catch(() => {});
				await agent.close().catch(() => {});

				if (!location) {
					throw new SafeFetchError(
						'INVALID_REDIRECT',
						'The redirect is missing a Location header.'
					);
				}

				if (redirects >= maxRedirects) {
					throw new SafeFetchError(
						'TOO_MANY_REDIRECTS',
						`At most ${maxRedirects} redirects are allowed.`
					);
				}

				let nextUrl: URL;
				try {
					nextUrl = new URL(location, validatedUrl);
				} catch {
					throw new SafeFetchError('INVALID_REDIRECT', 'Invalid redirect target.');
				}

				if (nextUrl.origin !== validatedUrl.origin) {
					requestHeaders.delete('authorization');
				}

				redirects += 1;
				currentUrl = nextUrl;
				continue;
			}

			const contentLengthHeader = hopResponse.headers.get('content-length');
			if (contentLengthHeader && !options.allowEarlyStopExceedingContentLength) {
				const declaredLength = Number(contentLengthHeader);
				if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
					await hopResponse.body?.cancel().catch(() => {});
					await agent.close().catch(() => {});
					throw new SafeFetchError(
						'RESPONSE_TOO_LARGE',
						`The response exceeds the ${maxBytes}-byte limit.`
					);
				}
			}

			let closed = false;
			const close = async () => {
				if (closed) {
					return;
				}
				closed = true;
				cleanupControllerListeners();
				await hopResponse.body?.cancel().catch(() => {});
				await agent.close().catch(() => {});
			};

			const readChunks: SafeFetchStreamResult['readChunks'] = async (onChunk) => {
				if (!hopResponse.body) {
					await close();
					return { truncatedByCaller: false, totalBytes: 0 };
				}

				const reader = hopResponse.body.getReader();
				let totalBytes = 0;
				let truncatedByCaller = false;

				try {
					while (true) {
						const { done, value } = await reader.read();
						if (done) {
							break;
						}
						if (!value || value.byteLength === 0) {
							continue;
						}

						totalBytes += value.byteLength;
						if (totalBytes > maxBytes) {
							await reader.cancel().catch(() => {});
							throw new SafeFetchError(
								'RESPONSE_TOO_LARGE',
								`The response stream exceeded the ${maxBytes}-byte limit.`
							);
						}

						const shouldContinue = await onChunk(value);
						if (shouldContinue === false) {
							truncatedByCaller = true;
							await reader.cancel().catch(() => {});
							break;
						}
					}
					return { truncatedByCaller, totalBytes };
				} catch (error) {
					throw mapFetchFailure(error, totalTimedOut, callerAborted);
				} finally {
					reader.releaseLock();
					await close();
				}
			};

			return {
				status: hopResponse.status,
				headers: hopResponse.headers as unknown as Headers,
				finalUrl: validatedUrl,
				readChunks,
				close
			};
		}
	} catch (error) {
		cleanupControllerListeners();
		throw mapFetchFailure(error, totalTimedOut, callerAborted);
	}
}

export async function safeFetchBytes(
	inputUrl: string | URL,
	options: SafeFetchOptions = {}
): Promise<{ status: number; headers: Headers; finalUrl: URL; bytes: Buffer }> {
	const stream = await safeFetchStream(inputUrl, {
		...options,
		maxBytes: options.maxBytes ?? MAX_IMAGE_BYTES
	});

	const chunks: Uint8Array[] = [];
	try {
		await stream.readChunks((chunk) => {
			chunks.push(chunk);
			return true;
		});
	} finally {
		await stream.close();
	}

	return {
		status: stream.status,
		headers: stream.headers,
		finalUrl: stream.finalUrl,
		bytes: Buffer.concat(chunks)
	};
}

export async function safeFetchText(
	inputUrl: string | URL,
	options: SafeFetchOptions = {}
): Promise<{ status: number; headers: Headers; finalUrl: URL; text: string }> {
	const { status, headers, finalUrl, bytes } = await safeFetchBytes(inputUrl, {
		...options,
		maxBytes: options.maxBytes ?? MAX_TEXT_BYTES
	});

	return {
		status,
		headers,
		finalUrl,
		text: new TextDecoder('utf-8', { fatal: false }).decode(bytes)
	};
}

export const safeFetch = safeFetchStream;

export async function safeFetchDiscardBody(
	inputUrl: string | URL,
	options: SafeFetchOptions = {}
): Promise<{ status: number; headers: Headers; finalUrl: URL }> {
	const stream = await safeFetchStream(inputUrl, {
		...options,
		maxBytes: options.maxBytes ?? MAX_TEXT_BYTES
	});

	try {
		return {
			status: stream.status,
			headers: stream.headers,
			finalUrl: stream.finalUrl
		};
	} finally {
		await stream.close();
	}
}
