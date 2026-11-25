import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
	BLOCKED_IPV4_CIDRS,
	BLOCKED_IPV6_CIDRS,
	isBlockedIpAddress,
	MAX_TEXT_BYTES,
	SafeFetchError,
	safeFetch,
	safeFetchBytes,
	safeFetchStream,
	safeFetchText,
	UNFURL_USER_AGENT,
	validateSafeFetchUrl,
	type DnsAddressRecord,
	type TestConnectTarget
} from '../../src/lib/server/unfurl/safe-fetch';
import {
	CIRCUIT_BREAKER_COOLDOWN_MS,
	CIRCUIT_BREAKER_FAILURE_THRESHOLD,
	CIRCUIT_BREAKER_MAX_HOSTS,
	getHostCircuitState,
	isHostCircuitOpen,
	PROVIDER_BREAKER_KEYS,
	recordHostStatus,
	resetCircuitBreakers
} from '../../src/lib/server/unfurl/circuit-breaker';
import {
	extractTweetPlainTextFromBlockquote,
	fetchHtmlMetadata,
	unfurlTargetUrl,
	UnfurlUpstreamError
} from '../../src/lib/server/unfurl/adapters';
import {
	createSafeFetchShortUrlResolver,
	resolveAndCanonicalizeUrl
} from '../../src/lib/server/links/service';

interface TestCertBundle {
	dir: string;
	key: Buffer;
	cert: Buffer;
}

function generateTestCertificates(): TestCertBundle {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'izgah-m4-ssl-'));
	const keyPath = path.join(dir, 'key.pem');
	const certPath = path.join(dir, 'cert.pem');
	const san = [
		'DNS:sni.example.test',
		'DNS:public.example',
		'DNS:redirect-a.example',
		'DNS:redirect-b.example',
		'DNS:t.co',
		'DNS:youtu.be',
		'DNS:www.youtube.com',
		'DNS:publish.twitter.com',
		'DNS:api.github.com',
		'DNS:github.com',
		'DNS:www.instagram.com',
		'DNS:haber.example.com.tr'
	].join(',');

	execFileSync(
		'openssl',
		[
			'req',
			'-x509',
			'-newkey',
			'rsa:2048',
			'-nodes',
			'-keyout',
			keyPath,
			'-out',
			certPath,
			'-days',
			'1',
			'-subj',
			'/CN=sni.example.test',
			'-addext',
			`subjectAltName=${san}`
		],
		{ stdio: 'ignore' }
	);

	return {
		dir,
		key: fs.readFileSync(keyPath),
		cert: fs.readFileSync(certPath)
	};
}

function encodeWindows1254Turkish(text: string): Buffer {
	const map: Record<string, number> = {
		'\u011e': 0xd0, // Ğ
		'\u0130': 0xdd, // İ
		'\u015e': 0xde, // Ş
		'\u011f': 0xf0, // ğ
		'\u0131': 0xfd, // ı
		'\u015f': 0xfe // ş
	};
	const bytes: number[] = [];
	for (const ch of text) {
		const mapped = map[ch];
		if (mapped !== undefined) {
			bytes.push(mapped);
			continue;
		}
		const code = ch.charCodeAt(0);
		if (code <= 0xff) {
			bytes.push(code);
		} else {
			bytes.push(0x3f);
		}
	}
	return Buffer.from(bytes);
}

