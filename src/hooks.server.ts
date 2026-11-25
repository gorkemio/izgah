import type { Handle, HandleServerError, ServerInit } from '@sveltejs/kit/hooks';
import type { RequestEvent } from '@sveltejs/kit';
import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { building } from '$app/env';
import type { Locale } from '#lib/i18n/index.ts';
import { appTimeZone, instanceName, sourceUrl } from '#lib/instance.ts';
import { verifyApiKey } from '#lib/server/auth/api-keys.ts';
import {
	auth,
	buildExpiredSessionSetCookieHeaders,
	clearSessionCookies,
	hasSessionCookieInRequest,
	sanitizeNextPath,
	svelteKitHandler
} from '#lib/server/auth/better-auth.ts';
import { ensureInitialAdminBootstrap } from '#lib/server/auth/bootstrap.ts';
import {
	checkApiReadRateLimit,
	checkApiWriteRateLimit,
	checkAuthTokenRateLimit,
	checkLoginRateLimit,
	checkSearchRateLimit,
	extractClientIp
} from '#lib/server/auth/rate-limit.ts';
import { closeDb, db } from '#lib/server/db/client.ts';
import { sessions, users, type UserRole } from '#lib/server/db/schema.ts';
import { env } from '#lib/server/env.ts';
import {
	fillAppearancePlaceholders,
	parsePalette,
	parseThemePreference,
	shouldPreload,
	THEME_COOKIE
} from '#lib/server/http/theme.ts';
import { wireSafeFetchShortUrlResolver } from '#lib/server/links/service.ts';
import { runWithLocale, resolveRequestLocale } from '#lib/server/i18n.ts';
import { isSameOriginRequest } from '#lib/server/http/same-origin.ts';
import { logger } from '#lib/server/logger.ts';
import {
	DEFAULT_SHUTDOWN_TIMEOUT_MS,
	startUnfurlWorker,
	stopUnfurlWorker
} from '#lib/server/unfurl/worker.ts';
import { t } from '#lib/i18n/index.ts';

const INIT_PROMISE_SYMBOL = Symbol.for('izgah.server.initPromise');
const SHUTDOWN_HOOKS_SYMBOL = Symbol.for('izgah.server.shutdownHooksRegistered');

type CookieSessionResolution =
	| { status: 'none' }
	| { status: 'invalid' }
	| { status: 'error' }
	| {
			status: 'valid';
			user: {
				id: string;
				name: string;
				email: string;
				role: UserRole;
				authVersion: number;
			};
			session: { id: string; expiresAt: Date };
	  };

export function registerServerShutdownHooks(): void {
	const g = globalThis as Record<PropertyKey, unknown>;
	if (g[SHUTDOWN_HOOKS_SYMBOL]) {
		return;
	}
	g[SHUTDOWN_HOOKS_SYMBOL] = true;

	let shutdownPromise: Promise<void> | null = null;
	let httpClosed = false;
	let resolveHttpClosed: (() => void) | null = null;
	const httpClosedPromise = new Promise<void>((resolve) => {
		resolveHttpClosed = resolve;
	});

	const runShutdown = (trigger: 'SIGTERM' | 'SIGINT' | 'sveltekit:shutdown') => {
		if (trigger === 'sveltekit:shutdown') {
			httpClosed = true;
			resolveHttpClosed?.();
		}

		if (shutdownPromise) {
			return;
		}

		shutdownPromise = (async () => {
			try {
				await stopUnfurlWorker({ timeoutMs: DEFAULT_SHUTDOWN_TIMEOUT_MS });
			} catch (error) {
				logger.error('Failed to stop unfurl worker cleanly during shutdown', {
					error: error instanceof Error ? error.message : String(error)
				});
			}

			if (!httpClosed) {
				await Promise.race([
					httpClosedPromise,
					new Promise<void>((resolve) => {
						const timer = setTimeout(resolve, 2_000);
						timer.unref?.();
					})
				]);
			}

			await closeDb().catch((error) => {
				logger.error('Failed to close database pool cleanly during shutdown', {
					error: error instanceof Error ? error.message : String(error)
				});
			});

			logger.info('Server shutdown complete', { trigger });
		})();
	};

	process.on('sveltekit:shutdown' as unknown as NodeJS.Signals, () =>
		runShutdown('sveltekit:shutdown')
	);
	process.on('SIGTERM', () => runShutdown('SIGTERM'));
	process.on('SIGINT', () => runShutdown('SIGINT'));
}

