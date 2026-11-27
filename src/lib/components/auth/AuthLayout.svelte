<script lang="ts">
	import { t } from '#lib/i18n/index.ts';
	import { instanceName } from '#lib/instance.ts';
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();

	// Wordmark (docs/designs/izgah-ui-v4.md §5): "iz" in ink, the rest in tertiary ink.
	const name = instanceName();
	const wordmark =
		name.toLocaleLowerCase('tr').startsWith('iz') && name.length > 2
			? { head: name.slice(0, 2), tail: name.slice(2) }
			: null;
</script>

<!-- Auth layout (docs/designs/izgah-ui-v5.md §5.7): the brand, the promise and a sample entry on
     a quiet surface; the form in a card. Below 768px the left column becomes a compact top strip. -->
<div class="auth-layout">
	<aside class="auth-aside" aria-label={t('auth.aboutLabel', { name: instanceName() })}>
		<div class="aside-top">
			<p class="wordmark">
				<span class="brand-mark" aria-hidden="true"><span></span></span>
				<span>
					{#if wordmark}<span>{wordmark.head}</span><span class="wordmark-tail">
							{wordmark.tail}
						</span>{:else}{name}{/if}
				</span>
			</p>
			<span class="aside-kicker">{t('auth.kicker')}</span>
		</div>

		<div class="aside-body">
			<p class="tagline">{t('auth.tagline')}</p>

			<div class="studio-preview" aria-hidden="true">
				<p class="preview-head">
					<span class="preview-avatar">ZD</span>
					<span class="preview-author">Zeynep Demir</span>
					<span class="preview-meta">18:52</span>
				</p>
				<div class="preview-body">
					<p class="preview-title">{t('auth.previewTitle')}</p>
					<p class="preview-foot">{t('auth.previewFoot')}</p>
				</div>
			</div>
		</div>

		<p class="aside-foot">{t('auth.inviteOnly')}</p>
	</aside>

	<main id="main-content" class="auth-main">
		{@render children()}
	</main>
</div>

<style>
	.auth-layout {
		min-block-size: 100dvh;
		display: grid;
		grid-template-columns: minmax(0, 1.08fr) minmax(0, 1fr);
		background: var(--background);
		color: var(--foreground);
	}

	.auth-aside {
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		gap: var(--space-6);
		padding: clamp(2rem, 3.5vw, 3rem) clamp(2rem, 4vw, 3.25rem);
		background: var(--sidebar);
		border-inline-end: 1px solid var(--hairline);
	}

	.aside-top {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-3);
	}

	.wordmark {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		margin: 0;
		font-size: 1.25rem;
		font-weight: 600;
		line-height: 1;
		letter-spacing: -0.02em;
		color: var(--foreground);
	}

	.brand-mark {
		display: grid;
		place-items: center;
		inline-size: 28px;
		block-size: 28px;
		border-radius: 8px;
		background: var(--primary);
	}

	.brand-mark > span {
		inline-size: 7px;
		block-size: 7px;
		border-radius: 9999px;
		background: var(--primary-foreground);
	}

	.wordmark-tail {
		color: var(--muted-foreground);
	}

	.aside-kicker {
		font: var(--type-hint);
		color: var(--muted-foreground);
	}

	.aside-body {
		display: grid;
		gap: var(--space-6);
	}

	.tagline {
		max-inline-size: 16ch;
		margin: 0;
		font-size: clamp(1.875rem, 1.3rem + 1.6vw, 2.5rem);
		font-weight: 600;
		line-height: 1.1;
		letter-spacing: -0.02em;
		color: var(--foreground);
		text-wrap: balance;
	}

	/* A static feed entry (decorative, aria-hidden) in the v5 card look. */
	.studio-preview {
		display: grid;
		gap: var(--space-3);
		max-inline-size: 26rem;
		padding: var(--space-4);
		background: var(--card);
		border: 1px solid var(--border);
		border-radius: 12px;
		box-shadow: var(--elevation-md);
	}

	.preview-head {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 0;
	}

	.preview-avatar {
		display: grid;
		place-items: center;
		inline-size: 24px;
		block-size: 24px;
		border-radius: 9999px;
		font-size: 10px;
		font-weight: 600;
		color: var(--avatar-foreground);
		background: var(--avatar-3);
	}

	.preview-meta {
		font: var(--type-meta);
		font-variant-numeric: tabular-nums;
		color: var(--muted-foreground);
	}

	.preview-author {
		font: var(--type-ui);
		color: var(--foreground);
	}

	.preview-body {
		display: grid;
		gap: 3px;
		padding: var(--space-3);
		border: 1px solid var(--hairline);
		border-radius: 8px;
	}

	.preview-title {
		margin: 0;
		font: var(--type-title);
		color: var(--foreground);
	}

	.preview-foot {
		margin: 0;
		font: var(--type-hint);
		color: var(--muted-foreground);
	}

	.aside-foot {
		font: var(--type-hint);
		color: var(--muted-foreground);
	}

	.auth-main {
		display: grid;
		place-items: center;
		padding: var(--space-6) var(--gutter);
		background: var(--background);
	}

	.auth-main > :global(*) {
		inline-size: 100%;
		max-inline-size: 26rem;
		margin-inline: auto;
	}

	.auth-main :global(.auth-card) {
		display: grid;
		gap: var(--space-4);
		padding: 28px;
		background: var(--card);
		border: 1px solid var(--border);
		border-radius: 16px;
		box-shadow: var(--elevation-sm);
	}

	@media (max-width: 767px) {
		.auth-layout {
			grid-template-columns: minmax(0, 1fr);
			grid-template-rows: auto 1fr;
		}

		.auth-aside {
			flex-direction: row;
			align-items: center;
			padding: var(--space-3) var(--gutter);
			gap: var(--space-3);
			border-inline-end: 0;
			border-block-end: 1px solid var(--border);
		}

		.aside-top {
			inline-size: 100%;
		}

		.wordmark {
			font-size: 1.375rem;
		}

		.aside-body,
		.aside-foot {
			display: none;
		}

		.auth-main {
			align-items: start;
			padding-block: var(--space-5);
		}

		.auth-main :global(.auth-card) {
			padding: 20px;
		}
	}

	/* Shared form styles for /login, /auth/accept-invite, /auth/reset-password. */
	.auth-main :global(.auth-header) {
		display: grid;
		gap: var(--space-1);
	}

	.auth-main :global(.auth-header h1) {
		font: var(--type-display);
		font-size: clamp(1.5rem, 1.35rem + 0.5vw, 1.75rem);
		letter-spacing: -0.02em;
		color: var(--foreground);
	}

	.auth-main :global(.subtitle),
	.auth-main :global(.auth-card > p:not([class])) {
		font: var(--type-hint);
		color: var(--muted-foreground);
	}

	.auth-main :global(form) {
		display: grid;
		gap: var(--space-4);
	}

	.auth-main :global(.field) {
		display: grid;
		gap: 6px;
	}

	.auth-main :global(.field > label) {
		font: var(--type-ui);
		font-weight: 600;
		color: var(--foreground);
	}

	/* .hint MUST use --font-sans (--type-hint), NEVER monospace (izgah-ui-v3 §2.2). */
	.auth-main :global(.hint) {
		font: var(--type-hint);
		color: var(--muted-foreground);
	}

	.auth-main :global(input:not([type='hidden'])) {
		inline-size: 100%;
		min-block-size: 40px;
		padding: 8px 12px;
		font: var(--type-body);
		font-size: max(1rem, 1em);
		color: var(--foreground);
		background: var(--background);
		border: 1px solid var(--input);
		border-radius: 8px;
		box-shadow: var(--elevation-sm);
		transition:
			border-color var(--dur-fast) var(--ease),
			box-shadow var(--dur-fast) var(--ease),
			background-color var(--dur-fast) var(--ease);
	}

	.auth-main :global(input:not([type='hidden']):hover:not(:disabled, :read-only)) {
		border-color: color-mix(in oklab, var(--foreground) 22%, transparent);
	}

	.auth-main :global(input:not([type='hidden']):focus-visible) {
		border-color: var(--ring);
		outline: none;
		box-shadow: 0 0 0 3px color-mix(in oklab, var(--ring) 50%, transparent);
	}

	.auth-main :global(input[readonly]) {
		background: var(--muted);
		color: var(--muted-foreground);
		border-color: var(--border);
	}

	.auth-main
		:global(.field input:is(:user-invalid, .user-invalid-fallback, [aria-invalid='true'])) {
		border-color: var(--destructive);
	}

	.auth-main :global(.error-msg) {
		display: none;
		align-items: center;
		gap: 6px;
		font: var(--type-hint);
		font-weight: 500;
		color: var(--destructive);
	}

	.auth-main :global(.field:has(:is(:user-invalid, .user-invalid-fallback)) .error-msg),
	.auth-main :global(.field.is-invalid .error-msg) {
		display: flex;
	}

	.auth-main :global(.password-row) {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: var(--space-2);
		align-items: center;
	}

	.auth-main :global(.toggle-btn) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		min-block-size: 40px;
		min-inline-size: 44px;
		padding: 0 var(--space-3);
		font: var(--type-ui);
		color: var(--muted-foreground);
		background: transparent;
		border: 1px solid var(--input);
		border-radius: 8px;
		cursor: pointer;
		transition:
			background-color var(--dur-fast) var(--ease),
			border-color var(--dur-fast) var(--ease),
			color var(--dur-fast) var(--ease),
			opacity var(--dur-fast) var(--ease);
	}

	.auth-main :global(.toggle-btn:hover) {
		background: var(--secondary);
		border-color: var(--input);
		color: var(--foreground);
	}

	.auth-main :global(.toggle-btn:active) {
		opacity: 0.9;
	}

	.auth-main :global(.primary-btn) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		inline-size: 100%;
		min-block-size: 40px;
		padding: 0 var(--space-4);
		font: var(--type-ui);
		font-size: 0.9375rem;
		color: var(--primary-foreground);
		background: var(--primary);
		border: 1px solid transparent;
		border-radius: 8px;
		box-shadow: var(--elevation-sm);
		cursor: pointer;
		transition:
			background-color var(--dur-fast) var(--ease),
			border-color var(--dur-fast) var(--ease),
			opacity var(--dur-fast) var(--ease);
	}

	.auth-main :global(.primary-btn:hover:not(:disabled)) {
		background: color-mix(in oklab, var(--primary) 88%, var(--foreground));
		border-color: color-mix(in oklab, var(--primary) 88%, var(--foreground));
	}

	.auth-main :global(.primary-btn:active:not(:disabled)) {
		opacity: 0.9;
	}

	.auth-main :global(.primary-btn:disabled) {
		opacity: 0.6;
		cursor: wait;
	}

	@media (prefers-reduced-motion: no-preference) {
		.auth-main :global(.toggle-btn) {
			transition:
				background-color var(--dur-fast) var(--ease),
				border-color var(--dur-fast) var(--ease),
				color var(--dur-fast) var(--ease),
				opacity var(--dur-fast) var(--ease),
				scale 90ms var(--ease);
		}

		.auth-main :global(.primary-btn) {
			transition:
				background-color var(--dur-fast) var(--ease),
				border-color var(--dur-fast) var(--ease),
				opacity var(--dur-fast) var(--ease);
		}
	}

	.auth-main :global(.banner) {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		padding: var(--space-3);
		font: var(--type-hint);
		font-weight: 500;
		background: var(--muted);
		border: 1px solid var(--border);
		border-radius: 8px;
	}

	.auth-main :global(.banner > .icon) {
		margin-block-start: 2px;
	}

	.auth-main :global(.banner-error) {
		background: color-mix(in oklab, var(--destructive) 10%, transparent);
		color: var(--destructive);
		border-color: color-mix(in oklab, var(--destructive) 40%, transparent);
	}

	.auth-main :global(.banner-success) {
		background: var(--success-soft);
		color: var(--success);
		border-color: color-mix(in oklab, var(--success) 40%, transparent);
	}

	.auth-main :global(.auth-foot-hint) {
		font: var(--type-hint);
		color: var(--muted-foreground);
		text-align: center;
	}

	.auth-main :global(.link-row) {
		margin-block-start: var(--space-1);
	}

	@media (prefers-contrast: more), (forced-colors: active) {
		.auth-aside {
			background-image: none;
		}

		.studio-preview {
			box-shadow: none;
		}
	}

	@media (forced-colors: active) {
		.auth-aside {
			border-color: CanvasText;
		}

		.studio-preview {
			border-color: CanvasText;
		}

		.auth-main :global(.auth-card) {
			border-color: CanvasText;
			box-shadow: none;
		}

		.auth-main :global(.toggle-btn:active),
		.auth-main :global(.primary-btn:active:not(:disabled)) {
			opacity: 1;
		}

		.auth-main :global(.primary-btn) {
			background: Highlight;
			color: HighlightText;
			border-color: Highlight;
		}

		.auth-main :global(.primary-btn:hover:not(:disabled)) {
			background: Highlight;
			color: HighlightText;
			border-color: CanvasText;
		}
	}
</style>
