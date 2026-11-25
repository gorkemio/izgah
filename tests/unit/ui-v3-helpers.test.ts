import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import Avatar from '../../src/lib/components/ui/Avatar.svelte';
import AvatarStack from '../../src/lib/components/ui/AvatarStack.svelte';
import { ICONS } from '../../src/lib/components/ui/icons';
import SegmentedControl from '../../src/lib/components/ui/SegmentedControl.svelte';
import Skeleton from '../../src/lib/components/ui/Skeleton.svelte';
import { highlightTerms, splitHighlights } from '../../src/lib/search/highlight';

describe('UI v3 Studio primitives & helpers', () => {
	describe('Avatar deterministic initials and tone', () => {
		it('computes Turkish-aware initials and falls back to "?" for blank names', () => {
			expect(render(Avatar, { props: { name: 'ilker ışık' } }).body).toContain('İI');
			expect(render(Avatar, { props: { name: 'çağrı şahin' } }).body).toContain('ÇŞ');
			expect(render(Avatar, { props: { name: 'Deniz Ali Kaya' } }).body).toContain('DA');
			expect(render(Avatar, { props: { name: '   ' } }).body).toContain('?');
		});

		it('assigns a deterministic neutral tone (1..4) for peers and accent-soft for self', () => {
			const first = render(Avatar, { props: { name: 'Ahmet Yılmaz' } }).body;
			const second = render(Avatar, { props: { name: '  ahmet yılmaz  ' } }).body;
			const toneMatch = /is-tone-([1-4])/.exec(first);
			expect(toneMatch).not.toBeNull();
			expect(second).toContain(`is-tone-${toneMatch![1]}`);
			expect(first).toContain('aria-hidden="true"');

			const selfHtml = render(Avatar, {
				props: { name: 'Ahmet Yılmaz', self: true, size: 26 }
			}).body;
			expect(selfHtml).toContain('is-self');
			expect(selfHtml).not.toMatch(/is-tone-[1-4]/);
			expect(selfHtml).toMatch(/--avatar-size:\s*26px/);
		});
	});

	describe('AvatarStack overflow handling', () => {
		it('renders at most max avatars and displays a +N overflow badge when truncated', () => {
			const { body } = render(AvatarStack, {
				props: {
					items: [
						{ name: 'Ada' },
						{ name: 'Bora' },
						{ name: 'Can', self: true },
						{ name: 'Deniz' },
						{ name: 'Ece' }
					],
					max: 3,
					label: '5 kişi paylaştı'
				}
			});
			expect(body.match(/class="avatar-stack-item/g)).toHaveLength(3);
			expect(body).toContain('+2');
			expect(body).toContain('5 kişi paylaştı');
		});

		it('omits overflow badge when items fit within max', () => {
			const { body } = render(AvatarStack, {
				props: {
					items: [{ name: 'Ada' }, { name: 'Bora' }],
					max: 3
				}
			});
			expect(body.match(/class="avatar-stack-item/g)).toHaveLength(2);
			expect(body).not.toContain('avatar-stack-overflow');
		});
	});

	describe('SegmentedControl and Skeleton SSR output', () => {
		it('renders link and radio SegmentedControl variants without requiring JS', () => {
			const linkHtml = render(SegmentedControl, {
				props: {
					ariaLabel: 'İçerik türü',
					value: 'all',
					options: [
						{ value: 'all', label: 'Tümü', href: '/' },
						{ value: 'article', label: 'Makale', href: '/?type=article' }
					]
				}
			}).body;
			expect(linkHtml).toContain('aria-current="page"');
			expect(linkHtml).toContain('href="/?type=article"');

			const radioHtml = render(SegmentedControl, {
				props: {
					ariaLabel: 'Tema modu',
					name: 'theme',
					value: 'dark',
					options: [
						{ value: 'system', label: 'Sistem' },
						{ value: 'dark', label: 'Koyu' }
					]
				}
			}).body;
			expect(radioHtml).toContain('type="radio"');
			expect(radioHtml).toContain('name="theme"');
			expect(radioHtml).toContain('value="dark"');
		});

		it('renders Skeleton lines as decorative placeholders', () => {
			const { body } = render(Skeleton, { props: { variant: 'line', lines: 3 } });
			expect(body).toContain('aria-hidden="true"');
			expect(body.match(/skeleton-line/g)).toHaveLength(3);
		});
	});

	describe('Studio icons and Turkish command-palette highlighting', () => {
		it('registers all v3 Studio icons with valid SVG shapes', () => {
			for (const name of [
				'panelRight',
				'command',
				'gitBranch',
				'play',
				'arrowLeft',
				'chevronRight',
				'settings',
				'eye',
				'eyeOff',
				'filter',
				'bookmark',
				'sliders'
			] as const) {
				expect(ICONS[name].length).toBeGreaterThan(0);
			}
		});

		it('folds Turkish diacritics when splitting terms for command palette highlights', () => {
			const terms = highlightTerms('arayuz');
			const parts = splitHighlights('Arayüz Tasarımı', terms);
			expect(parts).toEqual([
				{ text: 'Arayüz', match: true },
				{ text: ' Tasarımı', match: false }
			]);
		});
	});
});
