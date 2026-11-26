<!--
	Effect level switch (docs/designs/izgah-ui-v5.md §7). The choice is stored in the izgah_effects
	cookie by /settings?/setEffects and applied at once to <html data-effects>.
-->
<script lang="ts">
	import { t } from '#lib/i18n/index.ts';
	import { enhance, type SubmitFunction } from '$app/forms';
	import { page } from '$app/state';
	import { toasts } from '#lib/client/toast.svelte.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import * as RadioGroup from '#lib/components/ui/radio-group/index.ts';
	import type { EffectLevel } from '#lib/types/appearance.ts';

	interface Props {
		effects: EffectLevel;
	}

	let { effects }: Props = $props();

	let value = $derived<string>(effects);
	let formEl = $state<HTMLFormElement | null>(null);
	const returnTo = $derived(`${page.url.pathname}${page.url.search}`);

	const options: [EffectLevel, string, string][] = [
		['full', t('effects.full'), t('effects.fullHint')],
		['reduced', t('effects.reduced'), t('effects.reducedHint')]
	];

	const handleEnhance: SubmitFunction = ({ formData }) => {
		const chosen = formData.get('effects') === 'reduced' ? 'reduced' : 'full';
		document.documentElement.dataset.effects = chosen;
		return async ({ result, update }) => {
			if (result.type !== 'success') {
				toasts.push(t('effects.saveFailed'), { tone: 'error' });
				await update({ navigate: false });
			}
		};
	};
</script>

<form
	bind:this={formEl}
	method="POST"
	action="/settings?/setEffects"
	use:enhance={handleEnhance}
	class="effects-form"
>
	<RadioGroup.Root
		name="effects"
		bind:value
		aria-label={t('effects.legend')}
		onValueChange={() => queueMicrotask(() => formEl?.requestSubmit())}
		class="gap-3"
	>
		{#each options as [option, label, hint] (option)}
			<div class="flex items-start gap-3">
				<RadioGroup.Item value={option} id="effects-{option}" class="mt-0.5" />
				<div class="grid gap-0.5">
					<Label for="effects-{option}" class="cursor-pointer">{label}</Label>
					<p class="text-sm text-muted-foreground">{hint}</p>
				</div>
			</div>
		{/each}
	</RadioGroup.Root>
	<input type="hidden" name="returnTo" value={returnTo} />
</form>
