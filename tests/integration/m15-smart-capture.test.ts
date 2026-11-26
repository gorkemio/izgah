import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb } from '../../src/lib/server/db/client';
import {
	aiUsageDaily,
	auditLogs,
	canonicalResources,
	enrichmentJobs,
	instanceSettings,
	linkShareSections,
	linkShares,
	resourceEnrichments,
	sections,
	shareSectionSuggestions,
	users,
	type UserRole
} from '../../src/lib/server/db/schema';
import {
	checkDuplicateLink,
	createLinkShare,
	updateLinkShare
} from '../../src/lib/server/links/service';
import { searchResources } from '../../src/lib/server/search/service';
import {
	loadSmartCaptureAdminView,
	purgeAiData,
	readSmartCaptureForm,
	saveSmartCaptureSettings,
	startEnrichmentBackfill,
	testSmartCaptureConnection
} from '../../src/lib/server/smart-capture/admin';
import { enqueueEnrichmentJob } from '../../src/lib/server/smart-capture/jobs';
import {
	loadSmartCaptureState,
	readProviderApiKey
} from '../../src/lib/server/smart-capture/settings';
import {
	acceptSuggestion,
	dismissSuggestions,
	listShareSuggestions,
	SuggestionError,
	undoAutoSection
} from '../../src/lib/server/smart-capture/suggestions';
import { runSingleEnrichmentPass } from '../../src/lib/server/smart-capture/worker';
import { _loadFeedPage } from '../../src/routes/(app)/+page.server';
import { load as adminAiLoad } from '../../src/routes/(app)/admin/ai/+page.server';
import { closeTestDb, migrateTestDb, resetTestDb, testDb } from '../setup/db';

async function seedUser(name: string, role: UserRole) {
	const [user] = await testDb
		.insert(users)
		.values({ name, email: `${name.toLowerCase()}@example.com`, role })
		.returning();
	return user;
}

async function seedSection(name: string, slug: string, createdById: string, sortOrder = 0) {
	const [row] = await testDb
		.insert(sections)
		.values({ name, slug, description: `${name} links`, sortOrder, createdById })
		.returning();
	return row;
}

/** Shares a link and fakes a finished unfurl so enrichment has something to work with. */
async function shareReady(
	actor: { id: string; role: UserRole },
	url: string,
	meta: { title: string; description?: string; contentText?: string },
	options: { note?: string; sectionIds?: string[]; isFeedVisible?: boolean } = {}
) {
	const created = await createLinkShare({
		actor,
		url,
		note: options.note,
		sectionIds: options.sectionIds,
		isFeedVisible: options.isFeedVisible
	});
	await testDb
		.update(canonicalResources)
		.set({
			title: meta.title,
			description: meta.description ?? null,
			contentText: meta.contentText ?? null,
			unfurlStatus: 'ready'
		})
		.where(eq(canonicalResources.id, created.share.resourceId));
	await enqueueEnrichmentJob(testDb, created.share.resourceId);
	return created.share;
}

function settingsForm(values: Record<string, string>): FormData {
	const form = new FormData();
	form.set('aiFields', '1');
	form.set('historySuggestions', 'on');
	form.set('dailyRequestLimit', '200');
	form.set('sectionMode', 'suggest');
	for (const [key, value] of Object.entries(values)) {
		form.set(key, value);
	}
	return form;
}

interface FakeCall {
	url: string;
	body: Record<string, unknown>;
	headers: Record<string, string>;
}

/** Fake OpenAI-compatible provider that answers with a fixed enrichment. */
function fakeProvider(answer: (body: Record<string, unknown>) => unknown, status = 200) {
	const calls: FakeCall[] = [];
	const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
		const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
		calls.push({
			url: String(url),
			body,
			headers: (init?.headers ?? {}) as Record<string, string>
		});
		if (status !== 200) {
			return new Response(JSON.stringify({ error: { message: 'nope' } }), { status });
		}
		return new Response(
			JSON.stringify({
				choices: [{ message: { content: JSON.stringify(answer(body)) } }],
				usage: { prompt_tokens: 100, completion_tokens: 20 }
			}),
			{ status: 200, headers: { 'content-type': 'application/json' } }
		);
	}) as unknown as typeof fetch;
	return { calls, fetchImpl };
}

