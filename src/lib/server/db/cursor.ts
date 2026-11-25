import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';

/**
 * Keyset pagination over `(created_at, id)`.
 *
 * PostgreSQL stores `timestamptz` with microsecond precision, but a JS `Date` only keeps
 * milliseconds. A cursor built from `Date#toISOString()` therefore sits *before* the real last row
 * (`…00.123` < `…00.123456`), and the next page silently skips rows inside that millisecond. The
 * cursor timestamp is read as text with full precision and compared as `::timestamptz` instead.
 */
export function preciseTimestampText(column: SQLWrapper): SQL<string> {
	return sql<string>`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

const CURSOR_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;

export interface TimeIdCursor {
	/** ISO-8601 UTC timestamp with up to microsecond precision. */
	createdAt: string;
	id: string;
}

export function encodeTimeIdCursor(createdAt: string, id: string): string {
	return Buffer.from(JSON.stringify({ createdAt, id }), 'utf8').toString('base64url');
}

export function decodeTimeIdCursor(raw: string | null | undefined): TimeIdCursor | null {
	if (!raw || typeof raw !== 'string') {
		return null;
	}
	try {
		const decoded = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as unknown;
		if (!decoded || typeof decoded !== 'object') {
			return null;
		}
		const { createdAt, id } = decoded as Record<string, unknown>;
		if (
			typeof createdAt !== 'string' ||
			!CURSOR_TIMESTAMP_PATTERN.test(createdAt) ||
			Number.isNaN(new Date(createdAt).getTime()) ||
			typeof id !== 'string' ||
			id.trim() === '' ||
			id.length > 128
		) {
			return null;
		}
		return { createdAt, id };
	} catch {
		return null;
	}
}

/** `(createdAtColumn, idColumn) < (cursor.createdAt, cursor.id)` for DESC keyset pages. */
export function isBeforeCursor(
	createdAtColumn: SQLWrapper,
	idColumn: SQLWrapper,
	cursor: TimeIdCursor
): SQL {
	return sql`(${createdAtColumn}, ${idColumn}) < (${cursor.createdAt}::timestamptz, ${cursor.id})`;
}
