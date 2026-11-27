import crypto from 'node:crypto';
import net from 'node:net';
import { env } from '#lib/server/env.ts';

export const RATE_LIMIT_MAX_KEYS = 10_000;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_MAX_ATTEMPTS = 10;
/** Total login attempts per client IP across all e-mail addresses. */
export const LOGIN_IP_MAX_ATTEMPTS = 30;
/** Total login attempts per account across all client IPs (distributed brute force). */
export const LOGIN_ACCOUNT_MAX_ATTEMPTS = 50;
export const AUTH_TOKEN_POST_WINDOW_MS = 15 * 60 * 1000;
export const AUTH_TOKEN_POST_MAX_ATTEMPTS = 10;
/** Total invite/reset token attempts per client IP across all token values. */
export const AUTH_TOKEN_IP_MAX_ATTEMPTS = 30;
export const PASSWORD_CHANGE_WINDOW_MS = 15 * 60 * 1000;
export const PASSWORD_CHANGE_MAX_ATTEMPTS = 10;
export const AVATAR_UPLOAD_WINDOW_MS = 15 * 60 * 1000;
export const AVATAR_UPLOAD_MAX_ATTEMPTS = 10;
export const SEARCH_WINDOW_MS = 60 * 1000;
export const SEARCH_MAX_REQUESTS = 60;
/** ⌘K typeahead fires roughly once per debounced keystroke, so it gets its own, larger bucket. */
export const QUICK_SEARCH_WINDOW_MS = 60 * 1000;
export const QUICK_SEARCH_MAX_REQUESTS = 120;
export const API_READ_WINDOW_MS = 60 * 1000;
export const API_READ_MAX_REQUESTS = 60;
export const API_WRITE_WINDOW_MS = 60 * 1000;
export const API_WRITE_MAX_REQUESTS = 30;

export interface RateLimitResult {
	allowed: boolean;
	remaining: number;
	retryAfterSeconds: number;
	resetAtMs: number;
}

interface WindowEntry {
	timestamps: number[];
	windowMs: number;
}

/**
 * Bounded in-memory sliding-window store evicting expired or least-recently-used keys at capacity.
 */
export class BoundedSlidingWindowStore {
	readonly maxKeys: number;
	/**
	 * When false, a full store never evicts keys that still hold active timestamps; new keys are
	 * refused instead (fail closed). Security-critical limiters use this so attacker-generated keys
	 * cannot push an exhausted bucket out of memory and reset its counter.
	 */
	readonly evictActive: boolean;
	private readonly entries = new Map<string, WindowEntry>();

	constructor(maxKeys = RATE_LIMIT_MAX_KEYS, options: { evictActive?: boolean } = {}) {
		if (!Number.isInteger(maxKeys) || maxKeys < 1) {
			throw new RangeError('maxKeys must be a positive integer');
		}
		this.maxKeys = maxKeys;
		this.evictActive = options.evictActive ?? true;
	}

	get size(): number {
		return this.entries.size;
	}

	clear(): void {
		this.entries.clear();
	}

	has(key: string): boolean {
		return this.entries.has(key);
	}

	/** True when a new key could not be admitted right now (full of active keys, fail-closed mode). */
	isFull(now = Date.now()): boolean {
		if (this.entries.size < this.maxKeys) {
			return false;
		}
		if (this.evictActive) {
			return false;
		}
		for (const entry of this.entries.values()) {
			const newest = entry.timestamps[entry.timestamps.length - 1];
			if (newest === undefined || newest <= now - entry.windowMs) {
				return false;
			}
		}
		return true;
	}

	/** Returns false when the store is full and may not evict an active key. */
	private evictIfFull(now: number): boolean {
		if (this.entries.size < this.maxKeys) {
			return true;
		}

		for (const [candidateKey, candidate] of this.entries) {
			const cutoff = now - candidate.windowMs;
			const newest = candidate.timestamps[candidate.timestamps.length - 1];
			if (newest === undefined || newest <= cutoff) {
				this.entries.delete(candidateKey);
				if (this.entries.size < this.maxKeys) {
					return true;
				}
			}
		}

		if (!this.evictActive) {
			return false;
		}

		const oldestKey = this.entries.keys().next().value;
		if (oldestKey !== undefined) {
			this.entries.delete(oldestKey);
		}
		return true;
	}

