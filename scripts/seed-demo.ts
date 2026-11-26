/**
 * Realistic demo data for local development and the UI v5 theme lab (docs/designs/izgah-ui-v5.md
 * §15, M1): members, sections, about thirty shares over the last ten days with notes, generated
 * thumbnails, comments and likes.
 *
 * Usage: pnpm seed:demo
 *
 * Only runs against a database on localhost and never with NODE_ENV=production. Every row it
 * writes has an id starting with "seed-"; running it again replaces those rows and leaves
 * everything else alone.
 */
import { and, eq, inArray, like, or, sql } from 'drizzle-orm';
import sharp from 'sharp';
import { closeDb, db } from '#lib/server/db/client.ts';
import {
	canonicalResources,
	linkShareSections,
	linkShares,
	resourceComments,
	resourceLikes,
	sections,
	users
} from '#lib/server/db/schema.ts';
import {
	decrementMediaAssetRefInTx,
	processAndWriteThumbnailToDisk,
	upsertAndIncrementMediaAssetInTx
} from '#lib/server/media/storage.ts';
import type { ContentType, ProviderMeta } from '#lib/types/domain.ts';

const PREFIX = 'seed-';

function assertLocalDatabase(): void {
	if (process.env.NODE_ENV === 'production') {
		throw new Error('seed-demo refuses to run with NODE_ENV=production.');
	}
	const url = process.env.DATABASE_URL ?? '';
	const host = (() => {
		try {
			return new URL(url).hostname;
		} catch {
			return '';
		}
	})();
	if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
		throw new Error(`seed-demo only runs against a local database (DATABASE_URL host: "${host}").`);
	}
}

/** Small deterministic PRNG so every run produces the same data. */
function prng(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state * 1664525 + 1013904223) >>> 0;
		return state / 2 ** 32;
	};
}

const MEMBERS = [
	['maya', 'Maya Chen'],
	['jonas', 'Jonas Weber'],
	['priya', 'Priya Nair'],
	['leo', 'Leo Martins'],
	['aylin', 'Aylin Kaya'],
	['sam', 'Sam Okafor'],
	['elif', 'Elif Demir'],
	['noah', 'Noah Fischer']
] as const;
type MemberKey = (typeof MEMBERS)[number][0];

const SECTIONS = [
	['frontend', 'Frontend', 'Browsers, CSS, frameworks and the craft of the web.'],
	['design', 'Design', 'Interfaces, type, colour and design systems.'],
	['ai-tools', 'AI tools', 'Models, agents and tools that help us ship.'],
	['long-reads', 'Long reads', 'Essays and talks worth a quiet hour.'],
	['backend', 'Backend', 'Databases, APIs and the boring parts that keep things up.'],
	['tooling', 'Tooling', 'Editors, terminals, CI and everything around the code.']
] as const;
type SectionKey = (typeof SECTIONS)[number][0];

interface SeedShare {
	url: string;
	domain: string;
	type: ContentType;
	title: string;
	description: string;
	siteName: string;
	meta?: ProviderMeta;
	author: MemberKey;
	note: string;
	sections: SectionKey[];
	/** Hours before now. */
	ago: number;
	thumbnail: boolean;
	comments?: [MemberKey, string][];
}

