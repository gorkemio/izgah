/**
 * Calls `onFail` when the image fails to load and returns a cleanup function. Wire it with
 * `bind:this` + `$effect`: an `onerror={…}` handler or a `use:` action on <img> makes Svelte
 * server-render inline `onload`/`onerror` capture attributes, which the enforced CSP blocks
 * (script-src-attr, izgah-ui-v2 §11). Also catches an error that happened before hydration.
 */
export function watchImageError(img: HTMLImageElement, onFail: () => void): () => void {
	if (img.complete && img.naturalWidth === 0 && img.currentSrc) {
		onFail();
	}
	img.addEventListener('error', onFail);
	return () => img.removeEventListener('error', onFail);
}
