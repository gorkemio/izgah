import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { and, asc, eq, gte, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/client.ts';
import { canonicalResources, linkShares, mediaAssets, unfurlJobs } from '#lib/server/db/schema.ts';
import { env } from '#lib/server/env.ts';
import { classifyContentType } from '#lib/server/links/classify.ts';
import { logger } from '#lib/server/logger.ts';
import {
	cleanupOrphanMediaAssets,
	decrementMediaAssetRefInTx,
	ensureMediaAssetFileInTx,
	lockMediaAssetKeyInTx,
	processAndWriteThumbnailToDisk,
	upsertAndIncrementMediaAssetInTx,
	type MediaDiskCheckOptions,
	type StoredThumbnailAsset
} from '#lib/server/media/storage.ts';
import {
	unfurlTargetUrl,
	type AdapterOptions,
	type UnfurlMetadata
} from '#lib/server/unfurl/adapters/index.ts';
import { MAX_IMAGE_BYTES, safeFetchBytes, SafeFetchError } from '#lib/server/unfurl/safe-fetch.ts';

export const UNFURL_LEASE_DURATION_MS = 90_000;
export const UNFURL_POLL_INTERVAL_MS = 15_000;
export const UNFURL_ORPHAN_MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000;
export const MAX_UNFURL_ATTEMPTS = 3;
export const UNFURL_BACKOFF_MS = [30_000, 120_000] as const;
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;
const MAX_ERROR_MESSAGE_LENGTH = 500;

export interface ClaimedUnfurlJob {
	id: string;
	resourceId: string;
	targetUrl: string;
	attempts: number;
	lockToken: string;
}

export interface UnfurlWorkerOptions {
	concurrency?: number;
	pollIntervalMs?: number;
	maintenanceIntervalMs?: number;
	adapterOptions?: AdapterOptions;
	mediaOptions?: MediaDiskCheckOptions;
}

export interface UnfurlWorkerHandle {
	wake(): void;
	stop(options?: { timeoutMs?: number }): Promise<void>;
	isRunning(): boolean;
	activeJobCount(): number;
}

interface GlobalWorkerState {
	handle: UnfurlWorkerHandle;
	stopPromise: Promise<void> | null;
}

const WORKER_STATE_SYMBOL = Symbol.for('izgah.unfurl.workerState');

function getGlobalStore(): Record<PropertyKey, unknown> {
	return globalThis as Record<PropertyKey, unknown>;
}

function getWorkerState(): GlobalWorkerState | null {
	const value = getGlobalStore()[WORKER_STATE_SYMBOL];
	return value && typeof value === 'object' ? (value as GlobalWorkerState) : null;
}

function truncateErrorMessage(message: string): string {
	return Array.from(message).slice(0, MAX_ERROR_MESSAGE_LENGTH).join('');
}

function extractErrorDetails(error: unknown): { code: string; message: string } {
	if (error instanceof SafeFetchError) {
		return {
			code: error.code,
			message: truncateErrorMessage(error.message)
		};
	}
	if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
		const msg = error instanceof Error ? error.message : String(error);
		return {
			code: error.code,
			message: truncateErrorMessage(msg)
		};
	}
	return {
		code: 'UNFURL_ERROR',
		message: truncateErrorMessage(error instanceof Error ? error.message : String(error))
	};
}

type WorkerTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function tryLockResourceInTx(tx: WorkerTx, resourceId: string): Promise<boolean> {
	const [locked] = await tx
		.select({ id: canonicalResources.id })
		.from(canonicalResources)
		.where(eq(canonicalResources.id, resourceId))
		.limit(1)
		.for('update', { skipLocked: true });
	return Boolean(locked);
}

async function lockResourceInTx(tx: WorkerTx, resourceId: string) {
	const [resource] = await tx
		.select({
			id: canonicalResources.id,
			canonicalUrl: canonicalResources.canonicalUrl,
			contentType: canonicalResources.contentType,
			contentTypeLocked: canonicalResources.contentTypeLocked,
			thumbnailAssetKey: canonicalResources.thumbnailAssetKey,
			title: canonicalResources.title,
			description: canonicalResources.description,
			siteName: canonicalResources.siteName,
			providerMeta: canonicalResources.providerMeta
		})
		.from(canonicalResources)
		.where(eq(canonicalResources.id, resourceId))
		.limit(1)
		.for('update');
	return resource ?? null;
}

