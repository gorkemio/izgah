<script lang="ts">
	import { t } from '$lib/i18n';
	import { enhance } from '$app/forms';
	import { toasts } from '$lib/client/toast.svelte';
	import { page } from '$app/state';
	import type { SubmitFunction } from '@sveltejs/kit';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { getThemeState } from '$lib/client/theme.svelte';
	import {
		ACCENT_VALUES,
		DARK_THEME_VALUES,
		DEFAULT_PALETTE,
		LIGHT_THEME_VALUES,
		pickAllowed,
		type Accent,
		type DarkTheme,
		type LightTheme,
		type Palette
	} from '$lib/types/appearance';

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
		['dim', t('palette.dim')],
		['contrast', t('palette.highContrast')]
	];
	const accentOptions: ReadonlyArray<readonly [Accent, string]> = [
		['teal', t('accent.teal')],
		['cobalt', t('accent.cobalt')],
		['terracotta', t('accent.terracotta')],
		['plum', t('accent.plum')]
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
			),
			accent: pickAllowed(ACCENT_VALUES, formData.get('accent'), DEFAULT_PALETTE.accent)
		});
		return async ({ result, update }) => {
			if (result.type !== 'success') {
				toasts.push(t('palette.saveFailed'), { tone: 'error' });
				await update();
			}
		};
	};
</script>

