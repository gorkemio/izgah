import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toasts } from '../../src/lib/client/toast.svelte';

describe('toast auto-dismiss holds', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		for (const item of toasts.items) {
			toasts.dismiss(item.id);
		}
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	function lastId(): number {
		const id = toasts.items.at(-1)?.id;
		if (id === undefined) {
			throw new Error('expected a toast');
		}
		return id;
	}

	it('auto-dismisses after the timeout when nothing holds it', () => {
		toasts.push('Kopyalandı');
		expect(toasts.items).toHaveLength(1);
		vi.advanceTimersByTime(6000);
		expect(toasts.items).toHaveLength(0);
	});

	it('keeps a focused toast open after the pointer leaves', () => {
		toasts.push('Kaydedildi');
		const id = lastId();
		toasts.pause(id, 'hover');
		toasts.pause(id, 'focus');
		toasts.resume(id, 'hover');
		vi.advanceTimersByTime(60_000);
		expect(toasts.items.map((item) => item.id)).toContain(id);

		toasts.resume(id, 'focus');
		vi.advanceTimersByTime(6000);
		expect(toasts.items.map((item) => item.id)).not.toContain(id);
	});

	it('keeps a hovered toast open after focus leaves', () => {
		toasts.push('Paylaşıldı');
		const id = lastId();
		toasts.pause(id, 'focus');
		toasts.pause(id, 'hover');
		toasts.resume(id, 'focus');
		vi.advanceTimersByTime(60_000);
		expect(toasts.items.map((item) => item.id)).toContain(id);
		toasts.resume(id, 'hover');
		vi.advanceTimersByTime(6000);
		expect(toasts.items).toHaveLength(0);
	});
});
