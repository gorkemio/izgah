<script lang="ts">
	import { t } from '#lib/i18n/index.ts';
	import Dialog from '#lib/components/legacy/Dialog.svelte';
	import type { ShortcutPreference } from '#lib/client/shortcuts.svelte.ts';

	interface Props {
		open?: boolean;
		preference: ShortcutPreference;
		/** The current page lists posts, so the post shortcuts apply. */
		hasPosts: boolean;
	}

	let { open = $bindable(false), preference, hasPosts }: Props = $props();

	const titleId = 'keyboard-help-title';

	const alwaysRows = [{ keys: ['⌘K', 'Ctrl+K'], action: t('help.openPalette') }];

	const postRows = [
		{ keys: ['j', 'k'], action: t('help.nextPrev') },
		{ keys: ['o', 'Enter'], action: t('help.openLink') },
		{ keys: [t('help.spaceKey')], action: t('help.peek') },
		{ keys: ['l'], action: t('help.like') },
		{ keys: ['c'], action: t('help.comments') }
	];
	const globalRows = [
		{ keys: ['/'], action: t('help.search') },
		{ keys: ['n'], action: t('help.share') },
		{ keys: ['?'], action: t('help.thisDialog') }
	];
	const singleKeyRows = $derived(hasPosts ? [...postRows, ...globalRows] : globalRows);
</script>

<Dialog bind:open id="keyboard-help-dialog" {titleId} closedby="any">
	{#snippet children({ requestClose })}
		<div class="help">
			<header class="help-head">
				<h2 id={titleId}>{t('help.title')}</h2>
				<button type="button" class="btn btn-ghost btn-sm" onclick={() => requestClose('cancel')}>
					{t('common.close')}
				</button>
			</header>

			<table class="keys">
				<caption class="visually-hidden">{t('help.alwaysCaption')}</caption>
				<thead class="visually-hidden">
					<tr>
						<th scope="col">{t('help.key')}</th>
						<th scope="col">{t('help.action')}</th>
					</tr>
				</thead>
				<tbody>
					{#each alwaysRows as row (row.action)}
						<tr>
							<td class="key-cell">
								{#each row.keys as key, index (key)}
									{#if index > 0}<span class="sep">/</span>{/if}<kbd class="kbd">{key}</kbd>
								{/each}
							</td>
							<td>{row.action}</td>
						</tr>
					{/each}
				</tbody>
			</table>

			<div class="single-key-block">
				<label class="switch-row">
					<input
						type="checkbox"
						checked={preference.enabled}
						onchange={(event) => preference.set(event.currentTarget.checked)}
					/>
					<span>{t('help.singleKey')}</span>
				</label>
				<p class="field-hint">{t('help.singleKeyHint')}</p>
			</div>

			<table class="keys" class:is-off={!preference.enabled}>
				<caption class="visually-hidden">{t('help.singleKeyCaption')}</caption>
				<thead class="visually-hidden">
					<tr>
						<th scope="col">{t('help.key')}</th>
						<th scope="col">{t('help.action')}</th>
					</tr>
				</thead>
				<tbody>
					{#each singleKeyRows as row (row.action)}
						<tr>
							<td class="key-cell">
								{#each row.keys as key, index (key)}
									{#if index > 0}<span class="sep">/</span>{/if}<kbd class="kbd">{key}</kbd>
								{/each}
							</td>
							<td>{row.action}</td>
						</tr>
					{/each}
				</tbody>
			</table>

			<p class="field-hint">{t('help.footer')}</p>
		</div>
	{/snippet}
</Dialog>

<style>
	.help {
		display: grid;
		gap: var(--space-4);
	}

	.help-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding-block-end: var(--space-3);
		border-block-end: 1px solid var(--k-color-line);
	}

	.help-head h2 {
		font: var(--k-text-section);
		font-size: 1.0625rem;
		color: var(--k-color-text);
	}

	.single-key-block {
		display: grid;
		gap: var(--space-2);
	}

	.switch-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-block-size: 40px;
		font: var(--k-text-ui);
		color: var(--k-color-text);
		cursor: pointer;
	}

	.switch-row input {
		inline-size: 16px;
		block-size: 16px;
	}

	.keys {
		inline-size: 100%;
		border-collapse: collapse;
		font: var(--k-text-ui);
		color: var(--k-color-text);
	}

	.keys.is-off {
		color: var(--k-color-text-muted);
	}

	.keys td {
		padding: var(--space-2) var(--space-1);
		vertical-align: middle;
		border-block-end: 1px solid var(--k-color-line);
	}

	.keys tbody tr:last-child td {
		border-block-end: 0;
	}

	.key-cell {
		inline-size: 9.5rem;
		white-space: nowrap;
	}

	.help :global(.kbd) {
		min-inline-size: 1.75em;
		padding: 0 6px;
	}

	.sep {
		padding-inline: var(--space-1);
		color: var(--k-color-text-muted);
	}

	@media (pointer: coarse) {
		.switch-row {
			min-block-size: 44px;
		}
	}
</style>
