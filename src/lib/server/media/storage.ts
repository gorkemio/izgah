import crypto from 'node:crypto';
import type { StatsFs } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { and, eq, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import sharp from 'sharp';
import { db, type Database } from '$lib/server/db/client';
import { canonicalResources, mediaAssets } from '$lib/server/db/schema';
import { env } from '$lib/server/env';
import { logger } from '$lib/server/logger';

// Configure libvips global bounds once on module load per Technical Plan §2.
sharp.cache(false);
sharp.concurrency(2);

export const ASSET_KEY_REGEX = /^[0-9a-f]{64}$/;
export const MAX_INPUT_PIXELS = 40_000_000;
export const THUMBNAIL_MAX_WIDTH = 1200;
export const THUMBNAIL_MAX_HEIGHT = 630;
export const THUMBNAIL_WEBP_QUALITY = 80;
export const ORPHAN_MEDIA_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type SupportedRasterFormat = 'jpeg' | 'png' | 'webp' | 'gif';
export type DbTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type DbOrTx = Database | DbTransaction;

export type StatFsFn = (
	targetPath: string
) => Promise<Pick<StatsFs, 'bavail' | 'bsize' | 'blocks'>>;

export class UnsupportedMediaFormatError extends Error {
	constructor(message = 'Only verified JPEG, PNG, WebP and GIF images are accepted.') {
		super(message);
		this.name = 'UnsupportedMediaFormatError';
	}
}

export class InvalidAssetKeyError extends Error {
	constructor(message = 'Invalid media key.') {
		super(message);
		this.name = 'InvalidAssetKeyError';
	}
}

export interface StoredThumbnailAsset {
	assetKey: string;
	byteSize: number;
	width: number;
	height: number;
	filePath: string;
	/** Encoded WebP bytes, kept so a file removed by a concurrent orphan cleanup can be restored. */
	data?: Buffer;
}

export type ThumbnailWriteResult =
	| { status: 'stored'; asset: StoredThumbnailAsset }
	| {
			status: 'skipped_low_disk';
			freeBytes: number;
			totalBytes: number;
			freeRatio: number;
	  };

export interface MediaDiskCheckOptions {
	storageDir?: string;
	minFreeBytes?: number;
	minFreeRatio?: number;
	statfs?: StatFsFn;
}

export function resolveMediaStorageDir(override?: string): string {
	if (override) {
		return path.resolve(override);
	}
	if (env.NODE_ENV === 'test' && process.env.MEDIA_STORAGE_DIR) {
		return path.resolve(process.env.MEDIA_STORAGE_DIR);
	}
	return path.resolve(env.MEDIA_STORAGE_DIR);
}

/**
 * Resolves the sharded WebP path `MEDIA_STORAGE_DIR/<first-2-hex>/<asset_key>.webp`
 * and guards against path traversal outside the storage root.
 */
export function resolveMediaAssetPath(assetKey: string, storageDirOverride?: string): string {
	if (!ASSET_KEY_REGEX.test(assetKey)) {
		throw new InvalidAssetKeyError();
	}

	const rootDir = resolveMediaStorageDir(storageDirOverride);
	const resolvedPath = path.resolve(rootDir, assetKey.slice(0, 2), `${assetKey}.webp`);
	const expectedPrefix = rootDir.endsWith(path.sep) ? rootDir : `${rootDir}${path.sep}`;
	if (!resolvedPath.startsWith(expectedPrefix)) {
		throw new InvalidAssetKeyError();
	}

	return resolvedPath;
}

/**
 * Validates raster image magic bytes before handing any buffer to sharp.
 * Explicitly rejects SVG, XML, HTML, and unknown formats.
 */
export function detectRasterFormat(bytes: Uint8Array): SupportedRasterFormat | null {
	if (bytes.length < 12) {
		return null;
	}

	// JPEG: FF D8 FF
	if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
		return 'jpeg';
	}

	// PNG: 89 50 4E 47 0D 0A 1A 0A
	if (
		bytes[0] === 0x89 &&
		bytes[1] === 0x50 &&
		bytes[2] === 0x4e &&
		bytes[3] === 0x47 &&
		bytes[4] === 0x0d &&
		bytes[5] === 0x0a &&
		bytes[6] === 0x1a &&
		bytes[7] === 0x0a
	) {
		return 'png';
	}

	// GIF87a / GIF89a
	if (
		bytes[0] === 0x47 &&
		bytes[1] === 0x49 &&
		bytes[2] === 0x46 &&
		bytes[3] === 0x38 &&
		(bytes[4] === 0x37 || bytes[4] === 0x39) &&
		bytes[5] === 0x61
	) {
		return 'gif';
	}

	// WebP: RIFF....WEBP
	if (
		bytes[0] === 0x52 &&
		bytes[1] === 0x49 &&
		bytes[2] === 0x46 &&
		bytes[3] === 0x46 &&
		bytes[8] === 0x57 &&
		bytes[9] === 0x45 &&
		bytes[10] === 0x42 &&
		bytes[11] === 0x50
	) {
		return 'webp';
	}

	return null;
}

