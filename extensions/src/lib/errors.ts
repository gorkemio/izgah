import type { ApiErrorEnvelope, MappedApiError } from './types';
import { msg } from './i18n';

const KNOWN_VALIDATION_FIELDS = new Set([
	'url',
	'note',
	'sectionIds',
	'contentType',
	'isFeedVisible'
]);

/**
 * Typed exception wrapping a localized Turkish error representation for extension UI.
 */
export class IzgahApiError extends Error {
	readonly mapped: MappedApiError;

	constructor(mapped: MappedApiError) {
		super(mapped.userMessage);
		this.name = 'IzgahApiError';
		this.mapped = mapped;
	}
}

/**
 * Returns true when an error represents an intentional AbortController cancellation.
 */
export function isAbortError(error: unknown): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		'name' in error &&
		(error as { name?: unknown }).name === 'AbortError'
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates and extracts the structured API v1 error envelope if present.
 */
export function parseApiErrorEnvelope(payload: unknown): {
	code: string;
	message: string;
	requestId: string | null;
	details: Record<string, string[]>;
} | null {
	if (!isRecord(payload) || !isRecord(payload.error)) {
		return null;
	}

	const errObj = payload.error;
	if (typeof errObj.code !== 'string' || typeof errObj.message !== 'string') {
		return null;
	}

	const requestId =
		typeof errObj.requestId === 'string' && errObj.requestId.trim() !== ''
			? errObj.requestId.trim()
			: null;

	const details: Record<string, string[]> = {};
	if (isRecord(errObj.details)) {
		for (const [key, rawMessages] of Object.entries(errObj.details)) {
			if (!Array.isArray(rawMessages)) {
				continue;
			}
			const cleanMessages = rawMessages.filter(
				(item): item is string => typeof item === 'string' && item.trim() !== ''
			);
			if (cleanMessages.length > 0) {
				details[key] = cleanMessages;
			}
		}
	}

	return {
		code: errObj.code,
		message: errObj.message,
		requestId,
		details
	};
}

/**
 * Parses an HTTP Retry-After header (seconds or HTTP-date) into non-negative whole seconds.
 */
export function parseRetryAfterSeconds(
	headerValue: string | null | undefined,
	nowMs = Date.now()
): number | null {
	const trimmed = headerValue?.trim() ?? '';
	if (trimmed === '') {
		return null;
	}

	if (/^\d+$/.test(trimmed)) {
		const seconds = Number(trimmed);
		return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
	}

	const targetMs = Date.parse(trimmed);
	if (Number.isFinite(targetMs)) {
		return Math.max(0, Math.ceil((targetMs - nowMs) / 1000));
	}

	return null;
}

export interface MapApiErrorInput {
	status: number;
	payload?: ApiErrorEnvelope | unknown;
	headers?: Headers;
	nowMs?: number;
}

/**
 * Maps an HTTP response from Izgah /api/v1/* (or reverse proxy) to Turkish UI copy.
 */
export function mapApiErrorToTurkish({
	status,
	payload,
	headers,
	nowMs = Date.now()
}: MapApiErrorInput): MappedApiError {
	const envelope = parseApiErrorEnvelope(payload);
	const headerRequestId = headers?.get('x-request-id')?.trim() || null;
	const requestId = envelope?.requestId ?? headerRequestId;
	const code = envelope?.code ?? `HTTP_${status}`;

	if (status === 400) {
		return {
			status,
			code,
			userMessage: msg('errBadRequest'),
			requestId,
			fieldErrors: {},
			retryAfterSeconds: null,
			isAuthError: false,
			isNetworkError: false
		};
	}

	if (status === 401) {
		return {
			status,
			code,
			userMessage: msg('errUnauthorized'),
			requestId,
			fieldErrors: {},
			retryAfterSeconds: null,
			isAuthError: true,
			isNetworkError: false
		};
	}

	if (status === 403) {
		return {
			status,
			code,
			userMessage: msg('errForbidden'),
			requestId,
			fieldErrors: {},
			retryAfterSeconds: null,
			isAuthError: false,
			isNetworkError: false
		};
	}

	if (status === 404 || status === 405) {
		return {
			status,
			code,
			userMessage: msg('errNotFound'),
			requestId,
			fieldErrors: {},
			retryAfterSeconds: null,
			isAuthError: false,
			isNetworkError: false
		};
	}

	if (status === 409) {
		return {
			status,
			code,
			userMessage: envelope?.message || msg('errConflict'),
			requestId,
			fieldErrors: {},
			retryAfterSeconds: null,
			isAuthError: false,
			isNetworkError: false
		};
	}

	if (status === 422) {
		const fieldErrors: Record<string, string[]> = {};
		const rootAndUnknownMessages: string[] = [];

		if (envelope) {
			for (const [key, messages] of Object.entries(envelope.details)) {
				if (KNOWN_VALIDATION_FIELDS.has(key)) {
					fieldErrors[key] = messages;
				} else {
					rootAndUnknownMessages.push(...messages);
				}
			}
		}

		const baseMessage = envelope?.message || msg('errValidation');
		const userMessage =
			rootAndUnknownMessages.length > 0
				? `${baseMessage} ${rootAndUnknownMessages.join(' ')}`
				: baseMessage;

		return {
			status,
			code,
			userMessage,
			requestId,
			fieldErrors,
			retryAfterSeconds: null,
			isAuthError: false,
			isNetworkError: false
		};
	}

	if (status === 429) {
		const retryAfterSeconds = parseRetryAfterSeconds(headers?.get('retry-after'), nowMs);
		const retryHint =
			retryAfterSeconds !== null ? msg('errRetryAfter', retryAfterSeconds) : msg('errRetrySoon');

		return {
			status,
			code,
			userMessage: msg('errRateLimited', retryHint),
			requestId,
			fieldErrors: {},
			retryAfterSeconds,
			isAuthError: false,
			isNetworkError: false
		};
	}

	if (status >= 500) {
		return {
			status,
			code,
			userMessage: msg('errServer'),
			requestId,
			fieldErrors: {},
			retryAfterSeconds: null,
			isAuthError: false,
			isNetworkError: false
		};
	}

	return {
		status,
		code,
		userMessage: envelope?.message || msg('errUnknown'),
		requestId,
		fieldErrors: {},
		retryAfterSeconds: null,
		isAuthError: false,
		isNetworkError: false
	};
}

/**
 * Maps network, CORS, or request-timeout failures (without HTTP status) to Turkish UI copy.
 */
export function mapNetworkErrorToTurkish(error: unknown): MappedApiError {
	const isTimeout =
		typeof error === 'object' &&
		error !== null &&
		'name' in error &&
		(error as { name?: unknown }).name === 'TimeoutError';

	return {
		status: null,
		code: isTimeout ? 'TIMEOUT_ERROR' : 'NETWORK_ERROR',
		userMessage: msg('errNetwork'),
		requestId: null,
		fieldErrors: {},
		retryAfterSeconds: null,
		isAuthError: false,
		isNetworkError: true
	};
}