	consume(key: string, maxRequests: number, windowMs: number, now = Date.now()): RateLimitResult {
		const cutoff = now - windowMs;
		const existing = this.entries.get(key);
		const activeTimestamps = existing ? existing.timestamps.filter((ts) => ts > cutoff) : [];

		if (existing) {
			// Refresh insertion position so active keys remain at the tail (LRU eviction from head).
			this.entries.delete(key);
		} else if (!this.evictIfFull(now)) {
			return {
				allowed: false,
				remaining: 0,
				retryAfterSeconds: Math.max(1, Math.ceil(windowMs / 1000)),
				resetAtMs: now + windowMs
			};
		}

		if (activeTimestamps.length >= maxRequests) {
			this.entries.set(key, { timestamps: activeTimestamps, windowMs });
			const oldestActive = activeTimestamps[0] ?? now;
			const resetAtMs = oldestActive + windowMs;
			return {
				allowed: false,
				remaining: 0,
				retryAfterSeconds: Math.max(1, Math.ceil((resetAtMs - now) / 1000)),
				resetAtMs
			};
		}

		activeTimestamps.push(now);
		this.entries.set(key, { timestamps: activeTimestamps, windowMs });
		const oldestActive = activeTimestamps[0] ?? now;

		return {
			allowed: true,
			remaining: maxRequests - activeTimestamps.length,
			retryAfterSeconds: 0,
			resetAtMs: oldestActive + windowMs
		};
	}
}

export class SlidingWindowRateLimiter {
	readonly maxRequests: number;
	readonly windowMs: number;
	private readonly store: BoundedSlidingWindowStore;

	constructor(options: {
		maxRequests: number;
		windowMs: number;
		maxKeys?: number;
		store?: BoundedSlidingWindowStore;
	}) {
		this.maxRequests = options.maxRequests;
		this.windowMs = options.windowMs;
		this.store =
			options.store ?? new BoundedSlidingWindowStore(options.maxKeys ?? RATE_LIMIT_MAX_KEYS);
	}

	get size(): number {
		return this.store.size;
	}

	consume(key: string, now = Date.now()): RateLimitResult {
		return this.store.consume(key, this.maxRequests, this.windowMs, now);
	}

	clear(): void {
		this.store.clear();
	}
}

/**
 * Fail-closed store whose top-level keys are client prefixes. Per-e-mail or per-token counters are
 * nested inside the prefix entry, so one client prefix always occupies exactly one slot however many
 * distinct values it submits. Filling the store therefore needs `maxKeys` distinct client prefixes
 * instead of a few hundred, and an exhausted prefix is never evicted (its counter cannot be reset).
 */
export class PrefixScopedWindowStore {
	readonly maxKeys: number;
	private readonly entries = new Map<
		string,
		{ timestamps: number[]; windowMs: number; sub: Map<string, number[]> }
	>();

	constructor(maxKeys = RATE_LIMIT_MAX_KEYS) {
		if (!Number.isInteger(maxKeys) || maxKeys < 1) {
			throw new RangeError('maxKeys must be a positive integer');
		}
		this.maxKeys = maxKeys;
	}

	get size(): number {
		return this.entries.size;
	}

	clear(): void {
		this.entries.clear();
	}

	private reclaimExpired(now: number): void {
		for (const [key, entry] of this.entries) {
			const newest = entry.timestamps[entry.timestamps.length - 1];
			if (newest === undefined || newest <= now - entry.windowMs) {
				this.entries.delete(key);
			}
		}
	}

