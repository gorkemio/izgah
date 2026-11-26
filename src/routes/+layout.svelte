<script lang="ts">
	import { t } from '#lib/i18n/index.ts';
	import '#lib/styles/fonts.css';
	import '../app.css';

	let { children } = $props();

	function handleSkipLink(event: MouseEvent): void {
		const target = document.getElementById('main-content') ?? document.querySelector('main');
		if (!target) {
			return;
		}
		event.preventDefault();
		if (!target.hasAttribute('tabindex')) {
			target.setAttribute('tabindex', '-1');
		}
		target.focus();
	}
</script>

<a class="skip-link" href="#main-content" onclick={handleSkipLink}>{t('a11y.skipToContent')}</a>

{@render children()}
