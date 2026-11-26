<!--
	A number that rolls to its new value (izgah-ui-v5.md §6, "Counters and badges"). Screen readers
	get only the final value; the rolling digits are hidden from them.
-->
<script lang="ts">
	import { cubicOut } from 'svelte/easing';
	import { Tween } from 'svelte/motion';
	import { DURATION, duration } from './index.ts';

	interface Props {
		value: number;
		format?: (value: number) => string;
		class?: string;
	}

	let { value, format = (n) => String(Math.round(n)), class: className = '' }: Props = $props();

	const tween = Tween.of(() => value, {
		duration: () => duration(DURATION.slow),
		easing: cubicOut
	});
</script>

<span class="tabular-nums {className}">
	<span aria-hidden="true">{format(tween.current)}</span><span class="sr-only">
		{format(value)}
	</span>
</span>
