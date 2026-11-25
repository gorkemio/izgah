<script lang="ts">
	import { splitHighlights } from '$lib/search/highlight';

	let { text, terms = [] }: { text: string; terms?: readonly string[] } = $props();

	const parts = $derived(splitHighlights(text, terms));
</script>

<!-- Plain text split into nodes; never {@html} (izgah-ui-v2 §13). -->
{#each parts as part, index (index)}{#if part.match}<mark class="hl">{part.text}</mark
		>{:else}{part.text}{/if}{/each}
