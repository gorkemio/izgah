import { db, type Database } from '$lib/server/db/client';
import { auditLogs } from '$lib/server/db/schema';

export const ADMIN_AUDIT_ACTIONS = [
	'admin.user_invited',
	'admin.user_invite_regenerated',
	'admin.password_reset_issued',
	'admin.user_role_changed',
	'admin.user_disabled',
	'admin.section_created',
	'admin.section_updated',
	'admin.section_reordered',
	'admin.section_deleted',
	'admin.section_silent_shares_resolved',
	'admin.unassigned_shares_assigned',
	'admin.unfurl_job_retried',
	'admin.unfurl_jobs_retried_all'
] as const;

export const KNOWN_SYSTEM_AUDIT_ACTIONS = [
	'admin.bootstrap',
	'cli.create_admin',
	'cli.reset_admin',
	'user.invite_accepted',
	'user.password_reset_completed',
	'user.password_changed',
	'api_key.created',
	'api_key.revoked'
] as const;

export type AdminAuditAction = (typeof ADMIN_AUDIT_ACTIONS)[number];
export type KnownAuditAction = AdminAuditAction | (typeof KNOWN_SYSTEM_AUDIT_ACTIONS)[number];

export const KNOWN_AUDIT_ACTIONS: readonly KnownAuditAction[] = [
	...ADMIN_AUDIT_ACTIONS,
	...KNOWN_SYSTEM_AUDIT_ACTIONS
];

const KNOWN_AUDIT_ACTION_SET = new Set<string>(KNOWN_AUDIT_ACTIONS);

export interface RecordAuditLogInput {
	actorUserId?: string | null;
	action: KnownAuditAction;
	targetType: string;
	targetId?: string | null;
	metadata?: Record<string, unknown> | null;
	requestId?: string | null;
}

export async function recordAuditLog(
	input: RecordAuditLogInput,
	executor: Pick<Database, 'insert'> = db
) {
	if (!KNOWN_AUDIT_ACTION_SET.has(input.action)) {
		throw new Error(`Unknown audit log action: ${input.action}`);
	}

	const [entry] = await executor
		.insert(auditLogs)
		.values({
			actorUserId: input.actorUserId ?? null,
			action: input.action,
			targetType: input.targetType,
			targetId: input.targetId ?? null,
			metadata: input.metadata ?? null,
			requestId: input.requestId ?? null
		})
		.returning();

	return entry;
}
