/**
 * Site icons (docs/designs/izgah-ui-v5.md §10.1). After a successful unfurl the worker refreshes the
 * domain's icon at most every 30 days: it tries the page's icon candidates in order, keeps the first
 * raster image that decodes, stores it as a 64px WebP in media_assets and records the result in
 * site_icons. Only the server contacts the site; viewers load the stored copy.
 */
import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/client.ts';
import { siteIcons } from '#lib/server/db/schema.ts';
import { logger } from '#lib/server/logger.ts';
import { extractPngFromIco, isIco } from '#lib/server/media/ico.ts';
import {
	decrementMediaAssetRefInTx,
	detectRasterFormat,
	ensureMediaAssetFileInTx,
	lockMediaAssetKeyInTx,
	processAndWriteThumbnailToDisk,
	SITE_ICON_SHAPE,
	upsertAndIncrementMediaAssetInTx,
	type MediaDiskCheckOptions,
	type StoredThumbnailAsset
} from '#lib/server/media/storage.ts';
import { safeFetchBytes, type SafeFetchOptions } from '#lib/server/unfurl/safe-fetch.ts';

export const SITE_ICON_REFRESH_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_SITE_ICON_BYTES = 256 * 1024;

export type SiteIconOutcome = 'ok' | 'none' | 'failed' | 'fresh';

export type FetchIconBytes = (
	url: string,
	options: SafeFetchOptions
) => Promise<{ status: number; bytes: Uint8Array }>;

export interface RefreshSiteIconOptions {
	fetchBytes?: FetchIconBytes;
	safeFetchOptions?: SafeFetchOptions;
	mediaOptions?: MediaDiskCheckOptions;
	now?: Date;
}

/** Normalises a host for the site_icons key: lower case, no "www.". */
export function siteIconDomain(host: string): string {
	return host
		.trim()
		.toLowerCase()
		.replace(/^www\./, '');
}

/** The raster bytes to decode: ICO files give up their largest embedded PNG. */
export function iconRasterBytes(bytes: Uint8Array): Uint8Array | null {
	const raster = isIco(bytes) ? extractPngFromIco(bytes) : bytes;
	return raster && detectRasterFormat(raster) ? raster : null;
}

async function recordIcon(
	domain: string,
	status: 'ok' | 'none' | 'failed',
	asset: StoredThumbnailAsset | null,
	sourceUrl: string | null,
	now: Date
): Promise<void> {
	await db.transaction(async (tx) => {
		const [existing] = await tx
			.select({ assetKey: siteIcons.assetKey, sourceUrl: siteIcons.sourceUrl })
			.from(siteIcons)
			.where(eq(siteIcons.domain, domain))
			.limit(1)
			.for('update');
		const oldKey = existing?.assetKey ?? null;

		let assetKey: string | null = null;
		let finalStatus: 'ok' | 'none' | 'failed' = status;
		let finalSource = sourceUrl;
		if (asset) {
			await lockMediaAssetKeyInTx(tx, asset.assetKey);
			if (oldKey !== asset.assetKey) {
				await upsertAndIncrementMediaAssetInTx(tx, asset);
				if (oldKey) {
					await decrementMediaAssetRefInTx(tx, oldKey);
				}
			}
			assetKey = asset.assetKey;
		} else if (status === 'failed' && oldKey) {
			// A failed refresh keeps the icon we already have until the next attempt.
			assetKey = oldKey;
			finalStatus = 'ok';
			finalSource = existing?.sourceUrl ?? null;
		} else if (oldKey) {
			await decrementMediaAssetRefInTx(tx, oldKey);
		}

		await tx
			.insert(siteIcons)
			.values({ domain, assetKey, status: finalStatus, sourceUrl: finalSource, fetchedAt: now })
			.onConflictDoUpdate({
				target: siteIcons.domain,
				set: { assetKey, status: finalStatus, sourceUrl: finalSource, fetchedAt: now }
			});

		if (asset) {
			await ensureMediaAssetFileInTx(asset);
		}
	});
}

/**
 * Refreshes one domain's icon unless it was fetched in the last 30 days. Never throws: icon problems
 * must not fail the unfurl job that triggered them.
 */
export async function refreshSiteIcon(
	rawDomain: string,
	candidates: readonly string[],
	options: RefreshSiteIconOptions = {}
): Promise<SiteIconOutcome> {
	const domain = siteIconDomain(rawDomain);
	const now = options.now ?? new Date();
	const fetchBytes: FetchIconBytes = options.fetchBytes ?? safeFetchBytes;
	try {
		const [existing] = await db
			.select({ fetchedAt: siteIcons.fetchedAt })
			.from(siteIcons)
			.where(eq(siteIcons.domain, domain))
			.limit(1);
		if (existing && now.getTime() - existing.fetchedAt.getTime() < SITE_ICON_REFRESH_MS) {
			return 'fresh';
		}

		let sawError = false;
		for (const url of candidates) {
			try {
				const response = await fetchBytes(url, {
					...options.safeFetchOptions,
					maxBytes: MAX_SITE_ICON_BYTES
				});
				if (response.status < 200 || response.status >= 300) {
					continue;
				}
				const raster = iconRasterBytes(response.bytes);
				if (!raster) {
					continue;
				}
				const written = await processAndWriteThumbnailToDisk(
					raster,
					options.mediaOptions,
					SITE_ICON_SHAPE
				);
				if (written.status !== 'stored') {
					return 'failed';
				}
				await recordIcon(domain, 'ok', written.asset, url, now);
				return 'ok';
			} catch (error) {
				sawError = true;
				logger.debug('Site icon candidate failed', {
					domain,
					url,
					error: error instanceof Error ? error.message : String(error)
				});
			}
		}

		const status = sawError ? 'failed' : 'none';
		await recordIcon(domain, status, null, null, now);
		return status;
	} catch (error) {
		logger.warn('Site icon refresh failed', {
			domain,
			error: error instanceof Error ? error.message : String(error)
		});
		return 'failed';
	}
}
