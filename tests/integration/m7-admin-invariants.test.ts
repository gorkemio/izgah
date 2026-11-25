import crypto from 'node:crypto';
import type { Cookies, RequestEvent } from '@sveltejs/kit';
import { isHttpError } from '@sveltejs/kit';
import { makeSignature } from 'better-auth/crypto';
import { desc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { handle } from '../../src/hooks.server';
import {
	AdminServiceError,
	bulkAssignSharesToSections,
	changeAdminUserRole,
	createAdminSection,
	deleteAdminSection,
	disableAdminUser,
	getAdminUsageMetrics,
	inviteAdminUser,
	issuePasswordResetLink,
	listAuditLogs,
	listUnassignedShares,
	moveAdminSection,
	regenerateUserInvite,
	resolveSectionSilentShares,
	retryAllDeadUnfurlJobs,
	retryDeadUnfurlJob,
	slugifySectionName
} from '../../src/lib/server/admin/service';
import { createApiKey } from '../../src/lib/server/auth/api-keys';
import { resetRateLimiters } from '../../src/lib/server/auth/rate-limit';
import { env } from '../../src/lib/server/env';
import { closeDb } from '../../src/lib/server/db/client';
import {
	apiKeys,
	auditLogs,
	canonicalResources,
	linkShareSections,
	linkShares,
	resourceComments,
	searchLogs,
	sections,
	sessions,
	unfurlJobs,
	users,
	type UserRole
} from '../../src/lib/server/db/schema';
import { load as adminLayoutLoad } from '../../src/routes/(app)/admin/+layout.server';
import { load as auditLoad } from '../../src/routes/(app)/admin/audit/+page.server';
import {
	actions as jobActions,
	load as jobsLoad
} from '../../src/routes/(app)/admin/jobs/+page.server';
import { load as metricsLoad } from '../../src/routes/(app)/admin/metrics/+page.server';
import {
	actions as sectionActions,
	load as sectionsLoad
} from '../../src/routes/(app)/admin/sections/+page.server';
import {
	actions as unassignedActions,
	load as unassignedLoad
} from '../../src/routes/(app)/admin/unassigned/+page.server';
import {
	actions as userActions,
	load as usersLoad
} from '../../src/routes/(app)/admin/users/+page.server';
import { GET as meGet } from '../../src/routes/api/v1/me/+server';
import { closeTestDb, migrateTestDb, resetTestDb, testDb } from '../setup/db';

const { notifyWorkerSpy } = vi.hoisted(() => ({
	notifyWorkerSpy: vi.fn()
}));

vi.mock('../../src/lib/server/unfurl/worker', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../src/lib/server/unfurl/worker')>();
	return {
		...actual,
		notifyUnfurlWorker: () => {
			notifyWorkerSpy();
		}
	};
});

function createMockCookies(initialCookieHeader?: string): Cookies {
	const store = new Map<string, string>();
	if (initialCookieHeader) {
		for (const part of initialCookieHeader.split(';')) {
			const idx = part.indexOf('=');
			if (idx === -1) {
				continue;
			}
			const name = part.slice(0, idx).trim();
			const value = part.slice(idx + 1).trim();
			if (name) {
				try {
					store.set(name, decodeURIComponent(value));
				} catch {
					store.set(name, value);
				}
			}
		}
	}

	return {
		get(name) {
			return store.get(name);
		},
		getAll() {
			return Array.from(store.entries()).map(([name, value]) => ({ name, value }));
		},
		set(name, value) {
			store.set(name, value);
		},
		delete(name) {
			store.delete(name);
		},
		parse: (() => {
			throw new Error('cookies.parse is not used in tests');
		}) as never,
		serialize(name, value) {
			return `${name}=${encodeURIComponent(value)}`;
		}
	};
}

