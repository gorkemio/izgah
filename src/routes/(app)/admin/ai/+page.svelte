<script lang="ts">
	import { formatNumber, t } from '#lib/i18n/index.ts';
	import { pageTitle } from '#lib/instance.ts';
	import { enhance, type SubmitFunction } from '$app/forms';
	import Icon from '#lib/components/ui/Icon.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const view = $derived(data.view);
	const settings = $derived(view.state.settings);
	const fieldErrors = $derived(
		(form && 'fieldErrors' in form ? form.fieldErrors : undefined) as
			Record<string, string> | undefined
	);

	let busy = $state(false);
	let keyInput = $state<HTMLInputElement | null>(null);
	let provider = $state('');
	$effect(() => {
		provider = settings.provider;
	});

	const providers = ['openrouter', 'anthropic', 'openai', 'gemini', 'custom'] as const;

	const status = $derived.by(() => {
		if (!view.state.aiAllowed) {
			return t('ai.state.operatorOff');
		}
		if (view.state.keyUnreadable) {
			return t('ai.state.keyUnreadable');
		}
		if (settings.pausedReason) {
			return t('ai.state.paused');
		}
		if (settings.enabled && settings.model) {
			return t('ai.state.on', {
				provider: t(`ai.provider.${settings.provider}`),
				model: settings.model
			});
		}
		return t('ai.state.off');
	});

	const keepValues: SubmitFunction = () => {
		busy = true;
		return async ({ result, update }) => {
			busy = false;
			await update({ reset: false });
			if (result.type === 'success' && keyInput) {
				keyInput.value = '';
			}
		};
	};
</script>

<svelte:head>
	<title>{pageTitle(t('ai.title'))}</title>
</svelte:head>

