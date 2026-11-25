<script lang="ts" module>
	export interface SegmentedOption<V extends string = string> {
		value: V;
		label: string;
		href?: string;
		count?: number;
		disabled?: boolean;
	}
</script>

<script lang="ts" generics="T extends string = string">
	interface Props {
		options: ReadonlyArray<SegmentedOption<T>>;
		value: T;
		ariaLabel: string;
		/**
		 * `links`: `<nav>` with `<a href>` items (no-JS navigation).
		 * `radio`: `<fieldset>` with native `<input type="radio">` items (no-JS form control).
		 * `buttons`: `role="group"` with `<button aria-pressed>` items (client interactive filter).
		 */
		mode?: 'links' | 'radio' | 'buttons';
		/** Form field name when `mode="radio"`. */
		name?: string;
		/** Automatically submits the enclosing `<form>` when a radio option changes. */
		autoSubmit?: boolean;
		size?: 'sm' | 'md';
		class?: string;
		onChange?: (value: T) => void;
	}

	let {
		options,
		value,
		ariaLabel,
		mode,
		name,
		autoSubmit = false,
		size = 'md',
		class: className = '',
		onChange
	}: Props = $props();

	const resolvedMode = $derived<'links' | 'radio' | 'buttons'>(
		mode ?? (options.some((opt) => opt.href !== undefined) ? 'links' : name ? 'radio' : 'buttons')
	);

	function handleRadioChange(
		optionValue: T,
		event: Event & { currentTarget: HTMLInputElement }
	): void {
		onChange?.(optionValue);
		if (autoSubmit) {
			event.currentTarget.form?.requestSubmit();
		}
	}
</script>

{#if resolvedMode === 'links'}
	<nav class="segmented is-{size} {className}" aria-label={ariaLabel}>
		{#each options as option (option.value)}
			{@const active = option.value === value}
			{#if option.disabled}
				<span class="seg-item" aria-disabled="true">
					<span>{option.label}</span>
					{#if option.count !== undefined}
						<span class="seg-count">{option.count}</span>
					{/if}
				</span>
			{:else}
				<a
					href={option.href ?? '#'}
					class="seg-item"
					class:is-active={active}
					aria-current={active ? 'page' : undefined}
				>
					<span>{option.label}</span>
					{#if option.count !== undefined}
						<span class="seg-count">{option.count}</span>
					{/if}
				</a>
			{/if}
		{/each}
	</nav>
{:else if resolvedMode === 'radio'}
	<fieldset class="segmented-fieldset {className}">
		<legend class="visually-hidden">{ariaLabel}</legend>
		<div class="segmented is-{size}">
			{#each options as option (option.value)}
				{@const active = option.value === value}
				<label class="seg-item" class:is-active={active}>
					<input
						type="radio"
						class="visually-hidden seg-radio"
						{name}
						value={option.value}
						checked={active}
						disabled={option.disabled}
						onchange={(event) => handleRadioChange(option.value, event)}
					/>
					<span>{option.label}</span>
					{#if option.count !== undefined}
						<span class="seg-count">{option.count}</span>
					{/if}
				</label>
			{/each}
		</div>
	</fieldset>
{:else}
	<div class="segmented is-{size} {className}" role="group" aria-label={ariaLabel}>
		{#each options as option (option.value)}
			{@const active = option.value === value}
			<button
				type="button"
				class="seg-item"
				class:is-active={active}
				aria-pressed={active}
				disabled={option.disabled}
				onclick={() => onChange?.(option.value)}
			>
				<span>{option.label}</span>
				{#if option.count !== undefined}
					<span class="seg-count">{option.count}</span>
				{/if}
			</button>
		{/each}
	</div>
{/if}

<style>
	.segmented-fieldset {
		margin: 0;
		padding: 0;
		border: 0;
		min-inline-size: 0;
		display: inline-flex;
		max-inline-size: 100%;
	}

	.segmented.is-sm .seg-item {
		min-block-size: 24px;
		padding: 0 9px;
		font-size: 0.78125rem;
	}

	.seg-count {
		font: var(--text-meta);
		font-size: 0.75rem;
		font-variant-numeric: tabular-nums;
		color: var(--color-text-muted);
	}

	.seg-item.is-active .seg-count,
	.seg-item[aria-current='page'] .seg-count,
	.seg-item[aria-pressed='true'] .seg-count,
	.seg-item:has(input:checked) .seg-count {
		color: var(--color-text-secondary);
	}

	@media (pointer: coarse) {
		.segmented.is-sm .seg-item {
			min-block-size: 38px;
		}
	}
</style>
