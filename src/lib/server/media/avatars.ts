/**
 * Profile photos (docs/designs/izgah-ui-v5.md §10.2). A member uploads a JPEG, PNG or WebP of at
 * most 5 MB; the server re-encodes it to a 256×256 WebP (EXIF stripped, pixel limit enforced) and
 * stores it content-addressed in media_assets. users.avatar_asset_key holds one reference.
 */
import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/client.ts';
import { users } from '#lib/server/db/schema.ts';
import {
	AVATAR_SHAPE,
	decrementMediaAssetRefInTx,
	detectRasterFormat,
	ensureMediaAssetFileInTx,
	lockMediaAssetKeyInTx,
	processAndWriteThumbnailToDisk,
	UnsupportedMediaFormatError,
	upsertAndIncrementMediaAssetInTx,
	type MediaDiskCheckOptions
} from '#lib/server/media/storage.ts';

export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const AVATAR_FORMATS = new Set(['jpeg', 'png', 'webp']);

export type AvatarErrorCode = 'empty' | 'too_large' | 'unsupported' | 'low_disk' | 'not_found';

export class AvatarError extends Error {
	constructor(readonly code: AvatarErrorCode) {
		super(`Avatar rejected: ${code}`);
		this.name = 'AvatarError';
	}
}

function isDecodeError(error: unknown): boolean {
	return (
		error instanceof Error &&
		/unsupported image format|Input buffer|pixel limit|corrupt|bad seek|VipsJpeg|pngload|webpload/i.test(
			error.message
		)
	);
}

/** Validates, re-encodes and stores a new profile photo; returns the new asset key. */
export async function setUserAvatar(
	userId: string,
	bytes: Uint8Array,
	options: MediaDiskCheckOptions = {}
): Promise<string> {
	if (bytes.byteLength === 0) {
		throw new AvatarError('empty');
	}
	if (bytes.byteLength > MAX_AVATAR_BYTES) {
		throw new AvatarError('too_large');
	}
	const format = detectRasterFormat(bytes);
	if (!format || !AVATAR_FORMATS.has(format)) {
		throw new AvatarError('unsupported');
	}

	let written;
	try {
		written = await processAndWriteThumbnailToDisk(bytes, options, AVATAR_SHAPE);
	} catch (error) {
		// sharp rejects corrupt images, format mismatches and images over the pixel limit.
		if (error instanceof UnsupportedMediaFormatError || isDecodeError(error)) {
			throw new AvatarError('unsupported');
		}
		throw error;
	}
	if (written.status !== 'stored') {
		throw new AvatarError('low_disk');
	}
	const asset = written.asset;

	await db.transaction(async (tx) => {
		const [row] = await tx
			.select({ avatarAssetKey: users.avatarAssetKey })
			.from(users)
			.where(eq(users.id, userId))
			.limit(1)
			.for('update');
		if (!row) {
			throw new AvatarError('not_found');
		}
		await lockMediaAssetKeyInTx(tx, asset.assetKey);
		if (row.avatarAssetKey !== asset.assetKey) {
			await upsertAndIncrementMediaAssetInTx(tx, asset);
			if (row.avatarAssetKey) {
				await decrementMediaAssetRefInTx(tx, row.avatarAssetKey);
			}
			await tx
				.update(users)
				.set({ avatarAssetKey: asset.assetKey, updatedAt: new Date() })
				.where(eq(users.id, userId));
		}
		await ensureMediaAssetFileInTx(asset);
	});

	return asset.assetKey;
}

/** Removes a member's profile photo; returns false when there was none. */
export async function removeUserAvatar(userId: string): Promise<boolean> {
	return db.transaction(async (tx) => {
		const [row] = await tx
			.select({ avatarAssetKey: users.avatarAssetKey })
			.from(users)
			.where(eq(users.id, userId))
			.limit(1)
			.for('update');
		if (!row) {
			throw new AvatarError('not_found');
		}
		if (!row.avatarAssetKey) {
			return false;
		}
		await decrementMediaAssetRefInTx(tx, row.avatarAssetKey);
		await tx
			.update(users)
			.set({ avatarAssetKey: null, updatedAt: new Date() })
			.where(eq(users.id, userId));
		return true;
	});
}
