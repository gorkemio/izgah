<script lang="ts">
	interface Props {
		name: string;
		/** The viewer's own avatar receives the soft accent tone; peers get deterministic neutral tones. */
		self?: boolean;
		size?: number;
		class?: string;
	}

	let { name, self = false, size = 30, class: className = '' }: Props = $props();

	const initials = $derived(
		name
			.trim()
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((part) => Array.from(part)[0] ?? '')
			.join('')
			.toLocaleUpperCase('tr-TR') || '?'
	);

	function hashTone(input: string): 1 | 2 | 3 | 4 {
		const normalized = input.trim().toLocaleLowerCase('tr-TR');
		let hash = 2166136261;
		for (let i = 0; i < normalized.length; i += 1) {
			hash ^= normalized.charCodeAt(i);
			hash = Math.imul(hash, 16777619);
		}
		return (((hash >>> 0) % 4) + 1) as 1 | 2 | 3 | 4;
	}

	const tone = $derived(hashTone(name));
</script>

<span
	class="avatar {self ? 'is-self' : `is-tone-${tone}`} {className}"
	style:--avatar-size="{size}px"
	aria-hidden="true"
>
	{initials}
</span>

<style>
	.avatar {
		display: inline-grid;
		place-items: center;
		flex: none;
		inline-size: var(--avatar-size);
		block-size: var(--avatar-size);
		font-family: var(--font-sans);
		font-size: calc(var(--avatar-size) * 0.38);
		font-weight: 600;
		line-height: 1;
		letter-spacing: 0.01em;
		color: var(--color-text);
		background: var(--color-surface-2);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-pill);
		user-select: none;
	}

	.avatar.is-tone-1 {
		background: var(--color-avatar-1-bg);
	}

	.avatar.is-tone-2 {
		background: var(--color-avatar-2-bg);
	}

	.avatar.is-tone-3 {
		background: var(--color-avatar-3-bg);
	}

	.avatar.is-tone-4 {
		background: var(--color-avatar-4-bg);
	}

	.avatar.is-self {
		background: var(--color-accent-soft);
		color: var(--color-accent-text);
		border-color: var(--color-accent-border);
	}

	@media (forced-colors: active) {
		.avatar {
			border-color: CanvasText;
		}

		.avatar.is-self {
			background: Highlight;
			color: HighlightText;
			border-color: Highlight;
		}
	}
</style>