const SHARES: SeedShare[] = [
	{
		url: 'https://github.com/ollama/ollama',
		domain: 'github.com',
		type: 'repo',
		title: 'ollama/ollama',
		description: 'Get up and running with large language models locally.',
		siteName: 'GitHub',
		meta: { stars: 154000, language: 'Go' },
		author: 'priya',
		note: 'Ran the new models on a laptop — surprisingly fast for summarising long PDFs.',
		sections: ['ai-tools'],
		ago: 3,
		thumbnail: true,
		comments: [
			['maya', 'Does it run on the CI runners too?'],
			['priya', 'Only the small models; the 8B one needs a GPU runner.'],
			['noah', 'Tried it on my M2 last night. The quantised model is very usable.']
		]
	},
	{
		url: 'https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/light-dark',
		domain: 'developer.mozilla.org',
		type: 'article',
		title: 'light-dark() — CSS colour function',
		description: 'Returns one of two colours depending on the colour scheme in use.',
		siteName: 'MDN Web Docs',
		author: 'maya',
		note: 'We could drop half of our theme media queries with this.',
		sections: ['frontend', 'design'],
		ago: 7,
		thumbnail: false,
		comments: [['leo', 'Already doing it in the token build — works in every browser we support.']]
	},
	{
		url: 'https://www.youtube.com/watch?v=NdOHA9rIpQs',
		domain: 'youtube.com',
		type: 'video',
		title: 'Local-first software, five years later',
		description: 'A talk on sync engines, CRDTs and what changed since the original essay.',
		siteName: 'YouTube',
		meta: { authorName: 'Strange Loop' },
		author: 'jonas',
		note: 'Worth watching before we pick a sync library.',
		sections: ['long-reads'],
		ago: 11,
		thumbnail: true
	},
	{
		url: 'https://github.com/sveltejs/kit',
		domain: 'github.com',
		type: 'repo',
		title: 'sveltejs/kit',
		description: 'Web development, streamlined.',
		siteName: 'GitHub',
		meta: { stars: 19800, language: 'JavaScript' },
		author: 'leo',
		note: 'The changelog for the new remote functions is a good read.',
		sections: ['frontend'],
		ago: 27,
		thumbnail: true,
		comments: [
			['aylin', 'Are we moving the share form to remote functions?'],
			['leo', 'Not yet — form actions still cover everything we need.']
		]
	},
	{
		url: 'https://tailwindcss.com/blog/tailwindcss-v4',
		domain: 'tailwindcss.com',
		type: 'article',
		title: 'Tailwind CSS v4.0',
		description:
			'A ground-up rewrite: faster builds, CSS-first configuration, modern CSS features.',
		siteName: 'Tailwind CSS',
		author: 'aylin',
		note: 'CSS-first config means our tokens can stay the single source. Big for us.',
		sections: ['frontend', 'design'],
		ago: 31,
		thumbnail: true,
		comments: [['maya', 'And cascade layers instead of the old purge tricks.']]
	},
	{
		url: 'https://www.figma.com/blog/design-systems-102-how-to-build-your-design-system/',
		domain: 'figma.com',
		type: 'article',
		title: 'Design systems 102: how to build your design system',
		description: 'From an audit of what exists to tokens, components and governance.',
		siteName: 'Figma Blog',
		author: 'elif',
		note: 'Good primer for the design-system workshop on Friday.',
		sections: ['design'],
		ago: 36,
		thumbnail: true
	},
	{
		url: 'https://www.postgresql.org/docs/current/textsearch-controls.html',
		domain: 'postgresql.org',
		type: 'article',
		title: 'Controlling text search',
		description: 'Parsing documents, parsing queries, ranking results and highlighting matches.',
		siteName: 'PostgreSQL Documentation',
		author: 'sam',
		note: 'ts_headline with the right options would give us search snippets for free.',
		sections: ['backend'],
		ago: 50,
		thumbnail: false,
		comments: [
			['jonas', 'Watch the cost on long documents — it re-parses the text.'],
			['sam', 'Good point, we can cap the input to the first few KB.']
		]
	},
	{
		url: 'https://github.com/anthropics/claude-code',
		domain: 'github.com',
		type: 'repo',
		title: 'anthropics/claude-code',
		description: 'An agentic coding tool that lives in your terminal.',
		siteName: 'GitHub',
		meta: { stars: 41000, language: 'TypeScript' },
		author: 'noah',
		note: 'The hooks docs answer most of the questions from yesterday’s standup.',
		sections: ['ai-tools', 'tooling'],
		ago: 54,
		thumbnail: true,
		comments: [['priya', 'The permission modes section is the one to read first.']]
	},
	{
		url: 'https://web.dev/articles/view-transitions',
		domain: 'web.dev',
		type: 'article',
		title: 'Smooth transitions with the View Transition API',
		description: 'Animate between DOM states and pages with a few lines of code.',
		siteName: 'web.dev',
		author: 'maya',
		note: 'The shared-element example is exactly the card → detail motion we want.',
		sections: ['frontend', 'design'],
		ago: 60,
		thumbnail: true
	},
	{
		url: 'https://x.com/rauchg/status/1856000000000000000',
		domain: 'x.com',
		type: 'social',
		title: 'Guillermo Rauch on shipping small',
		description: 'A short thread on why small, frequent releases beat big launches.',
		siteName: 'X',
		meta: { authorName: 'Guillermo Rauch' },
		author: 'jonas',
		note: 'Fits what we said in the retro.',
		sections: [],
		ago: 75,
		thumbnail: false
	},
	{
		url: 'https://www.joshwcomeau.com/css/designing-shadows/',
		domain: 'joshwcomeau.com',
		type: 'article',
		title: 'Designing beautiful shadows in CSS',
		description: 'Layered shadows, consistent light sources and colour-matched shadows.',
		siteName: 'Josh W. Comeau',
		author: 'elif',
		note: 'Reference for the new elevation scale — the layered approach looks much softer.',
		sections: ['design', 'frontend'],
		ago: 80,
		thumbnail: true,
		comments: [
			['aylin', 'Colour-matched shadows on dark mode look great.'],
			['elif', 'Yes, plain black disappears on our dark background.']
		]
	},
	{
		url: 'https://github.com/huntabyte/bits-ui',
		domain: 'github.com',
		type: 'repo',
		title: 'huntabyte/bits-ui',
		description: 'The headless components for Svelte.',
		siteName: 'GitHub',
		meta: { stars: 2600, language: 'TypeScript' },
		author: 'aylin',
		note: 'Accessible primitives for Svelte 5. The combobox handles everything we hand-rolled.',
		sections: ['frontend'],
		ago: 98,
		thumbnail: true
	},
	{
		url: 'https://www.youtube.com/watch?v=lKv1JxM3pPw',
		domain: 'youtube.com',
		type: 'video',
		title: 'The art of the small team',
		description: 'How five-person teams out-ship fifty: focus, trust and fewer meetings.',
		siteName: 'YouTube',
		meta: { authorName: 'Config' },
		author: 'sam',
		note: 'Twenty minutes, and the part about async decisions is gold.',
		sections: ['long-reads'],
		ago: 104,
		thumbnail: true
	},
	{
		url: 'https://sqlite.org/whentouse.html',
		domain: 'sqlite.org',
		type: 'web',
		title: 'Appropriate uses for SQLite',
		description: 'When SQLite works well, and when a client/server database is a better fit.',
		siteName: 'SQLite',
		author: 'jonas',
		note: 'For the next time someone asks why we need Postgres.',
		sections: ['backend'],
		ago: 120,
		thumbnail: false
	},
	{
		url: 'https://github.com/astral-sh/uv',
		domain: 'github.com',
		type: 'repo',
		title: 'astral-sh/uv',
		description: 'An extremely fast Python package and project manager, written in Rust.',
		siteName: 'GitHub',
		meta: { stars: 58000, language: 'Rust' },
		author: 'noah',
		note: 'Switched the data scripts to uv — installs went from minutes to seconds.',
		sections: ['tooling'],
		ago: 126,
		thumbnail: true,
		comments: [['sam', 'Same here. The lockfile alone was worth it.']]
	},
	{
		url: 'https://www.smashingmagazine.com/2025/10/accessible-colour-contrast-guide/',
		domain: 'smashingmagazine.com',
		type: 'article',
		title: 'A practical guide to accessible colour contrast',
		description: 'WCAG ratios, APCA and how to test palettes before they ship.',
		siteName: 'Smashing Magazine',
		author: 'elif',
		note: 'Our contrast test does most of this already; the APCA section is new to me.',
		sections: ['design'],
		ago: 140,
		thumbnail: true
	},
	{
		url: 'https://simonwillison.net/2025/Nov/10/agents/',
		domain: 'simonwillison.net',
		type: 'article',
		title: 'Agents are models using tools in a loop',
		description: 'A working definition of AI agents and why it is useful.',
		siteName: 'Simon Willison’s Weblog',
		author: 'priya',
		note: 'The clearest definition I have seen. Sharing for the AI reading group.',
		sections: ['ai-tools', 'long-reads'],
		ago: 150,
		thumbnail: false,
		comments: [
			['noah', 'Short and precise. Bookmarked.'],
			['maya', 'Can we use this as the intro for the onboarding trail?']
		]
	},
	{
		url: 'https://github.com/drizzle-team/drizzle-orm',
		domain: 'github.com',
		type: 'repo',
		title: 'drizzle-team/drizzle-orm',
		description: 'Headless TypeScript ORM with a head.',
		siteName: 'GitHub',
		meta: { stars: 30000, language: 'TypeScript' },
		author: 'sam',
		note: 'Release notes mention faster relational queries — relevant for the feed page.',
		sections: ['backend'],
		ago: 170,
		thumbnail: true
	},
	{
		url: 'https://ishadeed.com/article/container-queries-are-actually-coming/',
		domain: 'ishadeed.com',
		type: 'article',
		title: 'Container queries in practice',
		description: 'Real layouts that respond to their container instead of the viewport.',
		siteName: 'Ahmad Shadeed',
		author: 'maya',
		note: 'The card examples are close to our feed entry.',
		sections: ['frontend'],
		ago: 190,
		thumbnail: true
	},
	{
		url: 'https://www.youtube.com/watch?v=Mx8Ib6-2RQo',
		domain: 'youtube.com',
		type: 'video',
		title: 'Building a design system with tokens',
		description: 'From raw values to semantic tokens to components, live.',
		siteName: 'YouTube',
		meta: { authorName: 'Figma' },
		author: 'aylin',
		note: 'Good companion to the Figma article from last week.',
		sections: ['design'],
		ago: 205,
		thumbnail: true
	},
	{
		url: 'https://mastodon.social/@jensimmons/113500000000000000',
		domain: 'mastodon.social',
		type: 'social',
		title: 'Jen Simmons on Safari Technology Preview',
		description: 'A new preview with anchor positioning and more view transition types.',
		siteName: 'Mastodon',
		meta: { authorName: 'Jen Simmons' },
		author: 'leo',
		note: 'Anchor positioning in Safari means we can drop the popover fallback soon.',
		sections: ['frontend'],
		ago: 214,
		thumbnail: false
	},
	{
		url: 'https://github.com/charmbracelet/gum',
		domain: 'github.com',
		type: 'repo',
		title: 'charmbracelet/gum',
		description: 'A tool for glamorous shell scripts.',
		siteName: 'GitHub',
		meta: { stars: 20000, language: 'Go' },
		author: 'noah',
		note: 'Our release script could use the confirm and spin commands.',
		sections: ['tooling'],
		ago: 230,
		thumbnail: true
	}
];

