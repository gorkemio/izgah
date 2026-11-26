<script lang="ts">
	import { t } from '#lib/i18n/index.ts';
	import { page } from '$app/state';
	import Inbox from '@lucide/svelte/icons/inbox';
	import Layers from '@lucide/svelte/icons/layers';
	import Plus from '@lucide/svelte/icons/plus';
	import Search from '@lucide/svelte/icons/search';
	import UserRound from '@lucide/svelte/icons/user-round';

	interface Props {
		onCompose: () => void;
	}

	let { onCompose }: Props = $props();
	const pathname = $derived(page.url.pathname);

	function handleCompose(event: MouseEvent): void {
		event.preventDefault();
		onCompose();
	}

	const tab =
		'relative grid min-h-12 place-items-center content-center gap-1 rounded-lg px-1 text-[11px] text-muted-foreground no-underline transition-colors aria-[current=page]:font-medium aria-[current=page]:text-foreground';
</script>

<!--
	Mobile tab bar (< 768px), docs/designs/izgah-ui-v5.md §4. The rail navigation is display:none
	there, so exactly one "Ana gezinme" landmark exists at every width (izgah-ui-v2.md §12).
-->
<nav class="tab-bar border-t border-hairline glass" aria-label={t('nav.main')}>
	<a href="/" class={tab} aria-current={pathname === '/' ? 'page' : undefined}>
		<Inbox class="size-5" aria-hidden="true" />
		<span>{t('nav.feed')}</span>
	</a>
	<a
		href="/sections"
		class={tab}
		aria-current={pathname.startsWith('/sections') ? 'page' : undefined}
	>
		<Layers class="size-5" aria-hidden="true" />
		<span>{t('nav.sections')}</span>
	</a>
	<form method="GET" action="/" class="contents">
		<input type="hidden" name="compose" value="1" />
		<button
			type="submit"
			class="grid place-items-center self-center justify-self-center"
			aria-label={t('nav.shareLink')}
			onclick={handleCompose}
		>
			<span class="grid size-11 place-items-center rounded-full bg-ink tactile">
				<Plus class="size-5" aria-hidden="true" />
			</span>
			<span class="sr-only">{t('nav.share')}</span>
		</button>
	</form>
	<a href="/search" class={tab} aria-current={pathname === '/search' ? 'page' : undefined}>
		<Search class="size-5" aria-hidden="true" />
		<span>{t('nav.search')}</span>
	</a>
	<a
		href="/settings"
		class={tab}
		aria-current={pathname.startsWith('/settings') ? 'page' : undefined}
	>
		<UserRound class="size-5" aria-hidden="true" />
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
			padding-block: 4px calc(4px + env(safe-area-inset-bottom, 0px));
			padding-inline: calc(6px + env(safe-area-inset-left, 0px))
				calc(6px + env(safe-area-inset-right, 0px));
		}

		/* Keep the bar from sitting on top of the virtual keyboard while typing, and keep it away
		   while a [data-draft] field holds text: tapping that form's submit button blurs the field,
		   and a returning bar would move the button out from under the finger. */
		:global(body:has(:is(input, textarea, select, [contenteditable='true']):focus)) .tab-bar,
		:global(body:has(textarea[data-draft]:not(:placeholder-shown))) .tab-bar {
			display: none;
		}
	}

	@media (forced-colors: active) {
		.tab-bar :global([aria-current='page']) {
			forced-color-adjust: none;
			background: Highlight;
			color: HighlightText;
		}
	}
</style>
