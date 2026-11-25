import { beforeEach, describe, expect, it } from 'vitest';
import {
	BoundedSlidingWindowStore,
	checkAuthTokenRateLimit,
	checkLoginRateLimit,
	checkPasswordChangeRateLimit,
	LOGIN_IP_MAX_ATTEMPTS,
	LOGIN_MAX_ATTEMPTS,
	normalizeRateLimitIp,
	RATE_LIMIT_MAX_KEYS,
	resetRateLimiters
} from '../../src/lib/server/auth/rate-limit';

describe('rate limiter hardening', () => {
	beforeEach(() => {
		resetRateLimiters();
	});

	it('does not let a flood of invite-token keys evict an exhausted login bucket', () => {
		const t0 = 1_000_000;
		for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i += 1) {
			expect(
				checkLoginRateLimit('203.0.113.10', 'kurban@izgah.test', undefined, t0 + i).allowed
			).toBe(true);
		}
		expect(
			checkLoginRateLimit('203.0.113.10', 'kurban@izgah.test', undefined, t0 + 20).allowed
		).toBe(false);

		// Flood the token limiter from many addresses with unique tokens (previously a shared LRU store).
		for (let i = 0; i < RATE_LIMIT_MAX_KEYS + 500; i += 1) {
			checkAuthTokenRateLimit(
				`198.18.${Math.floor(i / 250)}.${i % 250}`,
				`tok_${i}`,
				undefined,
				t0 + 30
			);
		}

		expect(
			checkLoginRateLimit('203.0.113.10', 'kurban@izgah.test', undefined, t0 + 40).allowed
		).toBe(false);
	});

	it('caps total login attempts per IP across different e-mail addresses', () => {
		const t0 = 2_000_000;
		for (let i = 0; i < LOGIN_IP_MAX_ATTEMPTS; i += 1) {
			expect(
				checkLoginRateLimit('203.0.113.20', `rastgele${i}@izgah.test`, undefined, t0 + i).allowed
			).toBe(true);
		}
		expect(
			checkLoginRateLimit('203.0.113.20', 'baska-biri@izgah.test', undefined, t0 + 100).allowed
		).toBe(false);
		// Another client is unaffected.
		expect(
			checkLoginRateLimit('203.0.113.21', 'baska-biri@izgah.test', undefined, t0 + 101).allowed
		).toBe(true);
	});

	it('limits invite/reset token attempts per IP regardless of token value', () => {
		const t0 = 3_000_000;
		let blocked = false;
		for (let i = 0; i < 40; i += 1) {
			if (!checkAuthTokenRateLimit('198.51.100.30', `tok_${i}`, undefined, t0 + i).allowed) {
				blocked = true;
				break;
			}
		}
		expect(blocked).toBe(true);
	});

	it('refuses new keys instead of evicting active ones when configured to fail closed', () => {
		const store = new BoundedSlidingWindowStore(2, { evictActive: false });
		expect(store.consume('a', 1, 60_000, 0).allowed).toBe(true);
		expect(store.consume('b', 1, 60_000, 0).allowed).toBe(true);
		expect(store.consume('c', 1, 60_000, 0).allowed).toBe(false);
		// The exhausted bucket survives.
		expect(store.consume('a', 1, 60_000, 1).allowed).toBe(false);
		// Once entries expire, space is reclaimed.
		expect(store.consume('c', 1, 60_000, 120_000).allowed).toBe(true);
	});

	it('rate-limits password changes per user', () => {
		const t0 = 4_000_000;
		for (let i = 0; i < 10; i += 1) {
			expect(checkPasswordChangeRateLimit('user-1', t0 + i).allowed).toBe(true);
		}
		expect(checkPasswordChangeRateLimit('user-1', t0 + 20).allowed).toBe(false);
		expect(checkPasswordChangeRateLimit('user-2', t0 + 21).allowed).toBe(true);
	});

	it('buckets IPv6 clients by /64 and unwraps IPv4-mapped addresses', () => {
		expect(normalizeRateLimitIp('2001:db8:abcd:12:1::5')).toBe('2001:db8:abcd:12::/64');
		expect(normalizeRateLimitIp('2001:db8:abcd:12:ffff:ffff:ffff:1')).toBe('2001:db8:abcd:12::/64');
		expect(normalizeRateLimitIp('[2001:0db8::1]')).toBe('2001:db8:0:0::/64');
		expect(normalizeRateLimitIp('::ffff:203.0.113.7')).toBe('203.0.113.7');
		expect(normalizeRateLimitIp('203.0.113.7')).toBe('203.0.113.7');
	});
});
