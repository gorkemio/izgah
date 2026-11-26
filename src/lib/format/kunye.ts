import { formatCompactNumber, formatNumber, intlLocale, t } from '#lib/i18n/index.ts';
import type { ProviderMeta } from '#lib/types/domain.ts';
import { contentTypeLabel } from '#lib/types/feed.ts';

/** Lower-cases a label for the künye line in the active locale ("Makale" → "makale", "İ" → "i"). */
export function kunyeCase(text: string): string {
	return text.toLocaleLowerCase(intlLocale());
}

/**
 * The link's own facts, in künye order: site · type · language · stars · author
 * (docs/designs/izgah-ui-v4.md §4). The feed entry, the reading pane and the resource page share it.
 */
export function resourceFacts(resource: {
	domain: string;
	contentType: string;
	providerMeta?: ProviderMeta | null;
}): string[] {
	const meta = resource.providerMeta;
	const stars = meta?.stars;
	return [
		resource.domain,
		kunyeCase(contentTypeLabel(resource.contentType)),
		meta?.language ?? null,
		stars !== undefined
			? t('share.stars', {
					count: stars >= 1000 ? formatCompactNumber(stars) : formatNumber(stars)
				})
			: null,
		meta?.authorName ?? null
	].filter((part): part is string => Boolean(part));
}