{#snippet miniUi()}
	<span class="mini-ui-side">
		<span class="mini-brand">
			<span class="mini-bar is-brand"></span>
			<span class="mini-dot"></span>
		</span>
		<span class="mini-nav is-active"></span>
		<span class="mini-nav"></span>
		<span class="mini-nav is-short"></span>
	</span>
	<span class="mini-ui-main">
		<span class="mini-bar is-heading"></span>
		<span class="mini-card">
			<span class="mini-bar is-title"></span>
			<span class="mini-card-row">
				<span class="mini-bar is-sub"></span>
				<span class="mini-pill"></span>
			</span>
		</span>
	</span>
{/snippet}

<form
	method="POST"
	action="/settings?/setPalette"
	class="palette-form"
	data-testid="palette-form"
	use:enhance={handleEnhance}
>
	<fieldset>
		<legend>{t('palette.lightTheme')}</legend>
		<div class="palette-options">
			{#each lightOptions as [value, label] (value)}
				<label class="palette-option">
					<span
						class="theme-preview is-light mini-ui"
						data-light-theme={value}
						data-accent={current.accent}
						aria-hidden="true"
					>
						{@render miniUi()}
					</span>
					<span class="palette-label">
						<input
							type="radio"
							name="lightTheme"
							{value}
							checked={current.lightTheme === value}
							onchange={submitOnChange}
						/>
						<span class="palette-name">{label}</span>
						<Icon name="check" size={15} class="palette-check" />
					</span>
				</label>
			{/each}
		</div>
	</fieldset>

	<fieldset>
		<legend>{t('palette.darkTheme')}</legend>
		<div class="palette-options">
			{#each darkOptions as [value, label] (value)}
				<label class="palette-option">
					<span
						class="theme-preview is-dark mini-ui"
						data-dark-theme={value}
						data-accent={current.accent}
						aria-hidden="true"
					>
						{@render miniUi()}
					</span>
					<span class="palette-label">
						<input
							type="radio"
							name="darkTheme"
							{value}
							checked={current.darkTheme === value}
							onchange={submitOnChange}
						/>
						<span class="palette-name">{label}</span>
						<Icon name="check" size={15} class="palette-check" />
					</span>
				</label>
			{/each}
		</div>
	</fieldset>

	<fieldset>
		<legend>{t('palette.accent')}</legend>
		<div class="palette-options is-accents">
			{#each accentOptions as [value, label] (value)}
				<label class="accent-pill">
					<input
						type="radio"
						name="accent"
						{value}
						checked={current.accent === value}
						onchange={submitOnChange}
					/>
					<span class="theme-preview accent-swatch" data-accent={value} aria-hidden="true"></span>
					<span class="accent-name">{label}</span>
					<Icon name="check" size={14} class="palette-check" />
				</label>
			{/each}
		</div>
	</fieldset>

	<p class="palette-hint">
		{t('palette.hint')}
	</p>
	<input type="hidden" name="returnTo" value={returnTo} />
	<noscript><button type="submit" class="btn btn-outline">{t('common.apply')}</button></noscript>
</form>

<style>
	.palette-form {
		display: grid;
		gap: var(--space-5);
		margin-block-start: var(--space-5);
	}

	fieldset {
		margin: 0;
		padding: 0;
		border: 0;
		min-inline-size: 0;
	}

	legend {
		margin-block-end: var(--space-2);
		padding: 0;
		font: var(--text-ui);
		font-weight: 600;
		color: var(--color-text);
	}

	.palette-options {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(11.5rem, 1fr));
		gap: var(--space-3);
	}

	.palette-options.is-accents {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.palette-option {
		display: grid;
		grid-template-rows: auto 1fr;
		align-items: start;
		gap: var(--space-2);
		padding: 10px;
		background: var(--color-surface-1);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-md);
		cursor: pointer;
		transition:
			background-color var(--dur-fast) var(--ease),
			border-color var(--dur-fast) var(--ease),
			box-shadow var(--dur-fast) var(--ease);
	}

	.palette-option:hover {
		border-color: var(--color-line-strong);
	}

	/* Selection is shown by the native radio, accent border/ring, and check icon — never color alone. */
	.palette-option:has(input:checked) {
		border-color: var(--color-accent);
		box-shadow: 0 0 0 1px var(--color-accent);
	}

	.palette-label {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-block-size: 28px;
		font: var(--text-ui);
		font-size: 0.8125rem;
		color: var(--color-text);
	}

	.palette-label input {
		margin: 0;
		flex: none;
	}

	.palette-name {
		font-weight: 500;
	}

	.palette-option:has(input:checked) .palette-name {
		font-weight: 600;
	}

	.palette-label :global(.palette-check),
	.accent-pill :global(.palette-check) {
		flex: none;
		margin-inline-start: auto;
		color: var(--color-accent-text);
		visibility: hidden;
	}

	.palette-option:has(input:checked) :global(.palette-check),
	.accent-pill:has(input:checked) :global(.palette-check) {
		visibility: visible;
	}

	/*
	 * Miniature Studio UI preview cards resolve tokens under their own palette & color scheme
	 * (tokens.css mirrors the semantic mapping onto .theme-preview).
	 */
	.theme-preview.is-light {
		color-scheme: light;
	}

	.theme-preview.is-dark {
		color-scheme: dark;
	}

	.mini-ui {
		display: grid;
		grid-template-columns: 30% minmax(0, 1fr);
		block-size: 76px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--color-line);
		background: var(--color-bg);
		color: var(--color-text);
		overflow: hidden;
	}

	.mini-ui-side {
		display: grid;
		align-content: start;
		gap: 5px;
		padding: 8px 6px;
		background: var(--color-surface-1);
		border-inline-end: 1px solid var(--color-line);
	}

	.mini-brand {
		display: flex;
		align-items: center;
		gap: 3px;
		margin-block-end: 2px;
	}

	.mini-dot {
		inline-size: 4px;
		block-size: 4px;
		border-radius: var(--radius-pill);
		background: var(--color-accent);
		flex: none;
	}

	.mini-nav {
		display: block;
		block-size: 5px;
		inline-size: 76%;
		border-radius: 3px;
		background: var(--color-surface-3);
	}

	.mini-nav.is-active {
		inline-size: 92%;
		background: var(--color-surface-2);
		border-inline-start: 2px solid var(--color-accent);
		border-radius: 0 3px 3px 0;
	}

	.mini-nav.is-short {
		inline-size: 58%;
	}

	.mini-ui-main {
		display: grid;
		align-content: start;
		gap: 6px;
		padding: 8px;
	}

	.mini-bar {
		display: block;
		block-size: 5px;
		border-radius: 3px;
		background: var(--color-text);
	}

	.mini-bar.is-brand {
		inline-size: 62%;
	}

	.mini-bar.is-heading {
		inline-size: 44%;
	}

	.mini-card {
		display: grid;
		gap: 6px;
		padding: 7px;
		border-radius: 5px;
		background: var(--color-surface-1);
		border: 1px solid var(--color-line);
	}

	.mini-bar.is-title {
		inline-size: 80%;
	}

	.mini-card-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 6px;
	}

	.mini-bar.is-sub {
		inline-size: 52%;
		block-size: 4px;
		background: var(--color-text-muted);
	}

	.mini-pill {
		inline-size: 16px;
		block-size: 6px;
		border-radius: var(--radius-pill);
		background: var(--color-accent);
		flex: none;
	}

	/* Accent pills */
	.accent-pill {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		min-block-size: 36px;
		padding: 0 12px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--color-line);
		background: var(--color-surface-1);
		font: var(--text-ui);
		font-size: 0.8125rem;
		color: var(--color-text);
		cursor: pointer;
		transition:
			background-color var(--dur-fast) var(--ease),
			border-color var(--dur-fast) var(--ease),
			color var(--dur-fast) var(--ease);
	}

	.accent-pill:hover {
		border-color: var(--color-line-strong);
		background: var(--color-surface-2);
	}

	.accent-pill input {
		margin: 0;
		flex: none;
	}

	.accent-pill:has(input:checked) {
		border-color: var(--color-accent);
		background: var(--color-accent-soft);
		color: var(--color-accent-text);
		font-weight: 600;
	}

	.accent-swatch {
		flex: none;
		inline-size: 14px;
		block-size: 14px;
		border-radius: var(--radius-pill);
		background: var(--color-accent);
		border: 1px solid color-mix(in oklab, var(--color-text) 20%, transparent);
	}

	.palette-hint {
		font: var(--text-hint);
		color: var(--color-text-muted);
	}

	@media (pointer: coarse) {
		.palette-label,
		.accent-pill {
			min-block-size: 44px;
		}
	}

	@media (forced-colors: active) {
		/* The previews are colour samples: keep their real colours (izgah-themes §5). */
		.theme-preview,
		.theme-preview * {
			forced-color-adjust: none;
		}

		.palette-option:has(input:checked),
		.accent-pill:has(input:checked) {
			border-color: Highlight;
			box-shadow: none;
		}
	}
</style>
