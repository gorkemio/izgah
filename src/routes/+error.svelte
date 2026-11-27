<script lang="ts">
	import { t } from '#lib/i18n/index.ts';
	import { instanceName } from '#lib/instance.ts';
	import { page } from '$app/state';
	import ErrorContent from '#lib/components/ErrorContent.svelte';

	// Errors outside the app shell (sign-in pages, layout auth failures) land here (F14).
	const signedOut = $derived(page.status === 401);
</script>

<main
	id="main-content"
	class="error-page grid min-h-dvh content-center justify-items-center gap-6 px-[var(--gutter)] py-8"
>
	<a
		href="/"
		class="brand inline-flex items-center gap-2 text-[17px] tracking-[-0.02em] text-foreground no-underline"
	>
		<span class="grid size-6 place-items-center rounded-[7px] bg-primary" aria-hidden="true">
			<span class="size-1.5 rounded-full bg-primary-foreground"></span>
		</span>
		<span class="font-semibold">{instanceName()}</span>
	</a>
	<ErrorContent
		homeHref={signedOut ? '/login' : '/'}
		homeLabel={signedOut ? t('error.goToSignIn') : t('error.goHome')}
	/>
</main>
