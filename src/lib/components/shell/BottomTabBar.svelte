<script lang="ts">
	import { t } from '#lib/i18n/index.ts';
	import { page } from '$app/state';
	import Icon from '#lib/components/ui/Icon.svelte';

	interface Props {
		onCompose: () => void;
	}

	let { onCompose }: Props = $props();
	const pathname = $derived(page.url.pathname);

	function handleCompose(event: MouseEvent): void {
		event.preventDefault();
		onCompose();
	}
</script>

<!-- Only visible below 768px; the rail navigation is display:none there, so exactly one
     "Ana gezinme" landmark exists at every width. -->
<nav class="tab-bar" aria-label={t('nav.main')}>
	<a href="/" class="tab" aria-current={pathname === '/' ? 'page' : undefined}>
		<Icon name="home" size={18} />
		<span>{t('nav.feed')}</span>
	</a>
	<a
		href="/sections"
		class="tab"
		aria-current={pathname.startsWith('/sections') ? 'page' : undefined}
	>
		<Icon name="layers" size={18} />
		<span>{t('nav.sections')}</span>
	</a>
	<form method="GET" action="/" class="tab-form">
		<input type="hidden" name="compose" value="1" />
		<button
			type="submit"
			class="tab tab-compose"
			aria-label={t('nav.shareLink')}
			onclick={handleCompose}
		>
			<Icon name="plus" size={18} />
			<span>{t('nav.share')}</span>
		</button>
	</form>
	<a href="/search" class="tab" aria-current={pathname === '/search' ? 'page' : undefined}>
		<Icon name="search" size={18} />
		<span>{t('nav.search')}</span>
	</a>
	<a
		href="/settings"
		class="tab"
		aria-current={pathname.startsWith('/settings') ? 'page' : undefined}
	>
		<Icon name="user" size={18} />
		<span>{t('nav.profile')}</span>
	</a>
</nav>

<style>
	.tab-bar {
		display: none;
	}

	@media (max-width: 767px) {
		.tab-bar {
			position: fixed;
			inset-inline: 0;
			inset-block-end: 0;
			z-index: 40;
			display: grid;
			grid-template-columns: repeat(5, 1fr);
			gap: var(--space-1);
			min-block-size: var(--tab-bar-h);
			padding-block: 6px calc(6px + env(safe-area-inset-bottom, 0px));
			padding-inline: calc(6px + env(safe-area-inset-left, 0px))
				calc(6px + env(safe-area-inset-right, 0px));
			background: var(--color-surface-1);
			border-block-start: 1px solid var(--color-line);
		}

		/* Keep the bar from sitting on top of the virtual keyboard while typing, and keep it away
		   while a [data-draft] field holds text: tapping that form's submit button blurs the field,
		   and a returning bar would move the button out from under the finger. */
		:global(body:has(:is(input, textarea, select, [contenteditable='true']):focus)) .tab-bar,
		:global(body:has(textarea[data-draft]:not(:placeholder-shown))) .tab-bar {
			display: none;
		}
	}

	.tab-form {
		display: contents;
	}

	.tab {
		position: relative;
		display: grid;
		place-items: center;
		align-content: center;
		gap: 3px;
		min-block-size: 48px;
		padding: var(--space-1);
		font-family: var(--font-sans);
		font-size: 0.75rem;
		font-weight: 500;
		line-height: 1.15;
		color: var(--color-text-muted);
		text-decoration: none;
		background: transparent;
		border: 0;
		border-radius: var(--radius-md);
		cursor: pointer;
		transition:
			background-color var(--dur-fast) var(--ease),
			color var(--dur-fast) var(--ease),
			opacity var(--dur-fast) var(--ease);
	}

	.tab:not([aria-current='page'], .tab-compose):hover {
		background: var(--color-surface-2);
		color: var(--color-text);
		text-decoration: none;
	}

	.tab:active {
		opacity: 0.88;
	}

	.tab[aria-current='page'] {
		background: var(--color-accent-soft);
		color: var(--color-accent-text);
		font-weight: 600;
	}

	.tab-compose {
		background: var(--color-accent);
		color: var(--color-on-accent);
		border-radius: var(--radius-pill);
		font-weight: 600;
		margin: 2px 3px;
	}

	.tab-compose:hover {
		background: color-mix(in oklab, var(--color-accent) 88%, var(--color-text));
		color: var(--color-on-accent);
	}

	@media (prefers-reduced-motion: no-preference) {
		.tab {
			transition:
				background-color var(--dur-fast) var(--ease),
				color var(--dur-fast) var(--ease),
				opacity var(--dur-fast) var(--ease),
				scale 90ms var(--ease);
		}

		.tab:active {
			scale: 0.96;
		}
	}

	@media (forced-colors: active) {
		.tab:active {
			opacity: 1;
		}

		.tab[aria-current='page'],
		.tab-compose {
			forced-color-adjust: none;
			background: Highlight;
			color: HighlightText;
		}
	}
</style>
