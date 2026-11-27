/*
 * Shared helpers for the shadcn-svelte components in src/lib/components/ui
 * (docs/designs/izgah-ui-v5.md §1.1, §1.2).
 */
import { cn } from 'cn';

export { cn };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WithoutChild<T> = T extends { child?: any } ? Omit<T, 'child'> : T;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WithoutChildren<T> = T extends { children?: any } ? Omit<T, 'children'> : T;
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & { ref?: U | null };

type VariantTable = Record<string, Record<string, string>>;

interface VariantConfig<V extends VariantTable> {
	base?: string;
	variants?: V;
	defaultVariants?: { [K in keyof V]?: keyof V[K] };
}

type VariantInput<V extends VariantTable> = { [K in keyof V]?: keyof V[K] | null } & {
	class?: string | null;
	className?: string | null;
};

/**
 * The part of tailwind-variants' `tv()` the shadcn-svelte components use (base, variants and
 * defaults), on top of `cn` so later classes still win. Replaces the 39 KB package on every page
 * (izgah-ui-v5.md §7 budgets).
 */
export function tv<V extends VariantTable>(config: VariantConfig<V>) {
	return (input: VariantInput<V> = {} as VariantInput<V>): string => {
		const parts: Array<string | null | undefined> = [config.base];
		for (const key in config.variants) {
			const value = input[key] ?? config.defaultVariants?.[key];
			if (value != null) {
				parts.push(config.variants[key][String(value)]);
			}
		}
		parts.push(input.class, input.className);
		return cn(...parts);
	};
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type VariantProps<T extends (...args: any) => string> = Omit<
	NonNullable<Parameters<T>[0]>,
	'class' | 'className'
>;
