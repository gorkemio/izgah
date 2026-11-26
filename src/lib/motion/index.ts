/*
 * Motion presets for UI v5 "Fener" (docs/designs/izgah-ui-v5.md §1.4, §6, §7).
 *
 * Every animation goes through these helpers so the "Reduced" effect level, reduced motion,
 * reduced transparency, high contrast and forced colours turn it off in one place.
 */
import { backOut, cubicOut } from 'svelte/easing';
import {
	fade,
	fly,
	scale,
	type FadeParams,
	type FlyParams,
	type ScaleParams,
	type TransitionConfig
} from 'svelte/transition';

/** Durations in milliseconds (§6). */
export const DURATION = {
	fast: 120,
	base: 200,
	slow: 300,
	celebrate: 450
} as const;

/** Spring settings for `svelte/motion` `Spring` (stiffness and damping between 0 and 1). */
export const SPRING = {
	/** Indicators that follow the active item: tabs, toggle groups, the tab bar. */
	snappy: { stiffness: 0.2, damping: 0.7 },
	/** Larger surfaces: panels and sheets dragged by hand. */
	gentle: { stiffness: 0.1, damping: 0.8 },
	/** Celebration: the like heart. */
	bouncy: { stiffness: 0.25, damping: 0.45 }
} as const;

/** Media queries that force reduced effects whatever the cookie says (§7). */
export const REDUCED_EFFECTS_QUERY =
	'(prefers-reduced-motion: reduce), (prefers-reduced-transparency: reduce), (prefers-contrast: more), (forced-colors: active)';

/** True when animations must not run: server rendering, the Reduced level or a system setting. */
export function effectsReduced(): boolean {
	if (typeof document === 'undefined' || typeof matchMedia === 'undefined') {
		return true;
	}
	return (
		document.documentElement.dataset.effects === 'reduced' ||
		matchMedia(REDUCED_EFFECTS_QUERY).matches
	);
}

/** A duration that collapses to zero under reduced effects. */
export function duration(ms: number): number {
	return effectsReduced() ? 0 : ms;
}

/** `fly` with the v5 defaults; no movement under reduced effects. */
export function motionFly(node: Element, params: FlyParams = {}): TransitionConfig {
	if (effectsReduced()) {
		return fade(node, { duration: 0 });
	}
	return fly(node, { duration: DURATION.base, easing: cubicOut, y: 8, ...params });
}

/** `fade` with the v5 defaults. */
export function motionFade(node: Element, params: FadeParams = {}): TransitionConfig {
	return fade(node, { duration: duration(DURATION.fast), easing: cubicOut, ...params });
}

/** `scale` for popping elements such as badges; no scaling under reduced effects. */
export function motionPop(node: Element, params: ScaleParams = {}): TransitionConfig {
	if (effectsReduced()) {
		return fade(node, { duration: 0 });
	}
	return scale(node, { duration: DURATION.base, easing: backOut, start: 0.85, ...params });
}
