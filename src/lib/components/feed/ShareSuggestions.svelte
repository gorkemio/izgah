<script lang="ts">
	import { t } from '#lib/i18n/index.ts';
	import { enhance, type SubmitFunction } from '$app/forms';
	import { invalidate } from '$app/navigation';
	import { toasts } from '#lib/client/toast.svelte.ts';
	import type { FeedShareSuggestion } from '#lib/types/feed.ts';

	/**
	 * Section suggestions under a card (docs/designs/izgah-smart-capture.md §10). Shown only to the
	 * author and admins; every button is a form, so it works without JavaScript.
	 */
	interface Props {
		shareId: string;
		suggestions: FeedShareSuggestion[];
		actionBase: string;
		returnTo: string;
	}

	let { shareId, suggestions, actionBase, returnTo }: Props = $props();

	const pending = $derived(suggestions.filter((s) => s.status === 'pending'));
	const autoApplied = $derived(suggestions.filter((s) => s.status === 'auto_applied'));
	let busy = $state(false);

	const refresh: SubmitFunction = () => {
		busy = true;
		return async ({ result }) => {
			busy = false;
			if (result.type === 'failure' || result.type === 'error') {
				toasts.push(t('suggest.failed'), { tone: 'error' });
				return;
			}
			await invalidate('app:feed');
		};
	};
</script>

{#if pending.length > 0}
	<div class="share-suggestions" role="group" aria-label={t('suggest.groupLabel')}>
		<span class="label">{t('suggest.label')}</span>
		{#each pending as suggestion (suggestion.sectionId)}
			<form method="POST" action="{actionBase}?/acceptSuggestion" use:enhance={refresh}>
				<input type="hidden" name="shareId" value={shareId} />
				<input type="hidden" name="sectionId" value={suggestion.sectionId} />
				<input type="hidden" name="returnTo" value={returnTo} />
				<button
					type="submit"
					class="suggestion-add"
					disabled={busy}
					aria-label={t('suggest.addAria', { section: suggestion.name })}
					title={suggestion.source === 'ai' ? t('suggest.fromAi') : t('suggest.fromHistory')}
				>
					+ {suggestion.name}
				</button>
			</form>
		{/each}
		<form method="POST" action="{actionBase}?/dismissSuggestions" use:enhance={refresh}>
			<input type="hidden" name="shareId" value={shareId} />
			<input type="hidden" name="returnTo" value={returnTo} />
			<button type="submit" class="suggestion-dismiss" disabled={busy}>
				{t('suggest.dismiss')}
			</button>
		</form>
	</div>
{/if}

{#if autoApplied.length > 0}
	<div class="share-suggestions" role="group" aria-label={t('suggest.autoGroupLabel')}>
		<span class="label">{t('suggest.autoLabel')}</span>
		{#each autoApplied as suggestion (suggestion.sectionId)}
			<span class="auto-name">{suggestion.name}</span>
			<form method="POST" action="{actionBase}?/undoAutoSection" use:enhance={refresh}>
				<input type="hidden" name="shareId" value={shareId} />
				<input type="hidden" name="sectionId" value={suggestion.sectionId} />
				<input type="hidden" name="returnTo" value={returnTo} />
				<button
					type="submit"
					class="suggestion-dismiss"
					disabled={busy}
					aria-label={t('suggest.undoAria', { section: suggestion.name })}
				>
					{t('suggest.undo')}
				</button>
			</form>
		{/each}
	</div>
{/if}

<style>
	.share-suggestions {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-1) var(--space-2);
		margin-block-start: var(--space-2);
		font: var(--text-hint);
		color: var(--color-text-secondary);
	}

	.share-suggestions form {
		display: contents;
	}

	.label {
		color: var(--color-text-muted);
	}

	.auto-name {
		font-weight: 600;
		color: var(--color-text);
	}

	.suggestion-add,
	.suggestion-dismiss {
		padding: 0;
		font: inherit;
		background: none;
		border: 0;
		cursor: pointer;
		text-decoration: underline;
		text-underline-offset: 0.2em;
	}

	.suggestion-add {
		font-weight: 600;
		color: var(--color-accent-text);
	}

	.suggestion-dismiss {
		color: var(--color-text-muted);
	}

	.suggestion-add:hover,
	.suggestion-dismiss:hover {
		color: var(--color-text);
	}

	.suggestion-add:disabled,
	.suggestion-dismiss:disabled {
		cursor: progress;
		opacity: 0.6;
	}

	@media (pointer: coarse) {
		.suggestion-add,
		.suggestion-dismiss {
			min-block-size: 32px;
		}
	}
</style>
