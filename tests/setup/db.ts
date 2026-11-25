import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../../src/lib/server/db/schema';
import { runMigrations, type RunMigrationsResult } from '../../src/lib/server/db/migrate';

export const REQUIRED_TEST_DB_NAME = 'izgah_test';

/**
 * Ensures tests never execute against a non-test database.
 */
export function assertTestDatabaseUrl(rawUrl: string | undefined): string {
	if (!rawUrl || rawUrl.trim() === '') {
		const msg = 'TEST_DATABASE_URL is required and must point to izgah_test';
		process.stderr.write(`${msg}\n`);
		throw new Error(msg);
	}

	let parsed: URL;
	try {
		parsed = new URL(rawUrl);
	} catch {
		const msg = 'TEST_DATABASE_URL is not a valid URL';
		process.stderr.write(`${msg}\n`);
		throw new Error(msg);
	}

	if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
		const msg = 'TEST_DATABASE_URL must use postgres:// or postgresql://';
		process.stderr.write(`${msg}\n`);
		throw new Error(msg);
	}

	const dbName = parsed.pathname.replace(/^\//, '');
	if (dbName !== REQUIRED_TEST_DB_NAME) {
		const msg = `Refusing to run tests on database "${dbName}"; expected "${REQUIRED_TEST_DB_NAME}"`;
		process.stderr.write(`${msg}\n`);
		throw new Error(msg);
	}

	return rawUrl;
}

export const testDatabaseUrl = assertTestDatabaseUrl(process.env.TEST_DATABASE_URL);
process.env.DATABASE_URL = testDatabaseUrl;

export const testSql = postgres(testDatabaseUrl, {
	max: 4,
	onnotice: () => {}
});

export const testDb = drizzle(testSql, { schema });

export async function migrateTestDb(): Promise<RunMigrationsResult> {
	return runMigrations({ databaseUrl: testDatabaseUrl });
}

export async function resetTestDb(): Promise<void> {
	await testSql`
		TRUNCATE TABLE
			public.notifications,
			public.resource_comments,
			public.resource_likes,
			public.search_logs,
			public.audit_logs,
			public.link_share_sections,
			public.link_shares,
			public.unfurl_jobs,
			public.canonical_resources,
			public.media_assets,
			public.sections,
			public.api_keys,
			public.invite_tokens,
			public.verifications,
			public.accounts,
			public.sessions,
			public.users
		RESTART IDENTITY CASCADE
	`;
}

export async function closeTestDb(): Promise<void> {
	await testSql.end({ timeout: 5 });
}
