<script lang="ts">
	import { t } from '#lib/i18n/index.ts';
	import { pageTitle } from '#lib/instance.ts';
	import { page } from '$app/state';
	import { buttonVariants } from '#lib/components/ui/button/index.ts';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Copy from '@lucide/svelte/icons/copy';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';

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

<!-- Error page (docs/designs/izgah-ui-v5.md §5.7): a quiet card with the status, the message, the
     request id to quote and one way back. -->
<div
	class="error-content mx-auto grid w-full max-w-[32rem] justify-items-start gap-3 rounded-2xl border bg-card p-7 shadow-sm"
>
	<p
		class="error-code inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-[12px] font-medium text-muted-foreground tabular-nums"
		class:is-server-error={isServerError}
	>
		{#if isServerError}
			<TriangleAlert class="size-3.5" aria-hidden="true" />
		{/if}
		<span>{page.status}</span>
	</p>
	<h1 tabindex="-1" class="text-2xl font-semibold tracking-[-0.02em] outline-none">{heading}</h1>
	<p class="error-message text-[14.5px] leading-relaxed text-muted-foreground">{message}</p>
	{#if page.error?.requestId}
		<div
			class="request-id-row flex w-full flex-wrap items-center gap-2 rounded-lg border border-hairline bg-muted/50 px-3 py-2"
		>
			<p class="request-id-label min-w-0 flex-1 text-[12.5px] text-muted-foreground">
				{t('error.requestId')}
				<code id="error-request-id" class="font-mono text-[12px] break-all text-foreground">
					{page.error.requestId}
				</code>
			</p>
			<button
				type="button"
				class={buttonVariants({ variant: 'ghost', size: 'xs' })}
				onclick={copyRequestId}
			>
				<Copy aria-hidden="true" />
				<span>{t('common.copy')}</span>
			</button>
			<span class="copy-status sr-only" role="status">{copyStatus}</span>
		</div>
	{/if}
	<p class="error-actions pt-2">
		<a href={homeHref} class={buttonVariants()}>
			<ArrowLeft aria-hidden="true" />
			<span>{homeLabel}</span>
		</a>
	</p>
</div>

<style>
	.error-code.is-server-error {
		color: var(--destructive);
		background: color-mix(in oklab, var(--destructive) 10%, transparent);
	}
</style>
