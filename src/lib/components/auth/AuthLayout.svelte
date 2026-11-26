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

<!-- Künye split layout (izgah-ui-v4.md): the same paper on both sides, a rule between them.
     On viewports < 768px the left column collapses into a compact top strip. -->
<div class="auth-layout">
	<aside class="auth-aside" aria-label={t('auth.aboutLabel', { name: instanceName() })}>
		<div class="aside-top">
			<p class="wordmark">
				{#if wordmark}<span>{wordmark.head}</span><span class="wordmark-tail">
						{wordmark.tail}
					</span>{:else}{name}{/if}
			</p>
			<span class="aside-kicker">{t('auth.kicker')}</span>
		</div>

		<div class="aside-body">
			<p class="tagline">{t('auth.tagline')}</p>

			<div class="studio-preview" aria-hidden="true">
				<p class="preview-head">
					<span class="preview-meta">18:52</span>
					<span class="preview-author">Zeynep Demir</span>
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
		background: var(--color-bg);
		color: var(--color-text);
	}

	.auth-aside {
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		gap: var(--space-6);
		padding: clamp(2rem, 3.5vw, 3rem) clamp(2rem, 4vw, 3.25rem);
		border-inline-end: 1px solid var(--color-line);
	}

	.aside-top {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-3);
	}

	.wordmark {
		margin: 0;
		font-size: 1.625rem;
		font-weight: 600;
		line-height: 1;
		letter-spacing: -0.015em;
		color: var(--color-text);
	}

	.wordmark-tail {
		font-weight: 400;
		color: var(--color-text-muted);
	}

	.aside-kicker {
		font: var(--text-hint);
		color: var(--color-text-muted);
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
		color: var(--color-text);
		text-wrap: balance;
	}

	/* A static register entry (decorative, aria-hidden): rules, not a floating card. */
	.studio-preview {
		display: grid;
		grid-template-columns: 96px minmax(0, 1fr);
		gap: var(--space-4);
		max-inline-size: 30rem;
		padding-block: var(--space-3);
		border-block: 1px solid var(--color-line);
	}

	.preview-head {
		display: grid;
		gap: 2px;
		margin: 0;
	}

	.preview-meta {
		font: var(--text-meta);
		font-variant-numeric: tabular-nums;
		color: var(--color-text-muted);
	}

	.preview-author {
		font: var(--text-ui);
		color: var(--color-text-secondary);
	}

	.preview-body {
		display: grid;
		gap: 3px;
	}

	.preview-title {
		margin: 0;
		font: var(--text-title);
		color: var(--color-link);
		text-decoration: underline;
		text-underline-offset: 0.2em;
	}

	.preview-foot {
		margin: 0;
		font: var(--text-hint);
		color: var(--color-text-muted);
	}

	.aside-foot {
		font: var(--text-hint);
		color: var(--color-text-muted);
	}

	.auth-main {
		display: grid;
		place-items: center;
		padding: var(--space-6) var(--gutter);
		background: var(--color-bg);
	}

	.auth-main > :global(*) {
		inline-size: 100%;
		max-inline-size: 26rem;
		margin-inline: auto;
	}

	.auth-main :global(.auth-card) {
		display: grid;
		gap: var(--space-4);
		padding: 0;
		background: none;
		border: 0;
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
			border-block-end: 1px solid var(--color-line);
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
			padding: 0;
		}
	}

	/* Shared form styles for /login, /auth/accept-invite, /auth/reset-password. */
	.auth-main :global(.auth-header) {
		display: grid;
		gap: var(--space-1);
	}

	.auth-main :global(.auth-header h1) {
		font: var(--text-display);
		font-size: clamp(1.5rem, 1.35rem + 0.5vw, 1.75rem);
		letter-spacing: -0.02em;
		color: var(--color-text);
	}

	.auth-main :global(.subtitle),
	.auth-main :global(.auth-card > p:not([class])) {
		font: var(--text-hint);
		color: var(--color-text-muted);
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
		font: var(--text-ui);
		font-weight: 600;
		color: var(--color-text);
	}

	/* .hint MUST use --font-sans (--text-hint), NEVER monospace (izgah-ui-v3 §2.2). */
	.auth-main :global(.hint) {
		font: var(--text-hint);
		color: var(--color-text-muted);
	}

	.auth-main :global(input:not([type='hidden'])) {
		inline-size: 100%;
		min-block-size: 44px;
		padding: var(--space-2) var(--space-3);
		font: var(--text-body);
		font-size: max(1rem, 1em);
		color: var(--color-text);
		background: var(--input-bg);
		border: 1px solid var(--color-line-strong);
		border-radius: var(--radius-sm);
		transition:
			border-color var(--dur-fast) var(--ease),
			background-color var(--dur-fast) var(--ease);
	}

	.auth-main :global(input:not([type='hidden']):hover:not(:disabled, :read-only)) {
		border-color: var(--color-text-secondary);
	}

	.auth-main :global(input:not([type='hidden']):focus-visible) {
		border-color: var(--color-accent);
	}

	.auth-main :global(input[readonly]) {
		background: var(--color-surface-2);
		color: var(--color-text-muted);
		border-color: var(--color-line);
	}

	.auth-main
		:global(.field input:is(:user-invalid, .user-invalid-fallback, [aria-invalid='true'])) {
		border-color: var(--color-danger);
	}

	.auth-main :global(.error-msg) {
		display: none;
		align-items: center;
		gap: 6px;
		font: var(--text-hint);
		font-weight: 500;
		color: var(--color-danger);
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
		min-block-size: 44px;
		min-inline-size: 44px;
		padding: 0 var(--space-3);
		font: var(--text-ui);
		color: var(--color-text-secondary);
		background: var(--color-surface-2);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition:
			background-color var(--dur-fast) var(--ease),
			border-color var(--dur-fast) var(--ease),
			color var(--dur-fast) var(--ease),
			opacity var(--dur-fast) var(--ease);
	}

	.auth-main :global(.toggle-btn:hover) {
		background: var(--color-surface-3);
		border-color: var(--color-line-strong);
		color: var(--color-text);
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
		min-block-size: 44px;
		padding: 0 var(--space-4);
		font: var(--text-ui);
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--btn-primary-fg);
		background: var(--btn-primary-bg);
		border: 1px solid var(--btn-primary-bg);
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition:
			background-color var(--dur-fast) var(--ease),
			border-color var(--dur-fast) var(--ease),
			opacity var(--dur-fast) var(--ease);
	}

	.auth-main :global(.primary-btn:hover:not(:disabled)) {
		background: color-mix(in oklab, var(--btn-primary-bg) 88%, var(--color-text));
		border-color: color-mix(in oklab, var(--btn-primary-bg) 88%, var(--color-text));
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
				opacity var(--dur-fast) var(--ease),
				scale 90ms var(--ease);
		}

		.auth-main :global(.toggle-btn:active:not(:disabled)),
		.auth-main :global(.primary-btn:active:not(:disabled)) {
			scale: 0.98;
		}
	}

	.auth-main :global(.banner) {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		padding: var(--space-3);
		font: var(--text-hint);
		font-weight: 500;
		background: var(--color-surface-2);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-sm);
	}

	.auth-main :global(.banner > .icon) {
		margin-block-start: 2px;
	}

	.auth-main :global(.banner-error) {
		background: var(--color-danger-soft);
		color: var(--color-danger);
		border-color: var(--color-danger-border);
	}

	.auth-main :global(.banner-success) {
		background: var(--color-ok-soft);
		color: var(--color-ok-text);
		border-color: var(--color-ok-border);
	}

	.auth-main :global(.auth-foot-hint) {
		font: var(--text-hint);
		color: var(--color-text-muted);
		text-align: center;
		padding-block-start: var(--space-3);
		border-block-start: 1px solid var(--color-line);
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
