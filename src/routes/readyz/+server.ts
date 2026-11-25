import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { json } from '@sveltejs/kit';
import { sqlClient } from '#lib/server/db/client.ts';
import { env } from '#lib/server/env.ts';
import { logger } from '#lib/server/logger.ts';
import type { RequestHandler } from './$types';

interface JournalEntry {
	idx: number;
	when: number;
	tag: string;
}

interface JournalFile {
	entries: JournalEntry[];
}

type CheckStatus = 'ok' | 'fail';

async function checkDatabase(): Promise<CheckStatus> {
	try {
		await sqlClient`SELECT 1`;
		return 'ok';
	} catch (error) {
		logger.error('Readiness database ping failed', {
			error: error instanceof Error ? error.message : 'Unknown error'
		});
		return 'fail';
	}
}

async function checkMigrations(): Promise<CheckStatus> {
	try {
		const drizzleDir = path.resolve(process.cwd(), 'drizzle');
		const journalRaw = await fs.readFile(path.join(drizzleDir, 'meta', '_journal.json'), 'utf8');
		const journal = JSON.parse(journalRaw) as JournalFile;
		const latestEntry = journal.entries.at(-1);
		if (!latestEntry) {
			return 'fail';
		}

		const migrationSql = await fs.readFile(path.join(drizzleDir, `${latestEntry.tag}.sql`), 'utf8');
		const expectedHash = crypto.createHash('sha256').update(migrationSql).digest('hex');

		const rows = await sqlClient<{ hash: string; created_at: string | number }[]>`
			SELECT hash, created_at
			FROM drizzle.__drizzle_migrations
			ORDER BY created_at DESC, id DESC
			LIMIT 1
		`;
		const latestApplied = rows[0];
		if (!latestApplied) {
			return 'fail';
		}

		const matchesWhen = Number(latestApplied.created_at) === latestEntry.when;
		const matchesHash = latestApplied.hash === expectedHash;
		return matchesWhen && matchesHash ? 'ok' : 'fail';
	} catch (error) {
		logger.error('Readiness migration check failed', {
			error: error instanceof Error ? error.message : 'Unknown error'
		});
		return 'fail';
	}
}

async function checkStorage(): Promise<CheckStatus> {
	const probePath = path.join(env.MEDIA_STORAGE_DIR, `.readyz-${crypto.randomUUID()}.tmp`);
	try {
		await fs.mkdir(env.MEDIA_STORAGE_DIR, { recursive: true });
		await fs.writeFile(probePath, 'ok', 'utf8');
		await fs.unlink(probePath);
		return 'ok';
	} catch (error) {
		try {
			await fs.unlink(probePath);
		} catch {
			// Best-effort cleanup if unlink itself was not what failed
		}
		logger.error('Readiness storage check failed', {
			error: error instanceof Error ? error.message : 'Unknown error'
		});
		return 'fail';
	}
}

type ReadinessChecks = { database: CheckStatus; migrations: CheckStatus; storage: CheckStatus };

// /readyz is unauthenticated, so concurrent probes share one in-flight check instead of each
// running database queries and a storage write.
let inFlight: Promise<ReadinessChecks> | null = null;

function runChecks(): Promise<ReadinessChecks> {
	inFlight ??= Promise.all([checkDatabase(), checkMigrations(), checkStorage()])
		.then(([database, migrations, storage]) => ({ database, migrations, storage }))
		.finally(() => {
			inFlight = null;
		});
	return inFlight;
}

export const GET: RequestHandler = async ({ locals }) => {
	const { database, migrations, storage } = await runChecks();

	const checks = { database, migrations, storage };
	const isReady = database === 'ok' && migrations === 'ok' && storage === 'ok';

	if (!isReady) {
		logger
			.child({ request_id: locals.requestId ?? null, channel: 'system' })
			.error('Readiness probe returned not_ready', { checks });
	}

	return json(
		{
			status: isReady ? 'ready' : 'not_ready',
			checks
		},
		{
			status: isReady ? 200 : 503,
			headers: {
				'Cache-Control': 'no-store'
			}
		}
	);
};