export const init: ServerInit = async () => {
	if (building) {
		return;
	}
	const g = globalThis as Record<PropertyKey, unknown>;
	if (g[INIT_PROMISE_SYMBOL]) {
		await (g[INIT_PROMISE_SYMBOL] as Promise<void>);
		return;
	}

	const runInit = async () => {
		if (
			process.env.VITEST === 'true' ||
			(env.NODE_ENV === 'test' && process.env.PLAYWRIGHT_E2E !== '1')
		) {
			return;
		}
		await ensureInitialAdminBootstrap();
		wireSafeFetchShortUrlResolver();
		startUnfurlWorker();
		registerServerShutdownHooks();
	};

	const promise = runInit();
	g[INIT_PROMISE_SYMBOL] = promise;
	try {
		await promise;
	} catch (error) {
		delete g[INIT_PROMISE_SYMBOL];
		throw error;
	}
};

function createRequestId(): string {
	return `req_${crypto.randomUUID().replace(/-/g, '')}`;
}

function initLocals(event: RequestEvent, requestId: string): void {
	event.locals.requestId = requestId;
	event.locals.user = null;
	event.locals.session = null;
	event.locals.authChannel = null;
	event.locals.apiKeyId = null;
}

function extractBearerToken(headers: Headers): string | null {
	const authHeader = headers.get('authorization');
	if (!authHeader) {
		return null;
	}
	const match = /^Bearer\s+(\S+)$/i.exec(authHeader.trim());
	return match ? match[1] : null;
}

/**
 * Verifies the Better Auth signed cookie AND checks users.is_active and auth_version
 * against PostgreSQL on every request (cookieCache remains disabled).
 */
async function resolveVerifiedCookieSession(event: RequestEvent): Promise<CookieSessionResolution> {
	if (!hasSessionCookieInRequest(event.request.headers)) {
		return { status: 'none' };
	}

	let betterAuthSession: Awaited<ReturnType<typeof auth.api.getSession>> = null;
	try {
		betterAuthSession = await auth.api.getSession({
			headers: event.request.headers,
			query: { disableCookieCache: true }
		});
	} catch (error) {
		// Better Auth returns null for missing/forged/expired sessions and throws on adapter
		// (database) failures. A transient outage must not log every member out.
		logger.error('Session lookup failed', {
			request_id: event.locals.requestId,
			error: error instanceof Error ? error.message : String(error)
		});
		return { status: 'error' };
	}

	const sessionId = betterAuthSession?.session?.id;
	if (!sessionId) {
		return { status: 'invalid' };
	}

	let row:
		| {
				sessionId: string;
				expiresAt: Date;
				userAuthVersion: number;
				userId: string;
				name: string;
				email: string;
				role: UserRole;
				isActive: boolean;
				authVersion: number;
		  }
		| undefined;
	try {
		[row] = await db
			.select({
				sessionId: sessions.id,
				expiresAt: sessions.expiresAt,
				userAuthVersion: sessions.userAuthVersion,
				userId: users.id,
				name: users.name,
				email: users.email,
				role: users.role,
				isActive: users.isActive,
				authVersion: users.authVersion
			})
			.from(sessions)
			.innerJoin(users, eq(users.id, sessions.userId))
			.where(eq(sessions.id, sessionId))
			.limit(1);
	} catch (error) {
		logger.error('Session verification query failed', {
			request_id: event.locals.requestId,
			error: error instanceof Error ? error.message : String(error)
		});
		return { status: 'error' };
	}

	if (
		!row ||
		!row.isActive ||
		row.userAuthVersion !== row.authVersion ||
		row.expiresAt.getTime() <= Date.now()
	) {
		return { status: 'invalid' };
	}

	return {
		status: 'valid',
		user: {
			id: row.userId,
			name: row.name,
			email: row.email,
			role: row.role,
			authVersion: row.authVersion
		},
		session: {
			id: row.sessionId,
			expiresAt: row.expiresAt
		}
	};
}