const BLOCKED_BOUNDARY_CASES: Array<{ cidr: string; ip: string }> = [
	// 15 IPv4 CIDRs from Technical Plan §5
	{ cidr: '0.0.0.0/8', ip: '0.0.0.0' },
	{ cidr: '0.0.0.0/8', ip: '0.255.255.255' },
	{ cidr: '10.0.0.0/8', ip: '10.0.0.1' },
	{ cidr: '10.0.0.0/8', ip: '10.255.255.254' },
	{ cidr: '100.64.0.0/10', ip: '100.64.0.1' },
	{ cidr: '100.64.0.0/10', ip: '100.127.255.254' },
	{ cidr: '127.0.0.0/8', ip: '127.0.0.1' },
	{ cidr: '127.0.0.0/8', ip: '127.255.255.254' },
	{ cidr: '169.254.0.0/16', ip: '169.254.169.254' },
	{ cidr: '172.16.0.0/12', ip: '172.16.0.1' },
	{ cidr: '172.16.0.0/12', ip: '172.31.255.254' },
	{ cidr: '192.0.0.0/24', ip: '192.0.0.1' },
	{ cidr: '192.0.2.0/24', ip: '192.0.2.1' },
	{ cidr: '192.88.99.0/24', ip: '192.88.99.1' },
	{ cidr: '192.168.0.0/16', ip: '192.168.1.1' },
	{ cidr: '198.18.0.0/15', ip: '198.18.0.1' },
	{ cidr: '198.18.0.0/15', ip: '198.19.255.254' },
	{ cidr: '198.51.100.0/24', ip: '198.51.100.1' },
	{ cidr: '203.0.113.0/24', ip: '203.0.113.1' },
	{ cidr: '224.0.0.0/4', ip: '224.0.0.1' },
	{ cidr: '224.0.0.0/4', ip: '239.255.255.254' },
	{ cidr: '240.0.0.0/4', ip: '240.0.0.1' },
	{ cidr: '255.255.255.255/32', ip: '255.255.255.255' },
	// 14 IPv6 CIDRs from Technical Plan §5
	{ cidr: '::/128', ip: '::' },
	{ cidr: '::1/128', ip: '::1' },
	{ cidr: '::/96', ip: '::7f00:1' },
	{ cidr: '::/96', ip: '::a00:1' },
	{ cidr: '::ffff:0:0/96', ip: '::ffff:127.0.0.1' },
	{ cidr: '::ffff:0:0/96', ip: '::ffff:93.184.216.34' },
	{ cidr: '::ffff:0:0/96', ip: '::ffff:7f00:1' },
	{ cidr: '::ffff:0:0:0/96', ip: '::ffff:0:7f00:1' },
	{ cidr: '64:ff9b::/96', ip: '64:ff9b::1' },
	{ cidr: '64:ff9b:1::/48', ip: '64:ff9b:1::1' },
	{ cidr: '100::/64', ip: '100::1' },
	{ cidr: '100::/64', ip: '100::ffff:ffff:ffff:ffff' },
	{ cidr: '2001::/32', ip: '2001::1' },
	{ cidr: '2001:db8::/32', ip: '2001:db8::1' },
	{ cidr: '2002::/16', ip: '2002::1' },
	{ cidr: 'fc00::/7', ip: 'fc00::1' },
	{ cidr: 'fc00::/7', ip: 'fd00::1' },
	{ cidr: 'fec0::/10', ip: 'fec0::1' },
	{ cidr: 'fec0::/10', ip: 'feff:ffff::1' },
	{ cidr: 'fe80::/10', ip: 'fe80::1' },
	{ cidr: 'fe80::/10', ip: 'febf:ffff::1' },
	{ cidr: 'ff00::/8', ip: 'ff00::1' },
	{ cidr: 'ff00::/8', ip: 'ff02::1' }
];

const ALLOWED_PUBLIC_IPS = [
	'93.184.216.34',
	'1.1.1.1',
	'100.63.255.255',
	'100.128.0.1',
	'172.15.255.254',
	'172.32.0.1',
	'198.17.255.254',
	'198.20.0.1',
	'2606:2800:220:1:248:1893:25c8:1946',
	'2001:4860:4860::8888',
	// Just outside the newly blocked 100::/64 and ::/96 ranges.
	'100:0:0:1::1',
	'::1:0:0:1'
];