<div class="admin-page">
	<header class="page-header">
		<h1 tabindex="-1">{t('ai.title')}</h1>
		<p class="page-lead">{t('ai.lead')}</p>
	</header>

	<p class="ai-status" role="status">
		{status}
		{#if view.state.aiAllowed && settings.enabled}
			<span class="ai-today">
				{t('ai.today', {
					count: formatNumber(view.requestsToday),
					limit: formatNumber(settings.dailyRequestLimit)
				})}
			</span>
		{/if}
	</p>

	{#if form?.success && form?.message}
		<div class="banner banner-success" role="status"><span>{form.message}</span></div>
	{/if}
	{#if form?.error}
		<div class="banner banner-error" role="alert">
			<Icon name="alert" size={16} />
			<span>{form.error}</span>
		</div>
	{/if}

	<form method="POST" action="?/save" use:enhance={keepValues} class="ai-form">
		<section class="ai-row" aria-labelledby="ai-history-heading">
			<div class="ai-row-text">
				<h2 id="ai-history-heading">{t('ai.history.title')}</h2>
				<p>{t('ai.history.lead')}</p>
			</div>
			<div class="ai-row-control">
				<label class="ai-check">
					<input type="checkbox" name="historySuggestions" checked={settings.historySuggestions} />
					<span>{t('ai.history.toggle')}</span>
				</label>
			</div>
		</section>

		{#if view.state.aiAllowed}
			<input type="hidden" name="aiFields" value="1" />

			<section class="ai-row" aria-labelledby="ai-provider-heading">
				<div class="ai-row-text">
					<h2 id="ai-provider-heading">{t('ai.provider.title')}</h2>
					<p>{t('ai.provider.lead')}</p>
				</div>
				<div class="ai-row-control">
					<label class="ai-check">
						<input type="checkbox" name="enabled" checked={settings.enabled} />
						<span>{t('ai.enabled')}</span>
					</label>

					<fieldset class="ai-fieldset">
						<legend>{t('ai.provider.legend')}</legend>
						{#each providers as option (option)}
							<label class="ai-check">
								<input
									type="radio"
									name="provider"
									value={option}
									checked={settings.provider === option}
									onchange={() => (provider = option)}
								/>
								<span>
									{t(`ai.provider.${option}`)}
									<small>{t(`ai.provider.${option}.hint`)}</small>
								</span>
							</label>
						{/each}
					</fieldset>

					<div class="field" class:is-muted={provider !== 'custom'}>
						<label for="ai-base-url">{t('ai.baseUrl')}</label>
						<input
							id="ai-base-url"
							class="input"
							name="baseUrl"
							type="url"
							inputmode="url"
							autocomplete="off"
							spellcheck="false"
							placeholder="http://127.0.0.1:11434/v1"
							value={settings.baseUrl ?? ''}
							aria-invalid={fieldErrors?.baseUrl ? true : undefined}
							aria-describedby="ai-base-url-hint"
						/>
						<p id="ai-base-url-hint" class="field-hint">
							{fieldErrors?.baseUrl ?? t('ai.baseUrl.hint')}
						</p>
					</div>

					<div class="field">
						<label for="ai-key">{t('ai.key')}</label>
						<input
							bind:this={keyInput}
							id="ai-key"
							class="input"
							name="apiKey"
							type="password"
							autocomplete="off"
							spellcheck="false"
							placeholder={view.state.hasKey && settings.keyHint
								? t('ai.key.stored', { hint: settings.keyHint })
								: t('ai.key.placeholder')}
							aria-invalid={fieldErrors?.apiKey ? true : undefined}
							aria-describedby="ai-key-hint"
						/>
						<p id="ai-key-hint" class="field-hint">{fieldErrors?.apiKey ?? t('ai.key.hint')}</p>
						{#if view.state.hasKey}
							<label class="ai-check">
								<input type="checkbox" name="removeKey" />
								<span>{t('ai.key.remove')}</span>
							</label>
						{/if}
					</div>

					<div class="field">
						<label for="ai-model">{t('ai.model')}</label>
						<input
							id="ai-model"
							class="input"
							name="model"
							list="ai-models"
							autocomplete="off"
							spellcheck="false"
							value={settings.model}
							aria-invalid={fieldErrors?.model ? true : undefined}
							aria-describedby="ai-model-hint"
						/>
						<datalist id="ai-models">
							{#each settings.models as model (model)}
								<option value={model}></option>
							{/each}
						</datalist>
						<p id="ai-model-hint" class="field-hint">
							{fieldErrors?.model ??
								(settings.models.length > 0
									? t('ai.model.listed', { count: settings.models.length })
									: t('ai.model.hint'))}
						</p>
					</div>

					<div class="ai-buttons">
						<button class="btn btn-primary" type="submit" disabled={busy}>{t('ai.save')}</button>
						<button class="btn btn-outline" type="submit" formaction="?/test" disabled={busy}>
							{t('ai.test')}
						</button>
						<button class="btn btn-outline" type="submit" formaction="?/models" disabled={busy}>
							{t('ai.fetchModels')}
						</button>
					</div>
				</div>
			</section>

			<section class="ai-row" aria-labelledby="ai-features-heading">
				<div class="ai-row-text">
					<h2 id="ai-features-heading">{t('ai.features.title')}</h2>
					<p>{t('ai.features.lead')}</p>
				</div>
				<div class="ai-row-control">
					<fieldset class="ai-fieldset">
						<legend>{t('ai.sectionMode')}</legend>
						{#each ['off', 'suggest', 'auto'] as mode (mode)}
							<label class="ai-check">
								<input
									type="radio"
									name="sectionMode"
									value={mode}
									checked={settings.sectionMode === mode}
								/>
								<span>
									{t(`ai.sectionMode.${mode as 'off' | 'suggest' | 'auto'}`)}
									<small>{t(`ai.sectionMode.${mode as 'off' | 'suggest' | 'auto'}.hint`)}</small>
								</span>
							</label>
						{/each}
					</fieldset>
					<label class="ai-check">
						<input type="checkbox" name="summaries" checked={settings.summaries} />
						<span>{t('ai.summaries')} <small>{t('ai.summaries.hint')}</small></span>
					</label>
					<label class="ai-check">
						<input type="checkbox" name="keywords" checked={settings.keywords} />
						<span>{t('ai.keywords')} <small>{t('ai.keywords.hint')}</small></span>
					</label>
				</div>
			</section>

			<section class="ai-row" aria-labelledby="ai-privacy-heading">
				<div class="ai-row-text">
					<h2 id="ai-privacy-heading">{t('ai.privacy.title')}</h2>
					<p>{t('ai.privacy.lead')}</p>
				</div>
				<div class="ai-row-control">
					<ul class="ai-sent">
						<li>{t('ai.privacy.url')}</li>
						<li>{t('ai.privacy.meta')}</li>
						<li>{t('ai.privacy.excerpt')}</li>
						<li>{t('ai.privacy.sections')}</li>
					</ul>
					<p class="field-hint">{t('ai.privacy.never')}</p>
					<label class="ai-check">
						<input type="checkbox" name="sendExcerpt" checked={settings.sendExcerpt} />
						<span>{t('ai.privacy.sendExcerpt')}</span>
					</label>
					<label class="ai-check">
						<input type="checkbox" name="includeNotes" checked={settings.includeNotes} />
						<span>{t('ai.privacy.includeNotes')}</span>
					</label>
					<div class="field">
						<label for="ai-excluded">{t('ai.privacy.excluded')}</label>
						<textarea
							id="ai-excluded"
							class="textarea"
							name="excludedDomains"
							rows="3"
							spellcheck="false"
							aria-describedby="ai-excluded-hint">{settings.excludedDomains.join('\n')}</textarea
						>
						<p id="ai-excluded-hint" class="field-hint">{t('ai.privacy.excluded.hint')}</p>
					</div>
				</div>
			</section>

			<section class="ai-row" aria-labelledby="ai-limit-heading">
				<div class="ai-row-text">
					<h2 id="ai-limit-heading">{t('ai.limit.title')}</h2>
					<p>{t('ai.limit.lead')}</p>
				</div>
				<div class="ai-row-control">
					<div class="field">
						<label for="ai-limit">{t('ai.limit.label')}</label>
						<input
							id="ai-limit"
							class="input ai-limit-input"
							name="dailyRequestLimit"
							type="number"
							min="1"
							max="100000"
							inputmode="numeric"
							value={settings.dailyRequestLimit}
							aria-invalid={fieldErrors?.dailyRequestLimit ? true : undefined}
						/>
						{#if fieldErrors?.dailyRequestLimit}
							<p class="field-error">{fieldErrors.dailyRequestLimit}</p>
						{/if}
					</div>
					<button class="btn btn-primary" type="submit" disabled={busy}>{t('ai.save')}</button>
				</div>
			</section>
		{:else}
			<section class="ai-row">
				<div class="ai-row-text">
					<h2>{t('ai.provider.title')}</h2>
					<p>{t('ai.operatorOff.lead')}</p>
				</div>
				<div class="ai-row-control">
					<button class="btn btn-primary" type="submit" disabled={busy}>{t('ai.save')}</button>
				</div>
			</section>
		{/if}
	</form>

	{#if view.state.aiAllowed}
		<section class="ai-row" aria-labelledby="ai-usage-heading">
			<div class="ai-row-text">
				<h2 id="ai-usage-heading">{t('ai.usage.title')}</h2>
				<p>{t('ai.usage.lead')}</p>
			</div>
			<div class="ai-row-control">
				{#if view.usage.length === 0}
					<p class="field-hint">{t('ai.usage.empty')}</p>
				{:else}
					<table class="ai-usage">
						<thead>
							<tr>
								<th scope="col">{t('ai.usage.day')}</th>
								<th scope="col" class="num">{t('ai.usage.requests')}</th>
								<th scope="col" class="num">{t('ai.usage.input')}</th>
								<th scope="col" class="num">{t('ai.usage.output')}</th>
								<th scope="col" class="num">{t('ai.usage.failures')}</th>
							</tr>
						</thead>
						<tbody>
							{#each view.usage as row (row.day)}
								<tr>
									<th scope="row">{row.day}</th>
									<td class="num">{formatNumber(row.requests)}</td>
									<td class="num">{formatNumber(row.inputTokens)}</td>
									<td class="num">{formatNumber(row.outputTokens)}</td>
									<td class="num" class:is-bad={row.failures > 0}>{formatNumber(row.failures)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{/if}
			</div>
		</section>
	{/if}

	<section class="ai-row" aria-labelledby="ai-queue-heading">
		<div class="ai-row-text">
			<h2 id="ai-queue-heading">{t('ai.queue.title')}</h2>
			<p>{t('ai.queue.lead')}</p>
		</div>
		<div class="ai-row-control">
			<p>
				{t('ai.queue.counts', {
					queued: view.queue.queued,
					running: view.queue.running,
					dead: view.queue.dead
				})}
			</p>
			<div class="ai-buttons">
				<form method="POST" action="?/retry" use:enhance={keepValues}>
					<button class="btn btn-outline" type="submit" disabled={busy || view.queue.dead === 0}>
						{t('ai.queue.retry')}
					</button>
				</form>
				{#if view.state.aiAllowed}
					<form method="POST" action="?/backfill" use:enhance={keepValues}>
						<button
							class="btn btn-outline"
							type="submit"
							disabled={busy || view.enrichableCount === 0}
						>
							{t('ai.queue.backfill', { count: view.enrichableCount })}
						</button>
					</form>
				{/if}
			</div>
		</div>
	</section>

	<section class="ai-row" aria-labelledby="ai-purge-heading">
		<div class="ai-row-text">
			<h2 id="ai-purge-heading">{t('ai.purge.title')}</h2>
			<p>{t('ai.purge.lead')}</p>
		</div>
		<div class="ai-row-control">
			<form method="POST" action="?/purge" use:enhance={keepValues} class="ai-purge">
				<label class="ai-check">
					<input type="checkbox" name="confirm" required />
					<span>{t('ai.purge.confirm')}</span>
				</label>
				<button class="btn btn-danger-soft" type="submit" disabled={busy}>
					{t('ai.purge.button')}
				</button>
			</form>
		</div>
	</section>
</div>

<style>
	.ai-status {
		margin: var(--space-2) 0 0;
		font: var(--text-ui);
		color: var(--color-text);
	}

	.ai-today {
		margin-inline-start: var(--space-2);
		color: var(--color-text-muted);
		font-variant-numeric: tabular-nums;
	}

	.ai-form {
		display: contents;
	}

	.ai-row {
		display: grid;
		grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
		gap: var(--space-5);
		padding-block: var(--space-5);
		border-block-start: 1px solid var(--color-line);
	}

	.ai-row-text h2 {
		margin: 0 0 var(--space-1);
		font: var(--text-section);
	}

	.ai-row-text p {
		margin: 0;
		font: var(--text-hint);
		color: var(--color-text-secondary);
	}

	.ai-row-control {
		display: grid;
		gap: var(--space-3);
		align-content: start;
		min-inline-size: 0;
	}

	.ai-row-control > p {
		margin: 0;
	}

	.ai-row-control > .btn {
		justify-self: start;
	}

	.ai-fieldset {
		display: grid;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		border: 0;
	}

	.ai-fieldset legend {
		margin-block-end: var(--space-1);
		padding: 0;
		font: var(--text-ui);
		font-weight: 600;
	}

	.ai-check {
		display: flex;
		gap: var(--space-2);
		align-items: baseline;
		font: var(--text-body);
	}

	.ai-check input {
		flex: none;
		transform: translateY(2px);
	}

	.ai-check small {
		display: block;
		font: var(--text-hint);
		color: var(--color-text-muted);
	}

	.is-muted {
		opacity: 0.72;
	}

	.ai-buttons {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.ai-sent {
		margin: 0;
		padding-inline-start: 1.1em;
		font: var(--text-body);
	}

	.ai-limit-input {
		max-inline-size: 10rem;
	}

	.ai-usage {
		inline-size: 100%;
		border-collapse: collapse;
		font: var(--text-ui);
		font-variant-numeric: tabular-nums;
	}

	.ai-usage th,
	.ai-usage td {
		padding: var(--space-1) var(--space-3) var(--space-1) 0;
		text-align: start;
		border-block-end: 1px solid var(--color-line);
	}

	.ai-usage thead th {
		color: var(--color-text-secondary);
		font-weight: 600;
	}

	.ai-usage .num {
		text-align: end;
	}

	.ai-usage .is-bad {
		color: var(--color-danger);
	}

	.ai-purge {
		display: grid;
		gap: var(--space-2);
		justify-items: start;
	}

	@media (max-width: 767px) {
		.ai-row {
			grid-template-columns: minmax(0, 1fr);
			gap: var(--space-3);
		}
	}
</style>
