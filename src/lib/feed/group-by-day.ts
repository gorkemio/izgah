import { dayKey, dayLabel } from '$lib/format/date';

export interface DayGroup<T> {
	key: string;
	label: string;
	items: T[];
}

/** Groups newest-first items into consecutive Istanbul calendar days. */
export function groupByDay<T extends { createdAt: string }>(
	items: readonly T[],
	today: string
): DayGroup<T>[] {
	const groups: DayGroup<T>[] = [];
	for (const item of items) {
		const key = dayKey(item.createdAt);
		const last = groups.at(-1);
		if (last && last.key === key) {
			last.items.push(item);
		} else {
			groups.push({ key, label: dayLabel(key, today), items: [item] });
		}
	}
	return groups;
}
