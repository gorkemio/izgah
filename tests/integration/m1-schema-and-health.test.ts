import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb } from '../../src/lib/server/db/client';
import { validateEnv } from '../../src/lib/server/env';
import { GET as healthzGet } from '../../src/routes/healthz/+server';
import { GET as readyzGet } from '../../src/routes/readyz/+server';
import {
	assertTestDatabaseUrl,
	migrateTestDb,
	resetTestDb,
	testDatabaseUrl,
	testSql,
	closeTestDb
} from '../setup/db';

const EXPECTED_TABLES = [
	'accounts',
	'ai_usage_daily',
	'api_keys',
	'audit_logs',
	'canonical_resources',
	'enrichment_jobs',
	'instance_settings',
	'invite_tokens',
	'link_share_sections',
	'link_shares',
	'media_assets',
	'notifications',
	'resource_comments',
	'resource_enrichments',
	'resource_likes',
	'search_logs',
	'sections',
	'sessions',
	'share_section_suggestions',
	'unfurl_jobs',
	'users',
	'verifications'
];

function getPgErrorCode(error: unknown): string | undefined {
	if (!error || typeof error !== 'object') {
		return undefined;
	}
	if ('code' in error && typeof error.code === 'string') {
		return error.code;
	}
	if ('cause' in error && error.cause && typeof error.cause === 'object') {
		return getPgErrorCode(error.cause);
	}
	return undefined;
}

