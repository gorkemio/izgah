<script lang="ts">
	import { t } from '#lib/i18n/index.ts';
	import { instanceName } from '#lib/instance.ts';
	import { page } from '$app/state';
	import ErrorContent from '#lib/components/ErrorContent.svelte';

	// Errors outside the app shell (sign-in pages, layout auth failures) land here (F14).
	const signedOut = $derived(page.status === 401);
</script>

<main id="main-content" class="error-page">
	<a href="/" class="brand">{instanceName()}<span class="brand-dot" aria-hidden="true"></span></a>
	<ErrorContent
		homeHref={signedOut ? '/login' : '/'}
		homeLabel={signedOut ? t('error.goToSignIn') : t('error.goHome')}
	/>
</main>

<style>
	.error-page {
		min-block-size: 100dvh;
		display: grid;
		align-content: center;
		gap: var(--space-5);
		max-inline-size: calc(var(--read-w) + 2 * var(--gutter));
		margin: 0 auto;
		padding: var(--space-6) var(--gutter);
	}

	.brand {
		justify-self: start;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-family: var(--font-display);
		font-size: 1.5rem;
		font-weight: 600;
		line-height: 1;
		letter-spacing: -0.02em;
		color: var(--k-color-text);
		border-radius: var(--k-radius-xs);
		text-decoration: none;
	}

	.brand-dot {
		display: inline-block;
		inline-size: 7px;
		block-size: 7px;
		border-radius: var(--k-radius-pill);
		background: var(--k-color-accent);
		flex: none;
	}

	.brand:hover {
		color: var(--k-color-text);
		text-decoration: none;
	}

	@media (forced-colors: active) {
		.brand-dot {
			background: Highlight;
			border: 1px solid CanvasText;
		}
	}
</style>
