<script lang="ts" module>
	export interface AvatarStackItem {
		name: string;
		self?: boolean;
	}
</script>

<script lang="ts">
	import Avatar from './Avatar.svelte';

	interface Props {
		items: ReadonlyArray<AvatarStackItem>;
		max?: number;
		size?: number;
		/** Optional screen-reader summary when no adjacent visible text names the people. */
		label?: string;
		class?: string;
	}

	let { items, max = 3, size = 22, label, class: className = '' }: Props = $props();

	const limit = $derived(Math.max(1, Math.floor(max)));
	const visibleItems = $derived(items.slice(0, limit));
	const overflowCount = $derived(Math.max(0, items.length - visibleItems.length));
</script>

<span class="avatar-stack {className}" style:--stack-size="{size}px">
	<span class="avatar-stack-visual" aria-hidden="true">
		{#each visibleItems as item, index (`${item.name}-${index}`)}
			<span class="avatar-stack-item">
				<Avatar name={item.name} self={item.self} {size} />
			</span>
		{/each}
		{#if overflowCount > 0}
			<span class="avatar-stack-overflow">+{overflowCount}</span>
		{/if}
	</span>
	{#if label}
		<span class="visually-hidden">{label}</span>
	{/if}
</span>

<style>
	.avatar-stack {
		display: inline-flex;
		align-items: center;
	}

	.avatar-stack-visual {
		display: inline-flex;
		align-items: center;
	}

	.avatar-stack-item {
		display: inline-flex;
		margin-inline-start: -6px;
		border-radius: var(--radius-pill);
		box-shadow: 0 0 0 2px var(--avatar-ring, var(--card-bg, var(--color-surface-1)));
	}

	.avatar-stack-item:first-child {
		margin-inline-start: 0;
	}

	.avatar-stack-overflow {
		display: inline-grid;
		place-items: center;
		min-inline-size: var(--stack-size);
		block-size: var(--stack-size);
		padding-inline: 5px;
		margin-inline-start: -6px;
		border-radius: var(--radius-pill);
		font: var(--text-micro);
		font-size: 0.75rem;
		font-variant-numeric: tabular-nums;
		color: var(--color-text-secondary);
		background: var(--color-surface-2);
		border: 1px solid var(--color-line);
		box-shadow: 0 0 0 2px var(--avatar-ring, var(--card-bg, var(--color-surface-1)));
		user-select: none;
	}

	@media (forced-colors: active) {
		.avatar-stack-item,
		.avatar-stack-overflow {
			box-shadow: none;
		}

		.avatar-stack-overflow {
			border-color: CanvasText;
		}
	}
</style>
