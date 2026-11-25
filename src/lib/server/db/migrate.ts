import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

export const MIGRATION_ADVISORY_LOCK_ID = 74829104;

export interface RunMigrationsOptions {
	databaseUrl?: string;
	migrationsFolder?: string;
}

export interface RunMigrationsResult {
	appliedCount: number;
	beforeCount: number;
	afterCount: number;
}

function assertValidPostgresUrl(rawUrl: string | undefined): string {
	if (!rawUrl || rawUrl.trim() === '') {
		throw new Error('Missing DATABASE_URL');
	}

	let parsed: URL;
	try {
		parsed = new URL(rawUrl);
	} catch {
		throw new Error('Invalid DATABASE_URL format');
	}

	if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
		throw new Error('Invalid DATABASE_URL protocol');
	}

	return rawUrl;
}

async function readAppliedMigrationCount(sql: postgres.Sql): Promise<number> {
	const [reg] = await sql<{ reg: string | null }[]>`
		SELECT to_regclass('drizzle.__drizzle_migrations')::text AS reg
	`;
	if (!reg?.reg) {
		return 0;
	}

	const [row] = await sql<{ count: string }[]>`
		SELECT count(*)::text AS count FROM drizzle.__drizzle_migrations
	`;
	return Number(row?.count ?? '0');
}

/**
 * Applies pending Drizzle migrations under a single PostgreSQL advisory lock.
 */
export async function runMigrations(
	options: RunMigrationsOptions = {}
): Promise<RunMigrationsResult> {
	const databaseUrl = assertValidPostgresUrl(options.databaseUrl ?? process.env.DATABASE_URL);
	const migrationsFolder = options.migrationsFolder ?? path.resolve(process.cwd(), 'drizzle');

	const sql = postgres(databaseUrl, {
		max: 1,
		onnotice: () => {}
	});

	let lockAcquired = false;
	try {
		await sql`SELECT pg_advisory_lock(${MIGRATION_ADVISORY_LOCK_ID})`;
		lockAcquired = true;

		const beforeCount = await readAppliedMigrationCount(sql);
		await migrate(drizzle(sql), { migrationsFolder });
		const afterCount = await readAppliedMigrationCount(sql);

		return {
			appliedCount: afterCount - beforeCount,
			beforeCount,
			afterCount
		};
	} finally {
		if (lockAcquired) {
			try {
				await sql`SELECT pg_advisory_unlock(${MIGRATION_ADVISORY_LOCK_ID})`;
			} catch {
				// Best-effort unlock before closing single migration connection
			}
		}
		await sql.end({ timeout: 5 });
	}
}

const currentFilePath = fileURLToPath(import.meta.url);
const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';

if (invokedPath === currentFilePath) {
	if (process.env.NODE_ENV !== 'test' && fs.existsSync('.env')) {
		process.loadEnvFile('.env');
	}
	runMigrations()
		.then((result) => {
			process.stdout.write(
				JSON.stringify({
					timestamp: new Date().toISOString(),
					level: 'info',
					request_id: null,
					user_id: null,
					channel: 'system',
					client_version: null,
					msg: 'Database migrations complete',
					appliedCount: result.appliedCount,
					beforeCount: result.beforeCount,
					totalMigrations: result.afterCount
				}) + '\n'
			);
			process.exit(0);
		})
		.catch((error: unknown) => {
			const message = error instanceof Error ? error.message : 'Migration failed';
			process.stderr.write(
				JSON.stringify({
					timestamp: new Date().toISOString(),
					level: 'error',
					request_id: null,
					user_id: null,
					channel: 'system',
					client_version: null,
					msg: 'Database migration failed',
					error: message
				}) + '\n'
			);
			process.exit(1);
		});
}
