import type { AiProvider } from '#lib/server/smart-capture/settings.ts';

/**
 * Two wire formats cover every provider (docs/designs/izgah-smart-capture.md §5): OpenAI-compatible
 * chat completions (OpenRouter, OpenAI, Gemini, custom servers) and Anthropic's Messages API.
 * Plain fetch, no SDK. Calls never go through safeFetch: the address comes only from an admin and a
 * local model may live on a private network.
 */

export const ANTHROPIC_API_VERSION = '2026-10-21';
export const ANTHROPIC_MAX_TOKENS = 1024;
export const PROVIDER_TIMEOUT_MS = 60_000;
export const MAX_COMPLETION_BYTES = 1024 * 1024;
export const MAX_MODEL_LIST_BYTES = 8 * 1024 * 1024;
const MAX_MODELS = 1000;

export const PROVIDER_BASE_URLS: Record<Exclude<AiProvider, 'custom'>, string> = {
	openrouter: 'https://openrouter.ai/api/v1',
	openai: 'https://api.openai.com/v1',
	gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
	anthropic: 'https://api.anthropic.com/v1'
};

export interface ProviderConfig {
	provider: AiProvider;
	baseUrl: string | null;
	model: string;
	apiKey: string | null;
}

export interface StructuredRequest {
	system: string;
	user: string;
	schemaName: string;
	schema: Record<string, unknown>;
}

export interface StructuredResult {
	json: unknown;
	inputTokens: number;
	outputTokens: number;
}

export type AiProviderErrorCode =
	| 'CONFIG'
	| 'AUTH'
	| 'RATE_LIMITED'
	| 'BAD_REQUEST'
	| 'UPSTREAM'
	| 'TIMEOUT'
	| 'NETWORK'
	| 'BAD_OUTPUT';

export class AiProviderError extends Error {
	readonly code: AiProviderErrorCode;
	readonly status?: number;
	readonly retryAfterSeconds?: number;

	constructor(
		code: AiProviderErrorCode,
		message: string,
		options: { status?: number; retryAfterSeconds?: number } = {}
	) {
		super(message);
		this.name = 'AiProviderError';
		this.code = code;
		this.status = options.status;
		this.retryAfterSeconds = options.retryAfterSeconds;
	}
}

export interface CallOptions {
	fetchImpl?: typeof fetch;
	signal?: AbortSignal;
	timeoutMs?: number;
}

/** Validates an admin-provided base URL for the custom provider (http/https, no credentials). */
export function normalizeCustomBaseUrl(raw: string): string | null {
	const trimmed = raw.trim();
	if (!trimmed) {
		return null;
	}
	let url: URL;
	try {
		url = new URL(trimmed);
	} catch {
		return null;
	}
	if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
		return null;
	}
	url.search = '';
	url.hash = '';
	return url.toString().replace(/\/+$/, '');
}

export function resolveBaseUrl(config: Pick<ProviderConfig, 'provider' | 'baseUrl'>): string {
	if (config.provider === 'custom') {
		const base = config.baseUrl ? normalizeCustomBaseUrl(config.baseUrl) : null;
		if (!base) {
			throw new AiProviderError('CONFIG', 'A base URL is required for a custom provider.');
		}
		return base;
	}
	return PROVIDER_BASE_URLS[config.provider];
}

function redact(text: string, apiKey: string | null): string {
	let out = text.replace(/[\r\n\t]+/g, ' ').trim();
	if (apiKey && apiKey.length >= 6) {
		out = out.split(apiKey).join('[redacted]');
	}
	return out.length > 200 ? `${out.slice(0, 200)}…` : out;
}

async function readCapped(response: Response, maxBytes: number): Promise<string> {
	if (!response.body) {
		return '';
	}
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}
		total += value.byteLength;
		if (total > maxBytes) {
			await reader.cancel().catch(() => {});
			throw new AiProviderError('BAD_OUTPUT', 'The provider response is too large.');
		}
		chunks.push(value);
	}
	return Buffer.concat(chunks).toString('utf8');
}

function providerErrorMessage(bodyText: string): string {
	try {
		const parsed = JSON.parse(bodyText) as { error?: { message?: unknown } | string };
		if (typeof parsed.error === 'string') {
			return parsed.error;
		}
		if (parsed.error && typeof parsed.error.message === 'string') {
			return parsed.error.message;
		}
	} catch {
		// not JSON
	}
	return '';
}

function parseRetryAfter(value: string | null): number | undefined {
	if (!value) {
		return undefined;
	}
	const seconds = Number(value);
	if (Number.isFinite(seconds) && seconds >= 0) {
		return Math.min(Math.ceil(seconds), 24 * 60 * 60);
	}
	const date = Date.parse(value);
	if (Number.isFinite(date)) {
		return Math.max(0, Math.ceil((date - Date.now()) / 1000));
	}
	return undefined;
}

