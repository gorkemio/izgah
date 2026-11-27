<script lang="ts">
	import { watchImageError } from '#lib/client/image-error.ts';
	import { avatarTone, initials } from '#lib/format/avatar.ts';
	import { getLocale } from '#lib/i18n/index.ts';
	import { cn } from '#lib/utils.ts';

	/**
	 * A member's profile photo, or initials on their stable tone when there is none
	 * (docs/designs/izgah-ui-v5.md §3.6, §10.2). Decorative: the name is always printed next to it.
	 */
	interface Props {
		id: string;
		name: string;
		avatarAssetKey?: string | null;
		/** Size and text utilities, e.g. `size-7 text-[11px]`. */
		class?: string;
	}

	let {
		id,
		name,
		avatarAssetKey = null,
		class: className = 'size-7 text-[11px]'
	}: Props = $props();

	let failed = $state(false);
	let imgEl = $state<HTMLImageElement | null>(null);

	$effect(() => {
		const img = imgEl;
		if (!img) {
			return;
		}
		return watchImageError(img, () => {
			failed = true;
		});
	});

	let lastKey: string | null = null;
	$effect.pre(() => {
		if (avatarAssetKey !== lastKey) {
			lastKey = avatarAssetKey;
			failed = false;
		}
	});
</script>

{#if avatarAssetKey && !failed}
	<img
		class={cn('member-avatar shrink-0 rounded-full bg-muted object-cover', className)}
		src={`/media/thumbnails/${encodeURIComponent(avatarAssetKey)}`}
		alt=""
		width="256"
		height="256"
		loading="lazy"
		decoding="async"
		bind:this={imgEl}
	/>
{:else}
	<span
		class={cn(
			'member-avatar grid shrink-0 place-items-center rounded-full font-semibold text-avatar-foreground',
			className
		)}
		style="background: var(--avatar-{avatarTone(id)})"
		aria-hidden="true"
	>
		{initials(name, getLocale())}
	</span>
{/if}
