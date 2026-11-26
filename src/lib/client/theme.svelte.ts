import { getContext, setContext } from 'svelte';
import {
	colorSchemeFor,
	DEFAULT_PALETTE,
	type Palette,
	type ThemePreference
} from '#lib/types/appearance.ts';

export type ThemeChoice = ThemePreference;

const CONTEXT_KEY = Symbol('izgah.theme-state');

/**
 * The current mode and palette, shared by every appearance picker on the page (account menu and
 * /settings "Görünüm") so they never disagree after a JS switch (izgah-ui-v2 §9, izgah-themes §5).
 */
export class ThemeState {
	value = $state<ThemeChoice>('system');
	palette = $state<Palette>({ ...DEFAULT_PALETTE });

	constructor(initial: ThemeChoice, palette: Palette) {
		this.value = initial;
		this.palette = { ...palette };
	}

	apply(choice: ThemeChoice): void {
		this.value = choice;
		document.documentElement.dataset.theme = choice;
		document
			.querySelector('meta[name="color-scheme"]')
			?.setAttribute('content', colorSchemeFor(choice));
	}

	applyPalette(palette: Palette): void {
		this.palette = { ...palette };
		const { dataset } = document.documentElement;
		dataset.lightTheme = palette.lightTheme;
		dataset.darkTheme = palette.darkTheme;
	}
}

export function setThemeState(state: ThemeState): ThemeState {
	return setContext(CONTEXT_KEY, state);
}

export function getThemeState(): ThemeState | undefined {
	return getContext<ThemeState | undefined>(CONTEXT_KEY);
}