export async function hasSufficientMediaDiskSpace(options: MediaDiskCheckOptions = {}): Promise<{
	ok: boolean;
	freeBytes: number;
	totalBytes: number;
	freeRatio: number;
}> {
	const storageDir = resolveMediaStorageDir(options.storageDir);
	const minFreeBytes = options.minFreeBytes ?? env.MEDIA_MIN_FREE_BYTES;
	const minFreeRatio = options.minFreeRatio ?? env.MEDIA_MIN_FREE_RATIO;
	const statfsFn: StatFsFn = options.statfs ?? ((targetPath) => fs.statfs(targetPath));

	await fs.mkdir(storageDir, { recursive: true });
	const stats = await statfsFn(storageDir);
	const freeBytes = Number(stats.bavail) * Number(stats.bsize);
	const totalBytes = Number(stats.blocks) * Number(stats.bsize);
	const freeRatio = totalBytes > 0 ? freeBytes / totalBytes : 0;

	const ok = freeBytes >= minFreeBytes && freeRatio >= minFreeRatio;
	if (!ok) {
		logger.warn('Media disk space below threshold; skipping thumbnail write', {
			storage_dir: storageDir,
			free_bytes: freeBytes,
			total_bytes: totalBytes,
			free_ratio: freeRatio,
			min_free_bytes: minFreeBytes,
			min_free_ratio: minFreeRatio
		});
	}

	return { ok, freeBytes, totalBytes, freeRatio };
}

/**
 * Validates raster magic bytes, checks disk free-space guards, converts to WebP
 * (<=1200x630, EXIF orientation applied and EXIF metadata stripped), and atomically
 * writes the content-addressed file to MEDIA_STORAGE_DIR/<2-hex>/<sha256>.webp.
 */
export async function processAndWriteThumbnailToDisk(
	rawBytes: Uint8Array,
	options: MediaDiskCheckOptions = {}
): Promise<ThumbnailWriteResult> {
	const detected = detectRasterFormat(rawBytes);
	if (!detected) {
		throw new UnsupportedMediaFormatError();
	}

	const diskStatus = await hasSufficientMediaDiskSpace(options);
	if (!diskStatus.ok) {
		return {
			status: 'skipped_low_disk',
			freeBytes: diskStatus.freeBytes,
			totalBytes: diskStatus.totalBytes,
			freeRatio: diskStatus.freeRatio
		};
	}

	const { data, info } = await sharp(Buffer.from(rawBytes), {
		limitInputPixels: MAX_INPUT_PIXELS,
		animated: false
	})
		.rotate()
		.resize({
			width: THUMBNAIL_MAX_WIDTH,
			height: THUMBNAIL_MAX_HEIGHT,
			fit: 'inside',
			withoutEnlargement: true
		})
		.webp({ quality: THUMBNAIL_WEBP_QUALITY })
		.toBuffer({ resolveWithObject: true });

	if (!info.width || !info.height || !info.size) {
		throw new Error('Processed thumbnail produced invalid dimensions or empty output');
	}

	const assetKey = crypto.createHash('sha256').update(data).digest('hex');
	const finalPath = resolveMediaAssetPath(assetKey, options.storageDir);
	const shardDir = path.dirname(finalPath);
	await fs.mkdir(shardDir, { recursive: true });

	const tempPath = path.join(shardDir, `.${assetKey}.${crypto.randomUUID()}.tmp`);
	try {
		await fs.writeFile(tempPath, data);
		await fs.rename(tempPath, finalPath);
	} catch (error) {
		await fs.unlink(tempPath).catch(() => {});
		throw error;
	}

	return {
		status: 'stored',
		asset: {
			assetKey,
			byteSize: info.size,
			width: info.width,
			height: info.height,
			filePath: finalPath,
			data
		}
	};
}

/**
 * Serializes file writes/attaches and orphan deletions for one asset key within the current
 * transaction (released on commit/rollback).
 */
