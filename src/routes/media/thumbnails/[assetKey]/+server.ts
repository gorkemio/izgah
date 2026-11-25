import fs from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/client.ts';
import { mediaAssets } from '#lib/server/db/schema.ts';
import {
	ASSET_KEY_REGEX,
	InvalidAssetKeyError,
	resolveMediaAssetPath
} from '#lib/server/media/storage.ts';
import type { RequestHandler } from './$types';
import { t } from '#lib/i18n/index.ts';

function mediaJsonError(
	status: number,
	code: string,
	message: string,
	requestId: string
): Response {
	return new Response(
		JSON.stringify({
			error: {
				code,
				message,
				requestId
			}
		}),
		{
			status,
			headers: {
				'Content-Type': 'application/json; charset=utf-8',
				'Cache-Control': 'no-store',
				'X-Request-Id': requestId
			}
		}
	);
}

export const GET: RequestHandler = async ({ locals, params }) => {
	const requestId = locals.requestId || 'req_unknown';
	if (!locals.user) {
		return mediaJsonError(401, 'UNAUTHORIZED', t('auth.unauthorized'), requestId);
	}

	const assetKey = params.assetKey;
	if (!assetKey || !ASSET_KEY_REGEX.test(assetKey)) {
		return mediaJsonError(400, 'BAD_REQUEST', t('media.keyFormat'), requestId);
	}

	const [assetRow] = await db
		.select({
			assetKey: mediaAssets.assetKey,
			mimeType: mediaAssets.mimeType
		})
		.from(mediaAssets)
		.where(eq(mediaAssets.assetKey, assetKey))
		.limit(1);

	if (!assetRow) {
		return mediaJsonError(404, 'NOT_FOUND', t('media.notFound'), requestId);
	}

	let filePath: string;
	try {
		filePath = resolveMediaAssetPath(assetKey);
	} catch (error) {
		if (error instanceof InvalidAssetKeyError) {
			return mediaJsonError(400, 'BAD_REQUEST', t('media.keyInvalid'), requestId);
		}
		throw error;
	}

	let bytes: Buffer;
	try {
		bytes = await fs.readFile(filePath);
	} catch (error) {
		const errno = error as NodeJS.ErrnoException;
		if (errno?.code === 'ENOENT') {
			return mediaJsonError(404, 'NOT_FOUND', t('media.fileNotFound'), requestId);
		}
		throw error;
	}

	return new Response(new Uint8Array(bytes), {
		status: 200,
		headers: {
			'Content-Type': assetRow.mimeType,
			'Content-Length': String(bytes.byteLength),
			'Cache-Control': 'private, max-age=86400, immutable',
			'X-Content-Type-Options': 'nosniff',
			'Content-Security-Policy': "default-src 'none'"
		}
	});
};
