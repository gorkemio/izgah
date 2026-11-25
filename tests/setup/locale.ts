/**
 * Unit and integration tests run in Turkish with the original team's time zone, so the existing
 * Turkish assertions keep guarding the stable accessible-name contract (izgah-i18n-oss.md §8).
 * English behaviour is covered by tests that pass an explicit locale.
 */
import { setFallbackLocale, toLocale } from '../../src/lib/i18n';
import { registerServerInstanceConfig } from '../../src/lib/instance';

setFallbackLocale(toLocale(process.env.DEFAULT_LOCALE, 'tr'));
registerServerInstanceConfig({
	name: process.env.INSTANCE_NAME ?? 'İzgah',
	timeZone: process.env.APP_TIME_ZONE ?? 'Europe/Istanbul',
	sourceUrl: process.env.SOURCE_URL ?? 'https://github.com/gorkemio/izgah'
});
