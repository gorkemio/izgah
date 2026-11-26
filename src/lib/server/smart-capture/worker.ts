import crypto from 'node:crypto';
import { and, asc, eq, isNull, lte, or, sql } from 'drizzle-orm';
import { getLocale } from '#lib/i18n/index.ts';
import { appTimeZone } from '#lib/instance.ts';
import { db } from '#lib/server/db/client.ts';
import {
	aiUsageDaily,
	canonicalResources,
	enrichmentJobs,
	linkShares,
	resourceEnrichments,
	type SuggestedSectionRef
} from '#lib/server/db/schema.ts';
import { env } from '#lib/server/env.ts';
import { logger } from '#lib/server/logger.ts';
import { listSections } from '#lib/server/sections/service.ts';
import {
	buildEnrichmentRequest,
	cleanEnrichmentOutput,
	enrichmentInputHash,
	hasEnrichmentWork,
	PROMPT_VERSION
} from '#lib/server/ai/enrich.ts';
import { AiProviderError, callStructured } from '#lib/server/ai/providers.ts';
import { computeHistorySuggestions } from './history.ts';
import {
	isAiReady,
	isDomainExcluded,
	loadSmartCaptureState,
	readProviderApiKey,
	writeSmartCaptureSettings,
	type SmartCaptureState
} from './settings.ts';
import { writeResourceSuggestions } from './suggestions.ts';

/**
 * In-process enrichment worker (docs/designs/izgah-smart-capture.md §1): the same lease/fence
 * pattern as the unfurl worker. One job per resource; it writes history suggestions and, when an
 * admin has configured it, makes one AI call.
 */

export const ENRICHMENT_LEASE_MS = 3 * 60 * 1000;
export const ENRICHMENT_POLL_INTERVAL_MS = 30_000;
export const MAX_ENRICHMENT_ATTEMPTS = 3;
export const ENRICHMENT_BACKOFF_MS = [60_000, 600_000] as const;
export const DAILY_LIMIT_DEFER_MS = 60 * 60 * 1000;
const MAX_ERROR_MESSAGE_LENGTH = 500;

export interface ClaimedEnrichmentJob {
	id: string;
	resourceId: string;
	attempts: number;
	lockToken: string;
}

export interface EnrichmentRunOptions {
	fetchImpl?: typeof fetch;
	signal?: AbortSignal;
	now?: () => Date;
}

class DeferJob extends Error {
	readonly until: Date;
	constructor(until: Date) {
		super('deferred');
		this.until = until;
	}
}