function createMockEvent(options: {
	url: string;
	method?: string;
	headers?: Record<string, string>;
	body?: string;
	formData?: FormData;
	user?: NonNullable<App.Locals['user']> | null;
}): RequestEvent {
	const headers = new Headers(options.headers ?? {});
	let request: Request;

	if (options.formData) {
		request = new Request(options.url, {
			method: options.method ?? 'POST',
			headers,
			body: options.formData
		});
	} else {
		request = new Request(options.url, {
			method: options.method ?? 'GET',
			headers,
			body: options.body
		});
	}

	const urlObj = new URL(options.url);
	return {
		request,
		url: urlObj,
		params: {},
		route: { id: urlObj.pathname },
		cookies: createMockCookies(headers.get('cookie') ?? undefined),
		locals: {
			requestId: 'req-m7-test',
			user: options.user ?? null,
			session: null,
			authChannel: options.user ? 'web' : null,
			apiKeyId: null
		},
		platform: undefined,
		isDataRequest: false,
		isSubRequest: false,
		fetch: globalThis.fetch,
		getClientAddress: () => '127.0.0.1',
		setHeaders: () => {},
		depends: () => {},
		parent: async () => ({}),
		untrack: <T>(fn: () => T) => fn()
	} as unknown as RequestEvent;
}

async function seedUser(options: {
	name: string;
	email: string;
	role?: UserRole;
	isActive?: boolean;
	emailVerified?: boolean;
	authVersion?: number;
}) {
	const [created] = await testDb
		.insert(users)
		.values({
			name: options.name,
			email: options.email.toLowerCase(),
			role: options.role ?? 'member',
			isActive: options.isActive ?? true,
			emailVerified: options.emailVerified ?? true,
			authVersion: options.authVersion ?? 1
		})
		.returning();
	return created;
}

async function createSignedSessionCookieHeader(
	userId: string,
	userAuthVersion = 1
): Promise<string> {
	const sessionToken = crypto.randomBytes(32).toString('base64url');
	await testDb.insert(sessions).values({
		token: sessionToken,
		userId,
		expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
		userAuthVersion
	});
	const sig = await makeSignature(sessionToken, env.BETTER_AUTH_SECRET);
	return `better-auth.session_token=${encodeURIComponent(`${sessionToken}.${sig}`)}`;
}

async function seedResourceAndShare(options: {
	url: string;
	domain?: string;
	title?: string;
	authorId: string;
	sectionIds?: string[];
	isFeedVisible?: boolean;
	sourceChannel?: 'web' | 'api';
	createdAt?: Date;
}) {
	const now = options.createdAt ?? new Date();
	return testDb.transaction(async (tx) => {
		const [resource] = await tx
			.insert(canonicalResources)
			.values({
				canonicalUrl: options.url,
				domain: options.domain ?? new URL(options.url).hostname,
				title: options.title ?? 'Örnek Kaynak',
				unfurlStatus: 'ready',
				createdAt: now,
				updatedAt: now
			})
			.returning();

		const [share] = await tx
			.insert(linkShares)
			.values({
				resourceId: resource.id,
				authorId: options.authorId,
				rawUrl: options.url,
				note: 'Test paylaşımı',
				isFeedVisible: options.isFeedVisible ?? true,
				sourceChannel: options.sourceChannel ?? 'web',
				createdAt: now,
				updatedAt: now
			})
			.returning();

		if (options.sectionIds && options.sectionIds.length > 0) {
			await tx
				.insert(linkShareSections)
				.values(options.sectionIds.map((sectionId) => ({ shareId: share.id, sectionId })));
		}

		return { resource, share };
	});
}