/**
 * Claims at most one due or lease-expired unfurl job using PostgreSQL FOR UPDATE SKIP LOCKED
 * and attaches a unique 90s lease lock_token. Also transitions expired jobs past max attempts to dead.
 */
export async function claimNextUnfurlJob(now = new Date()): Promise<ClaimedUnfurlJob | null> {
	return db.transaction(async (tx) => {
		const expiredExhausted = await tx
			.select({
				id: unfurlJobs.id,
				resourceId: unfurlJobs.resourceId
			})
			.from(unfurlJobs)
			.where(
				and(
					eq(unfurlJobs.status, 'running'),
					lte(unfurlJobs.lockedUntil, now),
					gte(unfurlJobs.attempts, MAX_UNFURL_ATTEMPTS)
				)
			)
			.for('update', { skipLocked: true });

		for (const exhausted of expiredExhausted) {
			// Lock order everywhere is canonical_resources -> unfurl_jobs (createLinkShare locks the
			// resource first). We already hold the job row here, so never wait for the resource: if a
			// share transaction holds it, leave this job for the next poll instead of risking a deadlock.
			if (!(await tryLockResourceInTx(tx, exhausted.resourceId))) {
				continue;
			}
			await tx
				.update(unfurlJobs)
				.set({
					status: 'dead',
					lockedUntil: null,
					lockToken: null,
					lastErrorCode: 'LEASE_EXPIRED',
					lastErrorMessage: 'The preview job lease expired after its last attempt.',
					updatedAt: now
				})
				.where(eq(unfurlJobs.id, exhausted.id));

			await tx
				.update(canonicalResources)
				.set({
					unfurlStatus: 'failed',
					updatedAt: now
				})
				.where(eq(canonicalResources.id, exhausted.resourceId));
		}

		const [candidate] = await tx
			.select({
				id: unfurlJobs.id,
				resourceId: unfurlJobs.resourceId,
				targetUrl: unfurlJobs.targetUrl,
				attempts: unfurlJobs.attempts
			})
			.from(unfurlJobs)
			.where(
				or(
					and(eq(unfurlJobs.status, 'queued'), lte(unfurlJobs.nextRunAt, now)),
					and(
						eq(unfurlJobs.status, 'running'),
						lte(unfurlJobs.lockedUntil, now),
						lt(unfurlJobs.attempts, MAX_UNFURL_ATTEMPTS)
					)
				)
			)
			.orderBy(asc(unfurlJobs.nextRunAt), asc(unfurlJobs.createdAt))
			.limit(1)
			.for('update', { skipLocked: true });

		if (!candidate) {
			return null;
		}

		const lockToken = crypto.randomUUID();
		const nextAttempts = candidate.attempts + 1;
		const lockedUntil = new Date(now.getTime() + UNFURL_LEASE_DURATION_MS);

		await tx
			.update(unfurlJobs)
			.set({
				status: 'running',
				attempts: nextAttempts,
				lockedUntil,
				lockToken,
				updatedAt: now
			})
			.where(eq(unfurlJobs.id, candidate.id));

		// Cosmetic status only: skip it rather than wait if a share transaction holds the resource.
		if (await tryLockResourceInTx(tx, candidate.resourceId)) {
			await tx
				.update(canonicalResources)
				.set({
					unfurlStatus: 'running',
					updatedAt: now
				})
				.where(eq(canonicalResources.id, candidate.resourceId));
		}

		return {
			id: candidate.id,
			resourceId: candidate.resourceId,
			targetUrl: candidate.targetUrl,
			attempts: nextAttempts,
			lockToken
		};
	});
}

/**
 * Commits a completed unfurl result fenced by (id, status='running', lock_token).
 * If another worker reclaimed the expired lease with a newer lock_token, this update
 * writes zero rows and returns fencedOut: true without mutating canonical_resources.
 */
