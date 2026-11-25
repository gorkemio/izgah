import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

const CLI_DISPLAY_NAME_MAX_LENGTH = 120;
const emailSchema = z.string().trim().email();

let dbClientPromise: Promise<typeof import('#lib/server/db/client.ts')> | null = null;

async function loadServerDeps() {
	dbClientPromise ??= import('#lib/server/db/client.ts');
	const [auditMod, clientMod, schemaMod, tokensMod] = await Promise.all([
		import('#lib/server/audit.ts'),
		dbClientPromise,
		import('#lib/server/db/schema.ts'),
		import('#lib/server/auth/tokens.ts')
	]);

	return {
		recordAuditLog: auditMod.recordAuditLog,
		db: clientMod.db,
		apiKeys: schemaMod.apiKeys,
		users: schemaMod.users,
		createInviteToken: tokensMod.createInviteToken
	};
}

export interface CliIo {
	stdout?: (text: string) => void;
	stderr?: (text: string) => void;
	originOverride?: string | null;
}

const CLI_USAGE = `Usage:
  create-admin --email <email> --name "<full name>"
  reset-admin --email <email>
`;

function resolveCliOrigin(originOverride?: string | null): string | null {
	if (originOverride !== undefined) {
		return originOverride;
	}
	const runtimeOrigin = process.env.ORIGIN?.trim();
	return runtimeOrigin && runtimeOrigin !== '' ? runtimeOrigin : null;
}

export async function runCli(argv: string[], io: CliIo = {}): Promise<number> {
	const prevCliMode = process.env.IZGAH_CLI_MODE;
	process.env.IZGAH_CLI_MODE = '1';
	try {
		return await executeCliCommand(argv, io);
	} finally {
		if (prevCliMode === undefined) {
			delete process.env.IZGAH_CLI_MODE;
		} else {
			process.env.IZGAH_CLI_MODE = prevCliMode;
		}
	}
}

async function executeCliCommand(argv: string[], io: CliIo = {}): Promise<number> {
	const stdout = io.stdout ?? ((text: string) => process.stdout.write(text));
	const stderr = io.stderr ?? ((text: string) => process.stderr.write(text));
	const originOverride = resolveCliOrigin(io.originOverride);

	const [command, ...restArgs] = argv;
	if (!command || command === '--help' || command === '-h') {
		stdout(CLI_USAGE);
		return command ? 0 : 1;
	}

	if (command !== 'create-admin' && command !== 'reset-admin') {
		stderr(`Bilinmeyen komut: "${command}"\n${CLI_USAGE}`);
		return 1;
	}

	let parsedValues: { email?: string; name?: string };
	try {
		const parsed = parseArgs({
			args: restArgs,
			options: {
				email: { type: 'string' },
				name: { type: 'string' }
			},
			allowPositionals: false,
			strict: true
		});
		parsedValues = parsed.values;
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Invalid command arguments.';
		stderr(`${message}\n${CLI_USAGE}`);
		return 1;
	}

	const emailParsed = emailSchema.safeParse(parsedValues.email ?? '');
	if (!emailParsed.success) {
		stderr('A valid --email value is required.\n');
		return 1;
	}
	const normalizedEmail = emailParsed.data.toLowerCase();

	if (command === 'create-admin') {
		const trimmedName = (parsedValues.name ?? '').trim();
		if (trimmedName.length < 2 || trimmedName.length > CLI_DISPLAY_NAME_MAX_LENGTH) {
			stderr(`--name must be 2–${CLI_DISPLAY_NAME_MAX_LENGTH} characters long.\n`);
			return 1;
		}

		try {
			const { db, users, createInviteToken, recordAuditLog } = await loadServerDeps();
			const result = await db.transaction(async (tx) => {
				const [existing] = await tx
					.select({ id: users.id })
					.from(users)
					.where(eq(users.email, normalizedEmail))
					.limit(1);

				if (existing) {
					return { conflict: true as const };
				}

				const [createdUser] = await tx
					.insert(users)
					.values({
						name: trimmedName,
						email: normalizedEmail,
						role: 'admin',
						isActive: true
					})
					.returning({ id: users.id, email: users.email, name: users.name });

				const invite = await createInviteToken(createdUser.id, 'invite', null, {
					tx,
					originOverride
				});

				await recordAuditLog(
					{
						actorUserId: null,
						action: 'cli.create_admin',
						targetType: 'user',
						targetId: createdUser.id,
						metadata: { email: createdUser.email, name: createdUser.name }
					},
					tx
				);

				return { conflict: false as const, url: invite.url };
			});

			if (result.conflict) {
				stderr(
					`Error: "${normalizedEmail}" is already registered. Use reset-admin to recover it.\n`
				);
				return 1;
			}

			stdout(`One-time admin invite link (valid for 24 hours):\n${result.url}\n`);
			return 0;
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Bilinmeyen hata';
			stderr(`create-admin failed: ${message}\n`);
			return 1;
		}
	}

	// command === 'reset-admin'
	try {
		const { db, users, apiKeys, createInviteToken, recordAuditLog } = await loadServerDeps();
		const result = await db.transaction(async (tx) => {
			const [userRow] = await tx
				.select({
					id: users.id,
					email: users.email,
					role: users.role,
					isActive: users.isActive
				})
				.from(users)
				.where(eq(users.email, normalizedEmail))
				.limit(1)
				.for('update');

			if (!userRow) {
				return { error: `Error: no user found with "${normalizedEmail}".` };
			}
			if (userRow.role !== 'admin') {
				return { error: 'Error: only admin accounts can be reset with the CLI.' };
			}
			if (!userRow.isActive) {
				return { error: 'Error: a deactivated admin account cannot be reset.' };
			}

			await tx
				.update(users)
				.set({
					authVersion: sql`${users.authVersion} + 1`,
					updatedAt: sql`now()`
				})
				.where(eq(users.id, userRow.id));

			await tx
				.update(apiKeys)
				.set({ revokedAt: sql`now()` })
				.where(and(eq(apiKeys.userId, userRow.id), isNull(apiKeys.revokedAt)));

			const resetToken = await createInviteToken(userRow.id, 'password_reset', null, {
				tx,
				originOverride
			});

			await recordAuditLog(
				{
					actorUserId: null,
					action: 'cli.reset_admin',
					targetType: 'user',
					targetId: userRow.id,
					metadata: { email: userRow.email }
				},
				tx
			);

			return { url: resetToken.url };
		});

		if ('error' in result) {
			stderr(`${result.error}\n`);
			return 1;
		}

		stdout(`One-time admin password reset link (valid for 24 hours):\n${result.url}\n`);
		return 0;
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Bilinmeyen hata';
		stderr(`reset-admin failed: ${message}\n`);
		return 1;
	}
}

async function closeLoadedDb(): Promise<void> {
	if (!dbClientPromise) {
		return;
	}
	const { closeDb } = await dbClientPromise;
	await closeDb();
}

const currentFilePath = fileURLToPath(import.meta.url);
const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';

if (invokedPath === currentFilePath) {
	if (fs.existsSync('.env')) {
		process.loadEnvFile('.env');
	}
	runCli(process.argv.slice(2))
		.then(async (exitCode) => {
			await closeLoadedDb();
			process.exit(exitCode);
		})
		.catch(async (error: unknown) => {
			const message = error instanceof Error ? error.message : 'The CLI could not run.';
			process.stderr.write(`${message}\n`);
			await closeLoadedDb().catch(() => {});
			process.exit(1);
		});
}
