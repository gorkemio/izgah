<script lang="ts">
	interface Props {
		variant?: 'line' | 'rect' | 'thumb' | 'circle';
		width?: string;
		height?: string;
		/** When `variant="line"`, renders multiple lines (the last line narrows to 70% if > 1). */
		lines?: number;
		class?: string;
	}

	let { variant = 'line', width, height, lines = 1, class: className = '' }: Props = $props();

	const lineCount = $derived(variant === 'line' ? Math.max(1, Math.floor(lines)) : 1);
	const indices = $derived(Array.from({ length: lineCount }, (_, index) => index));
</script>

{#if variant === 'line' && lineCount > 1}
	<span class="skeleton-stack {className}" aria-hidden="true">
		{#each indices as index (index)}
			<span
				class="skeleton skeleton-line"
				style:inline-size={index === lineCount - 1 ? '70%' : (width ?? '100%')}
				style:block-size={height}
			></span>
		{/each}
	</span>
{:else}
	<span
		class="skeleton {variant === 'line'
			? 'skeleton-line'
			: variant === 'thumb'
				? 'skeleton-thumb'
				: variant === 'circle'
					? 'skeleton-circle'
					: ''} {className}"
		style:inline-size={width}
		style:block-size={height}
		aria-hidden="true"
	></span>
{/if}

<style>
	.skeleton-stack {
		display: grid;
		gap: var(--space-1);
		inline-size: 100%;
	}

	.skeleton-stack .skeleton-line {
		margin-block: 0;
	}
</style>