export async function completeClaimedJobInTx(params: {
	jobId: string;
	resourceId: string;
	lockToken: string;
	metadata: UnfurlMetadata;
	storedAsset: StoredThumbnailAsset | null;
	now?: Date;
}): Promise<{ applied: boolean; fencedOut: boolean }> {
	const now = params.now ?? new Date();

	return db.transaction(async (tx) => {
		// Same lock order as createLinkShare: resource first, then the job row.
		const resource = await lockResourceInTx(tx, params.resourceId);

		const [completedJob] = await tx
			.update(unfurlJobs)
			.set({
				status: 'completed',
				lockedUntil: null,
				lockToken: null,
				lastErrorCode: null,
				lastErrorMessage: null,
				updatedAt: now
			})
			.where(
				and(
					eq(unfurlJobs.id, params.jobId),
					eq(unfurlJobs.status, 'running'),
					eq(unfurlJobs.lockToken, params.lockToken)
				)
			)
			.returning({ id: unfurlJobs.id });

		if (!completedJob) {
			return { applied: false, fencedOut: true };
		}

		if (!resource) {
			return { applied: true, fencedOut: false };
		}

		const [activeShare] = await tx
			.select({ id: linkShares.id })
			.from(linkShares)
			.where(and(eq(linkShares.resourceId, resource.id), isNull(linkShares.deletedAt)))
			.limit(1);

		let nextThumbnailAssetKey = resource.thumbnailAssetKey;

		if (!activeShare) {
			if (resource.thumbnailAssetKey) {
				await decrementMediaAssetRefInTx(tx, resource.thumbnailAssetKey);
			}
			nextThumbnailAssetKey = null;
		} else if (params.storedAsset) {
			await lockMediaAssetKeyInTx(tx, params.storedAsset.assetKey);
			await ensureMediaAssetFileInTx(params.storedAsset);
			if (resource.thumbnailAssetKey !== params.storedAsset.assetKey) {
				await upsertAndIncrementMediaAssetInTx(tx, params.storedAsset);
				if (resource.thumbnailAssetKey) {
					await decrementMediaAssetRefInTx(tx, resource.thumbnailAssetKey);
				}
				nextThumbnailAssetKey = params.storedAsset.assetKey;
			}
		}

		let nextContentType = resource.contentType;
		if (!resource.contentTypeLocked && params.metadata.ogType) {
			const reclassified = classifyContentType(resource.canonicalUrl, params.metadata.ogType);
			if (reclassified === 'article') {
				nextContentType = 'article';
			}
		}

		await tx
			.update(canonicalResources)
			.set({
				// A re-unfurl that hits a login wall, a 403 or an open circuit breaker returns empty
				// metadata; keep what an earlier successful unfurl stored instead of wiping it.
				title: params.metadata.title ?? resource.title,
				description: params.metadata.description ?? resource.description,
				siteName: params.metadata.siteName ?? resource.siteName,
				providerMeta: params.metadata.providerMeta ?? resource.providerMeta,
				thumbnailAssetKey: nextThumbnailAssetKey,
				contentType: nextContentType,
				unfurlStatus: 'ready',
				updatedAt: now
			})
			.where(eq(canonicalResources.id, resource.id));

		return { applied: true, fencedOut: false };
	});
}

export async function failClaimedJobInTx(params: {
	jobId: string;
	resourceId: string;
	lockToken: string;
	attempts: number;
	errorCode: string;
	errorMessage: string;
	now?: Date;
}): Promise<{ fencedOut: boolean; nextStatus: 'queued' | 'dead' }> {
	const now = params.now ?? new Date();
	const isExhausted = params.attempts >= MAX_UNFURL_ATTEMPTS;

	return db.transaction(async (tx) => {
		// Same lock order as createLinkShare: resource first, then the job row.
		await lockResourceInTx(tx, params.resourceId);

		if (isExhausted) {
			const [deadJob] = await tx
				.update(unfurlJobs)
				.set({
					status: 'dead',
					lockedUntil: null,
					lockToken: null,
					lastErrorCode: params.errorCode,
					lastErrorMessage: truncateErrorMessage(params.errorMessage),
					updatedAt: now
				})
				.where(
					and(
						eq(unfurlJobs.id, params.jobId),
						eq(unfurlJobs.status, 'running'),
						eq(unfurlJobs.lockToken, params.lockToken)
					)
				)
				.returning({ id: unfurlJobs.id });

			if (!deadJob) {
				return { fencedOut: true, nextStatus: 'dead' };
			}

			await tx
				.update(canonicalResources)
				.set({
					unfurlStatus: 'failed',
					updatedAt: now
				})
				.where(eq(canonicalResources.id, params.resourceId));

			return { fencedOut: false, nextStatus: 'dead' };
		}

		const backoffIdx = Math.min(Math.max(params.attempts - 1, 0), UNFURL_BACKOFF_MS.length - 1);
		const nextRunAt = new Date(now.getTime() + UNFURL_BACKOFF_MS[backoffIdx]);

		const [requeuedJob] = await tx
			.update(unfurlJobs)
			.set({
				status: 'queued',
				nextRunAt,
				lockedUntil: null,
				lockToken: null,
				lastErrorCode: params.errorCode,
				lastErrorMessage: truncateErrorMessage(params.errorMessage),
				updatedAt: now
			})
			.where(
				and(
					eq(unfurlJobs.id, params.jobId),
					eq(unfurlJobs.status, 'running'),
					eq(unfurlJobs.lockToken, params.lockToken)
				)
			)
			.returning({ id: unfurlJobs.id });

		if (!requeuedJob) {
			return { fencedOut: true, nextStatus: 'queued' };
		}

		await tx
			.update(canonicalResources)
			.set({
				unfurlStatus: 'queued',
				updatedAt: now
			})
			.where(eq(canonicalResources.id, params.resourceId));

		return { fencedOut: false, nextStatus: 'queued' };
	});
}

