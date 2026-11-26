export interface MergeableFeedItem {
	id: string;
	/** ISO timestamp; items are ordered newest first. */
	createdAt: string;
}

export interface MergeFeedInput<T extends MergeableFeedItem> {
	/** First page currently shown (before the refresh). */
	previousFirstPage: readonly T[];
	/** Items appended with "Load more". */
	appended: readonly T[];
	/** Refreshed first page from the server. */
	freshFirstPage: readonly T[];
	pageSize: number;
}

export interface MergeFeedResult<T> {
	appended: T[];
	/** True when the appended pages can no longer be stitched to the fresh first page. */
	reset: boolean;
}

/**
 * Re-stitches appended pages after the first page was refreshed (like, unfurl polling, new share).
 *
 * - Items that dropped out of the refreshed first page but are older than its oldest item were
 *   pushed down by new shares: they move to the front of the appended pages.
 * - Items missing from inside the refreshed page's time window were deleted: they are dropped.
 * - When more than a full page of new items arrived, the old pages no longer connect: reset.
 */
export function mergeRefreshedFirstPage<T extends MergeableFeedItem>(
	input: MergeFeedInput<T>
): MergeFeedResult<T> {
	const { previousFirstPage, appended, freshFirstPage, pageSize } = input;
	if (appended.length === 0) {
		return { appended: [], reset: false };
	}

	const previousIds = new Set(previousFirstPage.map((item) => item.id));
	const newArrivals = freshFirstPage.filter((item) => !previousIds.has(item.id));
	const newestPrevious = previousFirstPage[0]?.createdAt;
	const oldestFresh = freshFirstPage.at(-1)?.createdAt;
	if (
		freshFirstPage.length >= pageSize &&
		newestPrevious !== undefined &&
		oldestFresh !== undefined &&
		oldestFresh > newestPrevious &&
		newArrivals.length >= pageSize
	) {
		return { appended: [], reset: true };
	}

	const freshIds = new Set(freshFirstPage.map((item) => item.id));
	const carried =
		oldestFresh === undefined
			? []
			: previousFirstPage.filter((item) => !freshIds.has(item.id) && item.createdAt < oldestFresh);
	const carriedIds = new Set(carried.map((item) => item.id));
	const rest = appended.filter((item) => !freshIds.has(item.id) && !carriedIds.has(item.id));
	return { appended: [...carried, ...rest], reset: false };
}
