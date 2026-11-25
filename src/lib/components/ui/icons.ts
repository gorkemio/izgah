/*
 * Icon shapes from Lucide (https://lucide.dev), ISC License:
 * Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT).
 * All other copyright (c) for Lucide are held by Lucide Contributors 2022.
 * Permission to use, copy, modify, and/or distribute this software for any purpose with or without
 * fee is hereby granted, provided that the above copyright notice and this permission notice appear
 * in all copies. THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES.
 *
 * Stored as plain shape data (no {@html}) and rendered by Icon.svelte.
 */
export type IconShape =
	| { tag: 'path'; d: string }
	| { tag: 'circle'; cx: number; cy: number; r: number }
	| { tag: 'rect'; x: number; y: number; width: number; height: number; rx: number };

const p = (d: string): IconShape => ({ tag: 'path', d });
const c = (cx: number, cy: number, r: number): IconShape => ({ tag: 'circle', cx, cy, r });
const r = (x: number, y: number, width: number, height: number, rx: number): IconShape => ({
	tag: 'rect',
	x,
	y,
	width,
	height,
	rx
});

export const ICONS = {
	home: [
		p('M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8'),
		p(
			'M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'
		)
	],
	search: [c(11, 11, 8), p('m21 21-4.3-4.3')],
	bell: [
		p('M10.268 21a2 2 0 0 0 3.464 0'),
		p(
			'M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326'
		)
	],
	plus: [p('M5 12h14'), p('M12 5v14')],
	layers: [
		p(
			'M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z'
		),
		p('m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65'),
		p('m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65')
	],
	user: [p('M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2'), c(12, 7, 4)],
	heart: [
		p(
			'M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z'
		)
	],
	message: [p('M7.9 20A9 9 0 1 0 4 16.1L2 22Z')],
	copy: [r(8, 8, 14, 14, 2), p('M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2')],
	external: [
		p('M15 3h6v6'),
		p('M10 14 21 3'),
		p('M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6')
	],
	more: [c(12, 12, 1), c(19, 12, 1), c(5, 12, 1)],
	key: [
		p('m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4'),
		p('m21 2-9.6 9.6'),
		c(7.5, 15.5, 5.5)
	],
	shield: [
		p(
			'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z'
		)
	],
	logout: [p('M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4'), p('m16 17 5-5-5-5'), p('M21 12H9')],
	sun: [
		c(12, 12, 4),
		p('M12 2v2'),
		p('M12 20v2'),
		p('m4.93 4.93 1.41 1.41'),
		p('m17.66 17.66 1.41 1.41'),
		p('M2 12h2'),
		p('M20 12h2'),
		p('m6.34 17.66-1.41 1.41'),
		p('m19.07 4.93-1.41 1.41')
	],
	moon: [p('M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z')],
	monitor: [r(2, 3, 20, 14, 2), p('M8 21h8'), p('M12 17v4')],
	keyboard: [
		p('M10 8h.01'),
		p('M12 12h.01'),
		p('M14 8h.01'),
		p('M16 12h.01'),
		p('M18 8h.01'),
		p('M6 8h.01'),
		p('M7 16h10'),
		p('M8 12h.01'),
		r(2, 4, 20, 16, 2)
	],
	close: [p('M18 6 6 18'), p('m6 6 12 12')],
	chevronDown: [p('m6 9 6 6 6-6')],
	chevronRight: [p('m9 18 6-6-6-6')],
	arrowUp: [p('m5 12 7-7 7 7'), p('M12 19V5')],
	arrowLeft: [p('m12 19-7-7 7-7'), p('M19 12H5')],
	link: [
		p('M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71'),
		p('M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71')
	],
	check: [p('M20 6 9 17l-5-5')],
	alert: [c(12, 12, 10), p('M12 8v4'), p('M12 16h.01')],
	hash: [p('M4 9h16'), p('M4 15h16'), p('M10 3 8 21'), p('M16 3l-2 18')],
	panelRight: [r(3, 3, 18, 18, 2), p('M15 3v18')],
	command: [p('M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3')],
	gitBranch: [p('M6 3v12'), c(18, 6, 3), c(6, 18, 3), p('M18 9a9 9 0 0 1-9 9')],
	play: [p('m6 3 14 9-14 9V3z')],
	settings: [
		p(
			'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z'
		),
		c(12, 12, 3)
	],
	eye: [
		p(
			'M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0'
		),
		c(12, 12, 3)
	],
	eyeOff: [
		p(
			'M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49'
		),
		p('M14.084 14.158a3 3 0 0 1-4.242-4.242'),
		p(
			'M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143'
		),
		p('m2 2 20 20')
	],
	filter: [p('M22 3H2l8 9.46V19l4 2v-8.54L22 3z')],
	bookmark: [p('m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z')],
	sliders: [
		p('M21 4h-7'),
		p('M10 4H3'),
		p('M21 12h-9'),
		p('M8 12H3'),
		p('M21 20h-5'),
		p('M12 20H3'),
		p('M14 2v4'),
		p('M8 10v4'),
		p('M16 18v4')
	]
} satisfies Record<string, IconShape[]>;

export type IconName = keyof typeof ICONS;
