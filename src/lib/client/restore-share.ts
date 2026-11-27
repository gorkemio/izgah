import { deserialize } from '$app/forms';
import { t } from '#lib/i18n/index.ts';

/**
 * Calls the feed's `?/restoreShare` action for the toast's "Undo" button
 * (docs/designs/izgah-ui-v5.md §10.3). The toast lives outside any form, so the action is posted
 * the way `use:enhance` would post it.
 */
export async function restoreShare(
	shareId: string
): Promise<{ ok: true } | { ok: false; message: string }> {
	const body = new FormData();
	body.set('shareId', shareId);
	try {
		const response = await fetch('/?/restoreShare', {
			method: 'POST',
			body,
			headers: { accept: 'application/json', 'x-sveltekit-action': 'true' }
		});
		const result = deserialize(await response.text());
		if (result.type === 'success') {
			return { ok: true };
		}
		if (result.type === 'failure') {
			const data = result.data as { errorMessage?: string } | undefined;
			return { ok: false, message: data?.errorMessage ?? t('share.restoreExpired') };
		}
	} catch {
		// Network failure: fall through.
	}
	return { ok: false, message: t('error.generic') };
}
