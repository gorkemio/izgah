import { mergeRefreshedFirstPage, type MergeableFeedItem } from './merge';

/**
 * Per-FeedView feed state (docs/designs/izgah-ui-v2.md §8.6). Instantiated inside the component —
 * never at module level — so server renders cannot share one user's feed with another.
 * The first page comes from page data; pages appended with "Load more" are kept across
 * same-query refreshes (likes, unfurl polling, edits) and re-stitched with the merge rules.
 */
export class FeedState<T extends MergeableFeedItem> {
	base = $state.raw<T[]>([]);
	appended = $state.raw<T[]>([]);
	hasMoreOverride = $state<boolean | null>(null);
	nextCursorOverride = $state<string | null | undefined>(undefined);
	#queryKey: string;
	#pageSize: number;

	items = $derived.by(() => {
		if (this.appended.length === 0) {
			return this.base;
		}
		const seen = new Set(this.base.map((item) => item.id));
		return [...this.base, ...this.appended.filter((item) => !seen.has(item.id))];
	});

	constructor(base: T[], queryKey: string, pageSize: number) {
		this.base = base;
		this.#queryKey = queryKey;
		this.#pageSize = pageSize;
	}

	/** Applies fresh page data: resets on a new query, otherwise merges with appended pages. */
	sync(base: T[], queryKey: string): void {
		if (base === this.base && queryKey === this.#queryKey) {
			return;
		}
		if (queryKey !== this.#queryKey) {
			this.#queryKey = queryKey;
			this.reset(base);
			return;
		}
		const merged = mergeRefreshedFirstPage({
			previousFirstPage: this.base,
			appended: this.appended,
			freshFirstPage: base,
			pageSize: this.#pageSize
		});
		if (merged.reset) {
			this.reset(base);
			return;
		}
		this.base = base;
		this.appended = merged.appended;
	}

	reset(base: T[]): void {
		this.base = base;
		this.appended = [];
		this.hasMoreOverride = null;
		this.nextCursorOverride = undefined;
	}

	append(items: T[], hasMore: boolean, nextCursor: string | null): number {
		const existing = new Set(this.items.map((item) => item.id));
		const fresh = items.filter((item) => !existing.has(item.id));
		this.appended = [...this.appended, ...fresh];
		this.hasMoreOverride = hasMore;
		this.nextCursorOverride = nextCursor;
		return fresh.length;
	}

	/** Re-applies pages restored from a navigation snapshot (Back after "Load more"). */
	restore(appended: T[], hasMore: boolean | null, nextCursor: string | null | undefined): void {
		const existing = new Set(this.base.map((item) => item.id));
		this.appended = appended.filter((item) => !existing.has(item.id));
		this.hasMoreOverride = hasMore;
		this.nextCursorOverride = nextCursor;
	}

	remove(id: string): void {
		this.base = this.base.filter((item) => item.id !== id);
		this.appended = this.appended.filter((item) => item.id !== id);
	}
}