async function request(
	url: string,
	init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string },
	apiKey: string | null,
	maxBytes: number,
	options: CallOptions
): Promise<unknown> {
	const fetchImpl = options.fetchImpl ?? fetch;
	const timeout = AbortSignal.timeout(options.timeoutMs ?? PROVIDER_TIMEOUT_MS);
	const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
	let response: Response;
	try {
		response = await fetchImpl(url, { ...init, redirect: 'error', signal });
	} catch (error) {
		if (timeout.aborted) {
			throw new AiProviderError('TIMEOUT', 'The provider did not answer in time.');
		}
		if (options.signal?.aborted) {
			throw error;
		}
		throw new AiProviderError('NETWORK', 'The provider could not be reached.');
	}

	const text = await readCapped(response, maxBytes);
	if (!response.ok) {
		const detail = redact(providerErrorMessage(text), apiKey);
		const message = `HTTP ${response.status}${detail ? `: ${detail}` : ''}`;
		const status = response.status;
		if (status === 401 || status === 403) {
			throw new AiProviderError('AUTH', message, { status });
		}
		if (status === 429) {
			throw new AiProviderError('RATE_LIMITED', message, {
				status,
				retryAfterSeconds: parseRetryAfter(response.headers.get('retry-after'))
			});
		}
		if (status >= 500) {
			throw new AiProviderError('UPSTREAM', message, { status });
		}
		throw new AiProviderError('BAD_REQUEST', message, { status });
	}
	try {
		return JSON.parse(text) as unknown;
	} catch {
		throw new AiProviderError('BAD_OUTPUT', 'The provider returned invalid JSON.');
	}
}

/** Parses model text into JSON, tolerating code fences and prose around one object. */
export function parseJsonText(text: string): unknown {
	const trimmed = text
		.trim()
		.replace(/^```(?:json)?\s*/i, '')
		.replace(/```$/, '')
		.trim();
	try {
		return JSON.parse(trimmed) as unknown;
	} catch {
		const start = trimmed.indexOf('{');
		const end = trimmed.lastIndexOf('}');
		if (start >= 0 && end > start) {
			try {
				return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
			} catch {
				// fall through
			}
		}
		throw new AiProviderError('BAD_OUTPUT', 'The model did not return valid JSON.');
	}
}

function toCount(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

async function callOpenAiCompatible(
	config: ProviderConfig,
	input: StructuredRequest,
	options: CallOptions
): Promise<StructuredResult> {
	const base = resolveBaseUrl(config);
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	if (config.apiKey) {
		headers.Authorization = `Bearer ${config.apiKey}`;
	}
	const buildBody = (format: 'json_schema' | 'json_object') =>
		JSON.stringify({
			model: config.model,
			messages: [
				{ role: 'system', content: input.system },
				{ role: 'user', content: input.user }
			],
			response_format:
				format === 'json_schema'
					? {
							type: 'json_schema',
							json_schema: { name: input.schemaName, strict: true, schema: input.schema }
						}
					: { type: 'json_object' },
			...(config.provider === 'openrouter' ? { provider: { require_parameters: true } } : {})
		});

	let payload: unknown;
	try {
		payload = await request(
			`${base}/chat/completions`,
			{ method: 'POST', headers, body: buildBody('json_schema') },
			config.apiKey,
			MAX_COMPLETION_BYTES,
			options
		);
	} catch (error) {
		// Some OpenAI-compatible servers reject json_schema; retry once with plain JSON mode.
		if (!(error instanceof AiProviderError) || error.code !== 'BAD_REQUEST') {
			throw error;
		}
		payload = await request(
			`${base}/chat/completions`,
			{ method: 'POST', headers, body: buildBody('json_object') },
			config.apiKey,
			MAX_COMPLETION_BYTES,
			options
		);
	}

	const data = payload as {
		choices?: Array<{ message?: { content?: unknown; refusal?: unknown } }>;
		usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
	};
	const message = data.choices?.[0]?.message;
	if (typeof message?.content !== 'string' || message.content.trim() === '') {
		throw new AiProviderError('BAD_OUTPUT', 'The model returned no content.');
	}
	return {
		json: parseJsonText(message.content),
		inputTokens: toCount(data.usage?.prompt_tokens),
		outputTokens: toCount(data.usage?.completion_tokens)
	};
}

async function callAnthropic(
	config: ProviderConfig,
	input: StructuredRequest,
	options: CallOptions
): Promise<StructuredResult> {
	if (!config.apiKey) {
		throw new AiProviderError('CONFIG', 'An API key is required.');
	}
	const base = resolveBaseUrl(config);
	const payload = await request(
		`${base}/messages`,
		{
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': config.apiKey,
				'anthropic-version': ANTHROPIC_API_VERSION
			},
			body: JSON.stringify({
				model: config.model,
				max_tokens: ANTHROPIC_MAX_TOKENS,
				system: input.system,
				messages: [{ role: 'user', content: input.user }],
				output_config: { format: { type: 'json_schema', schema: input.schema } }
			})
		},
		config.apiKey,
		MAX_COMPLETION_BYTES,
		options
	);
	const data = payload as {
		content?: Array<{ type?: unknown; text?: unknown }>;
		stop_reason?: unknown;
		usage?: { input_tokens?: unknown; output_tokens?: unknown };
	};
	if (data.stop_reason === 'refusal') {
		throw new AiProviderError('BAD_OUTPUT', 'The model refused the request.');
	}
	const text = data.content?.find((block) => block.type === 'text')?.text;
	if (typeof text !== 'string' || text.trim() === '') {
		throw new AiProviderError('BAD_OUTPUT', 'The model returned no content.');
	}
	return {
		json: parseJsonText(text),
		inputTokens: toCount(data.usage?.input_tokens),
		outputTokens: toCount(data.usage?.output_tokens)
	};
}

