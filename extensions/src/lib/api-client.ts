import {
	IzgahApiError,
	isAbortError,
	mapApiErrorToTurkish,
	mapNetworkErrorToTurkish
} from './errors';
import {
	REQUEST_TIMEOUT_MS,
	type BrowserTarget,
	type CreateLinkInput,
	type CreateLinkResponse,
	type LinkCheckResponse,
	type MeResponse,
	type SectionsResponse
} from './types';
import { msg } from './i18n';

export interface BuildClientHeadersOptions {
	apiKey: string;
	browserTarget: BrowserTarget;
	clientVersion: string;
	includeContentType?: boolean;
}

/**
 * Builds mandatory Izgah API v1 identification and bearer auth headers.
 */
export function buildClientHeaders({
	apiKey,
	browserTarget,
	clientVersion,
	includeContentType = false
}: BuildClientHeadersOptions): Headers {
	const headers = new Headers();
	headers.set('Authorization', `Bearer ${apiKey.trim()}`);
	headers.set('X-Client-Name', `izgah-${browserTarget}-extension`);
	headers.set('X-Client-Version', clientVersion);
	headers.set('Accept', 'application/json');
	if (includeContentType) {
		headers.set('Content-Type', 'application/json');
	}
	return headers;
}

export interface CreateIzgahApiClientOptions {
	serverOrigin: string;
	apiKey: string;
	browserTarget: BrowserTarget;
	clientVersion: string;
	timeoutMs?: number;
	fetchImpl?: typeof fetch;
}

export interface IzgahApiClient {
	getMe(signal?: AbortSignal): Promise<MeResponse>;
	getSections(signal?: AbortSignal): Promise<SectionsResponse>;
	checkLink(url: string, signal?: AbortSignal): Promise<LinkCheckResponse>;
	createLink(input: CreateLinkInput, signal?: AbortSignal): Promise<CreateLinkResponse>;
}

function createCallerAbortError(reason: unknown): Error {
	if (isAbortError(reason) && reason instanceof Error) {
		return reason;
	}
	const err = new Error(msg('requestAborted'));
	err.name = 'AbortError';
	return err;
}

/**
 * Creates a cookie-free /api/v1/* HTTP client with bounded request timeouts and Turkish error mapping.
 */
export function createIzgahApiClient({
	serverOrigin,
	apiKey,
	browserTarget,
	clientVersion,
	timeoutMs = REQUEST_TIMEOUT_MS,
	fetchImpl = globalThis.fetch
}: CreateIzgahApiClientOptions): IzgahApiClient {
	const normalizedBase = serverOrigin.replace(/\/+$/, '');

	async function requestJson<T>(
		path: string,
		init: { method: 'GET' | 'POST'; body?: string; signal?: AbortSignal }
	): Promise<T> {
		if (init.signal?.aborted) {
			throw createCallerAbortError(init.signal.reason);
		}

		const controller = new AbortController();
		let didTimeout = false;
		let didCallerAbort = false;

		const onCallerAbort = () => {
			didCallerAbort = true;
			controller.abort(init.signal?.reason);
		};

		init.signal?.addEventListener('abort', onCallerAbort, { once: true });
		const timeoutHandle = globalThis.setTimeout(() => {
			didTimeout = true;
			const timeoutError = new Error(msg('requestTimeout'));
			timeoutError.name = 'TimeoutError';
			controller.abort(timeoutError);
		}, timeoutMs);

		let response: Response;
		try {
			response = await fetchImpl(`${normalizedBase}${path}`, {
				method: init.method,
				headers: buildClientHeaders({
					apiKey,
					browserTarget,
					clientVersion,
					includeContentType: init.body !== undefined
				}),
				body: init.body,
				credentials: 'omit',
				signal: controller.signal
			});
		} catch (error) {
			if (didCallerAbort || (!didTimeout && isAbortError(error))) {
				throw createCallerAbortError(init.signal?.reason ?? error);
			}
			if (didTimeout) {
				const timeoutError = new Error(msg('requestTimeout'));
				timeoutError.name = 'TimeoutError';
				throw new IzgahApiError(mapNetworkErrorToTurkish(timeoutError));
			}
			throw new IzgahApiError(mapNetworkErrorToTurkish(error));
		} finally {
			globalThis.clearTimeout(timeoutHandle);
			init.signal?.removeEventListener('abort', onCallerAbort);
		}

		let rawText = '';
		try {
			rawText = await response.text();
		} catch {
			rawText = '';
		}

		let parsedPayload: unknown = null;
		if (rawText !== '') {
			try {
				parsedPayload = JSON.parse(rawText);
			} catch {
				parsedPayload = null;
			}
		}

		if (!response.ok) {
			throw new IzgahApiError(
				mapApiErrorToTurkish({
					status: response.status,
					payload: parsedPayload,
					headers: response.headers
				})
			);
		}

		if (parsedPayload === null) {
			throw new IzgahApiError(
				mapApiErrorToTurkish({
					status: 502,
					payload: null,
					headers: response.headers
				})
			);
		}

		return parsedPayload as T;
	}

	return {
		getMe(signal) {
			return requestJson<MeResponse>('/api/v1/me', {
				method: 'GET',
				signal
			});
		},

		getSections(signal) {
			return requestJson<SectionsResponse>('/api/v1/sections', {
				method: 'GET',
				signal
			});
		},

		checkLink(url, signal) {
			const query = new URLSearchParams({ url: url.trim() });
			return requestJson<LinkCheckResponse>(`/api/v1/links/check?${query.toString()}`, {
				method: 'GET',
				signal
			});
		},

		createLink(input, signal) {
			const payload: Record<string, unknown> = {
				url: input.url.trim()
			};

			const trimmedNote = input.note?.trim();
			if (trimmedNote) {
				payload.note = trimmedNote;
			}

			if (input.sectionIds && input.sectionIds.length > 0) {
				payload.sectionIds = input.sectionIds;
			}

			if (input.contentType) {
				payload.contentType = input.contentType;
			}

			if (input.isFeedVisible === false) {
				payload.isFeedVisible = false;
			}

			return requestJson<CreateLinkResponse>('/api/v1/links', {
				method: 'POST',
				body: JSON.stringify(payload),
				signal
			});
		}
	};
}
