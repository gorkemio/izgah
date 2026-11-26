import { and, desc, eq, gte, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import { recordAuditLog } from '#lib/server/audit.ts';
import { db } from '#lib/server/db/client.ts';
import {
	aiUsageDaily,
	canonicalResources,
	enrichmentJobs,
	linkShares,
	resourceEnrichments,
	shareSectionSuggestions
} from '#lib/server/db/schema.ts';
import {
	AiProviderError,
	listModels,
	normalizeCustomBaseUrl,
	testProvider,
	type CallOptions
} from '#lib/server/ai/providers.ts';
import {
	AI_PROVIDERS,
	DEFAULT_DAILY_REQUEST_LIMIT,
	loadSmartCaptureState,
	MAX_EXCLUDED_DOMAINS,
	normalizeExcludedDomain,
	readProviderApiKey,
	SECTION_MODES,
	writeSmartCaptureSettings,
	type AiProvider,
	type SectionMode,
	type SmartCaptureSettings,
	type SmartCaptureState
} from './settings.ts';
import { notifyEnrichmentWorker, requestsToday, usageDay } from './worker.ts';

/** Server side of `/admin/ai` (docs/designs/izgah-smart-capture.md §9). */

const USAGE_DAYS = 7;
const MAX_MODEL_LENGTH = 200;
const MAX_KEY_LENGTH = 400;
const BACKFILL_LIMIT = 5_000;

export interface SmartCaptureAdminView {
	state: Omit<SmartCaptureState, 'updatedAt'>;
	requestsToday: number;
	usage: Array<{
		day: string;
		requests: number;
		inputTokens: number;
		outputTokens: number;
		failures: number;
	}>;
	queue: { queued: number; running: number; dead: number };
	enrichableCount: number;
}

export interface SmartCaptureFormInput {
	aiFields: boolean;
	historySuggestions: boolean;
	enabled: boolean;
	provider: string;
	baseUrl: string;
	apiKey: string;
	removeKey: boolean;
	model: string;
	sectionMode: string;
	summaries: boolean;
	keywords: boolean;
	sendExcerpt: boolean;
	includeNotes: boolean;
	excludedDomains: string;
	dailyRequestLimit: string;
}

export type FieldErrors = Partial<
	Record<'baseUrl' | 'apiKey' | 'model' | 'dailyRequestLimit', string>
>;

export class SmartCaptureFormError extends Error {
	readonly fieldErrors: FieldErrors;
	constructor(fieldErrors: FieldErrors) {
		super('Invalid smart capture settings');
		this.fieldErrors = fieldErrors;
	}
}

export function readSmartCaptureForm(form: FormData): SmartCaptureFormInput {
	const text = (name: string) => {
		const value = form.get(name);
		return typeof value === 'string' ? value : '';
	};
	const flag = (name: string) => form.get(name) === 'on' || form.get(name) === 'true';
	return {
		aiFields: text('aiFields') === '1',
		historySuggestions: flag('historySuggestions'),
		enabled: flag('enabled'),
		provider: text('provider'),
		baseUrl: text('baseUrl'),
		apiKey: text('apiKey'),
		removeKey: flag('removeKey'),
		model: text('model'),
		sectionMode: text('sectionMode'),
		summaries: flag('summaries'),
		keywords: flag('keywords'),
		sendExcerpt: flag('sendExcerpt'),
		includeNotes: flag('includeNotes'),
		excludedDomains: text('excludedDomains'),
		dailyRequestLimit: text('dailyRequestLimit')
	};
}

/** Validates the form into the next settings. Error messages are i18n keys resolved by the page. */
export function buildSettingsFromForm(
	current: SmartCaptureSettings,
	input: SmartCaptureFormInput,
	aiAllowed: boolean
): { settings: SmartCaptureSettings; apiKey: string | null | undefined } {
	const next: SmartCaptureSettings = { ...current, historySuggestions: input.historySuggestions };
	if (!input.aiFields || !aiAllowed) {
		return { settings: next, apiKey: undefined };
	}
	const errors: FieldErrors = {};
	const provider = (AI_PROVIDERS as readonly string[]).includes(input.provider)
		? (input.provider as AiProvider)
		: current.provider;
	let baseUrl: string | null = null;
	if (provider === 'custom') {
		baseUrl = normalizeCustomBaseUrl(input.baseUrl);
		if (!baseUrl) {
			errors.baseUrl = 'ai.error.baseUrl';
		}
	}
	const model = input.model.trim();
	if (model.length > MAX_MODEL_LENGTH || /\s/.test(model)) {
		errors.model = 'ai.error.model';
	}
	const apiKeyRaw = input.apiKey.trim();
	if (apiKeyRaw.length > MAX_KEY_LENGTH || /\s/.test(apiKeyRaw)) {
		errors.apiKey = 'ai.error.apiKey';
	}
	const limit = Number.parseInt(input.dailyRequestLimit, 10);
	if (!Number.isInteger(limit) || limit < 1 || limit > 100_000) {
		errors.dailyRequestLimit = 'ai.error.limit';
	}
	if (Object.keys(errors).length > 0) {
		throw new SmartCaptureFormError(errors);
	}
	const excluded = Array.from(
		new Set(
			input.excludedDomains
				.split(/\r?\n/)
				.map(normalizeExcludedDomain)
				.filter((value): value is string => value !== null)
		)
	).slice(0, MAX_EXCLUDED_DOMAINS);

	const providerChanged = provider !== current.provider || baseUrl !== current.baseUrl;
	const settings: SmartCaptureSettings = {
		...next,
		enabled: input.enabled,
		provider,
		baseUrl,
		model,
		sectionMode: (SECTION_MODES as readonly string[]).includes(input.sectionMode)
			? (input.sectionMode as SectionMode)
			: current.sectionMode,
		summaries: input.summaries,
		keywords: input.keywords,
		sendExcerpt: input.sendExcerpt,
		includeNotes: input.includeNotes,
		excludedDomains: excluded,
		dailyRequestLimit: Number.isInteger(limit) ? limit : DEFAULT_DAILY_REQUEST_LIMIT,
		models: providerChanged ? [] : current.models,
		modelsFetchedAt: providerChanged ? null : current.modelsFetchedAt
	};
	const apiKey = input.removeKey ? null : apiKeyRaw ? apiKeyRaw : undefined;
	if (apiKey !== undefined) {
		// A new or removed key un-pauses: the next test or job shows whether it works.
		settings.pausedReason = null;
	}
	return { settings, apiKey };
}

export async function loadSmartCaptureAdminView(now = new Date()): Promise<SmartCaptureAdminView> {
	const state = await loadSmartCaptureState();
	const since = usageDay(new Date(now.getTime() - (USAGE_DAYS - 1) * 24 * 60 * 60 * 1000));
	const [usageRows, queueRows, enrichable, today] = await Promise.all([
		db
			.select({
				day: aiUsageDaily.day,
				requests: sql<number>`sum(${aiUsageDaily.requests})::int`,
				inputTokens: sql<number>`sum(${aiUsageDaily.inputTokens})::int`,
				outputTokens: sql<number>`sum(${aiUsageDaily.outputTokens})::int`,
				failures: sql<number>`sum(${aiUsageDaily.failures})::int`
			})
			.from(aiUsageDaily)
			.where(gte(aiUsageDaily.day, since))
			.groupBy(aiUsageDaily.day)
			.orderBy(desc(aiUsageDaily.day)),
		db
			.select({ status: enrichmentJobs.status, count: sql<number>`count(*)::int` })
			.from(enrichmentJobs)
			.groupBy(enrichmentJobs.status),
		countEnrichable(),
		requestsToday(now)
	]);
	const queue = { queued: 0, running: 0, dead: 0 };
	for (const row of queueRows) {
		if (row.status === 'queued' || row.status === 'running' || row.status === 'dead') {
			queue[row.status] = row.count;
		}
	}
	const { updatedAt: _updatedAt, ...publicState } = state;
	return {
		state: publicState,
		requestsToday: today,
		usage: usageRows,
		queue,
		enrichableCount: enrichable
	};
}

function enrichableCondition() {
	return and(
		notInArray(canonicalResources.unfurlStatus, ['queued', 'running']),
		sql`EXISTS (SELECT 1 FROM ${linkShares} WHERE ${linkShares.resourceId} = ${canonicalResources.id} AND ${linkShares.deletedAt} IS NULL)`,
		sql`NOT EXISTS (SELECT 1 FROM ${resourceEnrichments} WHERE ${resourceEnrichments.resourceId} = ${canonicalResources.id})`
	);
}

async function countEnrichable(): Promise<number> {
	const [row] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(canonicalResources)
		.where(enrichableCondition());
	return row?.count ?? 0;
}

function changedFields(before: SmartCaptureSettings, after: SmartCaptureSettings): string[] {
	const keys: Array<keyof SmartCaptureSettings> = [
		'historySuggestions',
		'enabled',
		'provider',
		'baseUrl',
		'model',
		'sectionMode',
		'summaries',
		'keywords',
		'sendExcerpt',
		'includeNotes',
		'excludedDomains',
		'dailyRequestLimit'
	];
	return keys.filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
}

export async function saveSmartCaptureSettings(
	input: SmartCaptureFormInput,
	actor: { id: string },
	requestId: string | null
): Promise<void> {
	const state = await loadSmartCaptureState();
	const { settings, apiKey } = buildSettingsFromForm(state.settings, input, state.aiAllowed);
	await db.transaction(async (tx) => {
		await writeSmartCaptureSettings(settings, { actorUserId: actor.id, apiKey }, tx);
		const fields = changedFields(state.settings, settings);
		if (fields.length > 0) {
			await recordAuditLog(
				{
					actorUserId: actor.id,
					action: 'admin.ai_settings_updated',
					targetType: 'instance_settings',
					targetId: 'smart_capture',
					metadata: { fields, provider: settings.provider, model: settings.model || null },
					requestId
				},
				tx
			);
		}
		if (apiKey !== undefined && (apiKey !== null || state.hasKey)) {
			await recordAuditLog(
				{
					actorUserId: actor.id,
					action: apiKey === null ? 'admin.ai_key_removed' : 'admin.ai_key_updated',
					targetType: 'instance_settings',
					targetId: 'smart_capture',
					metadata: { provider: settings.provider },
					requestId
				},
				tx
			);
		}
	});
	notifyEnrichmentWorker();
}

/** Provider config from the submitted form, falling back to the stored key when the field is empty. */
async function configFromForm(input: SmartCaptureFormInput) {
	const state = await loadSmartCaptureState();
	const { settings, apiKey } = buildSettingsFromForm(state.settings, input, true);
	const key = apiKey === undefined ? await readProviderApiKey() : apiKey;
	return { state, settings, apiKey: key };
}

export type ConnectionTestResult = { ok: true } | { ok: false; message: string };

export async function testSmartCaptureConnection(
	input: SmartCaptureFormInput,
	options: CallOptions = {}
): Promise<ConnectionTestResult> {
	const { state, settings, apiKey } = await configFromForm(input);
	if (!state.aiAllowed) {
		return { ok: false, message: 'AI_FEATURES=off' };
	}
	try {
		await testProvider(
			{ provider: settings.provider, baseUrl: settings.baseUrl, model: settings.model, apiKey },
			options
		);
	} catch (error) {
		if (error instanceof AiProviderError) {
			return { ok: false, message: error.message };
		}
		throw error;
	}
	if (state.settings.pausedReason) {
		await writeSmartCaptureSettings(
			{ ...state.settings, pausedReason: null },
			{ actorUserId: null }
		);
		notifyEnrichmentWorker();
	}
	return { ok: true };
}

export async function fetchSmartCaptureModels(
	input: SmartCaptureFormInput,
	options: CallOptions = {}
): Promise<{ ok: true; count: number } | { ok: false; message: string }> {
	const { state, settings, apiKey } = await configFromForm(input);
	if (!state.aiAllowed) {
		return { ok: false, message: 'AI_FEATURES=off' };
	}
	let models: string[];
	try {
		models = await listModels(
			{ provider: settings.provider, baseUrl: settings.baseUrl, apiKey },
			options
		);
	} catch (error) {
		if (error instanceof AiProviderError) {
			return { ok: false, message: error.message };
		}
		throw error;
	}
	// The list belongs to the provider it came from; other fields are saved only by "Save".
	if (
		settings.provider === state.settings.provider &&
		settings.baseUrl === state.settings.baseUrl
	) {
		await writeSmartCaptureSettings(
			{ ...state.settings, models, modelsFetchedAt: new Date().toISOString() },
			{ actorUserId: null }
		);
	}
	return { ok: true, count: models.length };
}

export async function retryFailedEnrichmentJobs(
	actor: { id: string },
	requestId: string | null
): Promise<number> {
	const count = await db.transaction(async (tx) => {
		const rows = await tx
			.update(enrichmentJobs)
			.set({
				status: 'queued',
				attempts: 0,
				nextRunAt: new Date(),
				lastErrorCode: null,
				lastErrorMessage: null,
				updatedAt: new Date()
			})
			.where(eq(enrichmentJobs.status, 'dead'))
			.returning({ id: enrichmentJobs.id });
		if (rows.length > 0) {
			await recordAuditLog(
				{
					actorUserId: actor.id,
					action: 'admin.ai_jobs_retried',
					targetType: 'enrichment_jobs',
					metadata: { count: rows.length },
					requestId
				},
				tx
			);
		}
		return rows.length;
	});
	notifyEnrichmentWorker();
	return count;
}

export async function startEnrichmentBackfill(
	actor: { id: string },
	requestId: string | null
): Promise<number> {
	const count = await db.transaction(async (tx) => {
		const resources = await tx
			.select({ id: canonicalResources.id })
			.from(canonicalResources)
			.where(enrichableCondition())
			.limit(BACKFILL_LIMIT);
		if (resources.length === 0) {
			return 0;
		}
		const now = new Date();
		await tx
			.insert(enrichmentJobs)
			.values(resources.map((resource) => ({ resourceId: resource.id, nextRunAt: now })))
			.onConflictDoUpdate({
				target: enrichmentJobs.resourceId,
				set: { status: 'queued', attempts: 0, nextRunAt: now, updatedAt: now },
				setWhere: sql`${enrichmentJobs.status} <> 'running'`
			});
		await recordAuditLog(
			{
				actorUserId: actor.id,
				action: 'admin.ai_backfill_started',
				targetType: 'enrichment_jobs',
				metadata: { count: resources.length },
				requestId
			},
			tx
		);
		return resources.length;
	});
	notifyEnrichmentWorker();
	return count;
}

/** Deletes summaries, keywords and AI suggestions; accepted sections stay (§9). */
export async function purgeAiData(
	actor: { id: string },
	requestId: string | null
): Promise<{ enrichments: number; suggestions: number }> {
	return db.transaction(async (tx) => {
		const enrichments = await tx
			.delete(resourceEnrichments)
			.returning({ id: resourceEnrichments.resourceId });
		await tx
			.update(canonicalResources)
			.set({ aiKeywords: [] })
			.where(sql`cardinality(${canonicalResources.aiKeywords}) > 0`);
		const suggestions = await tx
			.delete(shareSectionSuggestions)
			.where(eq(shareSectionSuggestions.source, 'ai'))
			.returning({ id: shareSectionSuggestions.shareId });
		await recordAuditLog(
			{
				actorUserId: actor.id,
				action: 'admin.ai_data_purged',
				targetType: 'resource_enrichments',
				metadata: { enrichments: enrichments.length, suggestions: suggestions.length },
				requestId
			},
			tx
		);
		return { enrichments: enrichments.length, suggestions: suggestions.length };
	});
}

/** Sidebar badge: AI paused or failed jobs need attention. */
export async function smartCaptureAttentionCount(): Promise<number> {
	const state = await loadSmartCaptureState();
	const [dead] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(enrichmentJobs)
		.where(eq(enrichmentJobs.status, 'dead'));
	return (state.settings.pausedReason || state.keyUnreadable ? 1 : 0) + (dead?.count ?? 0);
}

/** Pending suggestions for admin "Unassigned" rows. */
export async function pendingSuggestionsForShares(shareIds: readonly string[]) {
	if (shareIds.length === 0) {
		return [];
	}
	return db
		.select({
			shareId: shareSectionSuggestions.shareId,
			sectionId: shareSectionSuggestions.sectionId,
			source: shareSectionSuggestions.source
		})
		.from(shareSectionSuggestions)
		.innerJoin(linkShares, eq(linkShares.id, shareSectionSuggestions.shareId))
		.where(
			and(
				inArray(shareSectionSuggestions.shareId, [...shareIds]),
				eq(shareSectionSuggestions.status, 'pending'),
				isNull(linkShares.deletedAt)
			)
		);
}