/**
 * Decodes a request pathname exactly like SvelteKit's router (`decode_pathname`), so prefix checks in
 * this hook see the same path the router matches (`/%73earch` must be treated as `/search`).
 * Returns null for malformed percent-encoding.
 */
function decodeRequestPathname(pathname: string): string | null {
	try {
		return pathname.split('%25').map(decodeURI).join('%25');
	} catch {
		return null;
	}
}

function applyStandardResponseHeaders(
	response: Response,
	requestId: string,
	options?: {
		pathname?: string;
		cors?: boolean;
		varyInternal?: boolean;
		expireCookies?: boolean;
	}
): Response {
	const headers = new Headers(response.headers);
	headers.set('X-Request-Id', requestId);

	if (options?.pathname?.startsWith('/auth/')) {
		headers.set('Referrer-Policy', 'no-referrer');
		headers.set('Cache-Control', 'no-store');
	}

	if (options?.cors) {
		headers.set('Access-Control-Allow-Origin', '*');
		headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
		headers.set(
			'Access-Control-Allow-Headers',
			'Authorization, Content-Type, X-Client-Name, X-Client-Version'
		);
		headers.set('Access-Control-Expose-Headers', 'X-Request-Id');
	}

	if (options?.varyInternal) {
		const existingVary = headers.get('vary');
		const varyParts = new Set([
			...(existingVary
				? existingVary
						.split(',')
						.map((part) => part.trim())
						.filter(Boolean)
				: []),
			'Origin',
			'Sec-Fetch-Dest',
			'Sec-Fetch-Mode',
			'Sec-Fetch-Site'
		]);
		headers.set('Vary', Array.from(varyParts).join(', '));
	}

	if (!headers.has('X-Content-Type-Options')) {
		headers.set('X-Content-Type-Options', 'nosniff');
	}
	if (!headers.has('X-Frame-Options')) {
		headers.set('X-Frame-Options', 'DENY');
	}
	if (!headers.has('Referrer-Policy')) {
		headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	}

	if (options?.expireCookies) {
		for (const expiredCookie of buildExpiredSessionSetCookieHeaders()) {
			headers.append('Set-Cookie', expiredCookie);
		}
	}

	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers
	});
}

function jsonErrorResponse(
	status: number,
	code: string,
	message: string,
	requestId: string,
	options?: {
		cors?: boolean;
		varyInternal?: boolean;
		expireCookies?: boolean;
		retryAfterSeconds?: number;
		pathname?: string;
	}
): Response {
	const headers = new Headers({
		'Content-Type': 'application/json; charset=utf-8',
		'Cache-Control': 'no-store'
	});
	if (options?.retryAfterSeconds !== undefined) {
		headers.set('Retry-After', String(options.retryAfterSeconds));
	}

	return applyStandardResponseHeaders(
		new Response(
			JSON.stringify({
				error: {
					code,
					message,
					requestId
				}
			}),
			{ status, headers }
		),
		requestId,
		options
	);
}

function isApiV1Path(pathname: string): boolean {
	return pathname === '/api/v1' || pathname.startsWith('/api/v1/');
}

function isApiInternalPath(pathname: string): boolean {
	return pathname === '/api/internal' || pathname.startsWith('/api/internal/');
}

function isApiAuthPath(pathname: string): boolean {
	return pathname === '/api/auth' || pathname.startsWith('/api/auth/');
}

function isMediaThumbnailPath(pathname: string): boolean {
	return pathname === '/media/thumbnails' || pathname.startsWith('/media/thumbnails/');
}

function isAdminPath(pathname: string): boolean {
	return pathname === '/admin' || pathname.startsWith('/admin/');
}