/**
 * Gives back a job claimed while the worker was shutting down: the attempt is not counted and the
 * job is immediately claimable again (fenced by lock_token like every other job write).
 */
export async function releaseClaimedUnfurlJob(
	job: ClaimedUnfurlJob,
	now = new Date()
): Promise<void> {
	await db.transaction(async (tx) => {
		await lockResourceInTx(tx, job.resourceId);

		const [released] = await tx
			.update(unfurlJobs)
			.set({
				status: 'queued',
				attempts: sql`GREATEST(${unfurlJobs.attempts} - 1, 0)`,
				nextRunAt: now,
				lockedUntil: null,
				lockToken: null,
				updatedAt: now
			})
			.where(
				and(
					eq(unfurlJobs.id, job.id),
					eq(unfurlJobs.status, 'running'),
					eq(unfurlJobs.lockToken, job.lockToken)
				)
			)
			.returning({ id: unfurlJobs.id });

		if (released) {
			await tx
				.update(canonicalResources)
				.set({ unfurlStatus: 'queued', updatedAt: now })
				.where(eq(canonicalResources.id, job.resourceId));
		}
	});
}

/**
 * Executes a single already-claimed unfurl job (metadata extraction + optional thumbnail storage)
 * and persists the result fenced by lockToken.
 */
async function unlinkIfUnreferencedMediaAsset(
	storedAsset: StoredThumbnailAsset | null
): Promise<void> {
	if (!storedAsset) {
		return;
	}
	try {
		await db.transaction(async (tx) => {
			await lockMediaAssetKeyInTx(tx, storedAsset.assetKey);
			const [existingAsset] = await tx
				.select({ assetKey: mediaAssets.assetKey })
				.from(mediaAssets)
				.where(eq(mediaAssets.assetKey, storedAsset.assetKey))
				.limit(1);
			if (!existingAsset) {
				await fs.unlink(storedAsset.filePath).catch(() => {});
			}
		});
	} catch {
		// Best-effort cleanup of an unreferenced .webp file
	}
}

export async function executeClaimedJob(
	job: ClaimedUnfurlJob,
	options: {
		signal?: AbortSignal;
		adapterOptions?: AdapterOptions;
		mediaOptions?: MediaDiskCheckOptions;
	} = {}
): Promise<{ status: 'completed' | 'requeued' | 'dead' | 'fenced_out' }> {
	let storedAsset: StoredThumbnailAsset | null = null;
	try {
		const adapterResult = await unfurlTargetUrl(job.targetUrl, {
			...options.adapterOptions,
			signal: options.signal ?? options.adapterOptions?.signal
		});

		if (adapterResult.metadata.thumbnailUrl) {
			try {
				const imageResponse = await safeFetchBytes(adapterResult.metadata.thumbnailUrl, {
					...options.adapterOptions?.safeFetchOptions,
					signal: options.signal ?? options.adapterOptions?.safeFetchOptions?.signal,
					maxBytes: MAX_IMAGE_BYTES
				});
				if (imageResponse.status >= 200 && imageResponse.status < 300) {
					const writeResult = await processAndWriteThumbnailToDisk(
						imageResponse.bytes,
						options.mediaOptions
					);
					if (writeResult.status === 'stored') {
						storedAsset = writeResult.asset;
					}
				}
			} catch (thumbnailError) {
				if (options.signal?.aborted) {
					throw thumbnailError;
				}
				logger.warn('Thumbnail download or processing failed; keeping metadata without thumbnail', {
					job_id: job.id,
					resource_id: job.resourceId,
					thumbnail_url: adapterResult.metadata.thumbnailUrl,
					error: thumbnailError instanceof Error ? thumbnailError.message : String(thumbnailError)
				});
			}
		}

		const committed = await completeClaimedJobInTx({
			jobId: job.id,
			resourceId: job.resourceId,
			lockToken: job.lockToken,
			metadata: adapterResult.metadata,
			storedAsset
		});

		if (storedAsset) {
			await unlinkIfUnreferencedMediaAsset(storedAsset);
		}

		if (committed.fencedOut) {
			logger.warn('Unfurl completion ignored due to stale lock_token', {
				job_id: job.id,
				resource_id: job.resourceId
			});
			return { status: 'fenced_out' };
		}

		return { status: 'completed' };
	} catch (error) {
		await unlinkIfUnreferencedMediaAsset(storedAsset);
		const details = extractErrorDetails(error);
		logger.warn('Unfurl job attempt failed', {
			job_id: job.id,
			resource_id: job.resourceId,
			attempts: job.attempts,
			error_code: details.code,
			error: details.message
		});

		const failed = await failClaimedJobInTx({
			jobId: job.id,
			resourceId: job.resourceId,
			lockToken: job.lockToken,
			attempts: job.attempts,
			errorCode: details.code,
			errorMessage: details.message
		});

		if (failed.fencedOut) {
			return { status: 'fenced_out' };
		}
		return { status: failed.nextStatus === 'dead' ? 'dead' : 'requeued' };
	}
}

