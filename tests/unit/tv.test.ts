import { describe, expect, it } from 'vitest';
import { tv } from '../../src/lib/utils';

const button = tv({
	base: 'inline-flex px-3',
	variants: {
		variant: { default: 'bg-primary', ghost: 'bg-transparent' },
		size: { default: 'h-8', sm: 'h-7 px-2' }
	},
	defaultVariants: { variant: 'default', size: 'default' }
});

describe('tv() for shadcn-svelte variants', () => {
	it('applies the base, the defaults and the chosen variants', () => {
		expect(button()).toBe('inline-flex px-3 bg-primary h-8');
		expect(button({ variant: 'ghost' })).toBe('inline-flex px-3 bg-transparent h-8');
	});

	it('lets later classes win conflicts', () => {
		expect(button({ size: 'sm' })).toBe('inline-flex bg-primary h-7 px-2');
		expect(button({ class: 'h-11' })).toBe('inline-flex px-3 bg-primary h-11');
	});
});
