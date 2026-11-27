<script lang="ts">
	import { t } from '#lib/i18n/index.ts';
	import { enhance, type SubmitFunction } from '$app/forms';
	import { toasts } from '#lib/client/toast.svelte.ts';
	import { page } from '$app/state';
	import { getThemeState, type ThemeChoice } from '#lib/client/theme.svelte.ts';

	interface Props {
		/** Server-rendered choice; the shared ThemeState wins once it exists. */
		theme: ThemeChoice;
		variant?: 'menu' | 'list';
		legend?: string;
	}

	let { theme, variant = 'menu', legend = t('theme.legend') }: Props = $props();

	const themeState = getThemeState();
	const current = $derived(themeState?.value ?? theme);
	const returnTo = $derived(`${page.url.pathname}${page.url.search}`);

	const options = [
		['system', t('theme.system')],
		['light', t('theme.light')],
		['dark', t('theme.dark')]
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
			{#each options as [value, label] (value)}
				<label class="theme-option">
					<input
						type="radio"
						name="theme"
						{value}
						checked={current === value}
						onchange={(event) => event.currentTarget.form?.requestSubmit()}
					/>
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
		font: var(--type-ui);
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
		border-block: 1px solid var(--hairline);
	}

	.is-menu legend {
		padding-inline: var(--space-2);
		margin-block-end: var(--space-1);
		font-family: var(--font-sans);
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--muted-foreground);
	}

	.is-menu .theme-options {
		display: grid;
		gap: 2px;
	}

	.is-menu .theme-option {
		display: flex;
		min-block-size: 32px;
		padding: 0 var(--space-2);
		color: var(--muted-foreground);
		border-radius: var(--radius-md);
	}

	.is-menu .theme-option:hover {
		background: var(--accent);
		color: var(--foreground);
	}

	.is-menu .theme-option:has(input:checked) {
		background: var(--accent);
		color: var(--foreground);
		font-weight: 600;
	}

	/* Settings: a plain radio list (izgah-ui-v4 §7), native radios with visible labels. */
	.is-list legend {
		position: absolute;
		inline-size: 1px;
		block-size: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	.is-list .theme-options {
		display: grid;
		gap: 2px;
	}

	.is-list .theme-option {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-block-size: 32px;
		font: var(--type-ui);
		font-weight: 400;
		color: var(--foreground);
		cursor: pointer;
	}

	.is-list .theme-option:has(input:checked) {
		font-weight: 600;
	}

	.is-list input {
		inline-size: 16px;
		block-size: 16px;
		margin: 0;
	}

	@media (pointer: coarse) {
		.is-list .theme-option {
			min-block-size: 44px;
		}
	}
</style>