describe('SSRF safeFetch, Circuit Breaker, and Unfurl Adapters (unit)', () => {
	let certBundle: TestCertBundle;
	let httpServer: http.Server;
	let httpsServer: https.Server;
	let httpPort = 0;
	let httpsPort = 0;

	let recordedSniNames: string[] = [];
	let recordedHttpRequests: Array<{
		protocol: 'http' | 'https';
		hostHeader: string | undefined;
		method: string | undefined;
		url: string | undefined;
		headers: http.IncomingHttpHeaders;
	}> = [];

	let httpHandler: (req: http.IncomingMessage, res: http.ServerResponse) => void = (_req, res) => {
		res.writeHead(404).end('not configured');
	};
	let httpsHandler: (req: http.IncomingMessage, res: http.ServerResponse) => void = (_req, res) => {
		res.writeHead(404).end('not configured');
	};

	const publicLookup = async (): Promise<DnsAddressRecord[]> => [
		{ address: '93.184.216.34', family: 4 }
	];

	const localConnectOverride = (target: TestConnectTarget) => {
		const isHttps = target.url.protocol === 'https:';
		return isHttps
			? {
					connectAddress: '127.0.0.1',
					port: httpsPort,
					ca: certBundle.cert,
					rejectUnauthorized: true
				}
			: {
					connectAddress: '127.0.0.1',
					port: httpPort
				};
	};

	beforeAll(async () => {
		certBundle = generateTestCertificates();
		const sharedSecureContext = tls.createSecureContext({
			key: certBundle.key,
			cert: certBundle.cert
		});

		httpServer = http.createServer((req, res) => {
			recordedHttpRequests.push({
				protocol: 'http',
				hostHeader: req.headers.host,
				method: req.method,
				url: req.url,
				headers: req.headers
			});
			httpHandler(req, res);
		});

		httpsServer = https.createServer(
			{
				key: certBundle.key,
				cert: certBundle.cert,
				SNICallback(servername, cb) {
					recordedSniNames.push(servername);
					cb(null, sharedSecureContext);
				}
			},
			(req, res) => {
				recordedHttpRequests.push({
					protocol: 'https',
					hostHeader: req.headers.host,
					method: req.method,
					url: req.url,
					headers: req.headers
				});
				httpsHandler(req, res);
			}
		);

		await new Promise<void>((resolve) => {
			httpServer.listen(0, '127.0.0.1', () => {
				httpPort = (httpServer.address() as AddressInfo).port;
				resolve();
			});
		});

		await new Promise<void>((resolve) => {
			httpsServer.listen(0, '127.0.0.1', () => {
				httpsPort = (httpsServer.address() as AddressInfo).port;
				resolve();
			});
		});
	});

	afterEach(() => {
		resetCircuitBreakers();
		recordedSniNames = [];
		recordedHttpRequests = [];
		httpHandler = (_req, res) => res.writeHead(404).end('not configured');
		httpsHandler = (_req, res) => res.writeHead(404).end('not configured');
	});

	afterAll(async () => {
		await Promise.all([
			new Promise<void>((resolve) => httpServer.close(() => resolve())),
			new Promise<void>((resolve) => httpsServer.close(() => resolve()))
		]);
		fs.rmSync(certBundle.dir, { recursive: true, force: true });
	});

	describe('SSRF CIDR blocklist (§5 single source of truth)', () => {
		it('covers all 16 IPv4 and 15 IPv6 CIDRs defined in §5', () => {
			expect(BLOCKED_IPV4_CIDRS).toHaveLength(16);
			expect(BLOCKED_IPV6_CIDRS).toHaveLength(15);

			const testedCidrs = new Set(BLOCKED_BOUNDARY_CASES.map((entry) => entry.cidr));
			for (const cidr of [...BLOCKED_IPV4_CIDRS, ...BLOCKED_IPV6_CIDRS]) {
				expect(testedCidrs.has(cidr)).toBe(true);
			}
		});

		it.each(BLOCKED_BOUNDARY_CASES)(
			'blocks $ip ($cidr) in isBlockedIpAddress and safeFetch lookup',
			async ({ ip }) => {
				expect(isBlockedIpAddress(ip)).toBe(true);

				let dialAttempted = false;
				await expect(
					safeFetchText('https://public.example/probe', {
						lookup: async () => [{ address: ip, family: ip.includes(':') ? 6 : 4 }],
						testConnectOverride: (target) => {
							dialAttempted = true;
							return localConnectOverride(target);
						}
					})
				).rejects.toMatchObject({
					name: 'SafeFetchError',
					code: 'BLOCKED_IP'
				});
				expect(dialAttempted).toBe(false);
			}
		);

		it.each(ALLOWED_PUBLIC_IPS)('allows public IP boundary %s', (ip) => {
			expect(isBlockedIpAddress(ip)).toBe(false);
		});

		it('blocks literal private IP URLs including bracketed IPv6 before dialing', async () => {
			let dialAttempted = false;
			for (const blockedUrl of [
				'http://127.0.0.1/status',
				'http://169.254.169.254/latest/meta-data/',
				'http://[::1]/status',
				'http://[::ffff:127.0.0.1]/status'
			]) {
				await expect(
					safeFetchText(blockedUrl, {
						lookup: publicLookup,
						testConnectOverride: (target) => {
							dialAttempted = true;
							return localConnectOverride(target);
						}
					})
				).rejects.toMatchObject({ code: 'BLOCKED_IP' });
			}
			expect(dialAttempted).toBe(false);
		});

		it('rejects DNS response if any returned record belongs to a blocked CIDR', async () => {
			await expect(
				safeFetchText('https://public.example/multi-a', {
					lookup: async () => [
						{ address: '93.184.216.34', family: 4 },
						{ address: '10.20.30.40', family: 4 }
					],
					testConnectOverride: localConnectOverride
				})
			).rejects.toMatchObject({ code: 'BLOCKED_IP' });
		});
	});

	describe('URL validation, pinned lookup, TLS SNI, and proxy isolation', () => {
		it('rejects unsupported schemes, userinfo credentials, blocked ports, and oversized URLs', () => {
			expect(() => validateSafeFetchUrl('ftp://public.example/file')).toThrow(SafeFetchError);
			expect(() => validateSafeFetchUrl('file:///etc/passwd')).toThrow(SafeFetchError);
			expect(() => validateSafeFetchUrl('https://user:pass@public.example/')).toThrow(
				SafeFetchError
			);
			expect(() => validateSafeFetchUrl('https://public.example:8443/')).toThrow(SafeFetchError);
			expect(() => validateSafeFetchUrl('http://public.example:8080/')).toThrow(SafeFetchError);
			expect(() => validateSafeFetchUrl(`https://public.example/${'a'.repeat(2050)}`)).toThrow(
				SafeFetchError
			);
			expect(validateSafeFetchUrl('https://public.example:443/ok').hostname).toBe('public.example');
			expect(validateSafeFetchUrl('http://public.example:80/ok').hostname).toBe('public.example');
		});

		it('pins resolved IP without re-lookup, preserves original TLS SNI, sends IzgahUnfurl/1.0, and ignores HTTP(S)_PROXY', async () => {
			const prevHttpProxy = process.env.HTTP_PROXY;
			const prevHttpsProxy = process.env.HTTPS_PROXY;
			process.env.HTTP_PROXY = 'http://127.0.0.1:9';
			process.env.HTTPS_PROXY = 'http://127.0.0.1:9';

			try {
				let lookupCount = 0;
				let observedTarget: TestConnectTarget | undefined;

				httpsHandler = (req, res) => {
					res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
					res.end(`ok:${req.headers['user-agent'] ?? ''}`);
				};

				const result = await safeFetchText('https://sni.example.test/hello', {
					lookup: async (hostname) => {
						lookupCount += 1;
						expect(hostname).toBe('sni.example.test');
						return [{ address: '93.184.216.34', family: 4 }];
					},
					testConnectOverride: (target) => {
						observedTarget = target;
						return localConnectOverride(target);
					}
				});

				expect(result.status).toBe(200);
				expect(result.text).toBe(`ok:${UNFURL_USER_AGENT}`);
				expect(lookupCount).toBe(1);
				expect(observedTarget?.pinnedAddress).toBe('93.184.216.34');
				expect(observedTarget?.servername).toBe('sni.example.test');
				expect(recordedSniNames).toContain('sni.example.test');
				expect(recordedHttpRequests[0]?.headers['user-agent']).toBe(UNFURL_USER_AGENT);
				expect(recordedHttpRequests[0]?.hostHeader).toBe('sni.example.test');
			} finally {
				if (prevHttpProxy === undefined) {
					delete process.env.HTTP_PROXY;
				} else {
					process.env.HTTP_PROXY = prevHttpProxy;
				}
				if (prevHttpsProxy === undefined) {
					delete process.env.HTTPS_PROXY;
				} else {
					process.env.HTTPS_PROXY = prevHttpsProxy;
				}
			}
		});
	});

	describe('Redirects, stream caps, timeouts, and ShortUrlResolver', () => {
		it('follows up to 3 redirects and rejects a 4th hop', async () => {
			let hop4Redirects = false;
			httpsHandler = (req, res) => {
				if (req.url === '/r1') {
					res.writeHead(302, { Location: 'https://redirect-a.example/r2' }).end();
					return;
				}
				if (req.url === '/r2') {
					res.writeHead(301, { Location: '/r3' }).end();
					return;
				}
				if (req.url === '/r3') {
					res.writeHead(307, { Location: 'https://redirect-b.example/r4' }).end();
					return;
				}
				if (req.url === '/r4' && hop4Redirects) {
					res.writeHead(302, { Location: '/too-far' }).end();
					return;
				}
				res.writeHead(200, { 'Content-Type': 'text/plain' }).end('done');
			};

			const ok3Hops = await safeFetchText('https://redirect-a.example/r1', {
				maxRedirects: 3,
				lookup: publicLookup,
				testConnectOverride: localConnectOverride
			});
			expect(ok3Hops.status).toBe(200);
			expect(ok3Hops.finalUrl.toString()).toBe('https://redirect-b.example/r4');

			hop4Redirects = true;
			await expect(
				safeFetchText('https://redirect-a.example/r1', {
					maxRedirects: 3,
					lookup: publicLookup,
					testConnectOverride: localConnectOverride
				})
			).rejects.toMatchObject({ code: 'TOO_MANY_REDIRECTS' });
		});

		it('blocks absolute private-IP redirect, DNS-rebinding on relative redirect, bad redirect scheme/port, and strips Authorization cross-origin', async () => {
			// 1) Absolute redirect to metadata IP
			httpsHandler = (_req, res) => {
				res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' }).end();
			};
			await expect(
				safeFetchText('https://redirect-a.example/ssrf', {
					lookup: publicLookup,
					testConnectOverride: localConnectOverride
				})
			).rejects.toMatchObject({ code: 'BLOCKED_IP' });

			// 2) DNS rebinding during relative redirect
			recordedHttpRequests = [];
			let dnsCallCount = 0;
			httpsHandler = (req, res) => {
				if (req.url === '/start') {
					res.writeHead(302, { Location: '/internal' }).end();
					return;
				}
				res.writeHead(200).end('should-never-be-reached');
			};
			await expect(
				safeFetchText('https://redirect-a.example/start', {
					lookup: async () => {
						dnsCallCount += 1;
						return dnsCallCount === 1
							? [{ address: '93.184.216.34', family: 4 }]
							: [{ address: '127.0.0.1', family: 4 }];
					},
					testConnectOverride: localConnectOverride
				})
			).rejects.toMatchObject({ code: 'BLOCKED_IP' });
			expect(recordedHttpRequests.map((r) => r.url)).toEqual(['/start']);

			// 3) Bad scheme / port in Location
			httpsHandler = (_req, res) => {
				res.writeHead(302, { Location: 'https://redirect-b.example:8443/bad' }).end();
			};
			await expect(
				safeFetchText('https://redirect-a.example/port-hop', {
					lookup: publicLookup,
					testConnectOverride: localConnectOverride
				})
			).rejects.toMatchObject({ code: 'BLOCKED_PORT' });

			// 4) Cross-origin redirect strips Authorization header
			recordedHttpRequests = [];
			httpsHandler = (req, res) => {
				if (req.url === '/auth-start') {
					res.writeHead(302, { Location: 'https://redirect-b.example/auth-end' }).end();
					return;
				}
				res.writeHead(200).end('ok');
			};
			await safeFetchText('https://redirect-a.example/auth-start', {
				headers: { Authorization: 'Bearer secret-token' },
				lookup: publicLookup,
				testConnectOverride: localConnectOverride
			});
			expect(recordedHttpRequests).toHaveLength(2);
			expect(recordedHttpRequests[0]?.headers.authorization).toBe('Bearer secret-token');
			expect(recordedHttpRequests[1]?.headers.authorization).toBeUndefined();
		});

		it('resolves known short URLs through safeFetch and falls back safely on SSRF redirect or timeout', async () => {
			httpsHandler = (req, res) => {
				if (req.url === '/go') {
					res.writeHead(302, { Location: 'https://youtu.be/dQw4w9WgXcQ?si=track' }).end();
					return;
				}
				if (req.url === '/ssrf-short') {
					res.writeHead(302, { Location: 'http://127.0.0.1/secret' }).end();
					return;
				}
				res.writeHead(200, { 'Content-Type': 'text/html' }).end('<html></html>');
			};

			const resolver = createSafeFetchShortUrlResolver({
				lookup: publicLookup,
				testConnectOverride: localConnectOverride
			});

			const resolved = await resolveAndCanonicalizeUrl('https://t.co/go?utm_source=x', {
				shortUrlResolver: resolver
			});
			expect(resolved.canonicalUrl).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');

			const fallbackOnSsrf = await resolveAndCanonicalizeUrl('https://t.co/ssrf-short', {
				shortUrlResolver: resolver
			});
			expect(fallbackOnSsrf.canonicalUrl).toBe('https://t.co/ssrf-short');
		});

		it('enforces maxBytes cap and totalTimeoutMs', async () => {
			httpsHandler = (req, res) => {
				if (req.url === '/too-big') {
					res.writeHead(200, { 'Content-Type': 'text/plain' });
					const chunk = Buffer.alloc(64 * 1024, 0x61);
					for (let i = 0; i < 36; i += 1) {
						res.write(chunk);
					}
					res.end();
					return;
				}
				if (req.url === '/slow') {
					setTimeout(() => {
						if (!res.destroyed) {
							res.writeHead(200).end('late');
						}
					}, 350);
					return;
				}
				res.writeHead(200).end('ok');
			};

			await expect(
				safeFetchBytes('https://public.example/too-big', {
					maxBytes: MAX_TEXT_BYTES,
					lookup: publicLookup,
					testConnectOverride: localConnectOverride
				})
			).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' });

			await expect(
				safeFetchText('https://public.example/slow', {
					totalTimeoutMs: 80,
					lookup: publicLookup,
					testConnectOverride: localConnectOverride
				})
			).rejects.toMatchObject({ code: 'TIMEOUT' });
		});
	});

	describe('Host-keyed circuit breaker', () => {
		it('opens after 5 consecutive 401/403/429 responses for 15 minutes per host independently', () => {
			const baseNow = 1_700_000_000_000;
			for (let i = 0; i < CIRCUIT_BREAKER_FAILURE_THRESHOLD - 1; i += 1) {
				const step = recordHostStatus('api.github.com', 429, baseNow + i * 100);
				expect(step.opened).toBe(false);
				expect(isHostCircuitOpen('api.github.com', baseNow + i * 100)).toBe(false);
			}

			const trigger = recordHostStatus('api.github.com', 403, baseNow + 1000);
			expect(trigger.opened).toBe(true);
			expect(isHostCircuitOpen('api.github.com', baseNow + 1000)).toBe(true);
			expect(isHostCircuitOpen('github.com', baseNow + 1000)).toBe(false);
			expect(getHostCircuitState('api.github.com', baseNow + 1000).isOpen).toBe(true);

			// Still open 1s before cooldown expiry; closes cleanly after 15 min
			expect(
				isHostCircuitOpen('api.github.com', baseNow + 1000 + CIRCUIT_BREAKER_COOLDOWN_MS - 1000)
			).toBe(true);
			expect(
				isHostCircuitOpen('api.github.com', baseNow + 1000 + CIRCUIT_BREAKER_COOLDOWN_MS + 1)
			).toBe(false);

			// 200 clears streak
			recordHostStatus('github.com', 401, baseNow);
			recordHostStatus('github.com', 200, baseNow + 10);
			expect(getHostCircuitState('github.com', baseNow + 10).consecutiveFailures).toBe(0);
		});

		it('keeps provider breakers apart from member-shared pages on the same host', () => {
			const baseNow = 1_700_100_000_000;
			// Five member-shared api.github.com pages answering 401 trip only the page-host key.
			for (let i = 0; i < CIRCUIT_BREAKER_FAILURE_THRESHOLD; i += 1) {
				recordHostStatus('api.github.com', 401, baseNow + i);
			}
			expect(isHostCircuitOpen('api.github.com', baseNow + 10)).toBe(true);
			expect(isHostCircuitOpen(PROVIDER_BREAKER_KEYS.githubApi, baseNow + 10)).toBe(false);

			// A member page answering 200 does not reset the provider's failure streak.
			for (let i = 0; i < CIRCUIT_BREAKER_FAILURE_THRESHOLD - 1; i += 1) {
				recordHostStatus(PROVIDER_BREAKER_KEYS.githubApi, 429, baseNow + 20 + i);
			}
			recordHostStatus('api.github.com', 200, baseNow + 30);
			expect(recordHostStatus(PROVIDER_BREAKER_KEYS.githubApi, 429, baseNow + 31).opened).toBe(
				true
			);
		});

		it('does not evict an open provider breaker when many hosts are recorded', () => {
			const baseNow = 1_700_200_000_000;
			for (let i = 0; i < CIRCUIT_BREAKER_FAILURE_THRESHOLD; i += 1) {
				recordHostStatus(PROVIDER_BREAKER_KEYS.youtubeOembed, 429, baseNow + i);
			}
			for (let i = 0; i < CIRCUIT_BREAKER_MAX_HOSTS + 50; i += 1) {
				recordHostStatus(`h${i}.example.test`, 403, baseNow + 100);
			}
			expect(isHostCircuitOpen(PROVIDER_BREAKER_KEYS.youtubeOembed, baseNow + 200)).toBe(true);
		});
	});

	describe('Adapters (YouTube oEmbed, X oEmbed, GitHub API + OG fallback, streaming HTML)', () => {
		it('parses YouTube oEmbed metadata and retries 5xx/429', async () => {
			let mode: 'ok' | 'rate_limit' = 'ok';
			httpsHandler = (req, res) => {
				if (req.url?.startsWith('/oembed')) {
					if (mode === 'rate_limit') {
						res.writeHead(429).end('slow down');
						return;
					}
					res.writeHead(200, { 'Content-Type': 'application/json' }).end(
						JSON.stringify({
							title: 'Svelte 5 Runes Tutorial',
							author_name: 'Svelte Society',
							provider_name: 'YouTube',
							thumbnail_url: 'https://www.youtube.com/vi/abc123/hqdefault.jpg'
						})
					);
					return;
				}
				res.writeHead(404).end();
			};

			const result = await unfurlTargetUrl('https://www.youtube.com/watch?v=abc123', {
				safeFetchOptions: {
					lookup: publicLookup,
					testConnectOverride: localConnectOverride
				}
			});
			expect(result.shortCircuited).toBe(false);
			expect(result.metadata).toEqual({
				title: 'Svelte 5 Runes Tutorial',
				description: null,
				siteName: 'YouTube',
				providerMeta: { authorName: 'Svelte Society' },
				thumbnailUrl: 'https://www.youtube.com/vi/abc123/hqdefault.jpg',
				ogType: null
			});

			mode = 'rate_limit';
			await expect(
				unfurlTargetUrl('https://youtu.be/abc123', {
					safeFetchOptions: {
						lookup: publicLookup,
						testConnectOverride: localConnectOverride
					}
				})
			).rejects.toBeInstanceOf(UnfurlUpstreamError);
		});

		it('strips all HTML and <script> tags from X oEmbed <blockquote>', async () => {
			const stripped = extractTweetPlainTextFromBlockquote(
				'<blockquote class="twitter-tweet"><p lang="tr">Merhaba <b>İzgah</b> <a href="https://t.co/x">link</a><img onerror="alert(1)" src="x"></p>&mdash; Yazar<script async src="https://platform.twitter.com/widgets.js"></script></blockquote>'
			);
			expect(stripped).toBe('Merhaba İzgah link');
			expect(stripped).not.toContain('<');
			expect(stripped).not.toContain('alert');

			httpsHandler = (_req, res) => {
				res.writeHead(200, { 'Content-Type': 'application/json' }).end(
					JSON.stringify({
						author_name: 'İzgah Ekip',
						provider_name: 'X',
						html: '<blockquote class="twitter-tweet"><p>Yeni sürüm yayında!</p><script>evil()</script></blockquote>'
					})
				);
			};

			const res = await unfurlTargetUrl('https://x.com/izgah/status/987654321', {
				safeFetchOptions: {
					lookup: publicLookup,
					testConnectOverride: localConnectOverride
				}
			});
			expect(res.metadata.title).toBe('Yeni sürüm yayında!');
			expect(res.metadata.description).toBe('Yeni sürüm yayında!');
			expect(res.metadata.siteName).toBe('X');
			expect(res.metadata.providerMeta).toEqual({ authorName: 'İzgah Ekip' });
		});

		it('fetches GitHub REST API with optional token + og:image, and falls back to HTML OG on 403/429', async () => {
			let apiMode: 'ok' | 'rate_limited' = 'ok';

			httpsHandler = (req, res) => {
				if (req.headers.host === 'api.github.com') {
					if (apiMode === 'rate_limited') {
						res.writeHead(403, { 'Content-Type': 'application/json' }).end('{"message":"limit"}');
						return;
					}
					expect(req.headers.authorization).toBe('Bearer ghp_unit_secret');
					res.writeHead(200, { 'Content-Type': 'application/json' }).end(
						JSON.stringify({
							full_name: 'sveltejs/kit',
							description: 'Web development, streamlined',
							stargazers_count: 19450,
							language: 'TypeScript',
							owner: { login: 'sveltejs' }
						})
					);
					return;
				}
				res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(
					`<!doctype html><html><head>
						<meta property="og:title" content="sveltejs/kit fallback title" />
						<meta property="og:description" content="Fallback GitHub HTML description" />
						<meta property="og:image" content="https://github.com/og-repo.png" />
					</head></html>`
				);
			};

			const apiSuccess = await unfurlTargetUrl('https://github.com/sveltejs/kit', {
				githubToken: 'ghp_unit_secret',
				safeFetchOptions: {
					lookup: publicLookup,
					testConnectOverride: localConnectOverride
				}
			});
			expect(apiSuccess.metadata).toEqual({
				title: 'sveltejs/kit',
				description: 'Web development, streamlined',
				siteName: 'GitHub',
				providerMeta: {
					stars: 19450,
					language: 'TypeScript',
					authorName: 'sveltejs'
				},
				thumbnailUrl: 'https://github.com/og-repo.png',
				ogType: null
			});

			apiMode = 'rate_limited';
			const fallbackResult = await unfurlTargetUrl('https://github.com/sveltejs/kit', {
				githubToken: 'ghp_unit_secret',
				safeFetchOptions: {
					lookup: publicLookup,
					testConnectOverride: localConnectOverride
				}
			});
			expect(fallbackResult.metadata.title).toBe('sveltejs/kit fallback title');
			expect(fallbackResult.metadata.description).toBe('Fallback GitHub HTML description');
			expect(fallbackResult.metadata.thumbnailUrl).toBe('https://github.com/og-repo.png');
		});

		it('skips api.github.com when githubToken is omitted and falls back directly to HTML OG', async () => {
			let apiRequests = 0;

			httpsHandler = (req, res) => {
				if (req.headers.host === 'api.github.com') {
					apiRequests += 1;
					res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}');
					return;
				}
				res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(
					`<!doctype html><html><head>
						<meta property="og:title" content="Direct GitHub HTML title" />
						<meta property="og:description" content="Direct GitHub HTML description" />
					</head></html>`
				);
			};

			expect(safeFetch).toBe(safeFetchStream);

			const res = await unfurlTargetUrl('https://github.com/sveltejs/kit', {
				safeFetchOptions: {
					lookup: publicLookup,
					testConnectOverride: localConnectOverride
				}
			});
			expect(apiRequests).toBe(0);
			expect(res.metadata.title).toBe('Direct GitHub HTML title');
			expect(res.metadata.description).toBe('Direct GitHub HTML description');
		});

		it('streams HTML head only, decodes windows-1254 / iso-8859-9 Turkish chars, resolves relative og:image, and suppresses login-wall redirects', async () => {
			httpsHandler = (req, res) => {
				if (req.url === '/win1254') {
					const html =
						'<html><head><title>İstanbul Şişli Haber</title><meta property="og:type" content="article" /><meta property="og:description" content="Güneşli dağlar ve Iğdır ovası" /><meta property="og:image" content="/assets/kapak.jpg?v=2" /></head><body><p>Body</p></body></html>';
					res.writeHead(200, { 'Content-Type': 'text/html; charset=windows-1254' });
					res.end(encodeWindows1254Turkish(html));
					return;
				}
				if (req.url === '/iso8859-meta') {
					const html =
						'<html><head><meta charset="iso-8859-9" /><meta property="og:title" content="Çanakkale Boğazı" /><meta name="description" content="<script>bad()</script>Temiz özet &amp; detay" /></head></html>';
					res.writeHead(200, { 'Content-Type': 'text/html' });
					res.end(encodeWindows1254Turkish(html));
					return;
				}
				if (req.url === '/huge-body-early-head') {
					const headPart =
						'<html><head><title>Başlık</title><meta property="og:title" content="Erken Durdurulan Sayfa" /></head><body>';
					res.writeHead(200, {
						'Content-Type': 'text/html; charset=utf-8',
						'Content-Length': String(headPart.length + 3 * 1024 * 1024)
					});
					res.write(headPart);
					const bigChunk = Buffer.alloc(64 * 1024, 0x78);
					for (let i = 0; i < 48; i += 1) {
						res.write(bigChunk);
					}
					res.end('</body></html>');
					return;
				}
				if (req.url === '/p/insta-post/') {
					res
						.writeHead(302, {
							Location: 'https://www.instagram.com/accounts/login/?next=/p/insta-post/'
						})
						.end();
					return;
				}
				if (req.url?.startsWith('/accounts/login/')) {
					res
						.writeHead(200, { 'Content-Type': 'text/html' })
						.end('<html><head><title>Login • Instagram</title></head></html>');
					return;
				}
				res.writeHead(404).end();
			};

			const win1254 = await fetchHtmlMetadata('https://haber.example.com.tr/win1254', {
				safeFetchOptions: {
					lookup: publicLookup,
					testConnectOverride: localConnectOverride
				}
			});
			expect(win1254.metadata.title).toBe('İstanbul Şişli Haber');
			expect(win1254.metadata.description).toBe('Güneşli dağlar ve Iğdır ovası');
			expect(win1254.metadata.ogType).toBe('article');
			expect(win1254.metadata.thumbnailUrl).toBe(
				'https://haber.example.com.tr/assets/kapak.jpg?v=2'
			);

			const isoMeta = await fetchHtmlMetadata('https://haber.example.com.tr/iso8859-meta', {
				safeFetchOptions: {
					lookup: publicLookup,
					testConnectOverride: localConnectOverride
				}
			});
			expect(isoMeta.metadata.title).toBe('Çanakkale Boğazı');
			expect(isoMeta.metadata.description).toBe('Temiz özet & detay');

			const earlyStop = await fetchHtmlMetadata(
				'https://haber.example.com.tr/huge-body-early-head',
				{
					safeFetchOptions: {
						lookup: publicLookup,
						testConnectOverride: localConnectOverride
					}
				}
			);
			expect(earlyStop.metadata.title).toBe('Erken Durdurulan Sayfa');

			const loginWall = await fetchHtmlMetadata('https://www.instagram.com/p/insta-post/', {
				safeFetchOptions: {
					lookup: publicLookup,
					testConnectOverride: localConnectOverride
				}
			});
			expect(loginWall.metadata.title).toBeNull();
			expect(loginWall.metadata.thumbnailUrl).toBeNull();
		});
	});
});