function escapeAttribute(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** Fills the language and instance placeholders of src/app.html. */
function fillInstancePlaceholders(html: string, locale: Locale): string {
	return html
		.replace('%izgah.lang%', () => locale)
		.replace('%izgah.timeZone%', () => escapeAttribute(appTimeZone()))
		.replace('%izgah.sourceUrl%', () => escapeAttribute(sourceUrl()))
		.replace('%izgah.instanceName%', () => escapeAttribute(instanceName()));
}

/** Runs every request in its member's locale (docs/designs/izgah-i18n-oss.md §2). */
export const handle: Handle = async (input) => {
	const locale = resolveRequestLocale(input.event.cookies);
	return runWithLocale(locale, () => handleRequest(input, locale));
};

async function handleRequest(
	{ event, resolve: kitResolve }: Parameters<Handle>[0],
	locale: Locale
): Promise<Response> {
	// Wrap resolve once so every branch below (better-auth's handler included) renders the theme
	// attribute and font preloads. `sequence()` is avoided: integration tests call `handle` directly.
	const theme = parseThemePreference(event.cookies.get(THEME_COOKIE));
	const palette = parsePalette((name) => event.cookies.get(name));
	const resolve: typeof kitResolve = (resolveEvent, options) =>
		kitResolve(resolveEvent, {
			preload: shouldPreload,
			...options,
			transformPageChunk: async (input) => {
				const html = options?.transformPageChunk
					? ((await options.transformPageChunk(input)) ?? input.html)
					: input.html;
				return fillInstancePlaceholders(fillAppearancePlaceholders(html, theme, palette), locale);
			}
		});

	const requestId = createRequestId();
	initLocals(event, requestId);

	const method = event.request.method.toUpperCase();
	const decodedPathname = decodeRequestPathname(event.url.pathname);
	if (decodedPathname === null) {
		return jsonErrorResponse(400, 'BAD_REQUEST', t('api.badPath'), requestId);
	}
	const pathname = decodedPathname;

	if (pathname === '/healthz' || pathname === '/readyz') {
		return applyStandardResponseHeaders(await resolve(event), requestId);
	}

	// 1. External / Extension HTTP API (/api/v1/*): Strictly Bearer API key, ignores cookies.
	if (isApiV1Path(pathname)) {
		if (method === 'OPTIONS') {
			return applyStandardResponseHeaders(new Response(null, { status: 204 }), requestId, {
				cors: true
			});
		}

		const bearerToken = extractBearerToken(event.request.headers);
		let verified: Awaited<ReturnType<typeof verifyApiKey>>;
		try {
			verified = await verifyApiKey(bearerToken);
		} catch (error) {
			logger.error('API key verification failed', {
				request_id: requestId,
				error: error instanceof Error ? error.message : String(error)
			});
			return jsonErrorResponse(500, 'INTERNAL_ERROR', t('error.serverMessage'), requestId, {
				cors: true
			});
		}
		if (!verified) {
			return jsonErrorResponse(401, 'UNAUTHORIZED', t('api.keyRequired'), requestId, {
				cors: true
			});
		}

		const isReadMethod = method === 'GET' || method === 'HEAD';
		const rateLimit = isReadMethod
			? checkApiReadRateLimit(verified.apiKeyId)
			: checkApiWriteRateLimit(verified.apiKeyId);
		if (!rateLimit.allowed) {
			return jsonErrorResponse(429, 'RATE_LIMITED', t('api.rateLimited'), requestId, {
				cors: true,
				retryAfterSeconds: rateLimit.retryAfterSeconds
			});
		}

		event.locals.user = verified.user;
		event.locals.session = null;
		event.locals.authChannel = 'api_key';
		event.locals.apiKeyId = verified.apiKeyId;

		const response = await resolve(event);
		if (
			(response.status === 404 || response.status === 405) &&
			!response.headers.get('content-type')?.includes('application/json')
		) {
			const allowHeader = response.headers.get('allow');
			const errResponse = jsonErrorResponse(
				response.status,
				response.status === 405 ? 'METHOD_NOT_ALLOWED' : 'NOT_FOUND',
				response.status === 405 ? t('api.methodNotAllowed') : t('api.notFound'),
				requestId,
				{ cors: true }
			);
			if (allowHeader) {
				errResponse.headers.set('Allow', allowHeader);
			}
			return errResponse;
		}
		return applyStandardResponseHeaders(response, requestId, { cors: true });
	}

	// 2. Internal Web API (/api/internal/*): Strictly cookie session + Origin/Sec-Fetch-Site.
	if (isApiInternalPath(pathname)) {
		if (!isSameOriginRequest(event)) {
			return jsonErrorResponse(403, 'FORBIDDEN', t('api.crossOrigin'), requestId, {
				varyInternal: true
			});
		}

		const cookieSession = await resolveVerifiedCookieSession(event);
		if (cookieSession.status === 'error') {
			return jsonErrorResponse(503, 'SERVICE_UNAVAILABLE', t('api.unavailable'), requestId, {
				varyInternal: true
			});
		}
		if (cookieSession.status !== 'valid') {
			return jsonErrorResponse(401, 'UNAUTHORIZED', t('auth.signInRequired'), requestId, {
				varyInternal: true,
				expireCookies: cookieSession.status === 'invalid'
			});
		}

		event.locals.user = cookieSession.user;
		event.locals.session = cookieSession.session;
		event.locals.authChannel = 'cookie';

		const response = await resolve(event);
		return applyStandardResponseHeaders(response, requestId, { varyInternal: true });
	}

	// 3. Cached thumbnail serving (/media/thumbnails/*): Accepts cookie OR Bearer, returns 401 (no redirect).
	if (isMediaThumbnailPath(pathname)) {
		const cookieSession = await resolveVerifiedCookieSession(event);
		if (cookieSession.status === 'error') {
			return jsonErrorResponse(503, 'SERVICE_UNAVAILABLE', t('api.unavailable'), requestId);
		}
		if (cookieSession.status === 'valid') {
			event.locals.user = cookieSession.user;
			event.locals.session = cookieSession.session;
			event.locals.authChannel = 'cookie';
		} else {
			const bearerToken = extractBearerToken(event.request.headers);
			let verified: Awaited<ReturnType<typeof verifyApiKey>>;
			try {
				verified = await verifyApiKey(bearerToken);
			} catch {
				return jsonErrorResponse(500, 'INTERNAL_ERROR', t('error.serverMessage'), requestId);
			}
			if (!verified) {
				return jsonErrorResponse(401, 'UNAUTHORIZED', t('auth.unauthorized'), requestId, {
					expireCookies: cookieSession.status === 'invalid'
				});
			}
			event.locals.user = verified.user;
			event.locals.session = null;
			event.locals.authChannel = 'api_key';
			event.locals.apiKeyId = verified.apiKeyId;
		}

		const response = await resolve(event);
		return applyStandardResponseHeaders(response, requestId);
	}

	// 4. Better Auth internal HTTP routes (/api/auth/*)
	if (isApiAuthPath(pathname)) {
		if (pathname.startsWith('/api/auth/sign-up')) {
			return jsonErrorResponse(403, 'SIGN_UP_DISABLED', t('auth.signupClosed'), requestId);
		}

		const isSignIn = pathname === '/api/auth/sign-in/email' && method === 'POST';
		const isSignOut = pathname === '/api/auth/sign-out' && method === 'POST';
		const isGetSession = pathname === '/api/auth/get-session' && method === 'GET';

		if (!isSignIn && !isSignOut && !isGetSession) {
			return jsonErrorResponse(403, 'FORBIDDEN', t('auth.endpointClosed'), requestId);
		}

		if (isGetSession) {
			const cookieSession = await resolveVerifiedCookieSession(event);
			if (cookieSession.status === 'error') {
				return jsonErrorResponse(503, 'SERVICE_UNAVAILABLE', t('api.unavailable'), requestId);
			}
			if (cookieSession.status === 'invalid') {
				return jsonErrorResponse(401, 'UNAUTHORIZED', t('auth.sessionExpired'), requestId, {
					expireCookies: true
				});
			}
		}

		if (isSignIn) {
			let bodyEmail: string | null = null;
			try {
				const parsedBody = (await event.request.clone().json()) as { email?: unknown } | null;
				if (parsedBody && typeof parsedBody.email === 'string') {
					bodyEmail = parsedBody.email;
				}
			} catch {
				// Ignore malformed JSON body here; Better Auth will validate it.
			}

			const rateLimit = checkLoginRateLimit(extractClientIp(event), bodyEmail, event.request);
			if (!rateLimit.allowed) {
				return jsonErrorResponse(429, 'RATE_LIMITED', t('auth.tooManyLogins'), requestId, {
					retryAfterSeconds: rateLimit.retryAfterSeconds
				});
			}
		}

		const authResponse = await svelteKitHandler({ auth, event, resolve, building });
		return applyStandardResponseHeaders(authResponse, requestId);
	}

	// 5. Public authentication views (/login, /auth/*) and logout endpoint
	if (pathname === '/login' || pathname.startsWith('/auth/') || pathname === '/logout') {
		const isHandledAuthFormPost =
			method === 'POST' &&
			(pathname === '/auth/accept-invite' || pathname === '/auth/reset-password');

		if (pathname.startsWith('/auth/') && !isHandledAuthFormPost) {
			const rateLimit = checkAuthTokenRateLimit(
				extractClientIp(event),
				event.url.searchParams.get('token'),
				event.request
			);
			if (!rateLimit.allowed) {
				return jsonErrorResponse(429, 'RATE_LIMITED', t('auth.tooManyAttempts'), requestId, {
					retryAfterSeconds: rateLimit.retryAfterSeconds,
					pathname
				});
			}
		}

		const cookieSession = await resolveVerifiedCookieSession(event);
		if (cookieSession.status === 'valid') {
			event.locals.user = cookieSession.user;
			event.locals.session = cookieSession.session;
			event.locals.authChannel = 'cookie';
		} else if (cookieSession.status === 'invalid' && (method === 'GET' || method === 'HEAD')) {
			clearSessionCookies(event.cookies);
		}

		const response = await resolve(event);
		return applyStandardResponseHeaders(response, requestId, { pathname });
	}

	// 6. All other web routes require a verified active session cookie
	const cookieSession = await resolveVerifiedCookieSession(event);
	if (cookieSession.status === 'error') {
		return jsonErrorResponse(503, 'SERVICE_UNAVAILABLE', t('api.unavailable'), requestId);
	}
	if (cookieSession.status === 'invalid') {
		return jsonErrorResponse(401, 'UNAUTHORIZED', t('auth.sessionExpired'), requestId, {
			expireCookies: true
		});
	}

	if (cookieSession.status === 'none') {
		if (method === 'GET' || method === 'HEAD') {
			const safeNext = sanitizeNextPath(`${pathname}${event.url.search}`);
			const target = safeNext === '/' ? '/login' : `/login?next=${encodeURIComponent(safeNext)}`;
			return applyStandardResponseHeaders(
				new Response(null, {
					status: 303,
					headers: { Location: target }
				}),
				requestId
			);
		}
		return jsonErrorResponse(401, 'UNAUTHORIZED', t('auth.signInRequired'), requestId);
	}

	event.locals.user = cookieSession.user;
	event.locals.session = cookieSession.session;
	event.locals.authChannel = 'cookie';

	if (isAdminPath(pathname) && cookieSession.user.role !== 'admin') {
		return jsonErrorResponse(403, 'FORBIDDEN', t('auth.adminRequired'), requestId);
	}

	if (pathname === '/search' || pathname.startsWith('/search/')) {
		const rateLimit = checkSearchRateLimit(cookieSession.session.id);
		if (!rateLimit.allowed) {
			return jsonErrorResponse(429, 'RATE_LIMITED', t('search.rateLimited'), requestId, {
				retryAfterSeconds: rateLimit.retryAfterSeconds
			});
		}
	}

	const response = await resolve(event);
	return applyStandardResponseHeaders(response, requestId, { pathname });
}

export const handleError: HandleServerError = ({ kind, error, event }) => {
	// SvelteKit 3 routes every caught error here: app errors from error(...), framework errors such
	// as 404s, validation errors and unknown (unexpected) errors.
	const status = kind === 'unknown' ? 500 : error.status;
	const message = kind === 'unknown' ? 'Internal Error' : error.message;
	const requestLogger = logger.child({
		request_id: event.locals?.requestId ?? null,
		user_id: event.locals?.user?.id ?? null,
		channel: event.locals?.authChannel === 'api_key' ? 'api' : 'web',
		client_version: event.request.headers.get('x-client-version')
	});

	if (status >= 500) {
		requestLogger.error('Unhandled server error', {
			status,
			kind,
			path: event.url.pathname,
			method: event.request.method,
			error: error instanceof Error ? error.message : message
		});
	} else {
		requestLogger.warn('Request error', {
			status,
			kind,
			message,
			path: event.url.pathname,
			method: event.request.method
		});
	}

	return {
		message: status >= 500 ? t('error.serverMessage') : message,
		requestId: event.locals?.requestId
	};
};
