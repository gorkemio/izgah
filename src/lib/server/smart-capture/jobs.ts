import { sql } from 'drizzle-orm';
import type { Database } from '#lib/server/db/client.ts';
import { enrichmentJobs } from '#lib/server/db/schema.ts';

type Insertable = Pick<Database, 'insert'>;

/**
 * Queues (or re-queues) the enrichment job of a resource. A running job is left alone; the share
 * that triggered this is picked up by the next run (docs/designs/izgah-smart-capture.md §1).
 */
export async function enqueueEnrichmentJob(
	executor: Insertable,
	resourceId: string,
	now = new Date()
): Promise<void> {
	await executor
		.insert(enrichmentJobs)
		.values({ resourceId, status: 'queued', nextRunAt: now })
		.onConflictDoUpdate({
			target: enrichmentJobs.resourceId,
			set: {
				status: 'queued',
				attempts: 0,
				nextRunAt: now,
				lockedUntil: null,
				lockToken: null,
				lastErrorCode: null,
				lastErrorMessage: null,
				updatedAt: now
			},
			setWhere: sql`${enrichmentJobs.status} <> 'running'`
		});
}
