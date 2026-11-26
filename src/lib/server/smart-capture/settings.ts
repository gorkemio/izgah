import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, type Database } from '#lib/server/db/client.ts';
import { instanceSettings } from '#lib/server/db/schema.ts';
import { env } from '#lib/server/env.ts';
import { openSecret, sealSecret, SecretBoxError } from '#lib/server/crypto/secret-box.ts';

/** Settings row for docs/designs/izgah-smart-capture.md §9. */
export const SMART_CAPTURE_SETTINGS_KEY = 'smart_capture';

export const AI_PROVIDERS = ['openrouter', 'anthropic', 'openai', 'gemini', 'custom'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export const SECTION_MODES = ['off', 'suggest', 'auto'] as const;
export type SectionMode = (typeof SECTION_MODES)[number];

export const DEFAULT_DAILY_REQUEST_LIMIT = 200;
export const MAX_EXCLUDED_DOMAINS = 200;

const settingsSchema = z.object({
	historySuggestions: z.boolean().catch(true),
	enabled: z.boolean().catch(false),
	provider: z.enum(AI_PROVIDERS).catch('openrouter'),
	baseUrl: z.string().nullable().catch(null),
	model: z.string().catch(''),
	sectionMode: z.enum(SECTION_MODES).catch('suggest'),
	summaries: z.boolean().catch(true),
	keywords: z.boolean().catch(true),
	sendExcerpt: z.boolean().catch(true),
	includeNotes: z.boolean().catch(false),
	excludedDomains: z.array(z.string()).catch([]),
	dailyRequestLimit: z.number().int().min(1).max(100_000).catch(DEFAULT_DAILY_REQUEST_LIMIT),
	pausedReason: z.enum(['auth_failed']).nullable().catch(null),
	keyHint: z.string().nullable().catch(null),
	models: z.array(z.string()).catch([]),
	modelsFetchedAt: z.string().nullable().catch(null)
});

export type SmartCaptureSettings = z.infer<typeof settingsSchema>;

export function defaultSmartCaptureSettings(): SmartCaptureSettings {
	return settingsSchema.parse({});
}

export function parseSmartCaptureSettings(raw: unknown): SmartCaptureSettings {
	const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
	return settingsSchema.parse(source);
}

export interface SmartCaptureState {
	settings: SmartCaptureSettings;
	/** A key is stored (it may still be unreadable after BETTER_AUTH_SECRET rotation). */
	hasKey: boolean;
	keyUnreadable: boolean;
	/** AI_FEATURES=off from the operator. */
	aiAllowed: boolean;
	updatedAt: Date | null;
}

type Executor = Pick<Database, 'select' | 'insert' | 'update'>;

async function readRow(executor: Executor = db) {
	const [row] = await executor
		.select()
		.from(instanceSettings)
		.where(eq(instanceSettings.key, SMART_CAPTURE_SETTINGS_KEY))
		.limit(1);
	return row ?? null;
}

function canOpen(secret: string | null): boolean {
	if (!secret) {
		return false;
	}
	try {
		openSecret(secret, env.BETTER_AUTH_SECRET);
		return true;
	} catch (error) {
		if (error instanceof SecretBoxError) {
			return false;
		}
		throw error;
	}
}

export async function loadSmartCaptureState(executor: Executor = db): Promise<SmartCaptureState> {
	const row = await readRow(executor);
	const hasKey = Boolean(row?.secret);
	return {
		settings: parseSmartCaptureSettings(row?.value),
		hasKey,
		keyUnreadable: hasKey && !canOpen(row?.secret ?? null),
		aiAllowed: env.AI_FEATURES === 'on',
		updatedAt: row?.updatedAt ?? null
	};
}

/** Decrypted API key for server-side provider calls; null when missing or unreadable. */
export async function readProviderApiKey(executor: Executor = db): Promise<string | null> {
	const row = await readRow(executor);
	if (!row?.secret) {
		return null;
	}
	try {
		return openSecret(row.secret, env.BETTER_AUTH_SECRET);
	} catch (error) {
		if (error instanceof SecretBoxError) {
			return null;
		}
		throw error;
	}
}

export function keyHintFor(apiKey: string): string {
	return apiKey.slice(-4);
}

/**
 * Writes the settings. `apiKey`: undefined keeps the stored key, null removes it, a string replaces it.
 */
export async function writeSmartCaptureSettings(
	settings: SmartCaptureSettings,
	options: { actorUserId: string | null; apiKey?: string | null },
	executor: Executor = db
): Promise<void> {
	const value = { ...settings };
	let secretUpdate: { secret: string | null } | Record<string, never> = {};
	if (options.apiKey === null) {
		secretUpdate = { secret: null };
		value.keyHint = null;
	} else if (typeof options.apiKey === 'string') {
		secretUpdate = { secret: sealSecret(options.apiKey, env.BETTER_AUTH_SECRET) };
		value.keyHint = keyHintFor(options.apiKey);
	}
	const now = new Date();
	await executor
		.insert(instanceSettings)
		.values({
			key: SMART_CAPTURE_SETTINGS_KEY,
			value,
			secret: 'secret' in secretUpdate ? secretUpdate.secret : null,
			updatedById: options.actorUserId,
			updatedAt: now
		})
		.onConflictDoUpdate({
			target: instanceSettings.key,
			set: { value, ...secretUpdate, updatedById: options.actorUserId, updatedAt: now }
		});
}

/** Normalises one excluded-domain line: lowercase host without scheme, path or leading dot. */
export function normalizeExcludedDomain(line: string): string | null {
	let value = line.trim().toLowerCase();
	if (!value) {
		return null;
	}
	value = value
		.replace(/^[a-z]+:\/\//, '')
		.replace(/[/?#].*$/, '')
		.replace(/^\.+/, '');
	value = value.replace(/:\d+$/, '');
	if (!/^[a-z0-9.-]+$/.test(value) || !value.includes('.')) {
		return null;
	}
	return value;
}

export function isDomainExcluded(domain: string, excluded: readonly string[]): boolean {
	const host = domain.toLowerCase();
	return excluded.some((entry) => host === entry || host.endsWith(`.${entry}`));
}

/** AI calls may run: operator allows it, admin enabled it, a model is set and it is not paused. */
export function isAiReady(state: SmartCaptureState): boolean {
	const { settings } = state;
	if (!state.aiAllowed || !settings.enabled || settings.pausedReason || !settings.model.trim()) {
		return false;
	}
	if (settings.provider === 'custom') {
		return Boolean(settings.baseUrl) && !state.keyUnreadable;
	}
	return state.hasKey && !state.keyUnreadable;
}