function hashHue(text: string): number {
	let h = 0;
	for (const char of text) {
		h = (h * 31 + char.charCodeAt(0)) >>> 0;
	}
	return h % 360;
}

/** A colourful abstract 1200×630 image per resource (no text, no external assets). */
async function thumbnailFor(share: SeedShare): Promise<Buffer> {
	const hue = hashHue(share.url);
	const random = prng(hue + 7);
	const circles = Array.from({ length: 5 }, (_, i) => {
		const x = Math.round(random() * 1200);
		const y = Math.round(random() * 630);
		const r = Math.round(120 + random() * 260);
		const h = (hue + i * 47) % 360;
		return `<circle cx="${x}" cy="${y}" r="${r}" fill="hsl(${h} 80% 60%)" fill-opacity="0.55"/>`;
	}).join('');
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
		<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
			<stop offset="0" stop-color="hsl(${hue} 70% 22%)"/>
			<stop offset="1" stop-color="hsl(${(hue + 60) % 360} 75% 38%)"/>
		</linearGradient><filter id="b"><feGaussianBlur stdDeviation="60"/></filter></defs>
		<rect width="1200" height="630" fill="url(#g)"/>
		<g filter="url(#b)">${circles}</g>
	</svg>`;
	return sharp(Buffer.from(svg)).png().toBuffer();
}

async function removePreviousSeed(): Promise<void> {
	await db.transaction(async (tx) => {
		const oldResources = await tx
			.select({ id: canonicalResources.id, key: canonicalResources.thumbnailAssetKey })
			.from(canonicalResources)
			.where(like(canonicalResources.id, `${PREFIX}%`));
		for (const resource of oldResources) {
			if (resource.key) {
				await decrementMediaAssetRefInTx(tx, resource.key);
			}
		}
		await tx.delete(resourceLikes).where(like(resourceLikes.resourceId, `${PREFIX}%`));
		await tx.delete(resourceComments).where(like(resourceComments.id, `${PREFIX}%`));
		await tx.delete(linkShareSections).where(like(linkShareSections.shareId, `${PREFIX}%`));
		await tx.delete(linkShares).where(like(linkShares.id, `${PREFIX}%`));
		await tx.delete(canonicalResources).where(like(canonicalResources.id, `${PREFIX}%`));
	});
}

async function ensureMembers(): Promise<Record<MemberKey, string>> {
	const ids = {} as Record<MemberKey, string>;
	for (const [key, name] of MEMBERS) {
		const email = `${key}@demo.test`;
		const [existing] = await db
			.select({ id: users.id })
			.from(users)
			.where(eq(users.email, email))
			.limit(1);
		if (existing) {
			ids[key] = existing.id;
			continue;
		}
		const [created] = await db
			.insert(users)
			.values({ id: `${PREFIX}user-${key}`, name, email, role: 'member', isActive: true })
			.returning({ id: users.id });
		ids[key] = created.id;
	}
	return ids;
}

async function ensureSections(createdById: string): Promise<Record<SectionKey, string>> {
	const ids = {} as Record<SectionKey, string>;
	let order = 0;
	for (const [slug, name, description] of SECTIONS) {
		const [existing] = await db
			.select({ id: sections.id })
			.from(sections)
			.where(or(eq(sections.slug, slug), eq(sections.name, name)))
			.limit(1);
		if (existing) {
			ids[slug] = existing.id;
		} else {
			const [created] = await db
				.insert(sections)
				.values({
					id: `${PREFIX}section-${slug}`,
					slug,
					name,
					description,
					sortOrder: order,
					createdById
				})
				.returning({ id: sections.id });
			ids[slug] = created.id;
		}
		order += 1;
	}
	return ids;
}

async function main(): Promise<void> {
	assertLocalDatabase();
	await removePreviousSeed();
	const members = await ensureMembers();
	const sectionIds = await ensureSections(members.maya);
	const memberIds = Object.values(members);
	const random = prng(2026);
	const now = Date.now();

	// Skip URLs another share (for example the older demo rows) already holds.
	const taken = new Set(
		(
			await db
				.select({ url: canonicalResources.canonicalUrl })
				.from(canonicalResources)
				.where(
					inArray(
						canonicalResources.canonicalUrl,
						SHARES.map((share) => share.url)
					)
				)
		).map((row) => row.url)
	);

	let written = 0;
	for (const [index, share] of SHARES.entries()) {
		if (taken.has(share.url)) {
			continue;
		}
		const resourceId = `${PREFIX}resource-${index + 1}`;
		const shareId = `${PREFIX}share-${index + 1}`;
		const createdAt = new Date(now - share.ago * 3_600_000);
		const likers = memberIds.filter(() => random() < 0.45);
		const comments = share.comments ?? [];

		let thumbnail: Awaited<ReturnType<typeof processAndWriteThumbnailToDisk>> | null = null;
		if (share.thumbnail) {
			thumbnail = await processAndWriteThumbnailToDisk(await thumbnailFor(share));
		}

		await db.transaction(async (tx) => {
			let thumbnailAssetKey: string | null = null;
			if (thumbnail?.status === 'stored') {
				await upsertAndIncrementMediaAssetInTx(tx, thumbnail.asset);
				thumbnailAssetKey = thumbnail.asset.assetKey;
			}
			await tx.insert(canonicalResources).values({
				id: resourceId,
				canonicalUrl: share.url,
				domain: share.domain,
				contentType: share.type,
				unfurlStatus: 'ready',
				title: share.title,
				description: share.description,
				siteName: share.siteName,
				providerMeta: share.meta ?? null,
				thumbnailAssetKey,
				likeCount: likers.length,
				commentCount: comments.length,
				createdAt,
				updatedAt: createdAt
			});
			await tx.insert(linkShares).values({
				id: shareId,
				resourceId,
				authorId: members[share.author],
				rawUrl: share.url,
				note: share.note,
				isFeedVisible: true,
				createdAt,
				updatedAt: createdAt
			});
			if (share.sections.length > 0) {
				await tx
					.insert(linkShareSections)
					.values(share.sections.map((section) => ({ shareId, sectionId: sectionIds[section] })));
			}
			for (const [i, [author, body]] of comments.entries()) {
				const at = new Date(createdAt.getTime() + (i + 1) * 47 * 60_000);
				await tx.insert(resourceComments).values({
					id: `${PREFIX}comment-${index + 1}-${i + 1}`,
					resourceId,
					authorId: members[author],
					body,
					createdAt: at,
					updatedAt: at
				});
			}
			if (likers.length > 0) {
				await tx
					.insert(resourceLikes)
					.values(likers.map((userId) => ({ resourceId, userId, createdAt })));
			}
		});
		written += 1;
	}

	const [{ value: total }] = await db
		.select({ value: sql<number>`count(*)::int` })
		.from(linkShares)
		.where(and(like(linkShares.id, `${PREFIX}%`)));
	console.log(`seed-demo: wrote ${written} shares (${total} seed shares in the database).`);
}

main()
	.catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	})
	.finally(() => closeDb());
