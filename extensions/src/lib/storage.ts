import { browser } from 'wxt/browser';
import {
	PENDING_SHARE_TTL_MS,
	SESSION_META_TTL_MS,
	type CachedUserProfile,
	type ExtensionSettings,
	type PendingShareContext,
	type SessionMetaCache
} from './types';

export const SETTINGS_STORAGE_KEY = 'izgah_settings_v1';
export const SESSION_META_STORAGE_KEY = 'izgah_session_meta_v1';
export const PENDING_SHARE_STORAGE_KEY = 'izgah_pending_share_v1';

function requireSessionStorage() {
	const session = browser.storage?.session;
	if (!session) {
		throw new Error('browser.storage.session is unavailable in this environment.');
	}
	return session;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidCachedUser(value: unknown): value is CachedUserProfile {
	if (!isRecord(value)) {
		return false;
	}
	return (
		typeof value.id === 'string' &&
		typeof value.name === 'string' &&
		typeof value.email === 'string' &&
		(value.role === 'admin' || value.role === 'member')
	);
}

export function isValidExtensionSettings(
	value: ExtensionSettings | null | undefined
): value is ExtensionSettings {
	return Boolean(
		value &&
		typeof value.serverOrigin === 'string' &&
		value.serverOrigin.trim() !== '' &&
		typeof value.apiKey === 'string' &&
		value.apiKey.trim() !== ''
	);
}

/**
 * Reads persisted extension settings from local browser storage.
 */
export async function loadSettings(): Promise<ExtensionSettings | null> {
	const stored = await browser.storage.local.get(SETTINGS_STORAGE_KEY);
	const raw = stored[SETTINGS_STORAGE_KEY];
	if (!isRecord(raw)) {
		return null;
	}

	if (typeof raw.serverOrigin !== 'string' || typeof raw.apiKey !== 'string') {
		return null;
	}

	const cachedUser = isValidCachedUser(raw.cachedUser) ? raw.cachedUser : null;
	return {
		serverOrigin: raw.serverOrigin,
		apiKey: raw.apiKey,
		cachedUser
	};
}

/**
 * Persists extension settings exclusively in local browser storage.
 */
export async function saveSettings(settings: ExtensionSettings): Promise<void> {
	await browser.storage.local.set({
		[SETTINGS_STORAGE_KEY]: settings
	});
}

/**
 * Updates cached user role/profile metadata in existing local settings.
 */
export async function updateCachedUser(
	cachedUser: CachedUserProfile | null
): Promise<ExtensionSettings | null> {
	const current = await loadSettings();
	if (!current) {
		return null;
	}

	const updated: ExtensionSettings = {
		...current,
		cachedUser
	};
	await saveSettings(updated);
	return updated;
}

/**
 * Removes stored server origin, API key, and cached user profile from local storage.
 */
export async function clearSettings(): Promise<void> {
	await browser.storage.local.remove(SETTINGS_STORAGE_KEY);
}

/**
 * Returns true when both server origin and API key are configured locally.
 */
export async function hasConfiguredSettings(): Promise<boolean> {
	const settings = await loadSettings();
	return isValidExtensionSettings(settings);
}

/**
 * Reads the 60s session metadata cache if fresh and bound to the same server origin.
 */
export async function readSessionMetaCache(
	serverOrigin: string,
	now = Date.now()
): Promise<SessionMetaCache | null> {
	const session = requireSessionStorage();
	const stored = await session.get(SESSION_META_STORAGE_KEY);
	const raw = stored[SESSION_META_STORAGE_KEY];
	if (!isRecord(raw)) {
		return null;
	}

	if (
		typeof raw.serverOrigin !== 'string' ||
		!isValidCachedUser(raw.user) ||
		!Array.isArray(raw.sections) ||
		typeof raw.cachedAt !== 'number'
	) {
		await session.remove(SESSION_META_STORAGE_KEY);
		return null;
	}

	const isExpired = now - raw.cachedAt > SESSION_META_TTL_MS;
	if (raw.serverOrigin !== serverOrigin || isExpired) {
		await session.remove(SESSION_META_STORAGE_KEY);
		return null;
	}

	return {
		serverOrigin: raw.serverOrigin,
		user: raw.user,
		sections: raw.sections as SessionMetaCache['sections'],
		cachedAt: raw.cachedAt
	};
}

/**
 * Stores validated user profile and ordered sections in session storage with a timestamp.
 */
export async function writeSessionMetaCache(
	entry: Omit<SessionMetaCache, 'cachedAt'> & { cachedAt?: number }
): Promise<SessionMetaCache> {
	const session = requireSessionStorage();
	const payload: SessionMetaCache = {
		serverOrigin: entry.serverOrigin,
		user: entry.user,
		sections: entry.sections,
		cachedAt: entry.cachedAt ?? Date.now()
	};
	await session.set({
		[SESSION_META_STORAGE_KEY]: payload
	});
	return payload;
}

/**
 * Clears the session metadata cache immediately.
 */
export async function clearSessionMetaCache(): Promise<void> {
	const session = requireSessionStorage();
	await session.remove(SESSION_META_STORAGE_KEY);
}

/**
 * Writes a one-time right-click share handoff record to session storage.
 * Returns a promise so event handlers can initiate popup opening before awaiting storage I/O.
 */
export async function writePendingShareContext(context: PendingShareContext): Promise<void> {
	const session = requireSessionStorage();
	await session.set({
		[PENDING_SHARE_STORAGE_KEY]: context
	});
}

/**
 * Atomically reads and clears a pending right-click share context within its 10s TTL window.
 */
export async function consumePendingShareContext(
	now = Date.now()
): Promise<PendingShareContext | null> {
	const session = requireSessionStorage();
	const stored = await session.get(PENDING_SHARE_STORAGE_KEY);
	const raw = stored[PENDING_SHARE_STORAGE_KEY];
	await session.remove(PENDING_SHARE_STORAGE_KEY);

	if (!isRecord(raw)) {
		return null;
	}

	if (
		typeof raw.url !== 'string' ||
		(raw.title !== null && typeof raw.title !== 'string') ||
		(raw.source !== 'page' && raw.source !== 'link') ||
		typeof raw.createdAt !== 'number'
	) {
		return null;
	}

	if (now - raw.createdAt > PENDING_SHARE_TTL_MS) {
		return null;
	}

	return {
		url: raw.url,
		title: raw.title,
		source: raw.source,
		createdAt: raw.createdAt
	};
}