/** Calendar day in the instance time zone (`YYYY-MM-DD`), used for usage rows and the daily limit. */
export function usageDay(now: Date): string {
	return new Intl.DateTimeFormat('en-CA', {
		timeZone: appTimeZone(),
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(now);
}

async function recordUsage(input: {
	now: Date;
	provider: string;
	model: string;
	inputTokens?: number;
	outputTokens?: number;
	failed: boolean;
}): Promise<void> {
	const values = {
		day: usageDay(input.now),
		provider: input.provider,
		model: input.model,
		requests: 1,
		inputTokens: input.inputTokens ?? 0,
		outputTokens: input.outputTokens ?? 0,
		failures: input.failed ? 1 : 0,
		updatedAt: input.now
	};
	await db
		.insert(aiUsageDaily)
		.values(values)
		.onConflictDoUpdate({
			target: [aiUsageDaily.day, aiUsageDaily.provider, aiUsageDaily.model],
			set: {
				requests: sql`${aiUsageDaily.requests} + 1`,
				inputTokens: sql`${aiUsageDaily.inputTokens} + ${values.inputTokens}`,
				outputTokens: sql`${aiUsageDaily.outputTokens} + ${values.outputTokens}`,
				failures: sql`${aiUsageDaily.failures} + ${values.failures}`,
				updatedAt: input.now
			}
		});
}

export async function requestsToday(now: Date): Promise<number> {
	const [row] = await db
		.select({ total: sql<number>`coalesce(sum(${aiUsageDaily.requests}), 0)::int` })
		.from(aiUsageDaily)
		.where(eq(aiUsageDaily.day, usageDay(now)));
	return row?.total ?? 0;
}

async function pauseForAuthFailure(state: SmartCaptureState): Promise<void> {
	await writeSmartCaptureSettings(
		{ ...state.settings, pausedReason: 'auth_failed' },
		{ actorUserId: null }
	);
}

/**
 * Runs the AI step when it applies. Returns the stored suggestions (possibly from an earlier run)
 * and, on the final attempt, the error that made it give up.
 */
async function runAiStep(
	resource: typeof canonicalResources.$inferSelect,
	state: SmartCaptureState,
	job: ClaimedEnrichmentJob,
	options: EnrichmentRunOptions
): Promise<{ refs: SuggestedSectionRef[]; error: AiProviderError | null }> {
	const [existing] = await db
		.select()
		.from(resourceEnrichments)
		.where(eq(resourceEnrichments.resourceId, resource.id))
		.limit(1);
	const storedRefs = existing?.suggestedSections ?? [];
	const { settings } = state;
	const features = {
		sections: settings.sectionMode !== 'off',
		summary: settings.summaries,
		keywords: settings.keywords
	};

	if (
		!isAiReady(state) ||
		!hasEnrichmentWork(features) ||
		isDomainExcluded(resource.domain, settings.excludedDomains) ||
		(!resource.title && !resource.description && !resource.contentText)
	) {
		return { refs: storedRefs, error: null };
	}

	const notes = settings.includeNotes
		? (
				await db
					.select({ note: linkShares.note })
					.from(linkShares)
					.where(and(eq(linkShares.resourceId, resource.id), isNull(linkShares.deletedAt)))
					.orderBy(asc(linkShares.createdAt))
			)
				.map((row) => row.note)
				.filter((note): note is string => Boolean(note))
		: [];
	const built = buildEnrichmentRequest({
		resource: {
			canonicalUrl: resource.canonicalUrl,
			domain: resource.domain,
			contentType: resource.contentType,
			title: resource.title,
			description: resource.description,
			siteName: resource.siteName,
			contentText: resource.contentText
		},
		notes,
		sections: (await listSections()).map((section) => ({
			id: section.id,
			name: section.name,
			description: section.description
		})),
		features,
		sendExcerpt: settings.sendExcerpt,
		locale: getLocale()
	});
	const inputHash = enrichmentInputHash(built, settings.provider, settings.model);
	if (existing?.inputHash === inputHash) {
		return { refs: storedRefs, error: null };
	}

	const now = options.now?.() ?? new Date();
	if ((await requestsToday(now)) >= settings.dailyRequestLimit) {
		throw new DeferJob(new Date(now.getTime() + DAILY_LIMIT_DEFER_MS));
	}

	const apiKey = await readProviderApiKey();
	let output;
	try {
		const result = await callStructured(
			{ provider: settings.provider, baseUrl: settings.baseUrl, model: settings.model, apiKey },
			built.request,
			{ fetchImpl: options.fetchImpl, signal: options.signal }
		);
		output = cleanEnrichmentOutput(result.json, built);
		await recordUsage({
			now,
			provider: settings.provider,
			model: settings.model,
			inputTokens: result.inputTokens,
			outputTokens: result.outputTokens,
			failed: false
		});
	} catch (error) {
		if (!(error instanceof AiProviderError)) {
			throw error;
		}
		if (error.code !== 'CONFIG') {
			await recordUsage({ now, provider: settings.provider, model: settings.model, failed: true });
		}
		if (error.code === 'AUTH') {
			logger.warn('AI provider rejected the key; AI enrichment is paused', {
				provider: settings.provider
			});
			await pauseForAuthFailure(state);
			return { refs: storedRefs, error: null };
		}
		if (error.code === 'CONFIG') {
			return { refs: storedRefs, error: null };
		}
		if (error.code === 'RATE_LIMITED') {
			throw new DeferJob(
				new Date(now.getTime() + 1000 * Math.max(60, error.retryAfterSeconds ?? 60))
			);
		}
		if (job.attempts < MAX_ENRICHMENT_ATTEMPTS) {
			throw error;
		}
		return { refs: storedRefs, error };
	}

	await db.transaction(async (tx) => {
		await tx
			.insert(resourceEnrichments)
			.values({
				resourceId: resource.id,
				summary: output.summary,
				language: output.language,
				suggestedSections: output.sections,
				provider: settings.provider,
				model: settings.model,
				promptVersion: PROMPT_VERSION,
				inputHash,
				createdAt: now,
				updatedAt: now
			})
			.onConflictDoUpdate({
				target: resourceEnrichments.resourceId,
				set: {
					summary: output.summary,
					language: output.language,
					suggestedSections: output.sections,
					provider: settings.provider,
					model: settings.model,
					promptVersion: PROMPT_VERSION,
					inputHash,
					updatedAt: now
				}
			});
		if (features.keywords) {
			await tx
				.update(canonicalResources)
				.set({ aiKeywords: output.keywords })
				.where(eq(canonicalResources.id, resource.id));
		}
	});
	return { refs: output.sections, error: null };
}

/** Does the work of one claimed job. Exported for tests. */
export async function processEnrichmentJob(
	job: ClaimedEnrichmentJob,
	options: EnrichmentRunOptions = {}
): Promise<{ aiError: AiProviderError | null }> {
	const [resource] = await db
		.select()
		.from(canonicalResources)
		.where(eq(canonicalResources.id, job.resourceId))
		.limit(1);
	if (!resource) {
		return { aiError: null };
	}
	const [activeShare] = await db
		.select({ id: linkShares.id })
		.from(linkShares)
		.where(and(eq(linkShares.resourceId, resource.id), isNull(linkShares.deletedAt)))
		.limit(1);
	if (!activeShare) {
		return { aiError: null };
	}

	const state = await loadSmartCaptureState();
	const ai = await runAiStep(resource, state, job, options);
	const history = state.settings.historySuggestions
		? await computeHistorySuggestions({
				resourceId: resource.id,
				domain: resource.domain,
				title: resource.title
			})
		: [];
	const aiActive = state.aiAllowed && state.settings.sectionMode !== 'off';
	await writeResourceSuggestions({
		resourceId: resource.id,
		history,
		aiRefs: aiActive ? ai.refs : [],
		sectionMode: aiActive ? state.settings.sectionMode : 'off',
		now: options.now?.()
	});
	return { aiError: ai.error };
}

export async function claimNextEnrichmentJob(
	now = new Date()
): Promise<ClaimedEnrichmentJob | null> {
	return db.transaction(async (tx) => {
		const [candidate] = await tx
			.select({
				id: enrichmentJobs.id,
				resourceId: enrichmentJobs.resourceId,
				attempts: enrichmentJobs.attempts
			})
			.from(enrichmentJobs)
			.where(
				or(
					and(eq(enrichmentJobs.status, 'queued'), lte(enrichmentJobs.nextRunAt, now)),
					and(eq(enrichmentJobs.status, 'running'), lte(enrichmentJobs.lockedUntil, now))
				)
			)
			.orderBy(asc(enrichmentJobs.nextRunAt))
			.limit(1)
			.for('update', { skipLocked: true });
		if (!candidate) {
			return null;
		}
		const lockToken = crypto.randomUUID();
		const attempts = candidate.attempts + 1;
		await tx
			.update(enrichmentJobs)
			.set({
				status: 'running',
				attempts,
				lockedUntil: new Date(now.getTime() + ENRICHMENT_LEASE_MS),
				lockToken,
				updatedAt: now
			})
			.where(eq(enrichmentJobs.id, candidate.id));
		return { id: candidate.id, resourceId: candidate.resourceId, attempts, lockToken };
	});
}

function fence(job: ClaimedEnrichmentJob) {
	return and(
		eq(enrichmentJobs.id, job.id),
		eq(enrichmentJobs.status, 'running'),
		eq(enrichmentJobs.lockToken, job.lockToken)
	);
}

function errorDetails(error: unknown): { code: string; message: string } {
	if (error instanceof AiProviderError) {
		return { code: `AI_${error.code}`, message: error.message.slice(0, MAX_ERROR_MESSAGE_LENGTH) };
	}
	const message = error instanceof Error ? error.message : String(error);
	return { code: 'INTERNAL', message: message.slice(0, MAX_ERROR_MESSAGE_LENGTH) };
}

export type EnrichmentJobOutcome = 'completed' | 'requeued' | 'deferred' | 'dead' | 'fenced_out';

export async function executeEnrichmentJob(
	job: ClaimedEnrichmentJob,
	options: EnrichmentRunOptions = {}
): Promise<EnrichmentJobOutcome> {
	const now = () => options.now?.() ?? new Date();
	try {
		const { aiError } = await processEnrichmentJob(job, options);
		const details = aiError ? errorDetails(aiError) : null;
		const rows = await db
			.update(enrichmentJobs)
			.set({
				status: aiError ? 'dead' : 'completed',
				lockedUntil: null,
				lockToken: null,
				lastErrorCode: details?.code ?? null,
				lastErrorMessage: details?.message ?? null,
				updatedAt: now()
			})
			.where(fence(job))
			.returning({ id: enrichmentJobs.id });
		if (rows.length === 0) {
			return 'fenced_out';
		}
		return aiError ? 'dead' : 'completed';
	} catch (error) {
		if (error instanceof DeferJob) {
			const rows = await db
				.update(enrichmentJobs)
				.set({
					status: 'queued',
					attempts: sql`GREATEST(${enrichmentJobs.attempts} - 1, 0)`,
					nextRunAt: error.until,
					lockedUntil: null,
					lockToken: null,
					updatedAt: now()
				})
				.where(fence(job))
				.returning({ id: enrichmentJobs.id });
			return rows.length === 0 ? 'fenced_out' : 'deferred';
		}
		const details = errorDetails(error);
		const exhausted = job.attempts >= MAX_ENRICHMENT_ATTEMPTS;
		const backoff =
			ENRICHMENT_BACKOFF_MS[Math.min(job.attempts - 1, ENRICHMENT_BACKOFF_MS.length - 1)];
		logger.warn('Enrichment job attempt failed', {
			job_id: job.id,
			resource_id: job.resourceId,
			attempts: job.attempts,
			error_code: details.code
		});
		const rows = await db
			.update(enrichmentJobs)
			.set({
				status: exhausted ? 'dead' : 'queued',
				nextRunAt: new Date(now().getTime() + backoff),
				lockedUntil: null,
				lockToken: null,
				lastErrorCode: details.code,
				lastErrorMessage: details.message,
				updatedAt: now()
			})
			.where(fence(job))
			.returning({ id: enrichmentJobs.id });
		if (rows.length === 0) {
			return 'fenced_out';
		}
		return exhausted ? 'dead' : 'requeued';
	}
}

/** Claims and runs up to `maxJobs` jobs once (tests and the admin backfill). */
export async function runSingleEnrichmentPass(
	options: EnrichmentRunOptions & { maxJobs?: number } = {}
): Promise<EnrichmentJobOutcome[]> {
	const outcomes: EnrichmentJobOutcome[] = [];
	for (let index = 0; index < (options.maxJobs ?? 20); index += 1) {
		const job = await claimNextEnrichmentJob(options.now?.() ?? new Date());
		if (!job) {
			break;
		}
		outcomes.push(await executeEnrichmentJob(job, options));
	}
	return outcomes;
}

// ---------------------------------------------------------------------------------------------
// Process-wide runner

interface RunnerState {
	wake: () => void;
	stop: (timeoutMs: number) => Promise<void>;
}

const STATE_SYMBOL = Symbol.for('izgah.enrichment.workerState');

function runnerState(): RunnerState | undefined {
	return (globalThis as Record<PropertyKey, unknown>)[STATE_SYMBOL] as RunnerState | undefined;
}

export function startEnrichmentWorker(): void {
	if (runnerState()) {
		return;
	}
	const concurrency = env.AI_CONCURRENCY;
	const inFlight = new Set<Promise<void>>();
	const controllers = new Set<AbortController>();
	let stopping = false;
	let pumping = false;
	let again = false;

	const pump = async (): Promise<void> => {
		if (stopping) {
			return;
		}
		if (pumping) {
			again = true;
			return;
		}
		pumping = true;
		try {
			do {
				again = false;
				while (!stopping && inFlight.size < concurrency) {
					let job: ClaimedEnrichmentJob | null;
					try {
						job = await claimNextEnrichmentJob();
					} catch (error) {
						logger.error('Failed to claim enrichment job', {
							error: error instanceof Error ? error.message : String(error)
						});
						break;
					}
					if (!job) {
						break;
					}
					const controller = new AbortController();
					controllers.add(controller);
					const running: Promise<void> = executeEnrichmentJob(job, { signal: controller.signal })
						.then(() => undefined)
						.catch((error: unknown) => {
							logger.error('Unexpected error executing enrichment job', {
								error: error instanceof Error ? error.message : String(error)
							});
						})
						.finally(() => {
							controllers.delete(controller);
							inFlight.delete(running);
							if (!stopping) {
								setImmediate(() => void pump());
							}
						});
					inFlight.add(running);
				}
			} while (again && !stopping);
		} finally {
			pumping = false;
		}
	};

	const timer = setInterval(() => void pump(), ENRICHMENT_POLL_INTERVAL_MS);
	timer.unref?.();

	(globalThis as Record<PropertyKey, unknown>)[STATE_SYMBOL] = {
		wake: () => {
			if (!stopping) {
				setImmediate(() => void pump());
			}
		},
		stop: async (timeoutMs: number) => {
			stopping = true;
			clearInterval(timer);
			const drained = Promise.allSettled([...inFlight]);
			const timedOut = await Promise.race([
				drained.then(() => false),
				new Promise<boolean>((resolve) => setTimeout(() => resolve(true), timeoutMs).unref?.())
			]);
			if (timedOut) {
				for (const controller of controllers) {
					controller.abort();
				}
				await Promise.race([drained, new Promise((resolve) => setTimeout(resolve, 250))]);
			}
			delete (globalThis as Record<PropertyKey, unknown>)[STATE_SYMBOL];
		}
	} satisfies RunnerState;

	logger.info('In-process enrichment worker started', { concurrency });
	setImmediate(() => void pump());
}

export function notifyEnrichmentWorker(): void {
	runnerState()?.wake();
}

export async function stopEnrichmentWorker(timeoutMs = 10_000): Promise<void> {
	await runnerState()?.stop(timeoutMs);
}