	/**
	 * Counts one attempt for `prefixKey` and, when the prefix still has budget, one for `subKey`
	 * inside it. Returns the prefix result and the sub-key result (null when no sub-key was given or
	 * the prefix was already blocked).
	 */
	consume(
		prefixKey: string,
		prefixMax: number,
		subKey: string | null,
		subMax: number,
		windowMs: number,
		now = Date.now()
	): { prefix: RateLimitResult; sub: RateLimitResult | null } {
		const cutoff = now - windowMs;
		let entry = this.entries.get(prefixKey);
		if (!entry) {
			if (this.entries.size >= this.maxKeys) {
				this.reclaimExpired(now);
			}
			if (this.entries.size >= this.maxKeys) {
				return { prefix: blockedResult(now, windowMs), sub: null };
			}
			entry = { timestamps: [], windowMs, sub: new Map() };
		} else {
			this.entries.delete(prefixKey);
		}
		this.entries.set(prefixKey, entry);

		entry.timestamps = entry.timestamps.filter((ts) => ts > cutoff);
		for (const [key, timestamps] of entry.sub) {
			const active = timestamps.filter((ts) => ts > cutoff);
			if (active.length === 0) {
				entry.sub.delete(key);
			} else {
				entry.sub.set(key, active);
			}
		}

		const prefix = applyWindow(entry.timestamps, prefixMax, windowMs, now);
		if (!prefix.allowed || subKey === null) {
			return { prefix, sub: null };
		}
		// The prefix budget bounds how many sub-keys can exist: each allowed attempt adds at most one.
		const subTimestamps = entry.sub.get(subKey) ?? [];
		const sub = applyWindow(subTimestamps, subMax, windowMs, now);
		entry.sub.set(subKey, subTimestamps);
		return { prefix, sub };
	}
}

function blockedResult(now: number, windowMs: number): RateLimitResult {
	return {
		allowed: false,
		remaining: 0,
		retryAfterSeconds: Math.max(1, Math.ceil(windowMs / 1000)),
		resetAtMs: now + windowMs
	};
}

/** Applies one attempt to an already-pruned timestamp list, mutating it when allowed. */
function applyWindow(
	timestamps: number[],
	maxRequests: number,
	windowMs: number,
	now: number
): RateLimitResult {
	if (timestamps.length >= maxRequests) {
		const resetAtMs = (timestamps[0] ?? now) + windowMs;
		return {
			allowed: false,
			remaining: 0,
			retryAfterSeconds: Math.max(1, Math.ceil((resetAtMs - now) / 1000)),
			resetAtMs
		};
	}
	timestamps.push(now);
	return {
		allowed: true,
		remaining: maxRequests - timestamps.length,
		retryAfterSeconds: 0,
		resetAtMs: (timestamps[0] ?? now) + windowMs
	};
}

/** Fixed-length, bounded key for attacker-chosen strings (e-mail addresses, tokens). */
function hashKey(value: string): string {
	return crypto.createHash('sha256').update(value.slice(0, 512), 'utf8').digest('hex').slice(0, 32);
}

// One store per limiter category: a flood against one category (e.g. random invite tokens) can
// never evict counters that protect another (e.g. login attempts).
const loginStore = new PrefixScopedWindowStore(RATE_LIMIT_MAX_KEYS);
// Per-account counters (distributed brute force across many IPs). Never evicted while active; when
// the store is full, new account counters are simply not created, so attacker-chosen e-mail strings
// cannot lock everyone else out. The per-prefix limits above still apply to every request.
const loginAccountStore = new BoundedSlidingWindowStore(RATE_LIMIT_MAX_KEYS, {
	evictActive: false
});
const authTokenStore = new PrefixScopedWindowStore(RATE_LIMIT_MAX_KEYS);
const passwordChangeStore = new BoundedSlidingWindowStore(RATE_LIMIT_MAX_KEYS, {
	evictActive: false
});
const avatarUploadStore = new BoundedSlidingWindowStore(RATE_LIMIT_MAX_KEYS, {
	evictActive: false
});
const searchStore = new BoundedSlidingWindowStore(RATE_LIMIT_MAX_KEYS);
const apiStore = new BoundedSlidingWindowStore(RATE_LIMIT_MAX_KEYS);
const allStores = [
	loginStore,
	loginAccountStore,
	authTokenStore,
	passwordChangeStore,
	avatarUploadStore,
	searchStore,
	apiStore
];

