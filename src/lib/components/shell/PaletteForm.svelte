<script lang="ts">
	import { t } from '#lib/i18n/index.ts';
	import { enhance, type SubmitFunction } from '$app/forms';
	import { toasts } from '#lib/client/toast.svelte.ts';
	import { page } from '$app/state';
	import { getThemeState } from '#lib/client/theme.svelte.ts';
	import {
		DARK_THEME_VALUES,
		DEFAULT_PALETTE,
		LIGHT_THEME_VALUES,
		pickAllowed,
		type DarkTheme,
		type LightTheme,
		type Palette
	} from '#lib/types/appearance.ts';

	/**
	 * Standard or high-contrast palette for the light and the dark scheme
	 * (docs/designs/izgah-ui-v4.md §1). A plain radio list; it works without JavaScript.
	 */
	interface Props {
		/** Server-rendered palette; the shared ThemeState wins once it exists. */
		palette: Palette;
	}

	let { palette }: Props = $props();

	const themeState = getThemeState();
	const current = $derived(themeState?.palette ?? palette);
	const returnTo = $derived(`${page.url.pathname}${page.url.search}`);

	const lightOptions: ReadonlyArray<readonly [LightTheme, string]> = [
		['default', t('palette.default')],
		['contrast', t('palette.highContrast')]
	];
	const darkOptions: ReadonlyArray<readonly [DarkTheme, string]> = [
		['default', t('palette.default')],
		['contrast', t('palette.highContrast')]
	];

	function submitOnChange(event: Event & { currentTarget: HTMLInputElement }): void {
		event.currentTarget.form?.requestSubmit();
	}

	// Works without JS (POST + 303); with JS the page is not reloaded (izgah-themes §5).
	const handleEnhance: SubmitFunction = ({ formData }) => {
		themeState?.applyPalette({
			lightTheme: pickAllowed(
				LIGHT_THEME_VALUES,
				formData.get('lightTheme'),
				DEFAULT_PALETTE.lightTheme
			),
			darkTheme: pickAllowed(
				DARK_THEME_VALUES,
				formData.get('darkTheme'),
				DEFAULT_PALETTE.darkTheme
			)
		});
		return async ({ result, update }) => {
			if (result.type !== 'success') {
				toasts.push(t('palette.saveFailed'), { tone: 'error' });
				// The action lives on /settings; stay on the current page (SvelteKit 3 would navigate).
				await update({ navigate: false });
			}
		};
	};
</script>

<form
	method="POST"
	action="/settings?/setPalette"
	class="palette-form"
	data-testid="palette-form"
	use:enhance={handleEnhance}
>
	<fieldset>
		<legend>{t('palette.lightTheme')}</legend>
		{#each lightOptions as [value, label] (value)}
			<label class="palette-choice">
				<input
					type="radio"
					name="lightTheme"
					{value}
					checked={current.lightTheme === value}
					onchange={submitOnChange}
				/>
				<span>{label}</span>
			</label>
		{/each}
	</fieldset>

	<fieldset>
		<legend>{t('palette.darkTheme')}</legend>
		{#each darkOptions as [value, label] (value)}
			<label class="palette-choice">
				<input
					type="radio"
					name="darkTheme"
					{value}
					checked={current.darkTheme === value}
					onchange={submitOnChange}
				/>
				<span>{label}</span>
			</label>
		{/each}
	</fieldset>

	<p class="palette-hint">{t('palette.hint')}</p>
	<input type="hidden" name="returnTo" value={returnTo} />
	<noscript><button type="submit" class="btn btn-outline">{t('common.apply')}</button></noscript>
</form>

<style>
	.palette-form {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-4) var(--space-7);
		margin-block-start: var(--space-4);
	}

	fieldset {
		display: grid;
		gap: var(--space-1);
		margin: 0;
		padding: 0;
		border: 0;
	}

	legend {
		margin-block-end: var(--space-2);
		padding: 0;
		font: var(--k-text-ui);
		font-weight: 600;
		color: var(--k-color-text);
	}

	.palette-choice {
		display: flex;
		gap: var(--space-2);
		align-items: center;
		min-block-size: 32px;
		font: var(--k-text-body);
		color: var(--k-color-text);
		cursor: pointer;
	}

	.palette-choice input {
		margin: 0;
		accent-color: var(--k-color-text);
	}

	.palette-hint {
		flex-basis: 100%;
		margin: 0;
		font: var(--k-text-hint);
		color: var(--k-color-text-muted);
	}

	@media (pointer: coarse) {
		.palette-choice {
			min-block-size: 44px;
		}
	}
</style>