describe('Milestone M7 — Admin Panel, Audit Logs & SQL Metrics Invariants', () => {
	beforeAll(async () => {
		await migrateTestDb();
	});

	beforeEach(async () => {
		await resetTestDb();
		resetRateLimiters();
		notifyWorkerSpy.mockClear();
	});

	afterAll(async () => {
		await closeDb();
		await closeTestDb();
	});

	it('enforces 403 defense-in-depth across hooks, admin layout, every load, and every form action', async () => {
		const member = await seedUser({
			name: 'Normal Üye',
			email: 'member-guard@izgah.test',
			role: 'member'
		});
		const memberCookie = await createSignedSessionCookieHeader(member.id, 1);

		for (const adminPath of [
			'/admin/users',
			'/admin/sections',
			'/admin/unassigned',
			'/admin/jobs',
			'/admin/audit',
			'/admin/metrics'
		]) {
			const res = await handle({
				event: createMockEvent({
					url: `http://127.0.0.1:4173${adminPath}`,
					headers: { cookie: memberCookie }
				}),
				resolve: async () => new Response('ok', { status: 200 })
			});
			expect(res.status).toBe(403);
			const body = (await res.json()) as { error: { code: string } };
			expect(body.error.code).toBe('FORBIDDEN');
		}

		const memberLocalsUser = {
			id: member.id,
			name: member.name,
			email: member.email,
			role: 'member' as const,
			authVersion: 1
		};

		const loadCalls: Array<() => unknown> = [
			() =>
				adminLayoutLoad(
					createMockEvent({ url: 'http://127.0.0.1/admin', user: memberLocalsUser }) as never
				),
			() =>
				usersLoad(
					createMockEvent({ url: 'http://127.0.0.1/admin/users', user: memberLocalsUser }) as never
				),
			() =>
				sectionsLoad(
					createMockEvent({
						url: 'http://127.0.0.1/admin/sections',
						user: memberLocalsUser
					}) as never
				),
			() =>
				unassignedLoad(
					createMockEvent({
						url: 'http://127.0.0.1/admin/unassigned',
						user: memberLocalsUser
					}) as never
				),
			() =>
				jobsLoad(
					createMockEvent({ url: 'http://127.0.0.1/admin/jobs', user: memberLocalsUser }) as never
				),
			() =>
				auditLoad(
					createMockEvent({ url: 'http://127.0.0.1/admin/audit', user: memberLocalsUser }) as never
				),
			() =>
				metricsLoad(
					createMockEvent({
						url: 'http://127.0.0.1/admin/metrics',
						user: memberLocalsUser
					}) as never
				)
		];

		for (const invokeLoad of loadCalls) {
			let caught: unknown = null;
			try {
				await Promise.resolve(invokeLoad());
			} catch (err) {
				caught = err;
			}
			expect(isHttpError(caught, 403)).toBe(true);
		}

		const emptyForm = new FormData();
		const actionCalls = [
			userActions.invite,
			userActions.regenerateInvite,
			userActions.resetPassword,
			userActions.changeRole,
			userActions.disable,
			sectionActions.create,
			sectionActions.update,
			sectionActions.move,
			sectionActions.delete,
			sectionActions.resolveSilentShares,
			unassignedActions.assign,
			jobActions.retry,
			jobActions.retryAll
		];

		for (const actionFn of actionCalls) {
			let caught: unknown = null;
			try {
				await actionFn(
					createMockEvent({
						url: 'http://127.0.0.1/admin',
						method: 'POST',
						formData: emptyForm,
						user: memberLocalsUser
					}) as never
				);
			} catch (err) {
				caught = err;
			}
			expect(isHttpError(caught, 403)).toBe(true);
		}
	});

	it('prevents concurrent demotion or disabling of the last active admin using row locks', async () => {
		const adminA = await seedUser({
			name: 'Admin Bir',
			email: 'admin-a@izgah.test',
			role: 'admin'
		});
		const adminB = await seedUser({
			name: 'Admin İki',
			email: 'admin-b@izgah.test',
			role: 'admin'
		});
		await seedUser({
			name: 'Pasif Eski Admin',
			email: 'inactive-admin@izgah.test',
			role: 'admin',
			isActive: false
		});

		const concurrentDisable = await Promise.allSettled([
			disableAdminUser(adminA.id, adminB.id),
			disableAdminUser(adminB.id, adminA.id)
		]);

		const fulfilledCount = concurrentDisable.filter((r) => r.status === 'fulfilled').length;
		expect(fulfilledCount).toBe(1);

		const remainingActiveAdmins = await testDb.query.users.findMany({
			where: (t, { and: andOp, eq: eqOp }) => andOp(eqOp(t.role, 'admin'), eqOp(t.isActive, true))
		});
		expect(remainingActiveAdmins).toHaveLength(1);

		const soleAdmin = remainingActiveAdmins[0];
		await expect(
			changeAdminUserRole({ targetUserId: soleAdmin.id, newRole: 'member' }, soleAdmin.id)
		).rejects.toMatchObject({ status: 409, code: 'LAST_ACTIVE_ADMIN' });

		await expect(disableAdminUser(soleAdmin.id, soleAdmin.id)).rejects.toMatchObject({
			status: 409,
			code: 'LAST_ACTIVE_ADMIN'
		});
	});

	it('invites, resets passwords without logging plaintext tokens, and disables users with immediate 401 API rejection while keeping content archive', async () => {
		const admin = await seedUser({
			name: 'Baş Yönetici',
			email: 'boss@izgah.test',
			role: 'admin'
		});

		const invited = await inviteAdminUser(
			{
				name: 'Yeni Üye',
				email: 'Yeni.Uye@Izgah.Test',
				role: 'member',
				originOverride: 'http://127.0.0.1:4173'
			},
			admin.id,
			'req-invite-1'
		);

		expect(invited.user.email).toBe('yeni.uye@izgah.test');
		expect(invited.invite.url).toContain('/auth/accept-invite?token=');

		const inviteUrlToken = new URL(invited.invite.url).searchParams.get('token')!;
		expect(inviteUrlToken.length).toBeGreaterThan(20);

		await expect(
			inviteAdminUser({ name: 'Yinelenen', email: 'yeni.uye@izgah.test', role: 'member' }, admin.id)
		).rejects.toMatchObject({ status: 409, code: 'USER_EMAIL_EXISTS' });

		const regenerated = await regenerateUserInvite(
			invited.user.id,
			admin.id,
			'req-regen-1',
			'http://127.0.0.1:4173'
		);
		const regenToken = new URL(regenerated.invite.url).searchParams.get('token')!;
		expect(regenToken).not.toBe(inviteUrlToken);

		// Mark user as verified and give them a web session, an API key, a share, and a comment
		await testDb.update(users).set({ emailVerified: true }).where(eq(users.id, invited.user.id));

		await testDb.insert(sessions).values({
			token: 'preserved-session-token-m7',
			userId: invited.user.id,
			expiresAt: new Date(Date.now() + 3600_000),
			userAuthVersion: 1
		});

		const keyBeforeReset = await createApiKey(invited.user.id, 'Eklenti 1');
		const resetIssued = await issuePasswordResetLink(
			invited.user.id,
			admin.id,
			'req-reset-1',
			'http://127.0.0.1:4173'
		);
		const resetToken = new URL(resetIssued.reset.url).searchParams.get('token')!;
		expect(resetToken.length).toBeGreaterThan(20);

		// Existing API key was invalidated by resetPassword bump & revocation
		const keyAfterReset = await testDb.query.apiKeys.findFirst({
			where: eq(apiKeys.id, keyBeforeReset.id)
		});
		expect(keyAfterReset?.revokedAt).not.toBeNull();

		// Role change member <-> admin
		const roleChanged = await changeAdminUserRole(
			{ targetUserId: invited.user.id, newRole: 'admin' },
			admin.id
		);
		expect(roleChanged.changed).toBe(true);
		const demoted = await changeAdminUserRole(
			{ targetUserId: invited.user.id, newRole: 'member' },
			admin.id
		);
		expect(demoted.user.role).toBe('member');

		// Create new API key after reset + historical share & comment
		const activeApiKey = await createApiKey(invited.user.id, 'Chrome Eklenti');
		const { resource, share } = await seedResourceAndShare({
			url: 'https://example.com/archive-kept',
			authorId: invited.user.id
		});
		await testDb.insert(resourceComments).values({
			resourceId: resource.id,
			authorId: invited.user.id,
			body: 'Arşivde kalacak yorum'
		});

		const activeMeRes = await handle({
			event: createMockEvent({
				url: 'http://127.0.0.1:4173/api/v1/me',
				headers: { authorization: `Bearer ${activeApiKey.rawKey}` }
			}),
			resolve: async (ev) => meGet(ev as never)
		});
		expect(activeMeRes.status).toBe(200);

		// Disable user
		const disabledResult = await disableAdminUser(invited.user.id, admin.id, 'req-disable-1');
		expect(disabledResult.revokedApiKeyCount).toBe(1);

		// Archive preserved
		const archivedShare = await testDb.query.linkShares.findFirst({
			where: eq(linkShares.id, share.id)
		});
		const archivedComment = await testDb.query.resourceComments.findFirst({
			where: eq(resourceComments.authorId, invited.user.id)
		});
		expect(archivedShare?.deletedAt).toBeNull();
		expect(archivedComment?.deletedAt).toBeNull();

		// API key returns 401 immediately
		const disabledMeRes = await handle({
			event: createMockEvent({
				url: 'http://127.0.0.1:4173/api/v1/me',
				headers: { authorization: `Bearer ${activeApiKey.rawKey}` }
			}),
			resolve: async (ev) => meGet(ev as never)
		});
		expect(disabledMeRes.status).toBe(401);

		// Preserved web session cookie returns 401 (never 303 anonymous redirect)
		const staleCookieSig = await makeSignature(
			'preserved-session-token-m7',
			env.BETTER_AUTH_SECRET
		);
		const disabledWebRes = await handle({
			event: createMockEvent({
				url: 'http://127.0.0.1:4173/',
				headers: {
					cookie: `better-auth.session_token=${encodeURIComponent(`preserved-session-token-m7.${staleCookieSig}`)}`
				}
			}),
			resolve: async () => new Response('ok', { status: 200 })
		});
		expect(disabledWebRes.status).toBe(401);

		// Open invite/reset tokens revoked
		const openTokens = await testDb.query.inviteTokens.findMany({
			where: (t, { and: andOp, eq: eqOp, isNull }) =>
				andOp(eqOp(t.userId, invited.user.id), isNull(t.revokedAt), isNull(t.consumedAt))
		});
		expect(openTokens).toHaveLength(0);

		// Ensure no plaintext token or URL with ?token= ever leaked into audit_logs
		const logs = await testDb.select().from(auditLogs);
		expect(logs.length).toBeGreaterThanOrEqual(5);
		const serializedLogs = JSON.stringify(logs);
		expect(serializedLogs).not.toContain(inviteUrlToken);
		expect(serializedLogs).not.toContain(regenToken);
		expect(serializedLogs).not.toContain(resetToken);
		expect(serializedLogs).not.toContain('?token=');
	});

	it('handles Turkish section slugs, reordering, cascade deletion vs exclusive silent 409 conflict, and unassigned bulk assignment', async () => {
		expect(slugifySectionName('Yapay Zekâ & Öğrenme — Çığır İstatistikleri')).toBe(
			'yapay-zeka-ogrenme-cigir-istatistikleri'
		);

		const admin = await seedUser({
			name: 'Bölüm Yöneticisi',
			email: 'secadmin@izgah.test',
			role: 'admin'
		});
		const secA = await createAdminSection({ name: 'İlk Bölüm' }, admin.id);
		const secB = await createAdminSection({ name: 'İkinci Bölüm' }, admin.id);
		const secC = await createAdminSection({ name: 'Üçüncü Bölüm' }, admin.id);

		const movedUp = await moveAdminSection(secC.id, 'up', admin.id);
		expect(movedUp.orderedSectionIds).toEqual([secA.id, secC.id, secB.id]);

		// Exclusive silent share in secB blocks deletion
		await seedResourceAndShare({
			url: 'https://example.com/silent-exclusive',
			authorId: admin.id,
			sectionIds: [secB.id],
			isFeedVisible: false
		});

		// Regular feed share in secB survives deletion into unassigned pool
		const { share: feedOnlyShare } = await seedResourceAndShare({
			url: 'https://example.com/feed-regular',
			authorId: admin.id,
			sectionIds: [secB.id],
			isFeedVisible: true
		});

		let conflictError: unknown = null;
		try {
			await deleteAdminSection(secB.id, admin.id);
		} catch (err) {
			conflictError = err;
		}
		expect(conflictError).toBeInstanceOf(AdminServiceError);
		expect((conflictError as AdminServiceError).status).toBe(409);
		expect((conflictError as AdminServiceError).code).toBe('SECTION_HAS_EXCLUSIVE_SILENT_SHARES');

		// Resolve exclusive silent share by moving to secA cleanly across deferred constraint trigger
		const resolved = await resolveSectionSilentShares(
			{ sourceSectionId: secB.id, mode: 'move', targetSectionId: secA.id },
			admin.id
		);
		expect(resolved.affectedShareCount).toBe(1);

		const deleted = await deleteAdminSection(secB.id, admin.id);
		expect(deleted.deletedSectionId).toBe(secB.id);

		// feedOnlyShare now appears in unassigned shares list
		const unassigned = await listUnassignedShares();
		expect(unassigned.items.map((item) => item.id)).toContain(feedOnlyShare.id);

		const bulkResult = await bulkAssignSharesToSections(
			{ shareIds: [feedOnlyShare.id], sectionIds: [secA.id, secC.id] },
			admin.id
		);
		expect(bulkResult.assignedShareCount).toBe(1);
		expect(bulkResult.sectionCount).toBe(2);

		const unassignedAfter = await listUnassignedShares();
		expect(unassignedAfter.items).toHaveLength(0);
	});

	it('retries dead unfurl jobs, wakes the worker, paginates audit logs at 50/page, and computes pure SQL 7d/30d metrics', async () => {
		const admin = await seedUser({
			name: 'Operasyon Admini',
			email: 'ops@izgah.test',
			role: 'admin'
		});
		const member2 = await seedUser({ name: 'Üye İki', email: 'm2@izgah.test', role: 'member' });
		const member3 = await seedUser({ name: 'Üye Üç', email: 'm3@izgah.test', role: 'member' });

		const [resDead1] = await testDb
			.insert(canonicalResources)
			.values({
				canonicalUrl: 'https://dead1.example/article',
				domain: 'dead1.example',
				unfurlStatus: 'failed'
			})
			.returning();
		const [resDead2] = await testDb
			.insert(canonicalResources)
			.values({
				canonicalUrl: 'https://dead2.example/article',
				domain: 'dead2.example',
				unfurlStatus: 'failed'
			})
			.returning();

		const [deadJob1] = await testDb
			.insert(unfurlJobs)
			.values({
				resourceId: resDead1.id,
				targetUrl: resDead1.canonicalUrl,
				status: 'dead',
				attempts: 5,
				lockedUntil: new Date(Date.now() + 60_000),
				lockToken: 'stale-lock-token',
				lastErrorCode: 'HTTP_502',
				lastErrorMessage: 'Bad gateway'
			})
			.returning();

		const [deadJob2] = await testDb
			.insert(unfurlJobs)
			.values({
				resourceId: resDead2.id,
				targetUrl: resDead2.canonicalUrl,
				status: 'dead',
				attempts: 4,
				lastErrorCode: 'TIMEOUT',
				lastErrorMessage: 'Timed out'
			})
			.returning();

		await retryDeadUnfurlJob(deadJob1.id, admin.id);
		expect(notifyWorkerSpy).toHaveBeenCalledTimes(1);

		const refreshedJob1 = await testDb.query.unfurlJobs.findFirst({
			where: eq(unfurlJobs.id, deadJob1.id)
		});
		const refreshedRes1 = await testDb.query.canonicalResources.findFirst({
			where: eq(canonicalResources.id, resDead1.id)
		});
		expect(refreshedJob1?.status).toBe('queued');
		expect(refreshedJob1?.attempts).toBe(0);
		expect(refreshedJob1?.lockToken).toBeNull();
		expect(refreshedJob1?.lastErrorCode).toBeNull();
		expect(refreshedRes1?.unfurlStatus).toBe('queued');

		const retriedAll = await retryAllDeadUnfurlJobs(admin.id);
		expect(retriedAll.retriedCount).toBe(1);
		expect(retriedAll.retriedJobIds).toEqual([deadJob2.id]);
		expect(notifyWorkerSpy).toHaveBeenCalledTimes(2);

		// Audit pagination: insert 65 audit rows
		const baseTime = Date.now() - 100_000;
		await testDb.insert(auditLogs).values(
			Array.from({ length: 65 }, (_, index) => ({
				actorUserId: admin.id,
				action: index % 2 === 0 ? 'admin.section_created' : 'admin.user_invited',
				targetType: 'test',
				targetId: `target-${String(index).padStart(2, '0')}`,
				createdAt: new Date(baseTime + index * 1000)
			}))
		);

		const page1 = await listAuditLogs();
		expect(page1.items).toHaveLength(50);
		expect(page1.nextCursor).not.toBeNull();

		const page2 = await listAuditLogs({ cursor: page1.nextCursor });
		expect(page2.items.length).toBeGreaterThanOrEqual(17);
		expect(page2.nextCursor).toBeNull();

		const filtered = await listAuditLogs({ action: 'admin.unfurl_job_retried' });
		expect(filtered.items).toHaveLength(1);

		// SQL Metrics check (rolling 7d vs 30d)
		const now = new Date();
		const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000);
		const sec = await testDb
			.insert(sections)
			.values({
				slug: 'metrik-bolum',
				name: 'Metrik Bölüm',
				createdById: admin.id
			})
			.returning();

		// 3 shares inside 7d (2 web by admin, 1 api by member2)
		await seedResourceAndShare({
			url: 'https://metrics.example/w1',
			authorId: admin.id,
			sectionIds: [sec[0].id],
			sourceChannel: 'web',
			createdAt: daysAgo(1)
		});
		await seedResourceAndShare({
			url: 'https://metrics.example/w2',
			authorId: admin.id,
			sourceChannel: 'web',
			createdAt: daysAgo(2)
		});
		await seedResourceAndShare({
			url: 'https://metrics.example/a1',
			authorId: member2.id,
			sourceChannel: 'api',
			createdAt: daysAgo(3)
		});
		// 1 share 15 days ago (only 30d window)
		await seedResourceAndShare({
			url: 'https://metrics.example/a15',
			authorId: member3.id,
			sourceChannel: 'api',
			createdAt: daysAgo(15)
		});
		// 1 share 45 days ago (neither window)
		await seedResourceAndShare({
			url: 'https://metrics.example/w45',
			authorId: member3.id,
			sourceChannel: 'web',
			createdAt: daysAgo(45)
		});

		await testDb.insert(searchLogs).values([
			{ userId: member3.id, sectionId: sec[0].id, resultCount: 0, createdAt: daysAgo(2) },
			{ userId: admin.id, sectionId: null, resultCount: 4, createdAt: daysAgo(2) },
			{ userId: member2.id, sectionId: null, resultCount: 0, createdAt: daysAgo(18) },
			{ userId: member2.id, sectionId: null, resultCount: 0, createdAt: daysAgo(50) }
		]);

		const metrics = await getAdminUsageMetrics(now);
		expect(metrics.totals.activeUsers).toBe(3);

		// 7d window: shares = 3 (2 web, 1 api); sharers = 2 (admin, member2); searchers = 2 (admin, member3); union = 3
		expect(metrics.windows.days7.totalShares).toBe(3);
		expect(metrics.windows.days7.webShares).toBe(2);
		expect(metrics.windows.days7.apiShares).toBe(1);
		expect(metrics.windows.days7.activeSharingUsers).toBe(2);
		expect(metrics.windows.days7.activeSearchingUsers).toBe(2);
		expect(metrics.windows.days7.activeUnionUsers).toBe(3);
		expect(metrics.windows.days7.totalSearches).toBe(2);
		expect(metrics.windows.days7.zeroResultSearches).toBe(1);
		expect(metrics.windows.days7.zeroResultSearchRate).toBeCloseTo(0.5);

		// 30d window: shares = 4 (2 web, 2 api); sharers = 3; searches = 3; zero = 2
		expect(metrics.windows.days30.totalShares).toBe(4);
		expect(metrics.windows.days30.webShares).toBe(2);
		expect(metrics.windows.days30.apiShares).toBe(2);
		expect(metrics.windows.days30.webShareRatio).toBeCloseTo(0.5);
		expect(metrics.windows.days30.apiShareRatio).toBeCloseTo(0.5);
		expect(metrics.windows.days30.totalSearches).toBe(3);
		expect(metrics.windows.days30.zeroResultSearches).toBe(2);

		const latestAudit = await testDb
			.select()
			.from(auditLogs)
			.orderBy(desc(auditLogs.createdAt))
			.limit(1);
		expect(latestAudit).toHaveLength(1);
	});
});
