import { asciiLower } from '$lib/server/links/canonicalize';

export const CIRCUIT_BREAKER_FAILURE_THRESHOLD = 5;
export const CIRCUIT_BREAKER_COOLDOWN_MS = 15 * 60 * 1000;
export const CIRCUIT_BREAKER_MAX_HOSTS = 5_000;

const TRIP_STATUS_CODES = new Set([401, 403, 429]);

interface HostCircuitEntry {
	consecutiveFailures: number;
	openUntilMs: number | null;
}

const CIRCUIT_STORE_SYMBOL = Symbol.for('izgah.unfurl.circuitBreakerStore');

function getCircuitStore(): Map<string, HostCircuitEntry> {
	const g = globalThis as Record<PropertyKey, unknown>;
	if (!(g[CIRCUIT_STORE_SYMBOL] instanceof Map)) {
		g[CIRCUIT_STORE_SYMBOL] = new Map<string, HostCircuitEntry>();
	}
	return g[CIRCUIT_STORE_SYMBOL] as Map<string, HostCircuitEntry>;
}

function normalizeHostKey(hostname: string): string {
	return asciiLower(hostname.trim());
}

function evictOldestIfNeeded(store: Map<string, HostCircuitEntry>, nowMs: number): void {
	if (store.size < CIRCUIT_BREAKER_MAX_HOSTS) {
		return;
	}

	for (const [key, entry] of store) {
		if (entry.openUntilMs !== null && nowMs >= entry.openUntilMs) {
			store.delete(key);
			if (store.size < CIRCUIT_BREAKER_MAX_HOSTS) {
				return;
			}
		}
	}

	const oldestKey = store.keys().next().value;
	if (oldestKey !== undefined) {
		store.delete(oldestKey);
	}
}

/**
 * Checks whether the in-memory circuit breaker is currently open for a specific host.
 * Automatically clears expired cooldown entries once their 15-minute window elapses.
 */
export function isHostCircuitOpen(hostname: string, nowMs = Date.now()): boolean {
	const key = normalizeHostKey(hostname);
	if (!key) {
		return false;
	}

	const store = getCircuitStore();
	const entry = store.get(key);
	if (!entry || entry.openUntilMs === null) {
		return false;
	}

	if (nowMs < entry.openUntilMs) {
		return true;
	}

	store.delete(key);
	return false;
}

/**
 * Records an HTTP status code observed for a host (tracked per exact hostname, e.g.
 * api.github.com vs github.com) and trips the 15-minute circuit breaker after 5 consecutive
 * 401/403/429 responses. Any other status code resets the failure streak.
 */
export function recordHostStatus(
	hostname: string,
	statusCode: number,
	nowMs = Date.now()
): { opened: boolean; consecutiveFailures: number; openUntilMs: number | null } {
	const key = normalizeHostKey(hostname);
	if (!key) {
		return { opened: false, consecutiveFailures: 0, openUntilMs: null };
	}

	const store = getCircuitStore();

	if (!TRIP_STATUS_CODES.has(statusCode)) {
		store.delete(key);
		return { opened: false, consecutiveFailures: 0, openUntilMs: null };
	}

	const existing = store.get(key);
	let consecutiveFailures = 0;

	if (existing) {
		store.delete(key);
		if (existing.openUntilMs === null || nowMs < existing.openUntilMs) {
			consecutiveFailures = existing.consecutiveFailures;
		}
	} else {
		evictOldestIfNeeded(store, nowMs);
	}

	consecutiveFailures += 1;
	const shouldOpen = consecutiveFailures >= CIRCUIT_BREAKER_FAILURE_THRESHOLD;
	const openUntilMs = shouldOpen ? nowMs + CIRCUIT_BREAKER_COOLDOWN_MS : null;

	store.set(key, {
		consecutiveFailures,
		openUntilMs
	});

	return {
		opened: shouldOpen,
		consecutiveFailures,
		openUntilMs
	};
}

export function getHostCircuitState(
	hostname: string,
	nowMs = Date.now()
): { consecutiveFailures: number; openUntilMs: number | null; isOpen: boolean } {
	const key = normalizeHostKey(hostname);
	const entry = key ? getCircuitStore().get(key) : undefined;
	if (!entry) {
		return { consecutiveFailures: 0, openUntilMs: null, isOpen: false };
	}
	if (entry.openUntilMs !== null && nowMs >= entry.openUntilMs) {
		getCircuitStore().delete(key);
		return { consecutiveFailures: 0, openUntilMs: null, isOpen: false };
	}
	return {
		consecutiveFailures: entry.consecutiveFailures,
		openUntilMs: entry.openUntilMs,
		isOpen: entry.openUntilMs !== null && nowMs < entry.openUntilMs
	};
}

export function resetCircuitBreakers(): void {
	getCircuitStore().clear();
}