/**
 * Claims and executes up to maxJobs queued/expired jobs once (useful for deterministic tests).
 */
export async function runSingleUnfurlPass(
	options: {
		maxJobs?: number;
		adapterOptions?: AdapterOptions;
		mediaOptions?: MediaDiskCheckOptions;
	} = {}
): Promise<{
	processedCount: number;
	results: Array<'completed' | 'requeued' | 'dead' | 'fenced_out'>;
}> {
	const maxJobs = options.maxJobs ?? 10;
	const results: Array<'completed' | 'requeued' | 'dead' | 'fenced_out'> = [];

	for (let i = 0; i < maxJobs; i += 1) {
		const job = await claimNextUnfurlJob();
		if (!job) {
			break;
		}
		const outcome = await executeClaimedJob(job, {
			adapterOptions: options.adapterOptions,
			mediaOptions: options.mediaOptions
		});
		results.push(outcome.status);
	}

	return {
		processedCount: results.length,
		results
	};
}

/**
 * Starts the in-process background unfurl worker once per Node process (globalThis guarded).
 */
export function startUnfurlWorker(options: UnfurlWorkerOptions = {}): UnfurlWorkerHandle {
	const existing = getWorkerState();
	if (existing && existing.handle.isRunning()) {
		return existing.handle;
	}

	const concurrency = Math.max(1, options.concurrency ?? env.UNFURL_CONCURRENCY);
	const pollIntervalMs = options.pollIntervalMs ?? UNFURL_POLL_INTERVAL_MS;
	const maintenanceIntervalMs =
		options.maintenanceIntervalMs ?? UNFURL_ORPHAN_MAINTENANCE_INTERVAL_MS;

	const inFlight = new Set<Promise<void>>();
	const jobControllers = new Set<AbortController>();
	let stopping = false;
	let pumping = false;
	let wakeRequested = false;
	let claimInProgress: Promise<ClaimedUnfurlJob | null> | null = null;

	const schedulePumpSoon = () => {
		if (stopping) {
			return;
		}
		setImmediate(() => {
			void pump();
		});
	};

	const pump = async () => {
		if (stopping) {
			return;
		}
		if (pumping) {
			wakeRequested = true;
			return;
		}

		pumping = true;
		try {
			do {
				wakeRequested = false;
				while (!stopping && inFlight.size < concurrency) {
					let claimed: ClaimedUnfurlJob | null = null;
					const claimStep = (async () => {
						const job = await claimNextUnfurlJob();
						// stop() may have started while the claim transaction was running; the database pool
						// is about to close, so hand the job back instead of starting it.
						if (job && stopping) {
							await releaseClaimedUnfurlJob(job).catch((error) => {
								logger.warn('Failed to release unfurl job claimed during shutdown', {
									job_id: job.id,
									error: error instanceof Error ? error.message : String(error)
								});
							});
							return null;
						}
						return job;
					})();
					claimInProgress = claimStep;
					try {
						claimed = await claimStep;
					} catch (error) {
						if (!stopping) {
							logger.error('Failed to claim unfurl job', {
								error: error instanceof Error ? error.message : String(error)
							});
						}
						break;
					} finally {
						if (claimInProgress === claimStep) {
							claimInProgress = null;
						}
					}

					if (!claimed) {
						break;
					}

					const jobController = new AbortController();
					jobControllers.add(jobController);

					const jobPromise: Promise<void> = executeClaimedJob(claimed, {
						signal: jobController.signal,
						adapterOptions: options.adapterOptions,
						mediaOptions: options.mediaOptions
					})
						.then(() => undefined)
						.catch((error) => {
							logger.error('Unexpected error executing unfurl job', {
								job_id: claimed.id,
								error: error instanceof Error ? error.message : String(error)
							});
						})
						.finally(() => {
							jobControllers.delete(jobController);
							inFlight.delete(jobPromise);
							if (!stopping) {
								schedulePumpSoon();
							}
						});

					inFlight.add(jobPromise);
				}
			} while (wakeRequested && !stopping && inFlight.size < concurrency);
		} finally {
			pumping = false;
		}
	};

	const pollTimer = setInterval(() => {
		if (!stopping) {
			void pump();
		}
	}, pollIntervalMs);
	pollTimer.unref?.();

	const maintenanceTimer = setInterval(() => {
		if (!stopping) {
			void cleanupOrphanMediaAssets({ storageDir: options.mediaOptions?.storageDir }).catch(
				(error) => {
					logger.warn('Hourly orphan media cleanup failed', {
						error: error instanceof Error ? error.message : String(error)
					});
				}
			);
		}
	}, maintenanceIntervalMs);
	maintenanceTimer.unref?.();

	const handle: UnfurlWorkerHandle = {
		wake() {
			if (!stopping) {
				schedulePumpSoon();
			}
		},
		isRunning() {
			return !stopping;
		},
		activeJobCount() {
			return inFlight.size;
		},
		async stop(stopOptions?: { timeoutMs?: number }) {
			const state = getWorkerState();
			if (state?.stopPromise) {
				return state.stopPromise;
			}

			const timeoutMs = stopOptions?.timeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
			stopping = true;
			clearInterval(pollTimer);
			clearInterval(maintenanceTimer);

			const runStop = async () => {
				if (claimInProgress) {
					await claimInProgress.catch(() => null);
				}

				if (inFlight.size > 0) {
					let timeoutId: ReturnType<typeof setTimeout> | undefined;
					let timedOut = false;

					const drainAll = Promise.allSettled(Array.from(inFlight));
					const deadline = new Promise<void>((resolve) => {
						timeoutId = setTimeout(() => {
							timedOut = true;
							resolve();
						}, timeoutMs);
					});

					await Promise.race([drainAll, deadline]);
					if (timeoutId !== undefined) {
						clearTimeout(timeoutId);
					}

					if (timedOut && inFlight.size > 0) {
						logger.warn('Unfurl worker shutdown timed out; aborting remaining in-flight jobs', {
							remaining_jobs: inFlight.size,
							timeout_ms: timeoutMs
						});
						for (const controller of jobControllers) {
							controller.abort(
								new SafeFetchError('TIMEOUT', 'Cancelled because the server is shutting down.')
							);
						}
						await Promise.race([
							Promise.allSettled(Array.from(inFlight)),
							new Promise<void>((resolve) => setTimeout(resolve, 250))
						]);
					}
				}

				if (getGlobalStore()[WORKER_STATE_SYMBOL] === stateObj) {
					delete getGlobalStore()[WORKER_STATE_SYMBOL];
				}
			};

			const stopPromise = runStop();
			if (state) {
				state.stopPromise = stopPromise;
			}
			return stopPromise;
		}
	};

	const stateObj: GlobalWorkerState = {
		handle,
		stopPromise: null
	};
	getGlobalStore()[WORKER_STATE_SYMBOL] = stateObj;

	logger.info('In-process unfurl worker started', {
		concurrency,
		poll_interval_ms: pollIntervalMs
	});

	schedulePumpSoon();
	return handle;
}

/**
 * Triggers an immediate non-blocking worker wakeup if the in-process worker is active.
 */
export function notifyUnfurlWorker(): void {
	const state = getWorkerState();
	if (state && state.handle.isRunning()) {
		state.handle.wake();
	}
}

export async function stopUnfurlWorker(options?: { timeoutMs?: number }): Promise<void> {
	const state = getWorkerState();
	if (!state) {
		return;
	}
	await state.handle.stop(options);
}
