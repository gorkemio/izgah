<script lang="ts">
	import { t } from '#lib/i18n/index.ts';
	import { pageTitle } from '#lib/instance.ts';
	import { page } from '$app/state';

	interface Props {
		/** Where the "home" link points; signed-out visitors go to /login. */
		homeHref?: string;
		homeLabel?: string;
	}

	let { homeHref = '/', homeLabel = t('error.backToFeed') }: Props = $props();

	const NBSP = String.fromCharCode(0xa0);

	const heading = $derived.by(() => {
		switch (page.status) {
			case 404:
				return t('error.notFound');
			case 401:
				return t('error.unauthorized');
			case 403:
				return t('error.forbidden');
			case 429:
				return t('error.tooMany');
			default:
				return page.status >= 500 ? t('error.server') : t('error.generic');
		}
	});

	const message = $derived.by(() => {
		const raw = page.error?.message;
		if (page.status === 404 && (!raw || raw === 'Not Found')) {
			return t('error.notFoundMessage');
		}
		if (page.status >= 500 && (!raw || raw === 'Internal Error')) {
			return t('error.serverMessage');
		}
		return raw ?? t('error.serverMessage');
	});

	const isServerError = $derived(page.status >= 500);

	let copyStatus = $state('');
	let toggle = false;

	async function copyRequestId(): Promise<void> {
		const id = page.error?.requestId;
		if (!id) {
			return;
		}
		let copied = false;
		try {
			await navigator.clipboard.writeText(id);
			copied = true;
		} catch {
			copied = false;
		}
		toggle = !toggle;
		const text = copied ? t('error.copied') : t('error.copyManually');
		copyStatus = toggle ? text : `${text}${NBSP}`;
	}
</script>

<svelte:head>
	<title>{pageTitle(heading)}</title>
</svelte:head>

<div class="error-content">
	<p class="error-code" class:is-server-error={isServerError}>
		<span class="error-code-dot" aria-hidden="true"></span>
		<span>{page.status}</span>
	</p>
	<h1 tabindex="-1">{heading}</h1>
	<p class="error-message">{message}</p>
	{#if page.error?.requestId}
		<div class="request-id-row">
			<p class="request-id-label">
				{t('error.requestId')} <code id="error-request-id">{page.error.requestId}</code>
			</p>
			<button type="button" class="btn btn-subtle btn-sm" onclick={copyRequestId}>
				<span>{t('common.copy')}</span>
			</button>
			<span class="copy-status" role="status">{copyStatus}</span>
		</div>
	{/if}
	<p class="error-actions">
		<a href={homeHref} class="btn btn-primary">
			<span>{homeLabel}</span>
		</a>
	</p>
</div>

<style>
	.error-content {
		display: grid;
		justify-items: start;
		gap: var(--space-4);
		max-inline-size: var(--read-w);
		padding: var(--space-6);
		background: var(--color-surface-1);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-lg);
	}

	.error-code {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 3px var(--space-3);
		font: var(--text-micro);
		font-variant-numeric: tabular-nums;
		letter-spacing: 0.04em;
		color: var(--color-text-secondary);
		background: var(--color-surface-2);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-pill);
	}

	.error-code-dot {
		inline-size: 6px;
		block-size: 6px;
		border-radius: var(--radius-pill);
		background: var(--color-accent);
		flex: none;
	}

	.error-code.is-server-error {
		background: var(--color-danger-soft);
		color: var(--color-danger);
		border-color: var(--color-danger-border);
	}

	.error-code.is-server-error .error-code-dot {
		background: var(--color-danger);
	}

	h1 {
		font: var(--text-display);
		letter-spacing: -0.02em;
		color: var(--color-text);
	}

	.error-message {
		font: var(--text-body);
		color: var(--color-text-secondary);
		max-inline-size: 52ch;
	}

	.request-id-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		background: var(--color-surface-2);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-sm);
		font: var(--text-hint);
		color: var(--color-text-secondary);
	}

	.request-id-label {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
	}

	.request-id-row code {
		font: var(--text-meta);
		padding: 2px 7px;
		color: var(--color-text);
		background: var(--color-surface-1);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-xs);
		overflow-wrap: anywhere;
	}

	.copy-status {
		font: var(--text-meta);
		color: var(--color-text-muted);
	}

	.error-actions {
		margin-block-start: var(--space-1);
	}

	@media (max-width: 767px) {
		.error-content {
			padding: var(--space-5);
		}
	}

	@media (forced-colors: active) {
		.error-content,
		.request-id-row,
		.request-id-row code,
		.error-code {
			border-color: CanvasText;
			box-shadow: none;
		}

		.error-code-dot {
			background: Highlight;
		}
	}
</style>