export async function lockMediaAssetKeyInTx(tx: DbOrTx, assetKey: string): Promise<void> {
	await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`media_asset:${assetKey}`}))`);
}

/**
 * Called after a thumbnail was attached under {@link lockMediaAssetKeyInTx}: if an orphan cleanup
 * removed the file between the worker's write and the attach, write it again atomically.
 */
export async function ensureMediaAssetFileInTx(asset: StoredThumbnailAsset): Promise<void> {
	try {
		await fs.access(asset.filePath);
		return;
	} catch {
		// Missing: restore below.
	}
	if (!asset.data) {
		logger.warn('Thumbnail file missing after attach and no buffer to restore it', {
			asset_key: asset.assetKey
		});
		return;
	}
	await fs.mkdir(path.dirname(asset.filePath), { recursive: true });
	const tempPath = path.join(
		path.dirname(asset.filePath),
		`.${asset.assetKey}.${crypto.randomUUID()}.tmp`
	);
	try {
		await fs.writeFile(tempPath, asset.data);
		await fs.rename(tempPath, asset.filePath);
	} catch (error) {
		await fs.unlink(tempPath).catch(() => {});
		throw error;
	}
}

export async function upsertAndIncrementMediaAssetInTx(
	tx: DbOrTx,
	asset: Pick<StoredThumbnailAsset, 'assetKey' | 'byteSize' | 'width' | 'height'>
): Promise<void> {
	await tx
		.insert(mediaAssets)
		.values({
			assetKey: asset.assetKey,
			mimeType: 'image/webp',
			byteSize: asset.byteSize,
			width: asset.width,
			height: asset.height,
			refCount: 1,
			orphanedAt: null
		})
		.onConflictDoUpdate({
			target: mediaAssets.assetKey,
			set: {
				refCount: sql`${mediaAssets.refCount} + 1`,
				orphanedAt: null
			}
		});
}

export async function decrementMediaAssetRefInTx(tx: DbOrTx, assetKey: string): Promise<void> {
	await tx
		.update(mediaAssets)
		.set({
			refCount: sql`GREATEST(${mediaAssets.refCount} - 1, 0)`,
			orphanedAt: sql`CASE WHEN ${mediaAssets.refCount} - 1 <= 0 THEN NOW() ELSE NULL END`
		})
		.where(eq(mediaAssets.assetKey, assetKey));
}

/**
 * Detaches a resource's thumbnail and decrements media_assets.ref_count when all shares
 * of that resource have been soft-deleted.
 */
export async function detachResourceThumbnailInTx(
	tx: DbTransaction,
	resourceId: string
): Promise<string | null> {
	const [resource] = await tx
		.select({
			id: canonicalResources.id,
			thumbnailAssetKey: canonicalResources.thumbnailAssetKey
		})
		.from(canonicalResources)
		.where(eq(canonicalResources.id, resourceId))
		.limit(1)
		.for('update');

	if (!resource || !resource.thumbnailAssetKey) {
		return null;
	}

	const oldKey = resource.thumbnailAssetKey;

	await tx
		.update(canonicalResources)
		.set({
			thumbnailAssetKey: null,
			updatedAt: new Date()
		})
		.where(eq(canonicalResources.id, resource.id));

	await decrementMediaAssetRefInTx(tx, oldKey);
	return oldKey;
}

/**
 * Removes orphan media_assets records whose ref_count = 0 and orphaned_at exceeds 24 hours,
 * then unlinks their corresponding WebP files from MEDIA_STORAGE_DIR.
 */
export async function cleanupOrphanMediaAssets(options?: {
	olderThanMs?: number;
	storageDir?: string;
	now?: Date;
}): Promise<{ deletedCount: number; assetKeys: string[] }> {
	const olderThanMs = options?.olderThanMs ?? ORPHAN_MEDIA_MAX_AGE_MS;
	const now = options?.now ?? new Date();
	const cutoff = new Date(now.getTime() - olderThanMs);

	const deletedRows = await db.transaction(async (tx) => {
		const locked = await tx
			.select({ assetKey: mediaAssets.assetKey })
			.from(mediaAssets)
			.where(
				and(
					eq(mediaAssets.refCount, 0),
					isNotNull(mediaAssets.orphanedAt),
					lte(mediaAssets.orphanedAt, cutoff)
				)
			)
			.for('update', { skipLocked: true });

		if (locked.length === 0) {
			return [];
		}

		const keys = locked.map((row) => row.assetKey).sort();
		for (const key of keys) {
			await lockMediaAssetKeyInTx(tx, key);
		}
		const deleted = await tx
			.delete(mediaAssets)
			.where(and(inArray(mediaAssets.assetKey, keys), eq(mediaAssets.refCount, 0)))
			.returning({ assetKey: mediaAssets.assetKey });

		// Unlink while the per-key locks are held, so a worker attaching the same image either sees
		// the row gone and rewrites the file afterwards, or attaches before this transaction starts.
		for (const row of deleted) {
			const filePath = resolveMediaAssetPath(row.assetKey, options?.storageDir);
			await fs.unlink(filePath).catch((error: NodeJS.ErrnoException) => {
				if (error?.code !== 'ENOENT') {
					logger.warn('Failed to unlink orphan thumbnail file', {
						asset_key: row.assetKey,
						error: error.message
					});
				}
			});
		}
		return deleted;
	});

	return {
		deletedCount: deletedRows.length,
		assetKeys: deletedRows.map((row) => row.assetKey)
	};
}