describe('M1 schema, triggers, env validation, and health endpoints', () => {
	let firstMigrationResult: Awaited<ReturnType<typeof migrateTestDb>>;
	let secondMigrationResult: Awaited<ReturnType<typeof migrateTestDb>>;

	beforeAll(async () => {
		await testSql`DROP SCHEMA IF EXISTS drizzle CASCADE`;
		await testSql`DROP SCHEMA IF EXISTS public CASCADE`;
		await testSql`CREATE SCHEMA public`;

		firstMigrationResult = await migrateTestDb();
		secondMigrationResult = await migrateTestDb();
	});

	beforeEach(async () => {
		await resetTestDb();
	});

	afterAll(async () => {
		await closeDb();
		await closeTestDb();
	});

	it('refuses non-izgah_test databases in test setup', () => {
		expect(() => assertTestDatabaseUrl(undefined)).toThrow();
		expect(() => assertTestDatabaseUrl('postgresql://izgah:izgah@127.0.0.1:5432/izgah')).toThrow(
			/izgah_test/
		);
		expect(() => assertTestDatabaseUrl('postgresql://izgah:izgah@127.0.0.1:5432/postgres')).toThrow(
			/izgah_test/
		);
		expect(assertTestDatabaseUrl(testDatabaseUrl)).toBe(testDatabaseUrl);

		const result = spawnSync('pnpm', ['exec', 'tsx', 'tests/setup/db.ts'], {
			cwd: process.cwd(),
			encoding: 'utf8',
			env: {
				...process.env,
				TEST_DATABASE_URL: 'postgresql://izgah:izgah@127.0.0.1:5432/izgah'
			}
		});

		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain('izgah_test');
	});

	it('applies every journal migration idempotently and matches _journal.json', async () => {
		const journalRaw = await fs.readFile(
			path.resolve(process.cwd(), 'drizzle/meta/_journal.json'),
			'utf8'
		);
		const journal = JSON.parse(journalRaw) as {
			entries: Array<{ tag: string; when: number }>;
		};
		const total = journal.entries.length;
		expect(journal.entries[0]?.tag).toBe('0000_initial_core');

		expect(firstMigrationResult.beforeCount).toBe(0);
		expect(firstMigrationResult.appliedCount).toBe(total);
		expect(firstMigrationResult.afterCount).toBe(total);

		expect(secondMigrationResult.beforeCount).toBe(total);
		expect(secondMigrationResult.appliedCount).toBe(0);
		expect(secondMigrationResult.afterCount).toBe(total);

		const latestEntry = journal.entries.at(-1);

		const sqlContent = await fs.readFile(
			path.resolve(process.cwd(), `drizzle/${latestEntry!.tag}.sql`),
			'utf8'
		);
		const expectedHash = crypto.createHash('sha256').update(sqlContent).digest('hex');

		const [migrationRow] = await testSql<{ hash: string; created_at: string }[]>`
			SELECT hash, created_at::text
			FROM drizzle.__drizzle_migrations
			ORDER BY created_at DESC, id DESC
			LIMIT 1
		`;
		expect(Number(migrationRow.created_at)).toBe(latestEntry!.when);
		expect(migrationRow.hash).toBe(expectedHash);

		const tables = await testSql<{ tablename: string }[]>`
			SELECT tablename
			FROM pg_tables
			WHERE schemaname = 'public'
			ORDER BY tablename ASC
		`;
		expect(tables.map((row) => row.tablename)).toEqual(EXPECTED_TABLES);
	});

	it('enables unaccent and pg_trgm extensions', async () => {
		const extensions = await testSql<{ extname: string }[]>`
			SELECT extname
			FROM pg_extension
			WHERE extname IN ('unaccent', 'pg_trgm')
			ORDER BY extname ASC
		`;
		expect(extensions.map((row) => row.extname)).toEqual(['pg_trgm', 'unaccent']);

		const [fnCheck] = await testSql<{ normalized: string; sim: number }[]>`
			SELECT
				unaccent('İzgah Şifreli Çağrı') AS normalized,
				similarity('github.com/sveltejs/kit', 'sveltejs/kit') AS sim
		`;
		expect(fnCheck.normalized).toBe('Izgah Sifreli Cagri');
		expect(fnCheck.sim).toBeGreaterThan(0.3);
	});

	it('enforces ON DELETE RESTRICT on users and ON DELETE CASCADE for normal section shares', async () => {
		const adminId = crypto.randomUUID();
		const resourceId = crypto.randomUUID();
		const shareId = crypto.randomUUID();
		const sectionId = crypto.randomUUID();

		await testSql`
			INSERT INTO users (id, name, email, role)
			VALUES (${adminId}, 'Admin', 'admin@example.com', 'admin')
		`;
		await testSql`
			INSERT INTO canonical_resources (id, canonical_url, domain)
			VALUES (${resourceId}, 'https://example.com/guide', 'example.com')
		`;
		await testSql`
			INSERT INTO link_shares (id, resource_id, author_id, raw_url, is_feed_visible)
			VALUES (${shareId}, ${resourceId}, ${adminId}, 'https://example.com/guide', true)
		`;
		await testSql`
			INSERT INTO sections (id, slug, name, created_by_id)
			VALUES (${sectionId}, 'rehberler', 'Rehberler', ${adminId})
		`;
		await testSql`
			INSERT INTO link_share_sections (share_id, section_id)
			VALUES (${shareId}, ${sectionId})
		`;

		let deleteUserError: unknown;
		try {
			await testSql`DELETE FROM users WHERE id = ${adminId}`;
		} catch (error) {
			deleteUserError = error;
		}
		expect(getPgErrorCode(deleteUserError)).toBe('23503');

		await testSql`DELETE FROM sections WHERE id = ${sectionId}`;
		const remainingShares = await testSql<{ id: string }[]>`
			SELECT id FROM link_shares WHERE id = ${shareId}
		`;
		expect(remainingShares).toHaveLength(1);
	});

	it('enforces DEFERRABLE INITIALLY DEFERRED silent share section constraint', async () => {
		const adminId = crypto.randomUUID();
		const sectionId = crypto.randomUUID();
		const resourceId = crypto.randomUUID();

		await testSql`
			INSERT INTO users (id, name, email, role)
			VALUES (${adminId}, 'Admin', 'admin@example.com', 'admin')
		`;
		await testSql`
			INSERT INTO sections (id, slug, name, created_by_id)
			VALUES (${sectionId}, 'genel', 'Genel', ${adminId})
		`;
		await testSql`
			INSERT INTO canonical_resources (id, canonical_url, domain)
			VALUES (${resourceId}, 'https://example.com/silent', 'example.com')
		`;

		// Silent share without any section fails on commit
		const orphanSilentId = crypto.randomUUID();
		let insertWithoutSectionError: unknown;
		try {
			await testSql.begin(async (tx) => {
				await tx`
					INSERT INTO link_shares (id, resource_id, author_id, raw_url, is_feed_visible)
					VALUES (${orphanSilentId}, ${resourceId}, ${adminId}, 'https://example.com/silent', false)
				`;
			});
		} catch (error) {
			insertWithoutSectionError = error;
		}
		expect(getPgErrorCode(insertWithoutSectionError)).toBe('23514');

		// Silent share + section in same deferred transaction succeeds
		const validSilentId = crypto.randomUUID();
		await testSql.begin(async (tx) => {
			await tx`
				INSERT INTO link_shares (id, resource_id, author_id, raw_url, is_feed_visible)
				VALUES (${validSilentId}, ${resourceId}, ${adminId}, 'https://example.com/silent', false)
			`;
			await tx`
				INSERT INTO link_share_sections (share_id, section_id)
				VALUES (${validSilentId}, ${sectionId})
			`;
		});

		// Updating a normal share to silent without a section fails
		const normalShareId = crypto.randomUUID();
		await testSql`
			INSERT INTO link_shares (id, resource_id, author_id, raw_url, is_feed_visible)
			VALUES (${normalShareId}, ${resourceId}, ${adminId}, 'https://example.com/silent', true)
		`;
		let updateToSilentError: unknown;
		try {
			await testSql`
				UPDATE link_shares SET is_feed_visible = false WHERE id = ${normalShareId}
			`;
		} catch (error) {
			updateToSilentError = error;
		}
		expect(getPgErrorCode(updateToSilentError)).toBe('23514');

		// Deleting the sole link_share_sections row directly fails
		let deleteJunctionError: unknown;
		try {
			await testSql`
				DELETE FROM link_share_sections
				WHERE share_id = ${validSilentId} AND section_id = ${sectionId}
			`;
		} catch (error) {
			deleteJunctionError = error;
		}
		expect(getPgErrorCode(deleteJunctionError)).toBe('23514');

		// Deleting the sole section via ON DELETE CASCADE also fails at commit
		let deleteSectionError: unknown;
		try {
			await testSql`DELETE FROM sections WHERE id = ${sectionId}`;
		} catch (error) {
			deleteSectionError = error;
		}
		expect(getPgErrorCode(deleteSectionError)).toBe('23514');

		// Soft-deleting the silent share allows removing its section
		await testSql`
			UPDATE link_shares SET deleted_at = now() WHERE id = ${validSilentId}
		`;
		await testSql`DELETE FROM sections WHERE id = ${sectionId}`;
		const remainingSections = await testSql<{ id: string }[]>`
			SELECT id FROM sections WHERE id = ${sectionId}
		`;
		expect(remainingSections).toHaveLength(0);
	});

	it('updates search_vector and note_search_vector triggers on insert, update, and soft-delete', async () => {
		const userId = crypto.randomUUID();
		const resourceId = crypto.randomUUID();
		const shareId = crypto.randomUUID();

		await testSql`
			INSERT INTO users (id, name, email, role)
			VALUES (${userId}, 'Member', 'member@example.com', 'member')
		`;
		await testSql`
			INSERT INTO canonical_resources (
				id,
				canonical_url,
				domain,
				title,
				description,
				site_name
			)
			VALUES (
				${resourceId},
				'https://github.com/sveltejs/kit',
				'github.com',
				'SvelteKit Türkçe Çağrıları',
				'Full-stack web framework rehberi',
				'GitHub'
			)
		`;

		const turkishMatch = await testSql<{ id: string }[]>`
			SELECT id
			FROM canonical_resources
			WHERE search_vector @@ websearch_to_tsquery('turkish', unaccent('çağrı'))
		`;
		expect(turkishMatch).toHaveLength(1);

		const urlTokenMatch = await testSql<{ id: string }[]>`
			SELECT id
			FROM canonical_resources
			WHERE search_vector @@ websearch_to_tsquery('simple', 'sveltejs')
		`;
		expect(urlTokenMatch).toHaveLength(1);

		await testSql`
			UPDATE canonical_resources
			SET title = 'Güncel Önizleme Başlığı', description = 'Yeni açıklama metni'
			WHERE id = ${resourceId}
		`;

		const updatedTitleMatch = await testSql<{ id: string }[]>`
			SELECT id
			FROM canonical_resources
			WHERE search_vector @@ websearch_to_tsquery('turkish', unaccent('onizleme'))
		`;
		expect(updatedTitleMatch).toHaveLength(1);

		await testSql`
			INSERT INTO link_shares (id, resource_id, author_id, raw_url, note)
			VALUES (
				${shareId},
				${resourceId},
				${userId},
				'https://github.com/sveltejs/kit',
				'Harika erişilebilirlik değerlendirmeleri'
			)
		`;

		const noteMatch = await testSql<{ id: string }[]>`
			SELECT id
			FROM link_shares
			WHERE note_search_vector @@ websearch_to_tsquery('turkish', unaccent('değerlendirme'))
		`;
		expect(noteMatch).toHaveLength(1);

		await testSql`
			UPDATE link_shares
			SET deleted_at = now()
			WHERE id = ${shareId}
		`;

		const [clearedShare] = await testSql<{ vector_text: string }[]>`
			SELECT note_search_vector::text AS vector_text
			FROM link_shares
			WHERE id = ${shareId}
		`;
		expect(clearedShare.vector_text).toBe('');
	});

	it('validates env without leaking secret values on error', () => {
		const prodCheck = validateEnv({
			NODE_ENV: 'production',
			DATABASE_URL: 'postgresql://izgah:izgah@127.0.0.1:5432/izgah',
			BETTER_AUTH_SECRET: 'a'.repeat(32)
		});
		expect(prodCheck).toEqual({ ok: false, fields: ['ORIGIN'] });
		expect(
			validateEnv({
				NODE_ENV: 'production',
				IZGAH_CLI_MODE: '1',
				DATABASE_URL: 'postgresql://izgah:izgah@127.0.0.1:5432/izgah',
				BETTER_AUTH_SECRET: 'a'.repeat(32)
			})
		).toMatchObject({ ok: true });

		const canarySecret = 'SHORT_CANARY_SECRET_999';
		const canaryDb = 'http://LEAK_DB_CANARY_999';
		const envImportLoader =
			'data:text/javascript,import{registerHooks}from"node:module";registerHooks({resolve(s,c,n){return s==="$app/env"?{shortCircuit:true,url:"data:text/javascript,export const building=false;"}:n(s,c);}})';

		const proc = spawnSync(
			'node',
			['--import', envImportLoader, '--import', 'tsx', '-e', "import './src/lib/server/env.ts'"],
			{
				cwd: process.cwd(),
				encoding: 'utf8',
				env: {
					PATH: process.env.PATH,
					HOME: process.env.HOME,
					NODE_ENV: 'development',
					BETTER_AUTH_SECRET: canarySecret,
					DATABASE_URL: canaryDb
				}
			}
		);

		expect(proc.status).toBe(1);
		expect(proc.stdout).toBe('');
		expect(proc.stderr).not.toContain(canarySecret);
		expect(proc.stderr).not.toContain(canaryDb);
		const parsedError = JSON.parse(proc.stderr.trim()) as { fields: string[]; level: string };
		expect(parsedError.level).toBe('error');
		expect(parsedError.fields).toEqual(['BETTER_AUTH_SECRET', 'DATABASE_URL']);
	});

	it('serves /healthz and /readyz accurately', async () => {
		const healthRes = await healthzGet({} as Parameters<typeof healthzGet>[0]);
		expect(healthRes.status).toBe(200);
		expect(healthRes.headers.get('cache-control')).toBe('no-store');
		expect(await healthRes.json()).toEqual({ status: 'ok' });

		const readyEvent = {
			locals: {
				requestId: 'req_test_readyz',
				user: null,
				session: null,
				authChannel: null,
				apiKeyId: null
			}
		} as Parameters<typeof readyzGet>[0];

		const readyRes = await readyzGet(readyEvent);
		expect(readyRes.status).toBe(200);
		expect(readyRes.headers.get('cache-control')).toBe('no-store');
		expect(await readyRes.json()).toEqual({
			status: 'ready',
			checks: {
				database: 'ok',
				migrations: 'ok',
				storage: 'ok'
			}
		});

		const [originalMigration] = await testSql<{ id: number; created_at: string }[]>`
			SELECT id, created_at::text
			FROM drizzle.__drizzle_migrations
			ORDER BY created_at DESC, id DESC
			LIMIT 1
		`;

		try {
			await testSql`
				UPDATE drizzle.__drizzle_migrations
				SET created_at = 0
				WHERE id = ${originalMigration.id}
			`;

			const notReadyRes = await readyzGet(readyEvent);
			expect(notReadyRes.status).toBe(503);
			expect(await notReadyRes.json()).toEqual({
				status: 'not_ready',
				checks: {
					database: 'ok',
					migrations: 'fail',
					storage: 'ok'
				}
			});
		} finally {
			await testSql`
				UPDATE drizzle.__drizzle_migrations
				SET created_at = ${originalMigration.created_at}
				WHERE id = ${originalMigration.id}
			`;
		}
	});

	it('enforces audit_logs immutability trigger and known action CHECK constraint', async () => {
		const auditId = crypto.randomUUID();
		await testSql`
			INSERT INTO audit_logs (id, actor_user_id, action, target_type, target_id, metadata)
			VALUES (${auditId}, NULL, 'cli.create_admin', 'user', NULL, '{}'::jsonb)
		`;

		let updateErr: unknown;
		try {
			await testSql`
				UPDATE audit_logs SET action = 'cli.reset_admin' WHERE id = ${auditId}
			`;
		} catch (error) {
			updateErr = error;
		}
		expect(getPgErrorCode(updateErr)).toBe('55000');

		let deleteErr: unknown;
		try {
			await testSql`DELETE FROM audit_logs WHERE id = ${auditId}`;
		} catch (error) {
			deleteErr = error;
		}
		expect(getPgErrorCode(deleteErr)).toBe('55000');

		let unknownActionErr: unknown;
		try {
			await testSql`
				INSERT INTO audit_logs (id, actor_user_id, action, target_type, target_id, metadata)
				VALUES (${crypto.randomUUID()}, NULL, 'unexpected.action', 'system', NULL, '{}'::jsonb)
			`;
		} catch (error) {
			unknownActionErr = error;
		}
		expect(getPgErrorCode(unknownActionErr)).toBe('23514');
	});
});
