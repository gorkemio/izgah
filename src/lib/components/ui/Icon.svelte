<script lang="ts">
	import { ICONS, type IconName } from './icons';

	interface Props {
		name: IconName;
		size?: number;
		filled?: boolean;
		strokeWidth?: number;
		class?: string;
	}

	let {
		name,
		size = 18,
		filled = false,
		strokeWidth = 1.5,
		class: className = ''
	}: Props = $props();
	const shapes = $derived(ICONS[name]);
</script>

<svg
	class="icon {className}"
	class:is-filled={filled}
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill={filled ? 'currentColor' : 'none'}
	stroke="currentColor"
	stroke-width={strokeWidth}
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
	focusable="false"
>
	{#each shapes as shape, index (index)}
		{#if shape.tag === 'path'}
			<path d={shape.d} />
		{:else if shape.tag === 'circle'}
			<circle cx={shape.cx} cy={shape.cy} r={shape.r} />
		{:else}
			<rect x={shape.x} y={shape.y} width={shape.width} height={shape.height} rx={shape.rx} />
		{/if}
	{/each}
</svg>

<style>
	.icon {
		flex: none;
	}
</style>
