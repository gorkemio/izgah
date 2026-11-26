<script lang="ts">
	import { t } from '#lib/i18n/index.ts';
	import { enhance, type SubmitFunction } from '$app/forms';
	import { toasts } from '#lib/client/toast.svelte.ts';
	import { page } from '$app/state';
	import Icon from '#lib/components/ui/Icon.svelte';
	import { getThemeState, type ThemeChoice } from '#lib/client/theme.svelte.ts';

	interface Props {
		/** Server-rendered choice; the shared ThemeState wins once it exists. */
		theme: ThemeChoice;
		variant?: 'menu' | 'segmented';
		legend?: string;
	}

	let { theme, variant = 'menu', legend = t('theme.legend') }: Props = $props();

	const themeState = getThemeState();
	const current = $derived(themeState?.value ?? theme);
	const returnTo = $derived(`${page.url.pathname}${page.url.search}`);

	const options = [
		['system', t('theme.system'), 'monitor'],
		['light', t('theme.light'), 'sun'],
		['dark', t('theme.dark'), 'moon']
	] as const;

	// Works without JS (POST + 303); with JS the page is not reloaded (izgah-ui-v2 §9).
	const handleEnhance: SubmitFunction = ({ formData }) => {
		const chosen = String(formData.get('theme') ?? 'system') as ThemeChoice;
		themeState?.apply(chosen);
		return async ({ result, update }) => {
			if (result.type !== 'success') {
				toasts.push(t('theme.saveFailed'), { tone: 'error' });
				// The action lives on /settings; stay on the current page (SvelteKit 3 would navigate).
				await update({ navigate: false });
			}
		};
	};
</script>

<form
	method="POST"
	action="/settings?/setTheme"
	class="theme-form is-{variant}"
	use:enhance={handleEnhance}
>
	<fieldset>
		<legend>{legend}</legend>
		<div class="theme-options">
			{#each options as [value, label, icon] (value)}
				<label class="theme-option">
					<input
						type="radio"
						name="theme"
						{value}
						checked={current === value}
						onchange={(event) => event.currentTarget.form?.requestSubmit()}
					/>
					<Icon name={icon} size={15} />
					<span>{label}</span>
				</label>
			{/each}
		</div>
	</fieldset>
	<input type="hidden" name="returnTo" value={returnTo} />
	<noscript><button type="submit" class="btn btn-outline">{t('common.apply')}</button></noscript>
</form>

<style>
	fieldset {
		margin: 0;
		padding: 0;
		border: 0;
		min-inline-size: 0;
	}

	.theme-option {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		font: var(--text-ui);
		cursor: pointer;
		transition:
			background-color var(--dur-fast) var(--ease),
			color var(--dur-fast) var(--ease),
			border-color var(--dur-fast) var(--ease);
	}

	/* Account menu: compact vertical list between hairlines. */
	.is-menu fieldset {
		margin: var(--space-1) 0;
		padding: var(--space-2) 0;
		border-block: 1px solid var(--color-line);
	}

	.is-menu legend {
		padding-inline: var(--space-2);
		margin-block-end: var(--space-1);
		font-family: var(--font-sans);
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-text-muted);
	}

	.is-menu .theme-options {
		display: grid;
		gap: 2px;
	}

	.is-menu .theme-option {
		display: flex;
		min-block-size: 32px;
		padding: 0 var(--space-2);
		color: var(--color-text-secondary);
		border-radius: var(--radius-sm);
	}

	.is-menu .theme-option:hover {
		background: var(--color-surface-2);
		color: var(--color-text);
	}

	.is-menu .theme-option:has(input:checked) {
		background: var(--color-surface-2);
		color: var(--color-text);
		font-weight: 600;
	}

	/* Settings: crisp Studio SegmentedControl look with native radio inputs. */
	.is-segmented legend {
		margin-block-end: var(--space-2);
		font: var(--text-ui);
		font-weight: 600;
		color: var(--color-text);
	}

	.is-segmented .theme-options {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		padding: 3px;
		max-inline-size: 100%;
		overflow-x: auto;
		background: var(--color-surface-2);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-sm);
	}

	.is-segmented .theme-option {
		position: relative;
		justify-content: center;
		min-block-size: 32px;
		padding: 0 14px;
		border: 1px solid transparent;
		border-radius: calc(var(--radius-sm) - 2px);
		color: var(--color-text-secondary);
		white-space: nowrap;
	}

	.is-segmented .theme-option:not(:has(input:checked)):hover {
		color: var(--color-text);
		background: var(--color-surface-3);
	}

	.is-segmented .theme-option:has(input:checked) {
		background: var(--color-surface-1);
		color: var(--color-text);
		border-color: var(--color-line);
		font-weight: 600;
		box-shadow: var(--shadow-xs);
	}

	.is-segmented .theme-option:has(input:focus-visible) {
		outline: 2px solid transparent;
		outline-offset: 2px;
		box-shadow:
			0 0 0 2px var(--color-bg),
			0 0 0 4px var(--color-accent);
	}

	.is-segmented input {
		/* Transparent radio covering the whole segment: it receives the click itself. */
		position: absolute;
		inset: 0;
		inline-size: 100%;
		block-size: 100%;
		margin: 0;
		opacity: 0;
		cursor: pointer;
	}

	@media (pointer: coarse) {
		.is-segmented .theme-option {
			min-block-size: 40px;
		}
	}

	@media (forced-colors: active) {
		.is-segmented .theme-option:has(input:checked) {
			forced-color-adjust: none;
			background: Highlight;
			color: HighlightText;
			border-color: Highlight;
			box-shadow: none;
		}
	}
</style>