const loginRequestResults = new WeakMap<Request, RateLimitResult>();
const authPostRequestResults = new WeakMap<Request, RateLimitResult>();

export function getSharedRateLimitKeyCount(): number {
	return allStores.reduce((total, store) => total + store.size, 0);
}

export function resetRateLimiters(): void {
	for (const store of allStores) {
		store.clear();
	}
}

/**
 * Normalizes a client address into a rate-limit identity. IPv6 clients usually control a whole
 * /64, so they are bucketed by that prefix instead of the full address.
 */
export function normalizeRateLimitIp(ip: string): string {
	const trimmed = ip.trim();
	if (!trimmed) {
		return '127.0.0.1';
	}
	const unbracketed = trimmed.replace(/^\[|\]$/g, '');
	const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(unbracketed);
	if (mapped) {
		return mapped[1];
	}
	if (!net.isIPv6(unbracketed)) {
		return unbracketed;
	}
	const withoutZone = unbracketed.split('%')[0];
	const [head, tail = ''] = withoutZone.split('::');
	const headParts = head ? head.split(':') : [];
	const tailParts = tail ? tail.split(':') : [];
	const missing = Math.max(0, 8 - headParts.length - tailParts.length);
	const groups = withoutZone.includes('::')
		? [...headParts, ...Array<string>(missing).fill('0'), ...tailParts]
		: headParts;
	const prefix = groups
		.slice(0, 4)
		.map((group) => (group || '0').toLowerCase().replace(/^0+(?=.)/, ''))
		.join(':');
	return `${prefix}::/64`;
}

export function extractClientIp(event: {
	getClientAddress?: () => string;
	request: Request;
}): string {
	if (typeof event.getClientAddress === 'function') {
		try {
			const address = event.getClientAddress();
			if (address && address.trim() !== '') {
				return address.trim();
			}
		} catch {
			// Synthetic unit/integration test RequestEvents may not have an underlying socket address.
		}
	}

	const headerName = env.ADDRESS_HEADER || 'x-forwarded-for';
	const forwarded = event.request.headers.get(headerName);
	if (forwarded) {
		const parts = forwarded
			.split(',')
			.map((part) => part.trim())
			.filter(Boolean);
		if (parts.length > 0) {
			const depth = env.XFF_DEPTH;
			const index = depth <= 0 ? parts.length - 1 : Math.max(0, parts.length - depth);
			const chosen = parts[index];
			if (chosen) {
				return chosen;
			}
		}
	}

	return '127.0.0.1';
}

function mostRestrictive(results: RateLimitResult[]): RateLimitResult {
	const blocked = results.filter((result) => !result.allowed);
	if (blocked.length > 0) {
		return blocked.reduce((a, b) => (a.retryAfterSeconds >= b.retryAfterSeconds ? a : b));
	}
	return results.reduce((a, b) => (a.remaining <= b.remaining ? a : b));
}

