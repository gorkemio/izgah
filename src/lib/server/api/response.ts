import type { RequestEvent } from '@sveltejs/kit';
import type { ZodError } from 'zod';
import { UrlCanonicalizeError } from '#lib/server/links/canonicalize.ts';
import { LinkServiceError } from '#lib/server/links/service.ts';
import { logger, type Logger } from '#lib/server/logger.ts';
import { t } from '#lib/i18n/index.ts';

export type ApiV1User = NonNullable<App.Locals['user']>;

const CORS_HEADERS: Record<string, string> = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
	'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Client-Name, X-Client-Version',
	'Access-Control-Expose-Headers': 'X-Request-Id'
};

function buildBaseHeaders(requestId: string, includeContentType: boolean): Headers {
	const headers = new Headers(CORS_HEADERS);
	headers.set('X-Request-Id', requestId);
	headers.set('Cache-Control', 'no-store');
	if (includeContentType) {
		headers.set('Content-Type', 'application/json; charset=utf-8');
	}
	return headers;
}

export function getRequestId(event: RequestEvent): string {
	return event.locals?.requestId || 'req_unknown';
}

export function apiPreflight(requestId: string): Response {
	return new Response(null, {
		status: 204,
		headers: buildBaseHeaders(requestId, false)
	});
}

export function apiJson(data: unknown, requestId: string, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: buildBaseHeaders(requestId, true)
	});
}

export function apiError(
	status: number,
	code: string,
	message: string,
	requestId: string,
	details?: Record<string, string[]>
): Response {
	const errorBody: {
		code: string;
		message: string;
		requestId: string;
		details?: Record<string, string[]>;
	} = {
		code,
		message,
		requestId
	};

	if (details && Object.keys(details).length > 0) {
		errorBody.details = details;
	}

	return new Response(JSON.stringify({ error: errorBody }), {
		status,
		headers: buildBaseHeaders(requestId, true)
	});
}

export function requireApiV1User(
	event: RequestEvent
): { ok: true; user: ApiV1User } | { ok: false; response: Response } {
	const requestId = getRequestId(event);
	if (!event.locals.user || event.locals.authChannel !== 'api_key') {
		return {
			ok: false,
			response: apiError(401, 'UNAUTHORIZED', t('api.keyRequired'), requestId)
		};
	}

	return {
		ok: true,
		user: event.locals.user
	};
}

export function formatZodDetails(error: ZodError): Record<string, string[]> {
	const details: Record<string, string[]> = {};
	for (const issue of error.issues) {
		const key = issue.path.length > 0 ? String(issue.path[0]) : '_root';
		if (!details[key]) {
			details[key] = [];
		}
		details[key].push(issue.message);
	}
	return details;
}

export function extractApiClientMetadata(headers: Headers): {
	clientName: string | null;
	clientVersion: string | null;
} {
	const clientName = headers.get('x-client-name')?.trim() || null;
	const clientVersion = headers.get('x-client-version')?.trim() || null;
	return { clientName, clientVersion };
}

export function createApiRequestLogger(event: RequestEvent): {
	log: Logger;
	clientName: string | null;
	clientVersion: string | null;
} {
	const { clientName, clientVersion } = extractApiClientMetadata(event.request.headers);
	const log = logger.child({
		request_id: getRequestId(event),
		user_id: event.locals.user?.id ?? null,
		channel: 'api',
		client_version: clientVersion
	});

	return { log, clientName, clientVersion };
}

export function handleApiV1Error(error: unknown, event: RequestEvent): Response {
	const requestId = getRequestId(event);

	if (error instanceof LinkServiceError) {
		return apiError(error.status, error.code, error.message, requestId, error.details);
	}

	if (error instanceof UrlCanonicalizeError) {
		return apiError(422, 'VALIDATION_ERROR', error.message, requestId, {
			url: [error.message]
		});
	}

	const { log, clientName } = createApiRequestLogger(event);
	log.error('Unhandled API v1 error', {
		path: event.url.pathname,
		method: event.request.method,
		...(clientName ? { client_name: clientName } : {}),
		error: error instanceof Error ? error.message : String(error)
	});

	return apiError(500, 'INTERNAL_ERROR', t('error.serverMessage'), requestId);
}
