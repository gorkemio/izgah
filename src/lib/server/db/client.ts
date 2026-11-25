import { building } from '$app/environment';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '$lib/server/env';
import * as schema from './schema';

function resolveDatabaseUrl(): string {
	const isTestEnv = process.env.VITEST === 'true' || env.NODE_ENV === 'test';
	if (isTestEnv) {
		const testUrl = env.TEST_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
		if (!testUrl) {
			throw new Error('TEST_DATABASE_URL is required in test environment');
		}
		const dbName = new URL(testUrl).pathname.replace(/^\//, '');
		if (dbName !== 'izgah_test') {
			throw new Error(`Refusing to run tests against non-test database: "${dbName}"`);
		}
		return testUrl;
	}

	return env.DATABASE_URL;
}

function createSqlClient(): postgres.Sql {
	if (building) {
		return postgres('postgres://placeholder:placeholder@127.0.0.1:5432/izgah', {
			max: 1,
			idle_timeout: 1,
			connect_timeout: 1,
			onnotice: () => {}
		});
	}

	return postgres(resolveDatabaseUrl(), {
		max: env.DATABASE_POOL_MAX,
		onnotice: () => {}
	});
}

export const sqlClient = createSqlClient();
export const db = drizzle(sqlClient, { schema });
export type Database = typeof db;

export async function closeDb(): Promise<void> {
	await sqlClient.end({ timeout: 5 });
}