export async function callStructured(
	config: ProviderConfig,
	input: StructuredRequest,
	options: CallOptions = {}
): Promise<StructuredResult> {
	if (!config.model.trim()) {
		throw new AiProviderError('CONFIG', 'Choose a model first.');
	}
	if (config.provider !== 'custom' && !config.apiKey) {
		throw new AiProviderError('CONFIG', 'An API key is required.');
	}
	return config.provider === 'anthropic'
		? callAnthropic(config, input, options)
		: callOpenAiCompatible(config, input, options);
}

/** Lists model IDs that can return structured output, best effort per provider. */
export async function listModels(
	config: Omit<ProviderConfig, 'model'>,
	options: CallOptions = {}
): Promise<string[]> {
	const base = resolveBaseUrl(config);
	const headers: Record<string, string> = {};
	if (config.provider === 'anthropic') {
		if (!config.apiKey) {
			throw new AiProviderError('CONFIG', 'An API key is required.');
		}
		headers['x-api-key'] = config.apiKey;
		headers['anthropic-version'] = ANTHROPIC_API_VERSION;
	} else if (config.apiKey) {
		headers.Authorization = `Bearer ${config.apiKey}`;
	}
	const url = config.provider === 'anthropic' ? `${base}/models?limit=1000` : `${base}/models`;
	const payload = (await request(
		url,
		{ method: 'GET', headers },
		config.apiKey,
		MAX_MODEL_LIST_BYTES,
		options
	)) as { data?: unknown };
	const entries = Array.isArray(payload.data) ? payload.data : [];
	const ids = new Set<string>();
	for (const entry of entries) {
		if (!entry || typeof entry !== 'object') {
			continue;
		}
		const model = entry as {
			id?: unknown;
			supported_parameters?: unknown;
			capabilities?: { structured_outputs?: { supported?: unknown } } | null;
		};
		if (typeof model.id !== 'string' || !model.id.trim()) {
			continue;
		}
		if (config.provider === 'openrouter' && Array.isArray(model.supported_parameters)) {
			const params = model.supported_parameters as unknown[];
			if (!params.includes('structured_outputs') && !params.includes('response_format')) {
				continue;
			}
		}
		if (
			config.provider === 'anthropic' &&
			model.capabilities?.structured_outputs?.supported === false
		) {
			continue;
		}
		const id = config.provider === 'gemini' ? model.id.replace(/^models\//, '') : model.id;
		ids.add(id.trim());
	}
	return [...ids].sort((a, b) => a.localeCompare(b)).slice(0, MAX_MODELS);
}

/** Tiny structured request used by "Test connection". */
export async function testProvider(
	config: ProviderConfig,
	options: CallOptions = {}
): Promise<StructuredResult> {
	const result = await callStructured(
		config,
		{
			system: 'You are a connection test. Answer with JSON only.',
			user: 'Return {"ok": true}.',
			schemaName: 'connection_test',
			schema: {
				type: 'object',
				additionalProperties: false,
				required: ['ok'],
				properties: { ok: { type: 'boolean' } }
			}
		},
		{ ...options, timeoutMs: options.timeoutMs ?? 30_000 }
	);
	const ok = (result.json as { ok?: unknown } | null)?.ok;
	if (ok !== true) {
		throw new AiProviderError('BAD_OUTPUT', 'The model answered, but not with the expected JSON.');
	}
	return result;
}
