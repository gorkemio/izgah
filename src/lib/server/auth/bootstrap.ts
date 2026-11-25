import { and, eq, isNull, sql } from 'drizzle-orm';
import { recordAuditLog } from '$lib/server/audit';
import { db } from '$lib/server/db/client';
import { apiKeys, users } from '$lib/server/db/schema';
import { env } from '$lib/server/env';
import { logger, type Logger } from '$lib/server/logger';
import { createInviteToken } from './tokens';

export const BOOTSTRAP_ADVISORY_LOCK_ID = 74829105;

export type BootstrapResult =
	| { status: 'already_initialized' }
	| { status: 'missing_bootstrap_email' }
	| {
			status: 'bootstrapped';
			userId: string;
			email: string;
			setupUrl: string;
			expiresAt: Date;
	  };

/**
 * Ensures an initial admin setup invite exists when the database has zero active admins.
 */
export async function ensureInitialAdminBootstrap(options?: {
	bootstrapEmail?: string | null;
	originOverride?: string | null;
	log?: Logger;
}): Promise<BootstrapResult> {
	const log = options?.log ?? logger;

	return db.transaction(async (tx) => {
		await tx.execute(sql`SELECT pg_advisory_xact_lock(${BOOTSTRAP_ADVISORY_LOCK_ID})`);

		const [existingAdmin] = await tx
			.select({ id: users.id })
			.from(users)
			.where(and(eq(users.role, 'admin'), eq(users.isActive, true)))
			.limit(1);

		if (existingAdmin) {
			return { status: 'already_initialized' as const };
		}

		const rawEmail =
			options?.bootstrapEmail !== undefined ? options.bootstrapEmail : env.ADMIN_BOOTSTRAP_EMAIL;
		const bootstrapEmail = rawEmail?.trim().toLowerCase();

		if (!bootstrapEmail) {
			log.warn(
				'No active admin found and ADMIN_BOOTSTRAP_EMAIL is not set; create the first admin via CLI',
				{
					command: 'node build/cli.js create-admin --email <email> --name <name>'
				}
			);
			return { status: 'missing_bootstrap_email' as const };
		}

		const [existingUser] = await tx
			.select({ id: users.id })
			.from(users)
			.where(eq(users.email, bootstrapEmail))
			.limit(1);

		const [adminUser] = existingUser
			? await tx
					.update(users)
					.set({
						role: 'admin',
						isActive: true,
						disabledAt: null,
						authVersion: sql`${users.authVersion} + 1`,
						updatedAt: sql`now()`
					})
					.where(eq(users.id, existingUser.id))
					.returning({ id: users.id, email: users.email })
			: await tx
					.insert(users)
					.values({
						name: 'Admin',
						email: bootstrapEmail,
						role: 'admin',
						isActive: true
					})
					.returning({ id: users.id, email: users.email });

		if (existingUser) {
			await tx
				.update(apiKeys)
				.set({ revokedAt: sql`now()` })
				.where(and(eq(apiKeys.userId, existingUser.id), isNull(apiKeys.revokedAt)));
		}

		const invite = await createInviteToken(adminUser.id, 'invite', null, {
			tx,
			originOverride: options?.originOverride
		});

		await recordAuditLog(
			{
				actorUserId: null,
				action: 'admin.bootstrap',
				targetType: 'user',
				targetId: adminUser.id,
				metadata: { email: adminUser.email }
			},
			tx
		);

		log.info('Initial admin bootstrap invite created', {
			email: adminUser.email,
			setupUrl: invite.url,
			expiresAt: invite.expiresAt.toISOString()
		});

		return {
			status: 'bootstrapped' as const,
			userId: adminUser.id,
			email: adminUser.email,
			setupUrl: invite.url,
			expiresAt: invite.expiresAt
		};
	});
}