export function checkLoginRateLimit(
	ip: string,
	email?: string | null,
	request?: Request,
	now = Date.now()
): RateLimitResult {
	if (request) {
		const cached = loginRequestResults.get(request);
		if (cached) {
			return cached;
		}
	}

	const normalizedIp = normalizeRateLimitIp(ip);
	const normalizedEmail = email?.trim().toLowerCase();

	// The per-IP total is checked first so a blocked client cannot keep adding per-email counters.
	const { prefix: ipResult, sub: ipEmailResult } = loginStore.consume(
		`login:ip:${normalizedIp}`,
		LOGIN_IP_MAX_ATTEMPTS,
		normalizedEmail ? hashKey(normalizedEmail) : null,
		LOGIN_MAX_ATTEMPTS,
		LOGIN_WINDOW_MS,
		now
	);
	let result = ipResult;
	if (ipResult.allowed && ipEmailResult && normalizedEmail) {
		const results = [ipResult, ipEmailResult];
		const accountKey = `login:account:${hashKey(normalizedEmail)}`;
		if (loginAccountStore.has(accountKey) || !loginAccountStore.isFull(now)) {
			results.push(
				loginAccountStore.consume(accountKey, LOGIN_ACCOUNT_MAX_ATTEMPTS, LOGIN_WINDOW_MS, now)
			);
		}
		result = mostRestrictive(results);
	}

	if (request) {
		loginRequestResults.set(request, result);
	}

	return result;
}

export function checkAuthTokenPostRateLimit(
	ip: string,
	rawToken?: string | null,
	request?: Request,
	now = Date.now()
): RateLimitResult {
	if (request) {
		const cached = authPostRequestResults.get(request);
		if (cached) {
			return cached;
		}
	}

	const normalizedIp = normalizeRateLimitIp(ip);
	const trimmedToken = rawToken?.trim() ?? '';
	const tokenBucket = trimmedToken ? hashKey(trimmedToken) : 'missing';

	const { prefix: ipResult, sub: tokenResult } = authTokenStore.consume(
		`auth_token_ip:${normalizedIp}`,
		AUTH_TOKEN_IP_MAX_ATTEMPTS,
		tokenBucket,
		AUTH_TOKEN_POST_MAX_ATTEMPTS,
		AUTH_TOKEN_POST_WINDOW_MS,
		now
	);
	const result = tokenResult ? mostRestrictive([ipResult, tokenResult]) : ipResult;

	if (request) {
		authPostRequestResults.set(request, result);
	}

	return result;
}

export const checkAuthTokenRateLimit = checkAuthTokenPostRateLimit;

export function checkPasswordChangeRateLimit(userId: string, now = Date.now()): RateLimitResult {
	return passwordChangeStore.consume(
		`password_change:${userId}`,
		PASSWORD_CHANGE_MAX_ATTEMPTS,
		PASSWORD_CHANGE_WINDOW_MS,
		now
	);
}

/** Profile photo uploads and removals (izgah-ui-v5.md §10.2): 10 per member per 15 minutes. */
export function checkAvatarUploadRateLimit(userId: string, now = Date.now()): RateLimitResult {
	return avatarUploadStore.consume(
		`avatar_upload:${userId}`,
		AVATAR_UPLOAD_MAX_ATTEMPTS,
		AVATAR_UPLOAD_WINDOW_MS,
		now
	);
}

export function checkSearchRateLimit(actorKey: string, now = Date.now()): RateLimitResult {
	return searchStore.consume(`search:${actorKey}`, SEARCH_MAX_REQUESTS, SEARCH_WINDOW_MS, now);
}

/**
 * Rate limit for the ⌘K typeahead endpoint (`GET /api/internal/search/quick`). It uses a separate
 * bucket so fast typing never exhausts the full `/search` page budget, while still bounding the
 * database work a single session can trigger.
 */
export function checkQuickSearchRateLimit(actorKey: string, now = Date.now()): RateLimitResult {
	return searchStore.consume(
		`quick_search:${actorKey}`,
		QUICK_SEARCH_MAX_REQUESTS,
		QUICK_SEARCH_WINDOW_MS,
		now
	);
}

export function checkApiReadRateLimit(apiKeyId: string, now = Date.now()): RateLimitResult {
	return apiStore.consume(`api_read:${apiKeyId}`, API_READ_MAX_REQUESTS, API_READ_WINDOW_MS, now);
}

export function checkApiWriteRateLimit(apiKeyId: string, now = Date.now()): RateLimitResult {
	return apiStore.consume(
		`api_write:${apiKeyId}`,
		API_WRITE_MAX_REQUESTS,
		API_WRITE_WINDOW_MS,
		now
	);
}