/** Maps a section name to the `sN` key the prompt used. */
function keyFor(body: Record<string, unknown>, sectionName: string): string {
	const messages = body.messages as Array<{ content: string }>;
	const match = new RegExp(`(s\\d+): ${sectionName}\\b`).exec(messages[1].content);
	if (!match) {
		throw new Error(`section ${sectionName} not in prompt`);
	}
	return match[1];
}

describe('M15 smart capture', () => {
	beforeAll(async () => {
		await migrateTestDb();
	});

	beforeEach(async () => {
		await resetTestDb();
	});

	afterAll(async () => {
		await Promise.all([closeTestDb(), closeDb()]);
	});

	it('files links with #section hashtags on create and edit', async () => {
		const admin = await seedUser('Admin', 'admin');
		const member = await seedUser('Elif', 'member');
		const frontend = await seedSection('Frontend', 'frontend', admin.id);
		const design = await seedSection('Tasarım', 'tasarim', admin.id, 1);

		const created = await createLinkShare({
			actor: { id: member.id, role: 'member' },
			url: 'https://web.dev/articles/light-dark',
			note: 'Harika anlatım #frontend #tasarım'
		});
		expect(created.share.note).toBe('Harika anlatım');
		const linked = await testDb
			.select({ sectionId: linkShareSections.sectionId })
			.from(linkShareSections)
			.where(eq(linkShareSections.shareId, created.share.id));
		expect(linked.map((row) => row.sectionId).sort()).toEqual([frontend.id, design.id].sort());

		const second = await createLinkShare({
			actor: { id: member.id, role: 'member' },
			url: 'https://example.com/a',
			note: 'İlk not'
		});
		const updated = await updateLinkShare({
			actor: { id: member.id, role: 'member' },
			shareId: second.share.id,
			note: 'İlk not #front'
		});
		expect(updated.note).toBe('İlk not');
		expect(updated.sectionIds).toEqual([frontend.id]);
	});

	it('suggests sections from history, lets the author accept or dismiss, and respects dismissals', async () => {
		const admin = await seedUser('Admin', 'admin');
		const elif = await seedUser('Elif', 'member');
		const mert = await seedUser('Mert', 'member');
		const design = await seedSection('Tasarım', 'tasarim', admin.id);
		const actorAdmin = { id: admin.id, role: 'admin' as const };

		for (const path of ['a', 'b', 'c']) {
			await shareReady(
				actorAdmin,
				`https://practicaltypography.com/${path}.html`,
				{
					title: `Typography chapter ${path}`
				},
				{ sectionIds: [design.id] }
			);
		}
		const share = await shareReady(
			{ id: elif.id, role: 'member' },
			'https://practicaltypography.com/summary-of-key-rules.html',
			{
				title: 'Summary of key rules'
			}
		);

		await runSingleEnrichmentPass();

		const viewForElif = await listShareSuggestions(
			[{ id: share.id, authorId: elif.id, sectionCount: 0 }],
			{ id: elif.id, role: 'member' }
		);
		expect(viewForElif.get(share.id)).toEqual([
			expect.objectContaining({ sectionId: design.id, source: 'history', status: 'pending' })
		]);
		// Other members do not see someone else's suggestions.
		const viewForMert = await listShareSuggestions(
			[{ id: share.id, authorId: elif.id, sectionCount: 0 }],
			{ id: mert.id, role: 'member' }
		);
		expect(viewForMert.size).toBe(0);
		await expect(
			acceptSuggestion({
				actor: { id: mert.id, role: 'member' },
				shareId: share.id,
				sectionId: design.id
			})
		).rejects.toBeInstanceOf(SuggestionError);

		await acceptSuggestion({
			actor: { id: elif.id, role: 'member' },
			shareId: share.id,
			sectionId: design.id
		});
		const [link] = await testDb
			.select()
			.from(linkShareSections)
			.where(eq(linkShareSections.shareId, share.id));
		expect(link.sectionId).toBe(design.id);

		// The duplicate check offers the same section before sharing again.
		const check = await checkDuplicateLink(
			'https://practicaltypography.com/summary-of-key-rules.html'
		);
		expect(check.suggestedSections).toEqual([
			expect.objectContaining({ id: design.id, name: 'Tasarım', source: 'history' })
		]);

		// A dismissed suggestion is not offered again for that share.
		const other = await shareReady(
			{ id: elif.id, role: 'member' },
			'https://practicaltypography.com/fonts.html',
			{
				title: 'Fonts'
			}
		);
		await runSingleEnrichmentPass();
		expect(
			await dismissSuggestions({ actor: { id: elif.id, role: 'member' }, shareId: other.id })
		).toBe(1);
		await enqueueEnrichmentJob(testDb, other.resourceId);
		await runSingleEnrichmentPass();
		const remaining = await testDb
			.select()
			.from(shareSectionSuggestions)
			.where(eq(shareSectionSuggestions.shareId, other.id));
		expect(remaining.map((row) => row.status)).toEqual(['dismissed']);

		// The feed loader attaches suggestions only for the author and admins.
		const feedForAdmin = await _loadFeedPage({
			depends: () => {},
			url: new URL('http://localhost/'),
			viewerUserId: admin.id,
			viewerRole: 'admin'
		});
		expect(feedForAdmin.items.find((item) => item.id === other.id)?.suggestions).toBeUndefined();
	});

	it('stores the API key encrypted and never returns it to the page', async () => {
		const admin = await seedUser('Admin', 'admin');
		await saveSmartCaptureSettings(
			readSmartCaptureForm(
				settingsForm({
					enabled: 'on',
					provider: 'openrouter',
					model: 'x/y',
					apiKey: 'sk-or-v1-supersecret'
				})
			),
			{ id: admin.id },
			'req_test'
		);
		const [row] = await testDb.select().from(instanceSettings);
		expect(row.secret).not.toContain('supersecret');
		expect(JSON.stringify(row.value)).not.toContain('supersecret');
		expect(await readProviderApiKey()).toBe('sk-or-v1-supersecret');

		const view = await loadSmartCaptureAdminView();
		expect(JSON.stringify(view)).not.toContain('supersecret');
		expect(view.state.settings.keyHint).toBe('cret');

		const actions = await testDb.select({ action: auditLogs.action }).from(auditLogs);
		expect(actions.map((entry) => entry.action).sort()).toEqual([
			'admin.ai_key_updated',
			'admin.ai_settings_updated'
		]);
		expect(JSON.stringify(await testDb.select().from(auditLogs))).not.toContain('supersecret');

		await expect(
			adminAiLoad({
				depends: () => {},
				locals: { user: { id: admin.id, role: 'member' } }
			} as never)
		).rejects.toMatchObject({ status: 403 });
	});

	it('enriches with a provider: summary, searchable keywords, suggest and automatic modes, undo, purge', async () => {
		const admin = await seedUser('Admin', 'admin');
		const elif = await seedUser('Elif', 'member');
		const frontend = await seedSection('Frontend', 'frontend', admin.id);
		await seedSection('Tasarım', 'tasarim', admin.id, 1);
		const { calls, fetchImpl } = fakeProvider((body) => ({
			language: 'en',
			summary: 'Explains how light-dark() picks a colour per scheme.',
			keywords: ['karanlık tema', 'dark mode'],
			sections: [{ key: keyFor(body, 'Frontend'), confidence: 'high' }]
		}));

		await saveSmartCaptureSettings(
			readSmartCaptureForm(
				settingsForm({
					enabled: 'on',
					provider: 'custom',
					baseUrl: 'http://llm.test/v1',
					model: 'local-model',
					summaries: 'on',
					keywords: 'on',
					sendExcerpt: 'on',
					sectionMode: 'suggest'
				})
			),
			{ id: admin.id },
			null
		);
		expect(
			(
				await testSmartCaptureConnection(
					readSmartCaptureForm(
						settingsForm({
							enabled: 'on',
							provider: 'custom',
							baseUrl: 'http://llm.test/v1',
							model: 'local-model'
						})
					),
					{ fetchImpl: fakeProvider(() => ({ ok: true })).fetchImpl }
				)
			).ok
		).toBe(true);

		const share = await shareReady(
			{ id: elif.id, role: 'member' },
			'https://web.dev/articles/light-dark',
			{
				title: 'CSS color-scheme-dependent colors with light-dark()',
				description: 'Colours for both schemes in one declaration',
				contentText: 'The light-dark() function takes two colours.'
			},
			{ note: "Elif'in özel notu" }
		);
		const silent = await shareReady(
			{ id: admin.id, role: 'admin' },
			'https://web.dev/articles/other',
			{
				title: 'Another web.dev article'
			},
			{ isFeedVisible: false, sectionIds: [frontend.id] }
		);

		await runSingleEnrichmentPass({ fetchImpl });
		expect(calls).toHaveLength(2);
		expect(calls[0].url).toBe('http://llm.test/v1/chat/completions');
		// notes are not sent unless the admin opts in
		expect(JSON.stringify(calls[0].body)).not.toContain('özel notu');

		const [enrichment] = await testDb
			.select()
			.from(resourceEnrichments)
			.where(eq(resourceEnrichments.resourceId, share.resourceId));
		expect(enrichment.summary).toContain('light-dark()');
		expect(enrichment.suggestedSections).toEqual([{ sectionId: frontend.id, confidence: 'high' }]);

		const search = await searchResources({
			query: 'karanlık tema',
			userId: elif.id,
			recordLog: false
		});
		expect(search.items.map((item) => item.resource.id)).toContain(share.resourceId);

		const suggestions = await testDb
			.select()
			.from(shareSectionSuggestions)
			.where(eq(shareSectionSuggestions.shareId, share.id));
		expect(suggestions).toEqual([
			expect.objectContaining({ sectionId: frontend.id, source: 'ai', status: 'pending' })
		]);
		// the silent share already has a section and is never touched
		expect(
			await testDb
				.select()
				.from(shareSectionSuggestions)
				.where(eq(shareSectionSuggestions.shareId, silent.id))
		).toHaveLength(0);

		const [usage] = await testDb.select().from(aiUsageDaily);
		expect(usage).toMatchObject({ requests: 2, inputTokens: 200, outputTokens: 40, failures: 0 });

		// Same input: no second call.
		await enqueueEnrichmentJob(testDb, share.resourceId);
		await runSingleEnrichmentPass({ fetchImpl });
		expect(calls).toHaveLength(2);

		// Automatic mode adds high-confidence sections to a new unsectioned share, with undo.
		await saveSmartCaptureSettings(
			readSmartCaptureForm(
				settingsForm({
					enabled: 'on',
					provider: 'custom',
					baseUrl: 'http://llm.test/v1',
					model: 'local-model',
					summaries: 'on',
					keywords: 'on',
					sendExcerpt: 'on',
					sectionMode: 'auto'
				})
			),
			{ id: admin.id },
			null
		);
		const autoShare = await shareReady(
			{ id: elif.id, role: 'member' },
			'https://web.dev/articles/container-queries',
			{
				title: 'Container queries'
			}
		);
		await runSingleEnrichmentPass({ fetchImpl });
		const autoLinks = await testDb
			.select()
			.from(linkShareSections)
			.where(eq(linkShareSections.shareId, autoShare.id));
		expect(autoLinks.map((row) => row.sectionId)).toEqual([frontend.id]);
		const autoView = await listShareSuggestions(
			[{ id: autoShare.id, authorId: elif.id, sectionCount: 1 }],
			{ id: elif.id, role: 'member' }
		);
		expect(autoView.get(autoShare.id)).toEqual([
			expect.objectContaining({ sectionId: frontend.id, status: 'auto_applied' })
		]);
		await undoAutoSection({
			actor: { id: elif.id, role: 'member' },
			shareId: autoShare.id,
			sectionId: frontend.id
		});
		expect(
			await testDb
				.select()
				.from(linkShareSections)
				.where(eq(linkShareSections.shareId, autoShare.id))
		).toHaveLength(0);

		// Purge removes AI data but keeps accepted sections.
		await acceptSuggestion({
			actor: { id: elif.id, role: 'member' },
			shareId: share.id,
			sectionId: frontend.id
		});
		const purged = await purgeAiData({ id: admin.id }, null);
		expect(purged.enrichments).toBeGreaterThan(0);
		expect(await testDb.select().from(resourceEnrichments)).toHaveLength(0);
		const [resource] = await testDb
			.select({ keywords: canonicalResources.aiKeywords })
			.from(canonicalResources)
			.where(eq(canonicalResources.id, share.resourceId));
		expect(resource.keywords).toEqual([]);
		expect(
			await testDb.select().from(linkShareSections).where(eq(linkShareSections.shareId, share.id))
		).toHaveLength(1);
	});

	it('pauses on a rejected key, defers at the daily limit and backfills existing links', async () => {
		const admin = await seedUser('Admin', 'admin');
		await seedSection('Frontend', 'frontend', admin.id);
		await saveSmartCaptureSettings(
			readSmartCaptureForm(
				settingsForm({
					enabled: 'on',
					provider: 'openrouter',
					model: 'x/y',
					apiKey: 'sk-bad',
					summaries: 'on'
				})
			),
			{ id: admin.id },
			null
		);
		const share = await shareReady({ id: admin.id, role: 'admin' }, 'https://example.com/paused', {
			title: 'Paused example'
		});
		const rejecting = fakeProvider(() => ({}), 401);
		expect(await runSingleEnrichmentPass({ fetchImpl: rejecting.fetchImpl })).toEqual([
			'completed'
		]);
		expect((await loadSmartCaptureState()).settings.pausedReason).toBe('auth_failed');

		// While paused nothing is sent; the backfill picks the link up after the key is fixed.
		const accepting = fakeProvider(() => ({ language: 'en', summary: 'Example page.' }));
		await enqueueEnrichmentJob(testDb, share.resourceId);
		await runSingleEnrichmentPass({ fetchImpl: accepting.fetchImpl });
		expect(accepting.calls).toHaveLength(0);

		await saveSmartCaptureSettings(
			readSmartCaptureForm(
				settingsForm({
					enabled: 'on',
					provider: 'openrouter',
					model: 'x/y',
					apiKey: 'sk-good',
					summaries: 'on',
					// The rejected 401 call above already counts as one request today.
					dailyRequestLimit: '2'
				})
			),
			{ id: admin.id },
			null
		);
		expect((await loadSmartCaptureState()).settings.pausedReason).toBeNull();
		expect(await startEnrichmentBackfill({ id: admin.id }, null)).toBe(1);
		await runSingleEnrichmentPass({ fetchImpl: accepting.fetchImpl });
		expect(accepting.calls).toHaveLength(1);
		expect(accepting.calls[0].headers.Authorization).toBe('Bearer sk-good');

		// Daily limit of 2 reached: the next job is deferred without a call.
		const next = await shareReady({ id: admin.id, role: 'admin' }, 'https://example.com/limited', {
			title: 'Limited example'
		});
		expect(await runSingleEnrichmentPass({ fetchImpl: accepting.fetchImpl })).toEqual(['deferred']);
		expect(accepting.calls).toHaveLength(1);
		const [job] = await testDb
			.select()
			.from(enrichmentJobs)
			.where(
				and(eq(enrichmentJobs.resourceId, next.resourceId), eq(enrichmentJobs.status, 'queued'))
			);
		expect(job.attempts).toBe(0);
		expect(job.nextRunAt.getTime()).toBeGreaterThan(Date.now());
	});

	it('queues enrichment for a new share of an already-unfurled link', async () => {
		const admin = await seedUser('Admin', 'admin');
		const first = await shareReady({ id: admin.id, role: 'admin' }, 'https://example.com/again', {
			title: 'Again'
		});
		await runSingleEnrichmentPass();
		await createLinkShare({
			actor: { id: admin.id, role: 'admin' },
			url: 'https://example.com/again'
		});
		const [job] = await testDb
			.select()
			.from(enrichmentJobs)
			.where(eq(enrichmentJobs.resourceId, first.resourceId));
		expect(job.status).toBe('queued');
		const shares = await testDb
			.select()
			.from(linkShares)
			.where(eq(linkShares.resourceId, first.resourceId));
		expect(shares).toHaveLength(2);
	});
});
