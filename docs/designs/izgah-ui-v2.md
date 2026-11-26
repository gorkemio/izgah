# Izgah UI v2 — "Signal"

*   **Author:** Gorkem Inanc Ozdemir
*   **Status:** Partially Superseded by [izgah-ui-v3.md](./izgah-ui-v3.md), [izgah-ui-v4.md](./izgah-ui-v4.md) and [izgah-ui-v5.md](./izgah-ui-v5.md) (§2, §9, §11 and §12 remain binding; §12 as amended by v5 §14; the no-JavaScript rules of §8 and §13 end with v5 §8)
*   **Date:** 2026-11-20

> **UI v3 transition note (2026-11-24):** The visual language, colour palette, banned clichés, component inventory, shell and card layout and the extension colour tokens of this document (**§1, §3, §4, §5, §6, §7, §13 and §14**) were updated by [izgah-ui-v3.md](./izgah-ui-v3.md) ("Izgah Studio"), and later by [izgah-ui-v4.md](./izgah-ui-v4.md) ("Künye"). **§2** (self-hosted Fontsource fonts and the `latin`/`latin-ext` preload mechanism), **§9** (theme cookies and flash-free SSR), **§11** (security headers and an enforced CSP) and **§12** (fixed E2E hooks and accessible names) remain binding.

--------------------------------------------------------------------------------

## Overview

This document defines the second version ("Signal") of the Izgah web interface: the visual language and design tokens, typography, the app shell and information architecture, a people-first post anatomy, four new interactions (inline sharing plus paste-to-share, keyboard shortcuts, a last-visit divider, a new-posts pill), the light/dark theme cookie, the Content Security Policy (CSP), the new `GET /api/internal/feed/updates` endpoint, fixed E2E hooks and the token alignment of the browser extension. The data model, authentication, preview worker and `/api/v1/*` contract stay as defined in [izgah-core.md](./izgah-core.md); UI v2 needs no database migration.

As required by [AGENTS.md](../../AGENTS.md), this document is the approval checkpoint before any interface code that contradicts `izgah-core.md` §6 and §8 is written. §15 lists, as a table, which core rules change and which are kept.

**North star:** *"Share as fast as on WhatsApp, read like X, find it in the archive in seconds."*

#### Key Concepts

*   **Signal:** A visual language of a white background, black ink and a single electric lime accent (`#C8F542`). Lime only carries meaning: active navigation, the primary "Share", unseen content, selection and link emphasis.
*   **Rail:** A persistent left navigation column at `≥ 1024px`; between `768–1023px` it becomes a narrow icon-only form (the icon rail).
*   **Bottom tab bar:** A stateless bottom navigation within thumb reach at `< 768px`.
*   **Inline composer:** A `?/createShare` form at the top of the feed and section feeds that also works without JavaScript.
*   **Composer controller (`ComposerController`):** A layout-level context that routes paste, drag and drop, the `n` shortcut and the "Share" triggers in the rail and the bottom bar to one target (the inline form or a `<dialog>`).
*   **Scope:** The identity of a feed view: the feed (`feed`) or a particular section (`section:<id>`). The content type filter is not part of the scope.
*   **Last-visit divider:** A line that separates seen and unseen posts in the feed, based on the "last seen share time" stored on the device per scope.
*   **New-posts pill:** A button that shows how many new shares others have made while the feed is open and refreshes the feed when clicked.

## The Problem

The v0.1.0 interface is functionally complete and uses native platform primitives correctly, but it contradicts the product promise and the team's habits in four ways:

1.  **A link-centred card for a people-centred promise:** The brief says "like the X feed", yet the largest element on the card is the link title, while the sharer's note (the team's voice) is buried under the description and the author and time sit in a faint meta line.
2.  **No visual identity:** Colours and font are Tailwind slate defaults (`#f8fafc`, `#0f172a`, `#cbd5e1`, `#1d4ed8`, `system-ui`); there is only a light theme (while the extension has a dark one); input borders fall below `3:1` on white (WCAG 1.4.11).
3.  **Navigation hides the core concept:** When sections overflow they are hidden in a "Menu" popover; "Settings" and "Sign out" take up the primary area; there is no thumb-reachable navigation on mobile; ~250 lines of `ResizeObserver` measurement logic cause layout shift on every load.
4.  **Sharing is not as fast as WhatsApp:** Sharing requires opening a dialog first; a returning member cannot see what is new; new shares do not appear in an open tab without a reload; there is no fast keyboard access to the archive.

## Goals

*   **Fast sharing:** On the feed screen, sharing WhatsApp text from the clipboard takes at most three interactions (paste → optional note → `Ctrl/⌘ + Enter`). On desktop Chrome and Firefox, pasting does not require focusing a field first; on Safari and mobile the inline URL field is one tap away. Without JavaScript the inline form works with the same server action.
*   **Read like X:** Every post shows the sharer and their note first, then the link attachment. At `≥ 1024px`, a post with an image and a three-line note takes at most `280px` of vertical space. The feed is grouped by day and can be navigated with `j`/`k` without a mouse.
*   **Find it in the archive in seconds:** The search field is one keystroke (`/`) away from every app page; sections are listed in the `/sections` index, without JavaScript and on mobile too.
*   **Context on return:** The last-visit divider and the new-posts pill answer "what changed?" without writing read state to the server.
*   **Accessibility and resilience:** WCAG 2.2 AA (especially 1.4.3, 1.4.11, 2.1.4, 2.4.7, 2.4.11, 2.5.3, 2.5.8); computed contrast ratios for every token pair; touch targets of at least `44 × 44px` on coarse pointers (`pointer: coarse`); no theme flash on first paint; zero JavaScript measurement and zero layout shift in the shell.
*   **A narrow dependency surface:** Only two font packages are added; no component library, CSS framework, icon package or polyfill.

## Non-Goals

*   **Command palette and split view:** No `⌘K` command palette or master-detail split view in this version.
*   **Server-side read state:** Last-visit information is kept only in the device's `localStorage`; there is no cross-device sync (the core document's "no read/unread tracking" decision stands).
*   **Real-time push:** No SSE or WebSocket; new shares are counted by a 60-second poll on visible tabs.
*   **Custom themes and colour choice:** UI v2 only brings System / Light / Dark. Named extra themes (Dim, High contrast) and preset accent colours were added later by [izgah-themes.md](./izgah-themes.md); there is still no free colour choice or density setting.
*   **Profile pictures, emoji reactions, nested comments:** Avatars are monograms built from initials; the reaction and comment model does not change.
*   **Extension behaviour:** The extension's popup and options behaviour does not change; only its visual tokens are aligned (§14).
*   **Data model:** No new table, column or index.

## Decisions

The six open questions of the draft were answered by the user on 2026-11-20; no open questions remain. The decisions are reflected in the relevant sections and the document was approved the same day.

1.  **Target of the "Link Paylaş" (share) trigger:** The rail, the bottom tab bar, `n` and paste/drag-and-drop follow the same rule: if the inline form is **fully** in view it is focused, otherwise a `<dialog>` opens (calling `focus()` on a half-visible field would scroll the page). The share E2E scenarios on feed pages move to the inline form; dialog-specific scenarios (`Esc`, the dirty-form confirmation, `returnValue`) move to `/resources/[id]` or `/search`, where the dialog opens; a new scenario checks that the dialog opens when the feed is scrolled down (§8.1, §12).
2.  **CSP:** There is **no** report-only mode and no `POST /csp-report` endpoint. Phase 1 (S3) only adds the fixed security headers; the CSP arrives directly in enforced mode in Phase 8. The precondition is zero `securitypolicyviolation` events on every main route in the m8 Docker smoke test that runs against the production image (§11).
3.  **New colours approved:** Light theme `surface` `#F5F5F5`; `line-strong` `#808080` / `#707070`; `danger` `#B42318` / `#FF7A7A` and `on-danger` `#FFFFFF` / `#0A0A0A` (§1).
4.  **Mobile top bar:** At `< 768px` the top bar holds only the wordmark and the notification bell; "Search" is only in the bottom tab bar (§6).
5.  **Shortcut preference:** Stays per device in `localStorage` `izgah:shortcuts`; never written to the server (§8.2).
6.  **The `/sections` index:** Shows only the section name and description; no extra query for share counts or the last share date (§6).

## Critical User Journeys (CUJs)

### CUJ U1: Sharing by Pasting Text Copied From WhatsApp

*   **Given**: A signed-in member is on the feed in desktop Chrome; the clipboard holds the text `"Şuna bakın https://github.com/sveltejs/kit?utm_source=x"` ("Look at this …") copied from WhatsApp; focus is not in any text field.
*   **When**: The member presses `Ctrl + V`, edits the suggested note in the inline form that opens, picks a section and submits with `Ctrl + Enter`.
*   **Then**: The first `http(s)` address fills the URL field and the rest of the text the note field; the early duplicate check runs; focus moves to the note field and a live region announces `"Bağlantı forma eklendi: github.com"` ("Link added to the form: github.com"). After submitting, the new post appears at the top of the feed, the form resets (re-selecting the section when on a section page) and a `"Paylaşıldı"` ("Shared") notice appears. In Safari or without JavaScript, the same result comes from pasting directly into the inline URL field.

### CUJ U2: Reading the Feed Without a Mouse

*   **Given**: The member is on the feed and single-key shortcuts are on.
*   **When**: They move down three posts with `j`, like one with `l`, open the link in a new tab with `o`, go to the comments with `c`, come back, open the help dialog with `?` and turn the shortcuts off.
*   **Then**: Each `j`/`k` moves focus to the next or previous post `<article>` with a visible focus ring; the like updates optimistically and is announced; Back keeps the scroll position; after the shortcuts are turned off, single keys trigger nothing (WCAG 2.1.4).

### CUJ U3: A Returning Member Sees What Is New

*   **Given**: The member last saw the feed yesterday at 18:40; the team has shared seven links since.
*   **When**: The member opens the feed and leaves the tab open; meanwhile another member shares two new links.
*   **Then**: Seven posts appear with a lime "New" mark (with an invisible "New" text for screen readers) and the last-visit divider sits above the eighth post. Within 60 seconds a `"2 yeni paylaşım"` ("2 new posts") pill appears; clicking it refreshes the feed, moves focus to the first new post and announces the state.

### CUJ U4: Finding a Section on Mobile and Sharing to It

*   **Given**: The member is on a `375px` wide phone.
*   **When**: They tap "Sections" in the bottom tab bar, choose "Interface Design" in the `/sections` index and paste a link into the inline form at the top of the section feed.
*   **Then**: The index works without JavaScript too; on the section page the form opens with "Interface Design" preselected; while a text field has focus, the bottom tab bar hides and does not sit above the virtual keyboard; after submitting, the share appears in the section feed.

### CUJ U5: Choosing a Theme

*   **Given**: The operating system is in light mode; the member prefers dark; JavaScript is off in the browser.
*   **When**: The member chooses "Dark" in the account menu (or in the "Appearance" section of `/settings`), submits the form and then goes to another page.
*   **Then**: The server writes the `izgah_theme=dark` cookie and redirects the member back to where they came from; every later HTML response comes with `<html data-theme="dark">`; there is no light flash on first paint.

## Technical Plan (Architecture)

### 1. Visual Language: Signal Colour Tokens

The grey scale is neutral (no blue tint). Tokens are defined in [`src/lib/styles/tokens.css`](../../src/lib/styles/tokens.css) with the `--color-*` prefix (the same naming as the extension, §14). Contrast ratios were computed with the WCAG 2.x relative luminance formula and are re-checked from the token file by the unit test in the [Verification Plan](#verification-plan).

| Token | Role | Light | Dark | Contrast — light | Contrast — dark | Threshold and result |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `--color-bg` | Page background | `#FFFFFF` | `#0A0A0A` | — | — | — |
| `--color-surface` | Hover/focus tint, inline form, image placeholder, `kbd`, code | `#F5F5F5` *(new)* | `#141414` | `1.09:1` with `bg` | `1.07:1` with `bg` | Decorative; never used alone as a boundary |
| `--color-text` | Primary text (ink) | `#0A0A0A` | `#F2F2F2` | `bg` `19.80` · `surface` `18.16` | `bg` `17.68` · `surface` `16.46` | 4.5:1 ✓ (AAA ✓) |
| `--color-text-muted` | Secondary text, meta | `#5C5C5C` | `#A3A3A3` | `bg` `6.69` · `surface` `6.13` · `line` `5.16` | `bg` `7.85` · `surface` `7.30` · `line` `5.69` | 4.5:1 ✓ |
| `--color-line` | Hairline row divider, attachment box border | `#E2E2E2` | `#2A2A2A` | `bg` `1.30` | `bg` `1.38` · `surface` `1.28` | 3:1 ✗ → **decorative divider only** |
| `--color-line-strong` | Boundary of form fields, checkboxes and unselected controls | `#808080` *(new)* | `#707070` *(new)* | `bg` `3.95` · `surface` `3.62` | `bg` `4.00` · `surface` `3.72` | 3:1 ✓ (WCAG 1.4.11) |
| `--color-signal` | Lime accent | `#C8F542` | `#C8F542` | `bg` `1.27` | `bg` `15.65` · `surface` `14.56` | ✗ as text or mark in light → **fill only**; ✓ as text in dark |
| `--color-on-signal` | Text or icon on a lime fill | `#0A0A0A` | `#0A0A0A` | `signal` `15.65` | `signal` `15.65` | 4.5:1 ✓ |
| `--color-danger` | Destructive action, error text | `#B42318` *(new)* | `#FF7A7A` *(new)* | `bg` `6.57` · `surface` `6.03` | `bg` `7.84` · `surface` `7.30` | 4.5:1 ✓ |
| `--color-on-danger` | Text on a danger fill | `#FFFFFF` | `#0A0A0A` | `danger` `6.57` | `danger` `7.84` | 4.5:1 ✓ |
| `--color-focus-inner` | Inner frame of the focus ring | `#0A0A0A` | `#F2F2F2` | `bg` `19.80` | `bg` `17.68` | 3:1 ✓ (WCAG 1.4.11 / 2.4.7) |
| `--color-focus-outer` | Outer halo of the focus ring | `#C8F542` | `#C8F542` | decorative | decorative | — |
| `--color-backdrop` | `dialog::backdrop` | `rgb(10 10 10 / 0.55)` | `rgb(0 0 0 / 0.7)` | — | — | No blur |

**Value adjustments:** None of the ten given values misses the AA threshold for text, so **no value was changed**. Three restrictions and four additions were made:

*   `line` is below `3:1` in both themes, so it is used only as a decorative divider and can never be the only visual boundary of an interactive component. `line-strong` was added for that role (the fix for finding F9).
*   Lime is `1.27:1` on white in the light theme: in the light theme it is never a text colour, an icon colour or a status mark on its own; it always appears as a fill carrying ink text or icons, or as a mark with an ink frame.
*   In the dark theme, text on a lime fill **cannot** be `--color-text` (`#F2F2F2`, `1.13:1` ✗); both themes use `--color-on-signal`.
*   Added: the light theme `surface`, and `line-strong`, `danger` and `on-danger` for both themes. There is no separate success or warning colour: states are expressed with ink text, an icon and a `surface` background (amber and orange are banned, §4).

#### Permitted Uses of Lime

| Use | Light theme | Dark theme |
| :--- | :--- | :--- |
| Active navigation item (rail, bottom bar) | Lime fill + `on-signal` text | Same |
| Primary button ("Share") | Lime fill + `on-signal` text, `1px` ink border | Lime fill + `on-signal` text |
| Unseen post mark | An `8px` lime square + `1px` ink border + invisible "New" text | An `8px` lime square + invisible "New" text |
| Text selection (`::selection`) | Lime background + `on-signal` text | Same |
| Link hover/focus emphasis | Highlighter: lime background + ink text | Lime text + underline |
| Avatar of your own post | Lime fill + `on-signal` monogram | Same |
| Outer halo of the focus ring | Decorative halo | Decorative halo |

Links are ink-coloured and underlined by default (`text-underline-offset: 0.2em`, `1px`); there is no blue link colour.

### 2. Typography

Fonts are self-hosted from the `@fontsource-variable/schibsted-grotesk@5.3.0` and `@fontsource-variable/jetbrains-mono@5.3.0` packages (both `OFL-1.1`); Google Fonts or any other CDN is not used.

*   **Families:** `--font-sans: 'Schibsted Grotesk Variable', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif` and `--font-mono: 'JetBrains Mono Variable', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`.
*   **Weights in use:** Sans `400 / 500 / 700 / 800`, mono `400 / 500` (from the variable axis; no extra files).
*   **Where mono is used:** Time, domain, content type, provider metadata (stars, language), counters, badges and `kbd`. Mono text always uses `font-variant-numeric: tabular-nums`.
*   **Turkish characters:** `ı İ ş Ş ğ Ğ` are in Fontsource's `latin-ext` subset. The preload therefore covers **both the `latin` and the `latin-ext`** Schibsted `wght-normal` files (this document corrects the "latin only" preload note in the implementation plan). Upper-casing is done only through CSS `text-transform` under `lang="tr"` or with `toLocaleUpperCase('tr-TR')`.
*   **Loading:** The fonts are imported with their package CSS in the root [`src/routes/+layout.svelte`](../../src/routes/+layout.svelte) (`font-display: swap`). The [`vite.config.ts`](../../vite.config.ts) `build.assetsInlineLimit` function never inlines `.woff2` files; otherwise a `data:` font would be blocked by the `font-src 'self'` policy. Preloading uses SvelteKit's `resolve(event, { preload })` option: the two files with `type === 'font'` whose path matches `schibsted-grotesk-latin(-ext)?-wght-normal` are preloaded; mono is not.

| Token | Size / line height | Weight | Family | Tracking (`letter-spacing`) | Use |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--text-display` | `clamp(1.75rem, 1.2rem + 2vw, 2.25rem)` / `1.05` | `800` | Sans | `-0.03em` | Page `h1` ("Feed", section name) |
| `--text-day` | `clamp(1.375rem, 1.1rem + 1vw, 1.75rem)` / `1.1` | `800` | Sans | `-0.02em` | Day heading `h2` ("Today", "Yesterday", "Tuesday", "18 November") |
| `--text-title` | `1.0625rem` / `1.35` | `700` | Sans | `-0.01em` | Link attachment title `h3` |
| `--text-body` | `1rem` / `1.5` | `400` | Sans | `0` | Notes, comments, form text |
| `--text-ui` | `0.875rem` / `1.3` | `500` | Sans | `0` | Buttons, rail items, section labels, author name (`700`) |
| `--text-meta` | `0.8125rem` / `1.3` | `400` | Mono | `0` | Time, domain, type, counters |
| `--text-micro` | `0.75rem` / `1.2` | `500` | Mono | `0.02em` | Badges ("Silent"), `kbd`; the smallest permitted size |

Headings use `text-wrap: balance` and notes `text-wrap: pretty` as progressive enhancements. Italics are not used (no italic file is imported); emphasis uses weight (`700`).

### 3. Shape, Spacing, Motion and the Focus Ring

> **Phase 2 update (2026-11-24):** Corner radii (`4 / 8 / 12px` plus a `9999px` pill for tags and badges), layered shadows in the light theme, a `1px` top-light border in the dark theme, a low-opacity surface sheen, three permitted accent glow points (the primary button, active navigation, the focus ring) and opt-in micro-interactions under `prefers-reduced-motion: no-preference` were updated by the Phase 2 polish pass of 2026-11-24; shadows, gradients and glows stay off in the high-contrast palettes (`contrast`), under `prefers-contrast: more` and under `forced-colors: active`.

*   **Spacing:** A `4px` grid; `--space-1 … --space-8` = `4, 8, 12, 16, 24, 32, 48, 64px`. Side padding is `16px` on mobile and `24px` on desktop.
*   **Corners:** `--radius-1: 2px` (tags, `kbd`, avatars), `--radius-2: 4px` (attachment boxes, form fields, buttons, dialogs, popovers, the new-posts pill). No larger radius and no pill shape.
*   **Rows:** Posts are not card boxes but rows separated by a `1px` `--color-line` hairline. The link attachment is a box with a `1px` `--color-line` border and `4px` corners.
*   **Shadow:** Only on `<dialog>` and popovers: `0 8px 24px rgb(0 0 0 / 0.12)` (in dark `rgb(0 0 0 / 0.5)` plus a `1px` `--color-line` border). No shadows on posts, buttons or attachments.
*   **Widths:** Rail `248px`, icon rail `72px`, reading column at most `680px`.
*   **Motion:** `--dur-1: 120ms`, `--dur-2: 180ms`, `--ease: cubic-bezier(0.2, 0, 0, 1)`. Only opacity, colour and background colour animate; no lift (`translateY`) or scaling on hover. Under `prefers-reduced-motion: reduce` every transition drops to `0ms` and View Transitions are disabled.
*   **Touch targets:** Every interactive element is at least `24 × 24px` (WCAG 2.5.8); under `@media (pointer: coarse)` the bottom tab bar, post actions and form controls are at least `44 × 44px`.
*   **Background scroll lock:** `html:has(dialog:modal) { overflow: hidden; }` and, as a progressive enhancement, `scrollbar-gutter: stable` (F11).
*   **Sticky elements and focus visibility:** `html { scroll-padding-block-start: var(--sticky-top); scroll-padding-block-end: var(--tab-bar-h); }` — a focused element never hides under the sticky top bar, a day heading or the bottom tab bar (WCAG 2.4.11).

#### Focus Ring

Lime alone is `1.27:1` on white and fails WCAG 1.4.11, so the ring has two layers and the inner frame carries the contrast. A `2px` gap in the background colour sits between the ring and the element, so the ring stands apart even on a lime-filled button.

```css
:focus-visible {
	outline: 2px solid transparent; /* stays visible in Windows High Contrast / forced-colors */
	outline-offset: 2px;
	box-shadow:
		0 0 0 2px var(--color-bg),
		0 0 0 4px var(--color-focus-inner),
		0 0 0 7px var(--color-focus-outer);
}
```

*   **Light theme:** A `2px` ink frame (`19.80:1`) plus a `3px` lime halo outside it.
*   **Dark theme (inverted):** A `2px` `#F2F2F2` frame (`17.68:1`) plus a `3px` lime halo outside it (`15.65:1`).
*   Elements inside containers with `overflow: hidden` (such as the stretched link inside a link attachment) draw the ring on the container with `:focus-within`; a focused post `<article>` gets the same ring. A side-bar style focus indicator is not used.

### 4. Banned Clichés

The following are not used in the Izgah interface or the extension; they are grounds for rejection in code review. *(Note: the corner radius, light/dark depth, low-opacity surface sheen, three permitted accent glows and opt-in micro-motion rules were updated by the strict limits of the Phase 2 polish pass; the bans on serifs, cream/beige, orange/amber, purple/indigo, `backdrop-filter`/blur, button/text/fill gradients, a coloured bar on the card's left edge and emoji still apply.)*

| Banned | Why | Instead |
| :--- | :--- | :--- |
| Serif fonts (body or headings) | The "AI default" editorial look | Schibsted Grotesk + JetBrains Mono |
| Cream, beige, off-white backgrounds | The signature of the same default look | `#FFFFFF` / `#0A0A0A` |
| Orange and amber tones (warnings included) | Same reason; breaks the single-accent rule | Warnings use ink + icon + `surface` |
| A coloured bar on the card edge (`border-left` emphasis), including focused, new, silent or failed posts | The most common AI card cliché | A full frame, the focus ring or a `surface` tint |
| Gradients (background, button, text, skeleton shimmer) | A cliché; against a flat colour system | Flat colour; the skeleton is a still `surface` block |
| Blur and glass effects (`backdrop-filter`, glassmorphism) | A cliché; costly on low-power devices | An opaque surface + `--color-backdrop` |
| A purple/indigo accent, the Inter + slate pairing | v1 and the generic SaaS default | Lime as the single accent |
| Emoji icons, "✨" and similar AI symbols | Inconsistent drawing, noise for screen readers | Lucide line icons (`Icon`) |
| Bento grids, large shadowed cards, pill buttons, corners `> 4px` | A cliché; lowers density | Hairline rows, `2/4px` corners |
| Lift or scale animations on hover | Distracting; jitter in a dense list | A change of background tint |

### 5. Component Inventory and Style Architecture

The style layers are defined in the order `@layer reset, tokens, base, components, utilities;` in [`src/lib/styles/tokens.css`](../../src/lib/styles/tokens.css), [`src/lib/styles/base.css`](../../src/lib/styles/base.css) and [`src/lib/styles/components.css`](../../src/lib/styles/components.css). Svelte `<style>` blocks are unlayered, so they always override layered rules; this is deliberate (component-specific layout rules win). The dark theme is applied through `light-dark()` semantic tokens and `color-scheme` on `:root[data-theme]` (§9; for the palette slots see [izgah-themes.md](./izgah-themes.md) §4). Shared client types are imported from `src/lib/types/` instead of `#lib/server/...`.

**Rule:** Visual primitives without behaviour are **CSS classes**; Svelte components are written only for parts that carry state, events or accessibility behaviour.

#### CSS Classes (`components.css`)

| Class | Variants | Note |
| :--- | :--- | :--- |
| `.btn` | `.btn-primary` (lime), `.btn-quiet` (frameless), `.btn-outline` (`line-strong`), `.btn-danger`, `.btn-icon` (square, visually hidden label) | The same look on `<button>` and `<a>`; an `aria-disabled` style |
| `.field` | `input`, `textarea`, `select`; `.field-error` | A `1px` `line-strong` boundary; error text in `danger` + `aria-describedby` |
| `.tag` | Section link | Sans `--text-ui`, not mono; `1px` `line` + `2px` corners |
| `.badge` | `.badge-silent` ("Silent"), `.badge-pending` ("Preparing preview"), `.badge-count` | Mono `--text-micro`; the counter badge is used together with `.notification-badge` |
| `.kbd` | — | `surface` background, `1px` `line-strong` bottom edge |
| `.skeleton` | `.skeleton-line`, `.skeleton-thumb` | A still `surface` block; no animation |
| `.day-heading` | — | A sticky `h2` |
| `.unseen-mark` | — | An `8px` lime square (+ an ink border in the light theme) |
| `.visually-hidden` | — | The existing helper is kept |

#### Svelte Components and Modules

| Name | Kind | File | Responsibility |
| :--- | :--- | :--- | :--- |
| `Icon` | Component | `src/lib/components/ui/Icon.svelte` | Draws ~24 Lucide line icon paths as inline SVG (`aria-hidden="true"`); no package, the ISC licence text at the top of the file |
| `Avatar` | Component | `src/lib/components/ui/Avatar.svelte` | A square monogram (`tr-TR` upper case, at most two letters); lime for your own posts; decorative (`aria-hidden`) |
| `Toaster` | Component | `src/lib/components/ui/Toaster.svelte` | A single `role="status"` notice stack plus a shared live-region announcer |
| `Dialog`, `PopoverPanel` | Component (existing) | `src/lib/components/ui/` | The API is kept; only the styles move to tokens; the F12 fix |
| `SiteHeader` | Component | `src/lib/components/shell/SiteHeader.svelte` | A single `<header class="site-header">`: rail / icon rail / mobile top bar (§6) |
| `BottomTabBar` | Component | `src/lib/components/shell/BottomTabBar.svelte` | Stateless bottom navigation at `< 768px` |
| `NotificationBell` | Component (existing) | `src/lib/components/notifications/` | A single instance; moved onto `visibility-poller` (F16) |
| `KeyboardHelpDialog` | Component | `src/lib/components/shell/KeyboardHelpDialog.svelte` | The `?` dialog: the shortcuts valid on the page and the off switch |
| `FeedView` | Component | `src/lib/components/feed/FeedView.svelte` | The shared feed view of `/` and `/sections/[slug]`; creates the `feed-state` instance |
| `PostCard` | Component | `src/lib/components/feed/PostCard.svelte` | Replaces `ShareCard.svelte`; the root `article.share-card` is kept |
| `LinkAttachment`, `PostActions`, `PostMenu` | Component | `src/lib/components/feed/` | The attachment box, the action row, the `⋯` overflow menu ("Paylaşım işlemleri", share actions) |
| `ShareNoJsFallbacks` | Component | `src/lib/components/feed/` | The inline no-JS panels for `?edit=` and `?delete=` (`.inline-card-panel`) |
| `ShareForm` | Component | `src/lib/components/share/ShareForm.svelte` | The shared form core (duplicate check, sections, type, silent option) |
| `InlineComposer`, `ShareComposerDialog` | Component | `src/lib/components/share/` | Wrap `ShareForm` inline and as a `<dialog>` |
| `NewPostsPill` | Component | `src/lib/components/feed/NewPostsPill.svelte` | §8.5 |
| `FeedFilterBar` | Component (existing) | `src/lib/components/feed/` | Behaviour kept; a segmented look |
| `feed-state` | Module (`.svelte.ts`) | `src/lib/feed/feed-state.svelte.ts` | Feed state shared through context (§8.6) |
| `ComposerController` | Context | `src/lib/share/composer-controller.svelte.ts` | Chooses the target of the share triggers (§8.1) |
| `visibility-poller` | Module | `src/lib/client/visibility-poller.ts` | A shared poller that respects tab visibility |
| `date`, `merge`, `group-by-day`, `paste`, `keyboard-filter` | Pure modules | `src/lib/format/date.ts`, `src/lib/feed/*.ts`, `src/lib/share/paste.ts`, `src/lib/client/keyboard-filter.ts` | Pure logic, unit-tested with Vitest |

### 6. Information Architecture and App Shell

The shell is responsive through CSS media queries alone; the `ResizeObserver` measurement logic and the switch from `popover` to inline on first paint are removed entirely (F10). Layouts inside components (the link attachment, the form) use container queries (`@container`).

| Width | Shell | Content |
| :--- | :--- | :--- |
| `≥ 1024px` | Full rail (`248px`) | A single reading column (`≤ 680px`) |
| `768–1023px` | Icon rail (`72px`; labels visually hidden, accessible names kept) | A single reading column |
| `< 768px` | A sticky top bar + a fixed bottom tab bar | Full width, `16px` side padding |

```text
≥ 1024px                                      < 768px
┌────────────────────┬───────────────────┐    ┌────────────────────────────────┐
│ Izgah              │ Feed              │    │ Izgah                 Notif. 3 │
│ [Search Izgah]     │ All Video Repo …  │    ├────────────────────────────────┤
│ [☐ This section Go]│ ┌───────────────┐ │    │ Feed                           │
│ ▓▓ Feed ▓▓▓▓▓▓▓▓▓▓▓│ │Paste a link…  │ │    │ ┌────────────────────────────┐ │
│ Notifications    3 │ │        Share  │ │    │ │ Paste a link…              │ │
│                    │ └───────────────┘ │    │ └────────────────────────────┘ │
│ SECTIONS           │ Today ─────────── │    │ Today ───────────────────────  │
│ AI                 │ EK Elif · 14:32 ⋯ │    │ EK Elif Kaya · 14:32       ⋯   │
│ Interface Design   │ Note text…        │    │ Note text…                     │
│ All sections       │ ┌ attach. ─┬────┐ │    │ ┌ image ─────────────────────┐ │
│                    │ │ title    │img │ │    │ │ title                      │ │
│ [ Share ]          │ └──────────┴────┘ │    │ └────────────────────────────┘ │
│ Admin              │ ♡ 3  ◯ 2  ⧉  ↗    │    │ ♡ 3  ◯ 2  ⧉  ↗                 │
│                    │ ───────────────── │    ├────────────────────────────────┤
│ EK Elif Kaya     ⋯ │                   │    │ Feed Sections Share Search Prof│
└────────────────────┴───────────────────┘    └────────────────────────────────┘
(▓ = lime fill + ink text)
```

#### Rail (`≥ 768px`)

From top to bottom: the wordmark ("Izgah", weight `800`, a link to `/`); the site search form (only at `≥ 1024px`; `<search aria-label="Site içi arama">` (site search), a "İzgah içinde ara" (search Izgah) field with a visually hidden label, a "Bu Bölüm" (this section) checkbox on section pages and a "Search" button; on the `/search` page the rail form is not drawn and the page's own form is used; at `768–1023px` a "Search" icon link goes to `/search`); the "Feed" and "Sections" list inside `<nav aria-label="Ana gezinme">` (main navigation) (`sort_order`; the last item is "All sections" → `/sections`; in the icon rail the list collapses to a single "Sections" icon); `NotificationBell`; the primary "Share" button; a direct "Admin" link for admins (not hidden in a menu, the m7 test); at the bottom the account menu (`PopoverPanel`: Settings, API keys, Theme, Sign out). The active item carries `aria-current="page"` and a lime fill.

#### Mobile Top Bar and Bottom Tab Bar (`< 768px`)

*   The same `<header class="site-header">` turns into a sticky top bar and shows only the wordmark and the `NotificationBell` (the same DOM node; the fixed `#notification-bell-popover` id and the single poller are kept). "Search" is not in the top bar, only in the bottom tab bar. The rail's navigation list, search form, "Share" and account menu are `display: none` at this width.
*   The bottom tab bar is a separate `<nav aria-label="Ana gezinme">` visible only at `< 768px`; since the rail's `nav` leaves the accessibility tree at this width, there is exactly one "main navigation" at every width. Items: Feed (`/`), Sections (`/sections`), Share, Search (`/search`), Profile (`/settings`). Each item is an icon plus a short visible label.
*   The "Share" item is `<form method="get" action="/"><input type="hidden" name="compose" value="1"><button aria-label="Link Paylaş">`: without JavaScript it opens `/?compose=1` (which focuses the inline form), with JavaScript it calls `ComposerController.open()`.
*   On mobile, `/settings` takes over the account menu's job: Appearance (theme, shortcuts), a link to API keys, "Admin" for admins, and "Sign out".
*   `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`; the bar carries `padding-bottom: env(safe-area-inset-bottom)`; the content's bottom padding equals `--tab-bar-h`.
*   So that it never sits on top of the virtual keyboard while a text field has focus: `body:has(:is(input, textarea, select, [contenteditable="true"]):focus) .tab-bar { display: none; }`.

#### The New `/sections` Index

[`src/routes/(app)/sections/+page.svelte`](../../src/routes/(app)/sections/+page.svelte) and `+page.server.ts`: an `h1` "Sections" listing the sections in `sort_order ASC, name ASC` order with their name (a link) and description; for admins "Manage sections" → `/admin/sections`. No share count or last share date is shown; there is no extra query, the section list from the layout loader is reused. The page works without JavaScript. In the bottom tab bar "Sections" appears active for `/sections` and `/sections/*`.

### 7. Post Anatomy (People First)

Source order is visual order; CSS `order` is not used (the core §8.1 rule is kept).

```text
<article class="share-card" id="share-{id}" tabindex="-1" aria-labelledby="share-{id}-author share-{id}-title">
├─ header.post-head
│   Avatar(aria-hidden) · strong#share-{id}-author "Elif Kaya"
│   · a[href="/resources/{rid}#share-{id}"] > time[datetime] "14:32"  (mono; a visually hidden prefix "Shared at: 18 November")
│   · section tags (.tag links) · [Silent] · [Preparing preview]
│   · .unseen-mark + visually hidden "New" (if unseen)
│   · PostMenu ⋯ (aria-label "Paylaşım işlemleri", share actions)
├─ div.post-note       the note; a 6-line limit + "Show more" (only if it overflows, aria-expanded)
├─ div.link-attachment (container-type: inline-size)
│   h3#share-{id}-title > a[href=raw_url][target=_blank][rel="noopener noreferrer"]  ← stretched link (::after inset 0)
│   p.meta (mono): domain · type · provider metadata (★ stars, language, author)
│   p.desc: description, 2-line limit
│   img.card-thumbnail (1200/630, loading/fetchpriority by position class)
├─ p.first-share       "First shared by: Ayşe · 3 days ago" → /resources/{rid}#share-{first} | "The original post was deleted"
└─ footer.post-actions  Like (aria-pressed, mono counter) · Comments (counter) → /resources/{rid}#comments
                        · Copy link · Open ↗ (new tab)
```

*   **Link attachment:** The whole box is a single external link, but the link's accessible name is only the title (the stretched link pattern: `h3 > a::after { position: absolute; inset: 0 }`); the description and meta are read as separate paragraphs by screen readers. Without a title, the domain is used as the title. When the container is `≥ 440px` the image sits on the right at `176px` wide; when narrower, it sits full width above the attachment; the ratio is always `1200 / 630`. An attachment without an image reserves no image column (`:has()` with an `@supports not selector(:has(*))` fallback; the core rule moves to the attachment box).
*   **Note:** A post without a note goes straight from the header to the attachment. The note is clamped with `-webkit-line-clamp: 6`; the "Show more" button appears only if it overflows (a JavaScript measurement); without JavaScript the full note shows.
*   **Avatar:** For other members a `surface` background + `1px` `line` + an ink monogram; for your own posts a lime fill + an `on-signal` monogram. No per-user colours are generated (the single-accent rule).
*   **Focus and hover:** `:hover` and `:focus-within` give the post a `surface` tint; an `<article>` focused with `j`/`k` gets the §3 focus ring.
*   **Content visibility:** Every post after the first 5 gets `content-visibility: auto; contain-intrinsic-size: auto none auto 240px` through the `.is-deferred` class. Because day groups reset the `nth-child` counter in each group, the class is assigned from the overall order in `feed-state`; the first post with an image gets `fetchpriority="high"`, the rest `loading="lazy"`.
*   **Heading hierarchy:** Page `h1` → day `h2` → attachment title `h3`.

### 8. Interactions

#### 8.1 Inline Sharing, Paste-to-Share and Drag-and-Drop

*   **Inline form:** `InlineComposer` (`<form method="post" action="?/createShare">`) inside `FeedView` at the top of `/` and `/sections/[slug]`. Collapsed, it is one row: avatar, URL field (placeholder `"Paste a link…"`) and a "Share" submit button. When the form matches `:focus-within` or `:has(input[name="url"]:not(:placeholder-shown))`, it expands through CSS (also without JavaScript): the early duplicate check panel (`.conflict-box`), the note field (progressive `field-sizing: content`, at most 8 lines), section checkboxes, the content type choice and, for admins only, the silent option. On a section page that section is preselected and re-applied after a successful submit. `/?compose=1` focuses the inline URL field; the old no-JS composer fallback in the layout is deleted (otherwise there would be two forms).
*   **Silent option label (normative):** `"Ana akışta yayınlama (yalnızca seçili bölümlere sessiz ekle)"` ("Don't post to the feed (add silently to the selected sections only)") — the core CUJ 4 text; the deviation in the web code (F17) is aligned with this text in B4.
*   **Submitting:** `Ctrl/⌘ + Enter` in the note field submits the form (it has a modifier, so it is outside WCAG 2.1.4). `ShareForm` uses a custom `SubmitFunction` that does not call `applyAction` on success or failure (otherwise `page.form` would leak into the dialog in the layout); on success the returned post is added to `feed-state`, the form resets, focus stays in the URL field and `Toaster` announces `"Shared"` with a "Show" link (`#share-{id}`).
*   **Other pages:** On `/resources/[id]`, `/search`, `/settings` and `/admin/*` the same `ShareForm` core opens inside the existing `#share-composer-dialog`.
*   **`ComposerController` target rule (Decision 1):** The rail "Share", the bottom tab bar "Share", `n`, paste and drag-and-drop follow the same rule. At trigger time, if an inline form is registered and its bounding box (`getBoundingClientRect()`) lies **fully** inside the visible area, the target is the inline form; otherwise (no form, partly visible or hidden) the `<dialog>` opens. The visible area is the `visualViewport` height (or `innerHeight`) minus the sticky top bar (`--sticky-top`) and the bottom tab bar (`--tab-bar-h`). The threshold is "fully visible" because calling `focus()` on a half-visible field would scroll the page; the inline form is also focused with `focus({ preventScroll: true })`. The state is read from a synchronous measurement at trigger time, not from an asynchronous `IntersectionObserver` entry (which avoids a stale state one frame behind).
*   **Paste-to-share (progressive enhancement):** A `paste` listener on `document`, when the target is not an editable element (`input`, `textarea`, `select`, `isContentEditable`), extracts the first `http(s)` address from `clipboardData.getData('text/plain')` with `extractFirstUrlFromText` from [`src/lib/links/parse-url.ts`](../../src/lib/links/parse-url.ts). If it finds one, it calls `preventDefault()`, fills the form (the rest of the text becomes the suggested note), runs the duplicate check, moves focus to the note field and a live region announces `"Link added to the form: <domain>"`; without an address it does nothing. It does not run while a dialog or popover is open. Safari only fires `paste` in an editable context, so this behaviour is specific to Chrome and Firefox; the inline URL field works in every browser.
*   **Drag-and-drop:** Only for drags whose `dataTransfer.types` include `text/uri-list` and not `Files`, a drop zone with a `2px` dashed ink frame appears in the content column (no blur); on drop, the first non-comment (`#`) line of `text/uri-list` goes through the same flow. File drags are left alone.

#### 8.2 Keyboard Shortcuts

Shortcuts run through a single `<svelte:window onkeydown>` listener in the layout plus a per-page context registry. Keys are matched by `event.key`, not by the physical key code (`event.code`), so letters work regardless of layout on the Turkish Q and Turkish F keyboards.

| Key | Action | Context | Note |
| :--- | :--- | :--- | :--- |
| `j` / `k` | Focus the next / previous post | Feed, section, search results | Posts have `tabindex="-1"`; the Tab order does not change; on the last post `j` focuses the "Load more" button and does not load automatically |
| `o` / `Enter` | Open the link in a new tab | While focus is on the post `<article>` itself | `window.open(url, '_blank', 'noopener,noreferrer')`; if focus is on a button inside, `Enter` keeps its native behaviour |
| `l` | Like / unlike | The focused post | `event.repeat` is ignored; the result is announced |
| `c` | Go to comments | The focused post | `/resources/{id}#comments` |
| `/` | Go to search | Every app page | Focuses the rail form if visible, otherwise goes to `/search` and focuses the field; `preventDefault()`. `Shift + 7` on Turkish Q |
| `n` | Share | Every app page | `ComposerController.open()`; `preventDefault()` |
| `?` | Shortcut help | Every app page | `#keyboard-help-dialog`; lists only the shortcuts valid on that page. `Shift + *` on Turkish Q |
| `Ctrl/⌘ + Enter` | Submit the form | The share note field | Has a modifier; not affected by the off switch |

*   **When they do not run:** If the target is an editable element (`input`, `textarea`, `select`, `contenteditable`, `[role="textbox"]`); if `event.isComposing` or `keyCode === 229` (IME composition); if `event.defaultPrevented`; if `Ctrl`, `Meta` or `Alt` is held (including Windows AltGr = `Ctrl + Alt`); if a `dialog:modal` or `:popover-open` element exists; if the shortcuts are off.
*   **Shift:** `Shift` is not blocked (on Turkish Q, `/` and `?` need Shift). Letter shortcuts pressed with `Shift` are ignored; an upper-case letter that arrives while Caps Lock is on (without `Shift`) is lowered.
*   **Off switch (WCAG 2.1.4):** The "Single-key shortcuts" switch is both in the `?` dialog and in the "Appearance" section of `/settings`; the preference is kept per device in `localStorage` `izgah:shortcuts` (`on` | `off`, default `on`) and never written to the server (Decision 5). When off, the `kbd` hints in the rail hide too (`html[data-shortcuts="off"]`); before hydration the hints are hidden by default.
*   **Screen readers:** Screen readers in browse mode do not pass keys to the page; if there is a conflict in focus mode, the off switch is the solution.

#### 8.3 Day Groups

*   Grouping uses the merged list in `feed-state` (continuous after "Load more" too). `dayKey` is produced as `YYYY-MM-DD` with `Intl.DateTimeFormat` `formatToParts` using `timeZone: 'Europe/Istanbul'` and `hourCycle: 'h23'`; `todayKey` is computed on the server in `load` and passed to the page, so SSR and hydration give the same result (even when the client's time zone differs).
*   Labels come from fixed Turkish arrays (independent of ICU differences): difference `0` → "Bugün" (today), `1` → "Dün" (yesterday), `2–6` → the weekday name ("Salı"), older → "18 Kasım", a different year → "18 Kasım 2025". A post's time is only hours and minutes (`14:32`); the full date is in `time[datetime]` and the visually hidden prefix. *(Since [izgah-i18n-oss.md](./izgah-i18n-oss.md), the labels come from the message catalogs and the time zone from `APP_TIME_ZONE`.)*
*   Each group is a `<section aria-labelledby>` + a sticky `h2.day-heading` + an `<ol class="feed-list">`. The sticky heading sits under the top bar on mobile (`top: var(--header-h)`) and at `top: 0` on desktop.

#### 8.4 Last-Visit Divider

*   **Storage:** The `localStorage` key `izgah:lastSeen:<scope>` (`feed` or `section:<id>`); the value is the server `createdAt` ISO string of the newest post seen. The value is read only inside `$effect` (it does not exist during SSR); if `localStorage` is unavailable (private mode, quota) the feature silently turns off.
*   **Display:** It runs only on the first page without a cursor, and only if the list has at least one unseen and one seen post. Posts with `createdAt > lastSeen` that are **not your own** get `.unseen-mark` + a visually hidden "New". The first seen post gets the `.is-first-seen` class: its top hairline becomes a `2px` ink line with an absolutely positioned mono label "YOUR LAST VISIT · 18:40" drawn on it (with a visually hidden "Posts from before your last visit start here" for screen readers). The divider adds no row, so there is no layout shift after hydration.
*   **Update:** On `visibilitychange` (`hidden`) and `pagehide`, the value moves forward to the `createdAt` of the newest post in the list (never backward). On the first visit no divider is shown; only the value is written. No read state is written to the server.

#### 8.5 New-Posts Pill

*   **Conditions:** Only inside `FeedView`, on the first page without a cursor (no `?cursor=`), while `document.visibilityState === 'visible'`, `visibility-poller` calls `GET /api/internal/feed/updates` every 60 seconds (immediately on becoming visible, if at least 15 seconds have passed since the last request) (§10). `afterId` is the id of the newest post in the list; `section` and `type` are the current view's filters.
*   **Display:** If `newCount > 0`, a sticky, ink-filled `<button class="new-posts-pill">` with `4px` corners appears above the content column: a lime square + `"3 new posts"` (`"99+ new posts"` when `newCount ≥ 100`). When the pill becomes visible (`0 → n`), the shared live region announces it once; later increases update the text silently.
*   **Click:** `invalidate('app:feed')` → the `merge` rules (if more than 25 new items arrive, the list resets) → scroll to the top of the page → focus on the first new post's `<article>` → the announcement `"3 new posts loaded"` → the pill hides.
*   **Stopping and back-off:** On a `401` or `403` response, polling stops until the page changes; `404` (section or `afterId` not found) stops polling; network errors and the `5xx` range double the interval up to at most 5 minutes. Your own shares are not counted.

#### 8.6 Feed State, Likes and Preview Refresh

*   `feed-state` is created in each `FeedView` instance and shared through context; there is no module-level instance (which prevents leaks between users during SSR). It uses `$state.raw` with immutable patches; it is seeded synchronously in the constructor; later `data` changes are reset or merged with `merge` by query key (`pathname + type`) in a single `$effect.pre`; `export const snapshot` for Back navigation.
*   The `merge` rules: an old item missing from the refreshed first page is dropped only if it falls inside that page's time window (it counts as deleted); older items stay; the `nextCursor` of the last appended page is kept. So likes, edits and the 3-second preview refresh never delete the "Load more" pages (F1).
*   Likes are optimistic and idempotent (`liked=true|false` is sent, the returned `liked/likeCount` is applied, errors are reported through `Toaster`, no `invalidate`). The per-resource like layer lives in a small context at the layout level; search and the resource page use the same layer.
*   After a delete, focus moves to the next post (or the page `h1` if there is none); after loading the last page, to the first new post (F13). On navigation the `h1` is focused with `preventScroll: true`; if the URL has a hash, the target is focused; heading focus is skipped on `popstate` navigations (F2).

### 9. Theme Cookie (`izgah_theme`)

*   **Values:** `light` | `dark` | `system`; `system` when the cookie is missing or invalid.
*   **Cookie:** `izgah_theme=<value>; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly; Secure` (the `Secure` flag follows the same condition as `useSecureCookies` in [`better-auth.ts`](../../src/lib/server/auth/better-auth.ts)). The client never needs to read the cookie.
*   **Server:** [`src/hooks.server.ts`](../../src/hooks.server.ts) wraps `resolve` once at the very start of the existing `handle` (no `sequence()`; integration tests call `handle` directly). The wrapper uses `transformPageChunk` to replace the first match of the `<html lang="tr" data-theme="%izgah.theme%">` placeholder in [`src/app.html`](../../src/app.html) and adds the §2 font preload in the same place.
*   **CSS:** Semantic tokens are defined with `light-dark(var(--light-*), var(--dark-*))`; the mode only switches `color-scheme`: `system` → `light dark`, `light` → `light`, `dark` → `dark`.
*   **Extra themes:** The light/dark palette and the accent colour are applied the same way, through the `data-light-theme`, `data-dark-theme` and `data-accent` attributes and the `izgah_theme_light`, `izgah_theme_dark` and `izgah_accent` cookies; details in [izgah-themes.md](./izgah-themes.md) §3–§4.
*   **Action:** `/settings?/setTheme` (`theme`, `returnTo`). The value is validated; `returnTo` is cleaned with the shared `sanitizeInternalPath` (Phase 1, S1) and redirected with `303`. On a JavaScript switch `use:enhance` does not reload the page and `document.documentElement.dataset.theme` is updated on the client. The picker is a three-option radio group ("System", "Light", "Dark") in the account menu and in the "Appearance" section of `/settings`.
*   **Why a cookie:** The `localStorage` + inline script approach neither works without JavaScript nor avoids a CSP exception for inline scripts (see Alternative D).

### 10. The `GET /api/internal/feed/updates` Contract

| Field | Value |
| :--- | :--- |
| File | [`src/routes/api/internal/feed/updates/+server.ts`](../../src/routes/api/internal/feed/updates/+server.ts) + the shared [`src/lib/server/feed/query.ts`](../../src/lib/server/feed/query.ts) (`feedScopeConditions({ sectionId, type })`, shared with `_loadFeedPage`) |
| Authentication | Cookie session; the existing internal endpoint guard (`Origin` or `Sec-Fetch-Site: same-origin`); `401` without a session, `403` on an origin mismatch |
| Query parameters | `afterId` (optional share id), `section` (optional section id), `type` (optional `video` \| `repo` \| `social` \| `article` \| `web`) |
| Success response | `200 OK` — `{ "newCount": number }` (`0–100`); `Cache-Control: no-store` |
| Errors | `400 VALIDATION_ERROR` (invalid `type` or malformed id), `401`, `403`, `404 NOT_FOUND` (no such section or `afterId` share); the body is the internal API JSON error envelope (including `requestId`) |

*   **Meaning:** The server reads the `(created_at, id)` of the `afterId` share (the row exists even when soft-deleted) and counts shares with `(created_at, id) > (anchor.created_at, anchor.id)`, `deleted_at IS NULL`, `author_id <> me` and the scope conditions. The feed scope is `is_feed_visible = true`; the section scope is every active share attached to that section (silent ones included, as on the section page); `type` is the resource's `content_type`. Without `afterId` (an empty feed) every share in the scope is counted.
*   **Why `afterId`:** No ISO timestamp is used; `created_at` has microsecond precision, `toISOString()` truncates to milliseconds and rows on the boundary could be missed (the same root cause as D6).
*   **Cost:** The count is `SELECT count(*) FROM (… LIMIT 100) s`; the existing `(is_feed_visible, created_at DESC, id DESC)` partial index and the `(section_id, share_id)` index are enough, no new index is added (checked once with `EXPLAIN` in A2). 15 members × visible tabs × one request per minute is a negligible load; no extra rate limit is defined.

### 11. Security Headers and the Content Security Policy (CSP)

*   **Phase 1 (S3) — fixed headers only:** The hook adds `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` and `Referrer-Policy: strict-origin-when-cross-origin` to every HTML response (the `no-referrer` on `?token=` pages is kept). In Phase 1 `kit.csp` is **not configured**; report-only mode (`reportOnly`) is not used (Decision 2).
*   **Why no report-only mode:** SvelteKit `2.70.4` rejects a report-only policy without `report-uri` or `report-to` (`csp.js:341-348`), which would need an open, unauthenticated report endpoint. Instead, verification is left to the smoke test that runs against the production image, and no `POST /csp-report` endpoint is added.
*   **Phase 8 — straight to enforced mode:** `svelte.config.js` `kit.csp` with `mode: 'auto'` (a nonce on SSR pages, a hash on prerendered pages) and the following `directives`:

```text
default-src 'self';
script-src 'self';                 # Kit adds a nonce to the hydration script; no 'strict-dynamic'
style-src 'self' 'unsafe-inline';  # Svelte style:/transition inline styles and app.html display:contents
img-src 'self' data:;
font-src 'self';
connect-src 'self';
object-src 'none';
base-uri 'none';
form-action 'self';
frame-ancestors 'none';
```

*   `upgrade-insecure-requests`, `report-uri` and `report-to` are not added (TLS terminates at the reverse proxy; there is no report receiver). `X-Frame-Options: DENY` stays for old clients that do not support `frame-ancestors`.

#### The CSP Smoke Test: Where and When It Runs

The normal E2E suite (`pnpm test:e2e`) runs against `vite dev`; the development server injects scripts and styles differently from production, so it does not reliably reveal CSP violations. The CI workflow only runs `lint`, `check` and `test`, not E2E. CSP verification therefore works like this:

*   **Where:** A CSP scenario added to the existing production image test [`tests/e2e/m8-docker-smoke.spec.ts`](../../tests/e2e/m8-docker-smoke.spec.ts). `pnpm test:docker` first builds the production image with `docker build`, then runs the scenario against the container with `PLAYWRIGHT_DOCKER_SMOKE=1`.
*   **What it checks:** With `context.addInitScript` it collects `securitypolicyviolation` events into an array on `window`; it visits the main routes without a session (`/login`, `/auth/accept-invite` and `/auth/reset-password` with an invalid token, the error page) and with an admin session (`/`, `/sections`, one `/sections/[slug]`, one `/resources/[id]`, `/search?q=…`, `/settings`, `/settings/api-keys`, every `/admin/*` page), triggering the share dialog, a popover, a theme change and the card → resource detail View Transition on the way. It checks that every response has a `Content-Security-Policy` header and that the number of collected violations is **zero**.
*   **When:** (1) In Phase 8, the commit that turns on `kit.csp.directives` is not pushed to `main` until this scenario in the same commit passes locally with `pnpm test:docker` (the deployment publishes `main` directly). (2) Afterwards, before pushing to `main` whenever `svelte.config.js`, `src/app.html`, `src/hooks.server.ts`, global styles or fonts change, or a new inline script or style or an external resource is added. (3) In the `pnpm test:docker` step before every release, as the existing rule says.
*   **Out of scope:** Adding the Docker smoke test to CI as a separate job is not part of this document; if it is added later, items (2) and (3) become automatic.

### 12. Fixed E2E Hooks and Accessible Names

E2E selector updates are made **in the same commit** as the markup change, never left for later.

**CSS/DOM hooks that will not change:**

| Hook | Element |
| :--- | :--- |
| `article.share-card` (+ `id="share-{id}"`) | The `PostCard` root |
| `#share-composer-dialog` | `ShareComposerDialog` |
| `#main-content h1` | Every page's `h1` (`tabindex="-1"`) |
| `#notification-bell-popover` | The single `NotificationBell` panel |
| `.notification-badge` | The unread notification counter |

**Accessible names that will not change** (the Turkish locale, which the E2E tests use; see the i18n note below):

| Role | Name | Note |
| :--- | :--- | :--- |
| `button` | "Link Paylaş" (share a link) | When the visible text is "Paylaş", `aria-label="Link Paylaş"` (WCAG 2.5.3: the visible label is part of the name) |
| `navigation` | "Ana gezinme" (main navigation) | Exactly one in the accessibility tree at every width (§6) |
| `button` | "Paylaşım işlemleri" (share actions) | The `PostMenu` trigger |
| `button` | "Daha fazla yükle" (load more) | Feed pagination |
| `navigation` | "İçerik türü süzgeci" (content type filter) | `FeedFilterBar` |
| `search` | "Site içi arama" (site search) | The rail search form (`≥ 1024px`) |
| `textbox` (label) | "İzgah içinde ara" (search Izgah) | The rail search field |
| `button` | "Bildirimler" (notifications; a name with a counter matches the pattern) | The `NotificationBell` trigger |
| `link` | "Yönetim" (admin) | Directly visible in the rail for admins |
| `heading` | "Ana Akış" (feed) | The `h1` of `/` |

Because "Paylaş" (the inline submit button) and "Link Paylaş" are on the same page, the tests use `exact: true`.

> **i18n note (2026-11-25):** Since [izgah-i18n-oss.md](./izgah-i18n-oss.md) the interface is English-first. The names above are the contract of the Turkish locale (`DEFAULT_LOCALE=tr`), which the E2E tests run with; their English equivalents are in `src/lib/i18n/messages/en.ts`.

**Hooks that change on purpose and are updated in the related commit:** `article.share-card > img.card-thumbnail` → `article.share-card .link-attachment img.card-thumbnail` (the class name is kept, the image moves inside the attachment; m5, m8); the `.site-header.is-wide` class check is removed (no measurement logic; m6); the m5 "Link Paylaş" → `#share-composer-dialog` flows are reorganised as below, following Decision 1. `.inline-card-panel`, `.conflict-box`, `.comment-list`, `#delete-comment-dialog`, `.search-summary` and `#new-api-key-value` are kept.

**Moving the share scenarios (Decision 1):**

*   The share scenarios on `/` and `/sections/[slug]` (CUJ 2 web sharing, the early duplicate warning, the preview update, CUJ 4 admin silent adds and member promotion) use the inline form: "Link Paylaş" is clicked while at the top of the page, or the inline URL field is filled directly; form fields are selected within the inline form (`main form[action="?/createShare"]` or by accessible name).
*   Dialog-specific scenarios — closing with `Esc`, the close warning on a dirty form with focus staying on the "Keep editing" button, resetting `returnValue` — move to `/resources/[id]` (preferably) or `/search`, where the dialog still opens, and keep using the `#share-composer-dialog` hook.
*   **New scenario:** After scrolling the feed far enough that the inline form leaves the visible area completely, clicking "Link Paylaş" and pressing `n` open `#share-composer-dialog` without changing the scroll position; the dialog also opens while the form is only partly visible.

### 13. Other Screens (Phase 6 Principles)

*   **`/resources/[id]`:** Two columns at `≥ 1024px`: a large preview and the comment thread on the left, the share history timeline and sections on the right; on mobile the comment form sticks to the bottom edge. The file is split into components.
*   **`/search`:** Scope and type filters in a segmented control look (the `name` attributes are kept after hydration, F15); matching terms are highlighted in `<mark>` (lime background + ink) with safe text splitting (no `{@html}`); pagination beyond the 25-result limit; a guiding empty state.
*   **`/settings`:** "Appearance" (mode, light/dark theme and accent colour — [izgah-themes.md](./izgah-themes.md) §5 — and single-key shortcuts), password; on mobile the account menu's functions (§6). `/settings/api-keys` is restyled.
*   **`/admin/*`:** Shared table and status chip styles, an admin sub-navigation, no-JS confirmation fallbacks for deactivation and for editing and deleting sections (F8); no other behaviour changes.
*   **`/login`, `/auth/accept-invite`, `/auth/reset-password`:** A split layout: an ink-filled brand panel (lime wordmark) + the form; on mobile the panel becomes a top strip. `main#main-content`, and `(app)/+error.svelte` plus the root error page with a `<title>` and a link home (F14).

### 14. Extension Token Alignment (Phase 7)

[`extensions/src/styles/tokens.css`](../../extensions/src/styles/tokens.css) moves to the Signal values once the B1 tokens are frozen; the popup/options behaviour and the single-layer `prefers-color-scheme` theme decision in [izgah-extensions.md](./izgah-extensions.md) do not change (the extension runs on a different origin and cannot read the `izgah_theme` cookie; it follows the system theme).

| Extension token | Current (light) | Signal equivalent |
| :--- | :--- | :--- |
| `--color-bg` / `--color-surface` | `#f8fafc` / `#ffffff` | `--color-bg` `#FFFFFF` / `--color-surface` `#F5F5F5` |
| `--color-text` / `--color-text-muted` | `#0f172a` / `#475569` | `#0A0A0A` / `#5C5C5C` |
| `--color-link`, `--color-accent` | `#1d4ed8` | Links in ink + underline; accent `--color-signal` |
| `--color-focus` | `#1d4ed8` | `--color-focus-inner` + `--color-focus-outer` (the §3 ring) |
| `--color-primary` / `--color-primary-contrast` | `#0f172a` / `#ffffff` | `--color-signal` / `--color-on-signal` |
| `--color-border` / `--color-border-strong` | `#cbd5e1` / `#64748b` | `--color-line` / `--color-line-strong` |
| `--color-danger*` | `#b91c1c`, `#991b1b` | `--color-danger`, `--color-on-danger` |
| `--color-*-warn`, `--color-*-success` | Amber / green tones | Removed: `surface` + `line-strong` + ink text + icon |
| `--radius-sm/md/lg` | `0.375 / 0.5 / 0.75rem` | `2px / 4px / 4px` |
| `--font-sans` / `--font-mono` | `system-ui` / `ui-monospace` | Schibsted Grotesk (only the `latin` + `latin-ext` `wght-normal` files are packaged) / the system mono stack |

`OFL.txt` is added to the extension package; `@fontsource-variable/schibsted-grotesk@5.3.0` becomes a development dependency in `extensions/package.json`, and the lockfile is kept current for the Firefox source archive. Verification: `pnpm verify:manifests` plus the extension's `lint`, `check`, `test` and `test:e2e`.

### 15. Relation to `izgah-core.md`: Changed and Preserved Rules

Since this document was approved (2026-11-20), the **changed** rows below replace their counterparts in `izgah-core.md`; the **preserved** rows stay valid in the core document and the UI v2 implementation must follow them.

| # | Core rule (where) | Status | UI v2 decision |
| :--- | :--- | :--- | :--- |
| 1 | Top navigation bar + a `popover="auto"` mobile drawer controlled by `ResizeObserver` below `960px` (§8.3, M5 #27) | **Changes** | Rail / icon rail / top bar + bottom tab bar; CSS breakpoints only (`768`, `1024`); the measurement code is deleted (§6) |
| 2 | Colour and typography variables unspecified; the app has a light theme only (M5 #25) | **Changes** | Signal light/dark tokens, Schibsted + JetBrains Mono, the `izgah_theme` cookie (§1, §2, §9) |
| 3 | A `.share-card:has(> .card-thumbnail)` grid that opens a side image column on cards with images; a link-centred card (§8.1, M5 #25–#26) | **Changes** | A people-first post; the image inside `.link-attachment`; the `:has()` + `@container` rule moves to the attachment box (§7) |
| 4 | Sharing only through the `<dialog>`; CUJ 2 "opens the share dialog" (§8.2, CUJ 2) | **Changes** | An inline form plus the paste/drop progressive enhancement on feed pages; the same dialog on other pages (§8.1) |
| 5 | Only the notification poll (60 s) and the preview refresh (3 s × 5) (§6, NFR) | **Extends** | An additional 60 s `GET /api/internal/feed/updates` poll in the feed view, with the same visible-tab rules; at most 2 requests per minute per tab (§8.5, §10) |
| 6 | `content-visibility` via `.feed-list > li:nth-child(n + 6)` (M5 #25) | **Changes (rule kept)** | The first 5 posts are excluded; because of day groups, the overall-order class `.is-deferred` (§7) |
| 7 | Focus on the `h1` on every `pathname` change (§8.4, M5 #27) | **Changes** | `preventScroll: true`, hash targets first, skipped on `popstate` (§8.6, F2) |
| 8 | Background scroll lock only through containment/`overscroll-behavior` (§8.2) | **Extends** | `html:has(dialog:modal) { overflow: hidden }` + progressive `scrollbar-gutter` (§3, F11) |
| 9 | Card overflow actions, filter pickers and the notification summary as `popover="auto"`, no `role="menu"` (§8.3) | **Kept** | Every popover use outside the mobile drawer and the anchor positioning fallback stay as they are |
| 10 | Native `<dialog>`, `cancel` guard, `closedby="any"` fallback, Invoker Commands for copying (§8.2) | **Kept** | The `Dialog`/`PopoverPanel` API does not change |
| 11 | Card ↔ resource detail View Transitions, `prefers-reduced-motion` (§8.4) | **Kept** | The `active-resource-card` match between `PostCard` and `/resources/[id]` |
| 12 | No-JS fallbacks `?compose=1`, `?edit=`, `?delete=`, `?editComment=`, `?deleteComment=` (§8.1) | **Kept** | `?compose=1` focuses the inline form; the others are `ShareNoJsFallbacks` |
| 13 | Cover image `1200 / 630`; no CSS `order`, natural source order (§8.1) | **Kept** | §7 |
| 14 | Notification poll: visible tab, 60 s, at least 15 s on `visibilitychange` (§6) | **Kept** | The shared `visibility-poller` applies the same rules |
| 15 | The CUJ 4 silent option label (CUJ 4) | **Kept (normative)** | The deviation in the web code (F17) is aligned with the document text in B4 |
| 16 | Touch target size (not stated explicitly in the core) | **New** | At least `24px`, `44px` on coarse pointers (§3) |
| 17 | Security headers and CSP (not in the core) | **New** | §11 |

#### Correcting Drift in Documents and Reports

Some claims in the previous automated review report ("No drift detected") do not match the code; this document is based on the actual state below:

| Claim | Actual state | Response in this document |
| :--- | :--- | :--- |
| CSP is on every response | HTML responses have no CSP, `frame-ancestors` or `nosniff` (only the thumbnail route has headers) | Phase 1 fixed security headers; Phase 8 an enforced CSP straight away (§11) |
| Thumbnails have `max-age=31536000` | The code and the core document say `86400` | No change |
| Sign-in is limited "per IP" | The code uses `IP + e-mail`; the core NFR says `IP + account` | Fixed: Phase 1 (S2) applies `IP + account` `10`, `IP` `30`, account `50` per 15-minute buckets; the core NFR and plan rows were updated to match |
| Mobile navigation breaks at `< 960px` | The code is measurement-based (`ResizeObserver`) | Row 1: replaced by CSS breakpoints |
| The silent option label matches the document | The text in `ShareComposerDialog.svelte` and `ShareCard.svelte` drifted; the extension is correct | Row 15 |

From now on, no document or report claim is treated as "true" until it is checked against the code.

## Alternatives Considered

### Alternative A: The "Pafta" (Map Sheet) Direction

A map or survey sheet aesthetic ("iz + gâh = the place of traces"): a jade green accent (`#0B7A5C`), narrow Archivo headings + IBM Plex Mono, sections with legend symbols, sharp corners and corner marks. Conceptually the closest to the name, but the legend symbols and the map metaphor add a learning load for new members, the green accent clashes with the meaning "success", and the narrow heading font hurts readability in long Turkish notes. Not chosen by the user.

### Alternative B: The "Kobalt" (Cobalt) Direction

A saturated cobalt blue left rail (`#1F2BD1`) on a light content background, Figtree, round avatars, pill buttons and cards with large images. The most social and warm direction, but also the most familiar (closest to the generic social/SaaS look); large image cards weaken density and the "find it in the archive in seconds" goal, and the saturated rail competes with the content. Not chosen by the user.

### Alternative C: Keeping the v1 Shell and Only Changing Colours

The top bar and the "Menu" popover could have stayed with the tokens switched to Signal. Rejected because hidden sections, the lack of thumb reach on mobile and the `ResizeObserver` layout shift would remain unsolved.

### Alternative D: Applying the Theme Through `localStorage` and an Inline Script

The common "flash-free theme" pattern needs an inline script in `<head>`, which means a hash or nonce exception in the CSP and a preference that does not work without JavaScript. A cookie-based `data-theme` written by the server through `transformPageChunk` solves both problems.

### Alternative E: SSE or WebSocket for New Shares

Real-time push would give an instant counter, but it needs long-lived connection management in a single container, timeout settings on the reverse proxy and reconnection logic. For a team of 10–15 people, a 60-second poll on visible tabs gives the same benefit at negligible cost.

### Alternative F: A CSS Framework, a Component Library or `light-dark()`

Tailwind or a ready-made component library would pull the design language back to defaults and widen the dependency boundary. `light-dark()` would shorten the two-theme tokens, but selectors are still needed to separate an explicit `data-theme` choice from the system preference, and the feature is not yet "widely available". Media queries plus `[data-theme]` selectors were chosen.

*Update (2026-11-22):* `light-dark()` became Baseline "widely available" on 2026-11-13; to avoid writing the dark palettes twice with the extra themes, the tokens moved to `light-dark()` ([izgah-themes.md](./izgah-themes.md), Alternative B). The rejection of Tailwind and component libraries stands.

### Alternative G: Shipping the CSP in Report-Only Mode First

Report-only mode would collect violations from real user traffic in production, but SvelteKit requires `report-uri`/`report-to` in that mode, which needs an open, unauthenticated report endpoint (`POST /csp-report`) with its own rate limit, size limit and log privacy rules. In a closed team of 10–15 people every route can be visited by the smoke test, so this extra attack surface was rejected (Decision 2).

## Risks & Mitigations

| Risk | Impact | Mitigation |
| :--- | :--- | :--- |
| Safari does not fire `paste` outside an editable context | "Paste anywhere" does not work in Safari | A progressive enhancement; the inline URL field is one tap away in every browser; the help dialog says so |
| An enforced CSP blocks Svelte inline styles, fonts or Kit scripts | A broken look or failed hydration in production | `style-src 'unsafe-inline'`; `.woff2` is never inlined; with no report-only mode, enforced mode goes to `main` only after the m8 Docker CSP scenario passes with zero violations against the production image; if something breaks, roll back to the `N-1` image |
| `localStorage` is unavailable (private mode, quota) | The last-visit divider and the shortcut preference are lost | Every access is in `try/catch`; the feature turns off silently and the feed is unaffected |
| Single-key shortcuts conflict with assistive technology | A keyboard user triggers actions by accident | Editable-target, IME and modifier checks; the WCAG 2.1.4 off switch |
| Widespread changes to E2E selectors | Regressions go unnoticed | The fixed list of hooks and names (§12); selector updates in the same commit as the markup change |
| The extension stays in v1 colours until Phase 7 | A short visual inconsistency | The token mapping table (§14) is ready; behaviour does not change, so the risk is only visual |
| An extra polling endpoint | Server load | A `LIMIT 100` subquery, existing indexes, visible tabs and the first page only; back-off on errors |

## Non-Functional Requirements

*   **Accessibility:** WCAG 2.2 AA; every text pair `≥ 4.5:1`, control boundaries and the focus indicator `≥ 3:1` (the §1 table); every flow by keyboard alone; support for `prefers-reduced-motion` and Windows `forced-colors`; live-region announcements from one shared announcer.
*   **Performance:** No JavaScript measurement in the shell; no source of layout shift after hydration (the divider and the `kbd` hints reserve no space); only two `.woff2` files are preloaded; `content-visibility` in long feeds.
*   **Working without JavaScript:** Inline sharing, theme choice, `/sections`, navigation and every existing no-JS fallback work; shortcuts, paste, the last-visit divider and the new-posts pill are progressive enhancements only.
*   **Privacy:** `localStorage` holds only a timestamp and preferences (no personal data); the theme cookie is `HttpOnly`.
*   **Browser support:** The last two major versions of Chrome, Firefox and Safari. Features that are not Baseline "widely available" (View Transitions, anchor positioning, `content-visibility`, `field-sizing`, `scrollbar-gutter`, `text-wrap: balance/pretty`) are progressive enhancements only.

--------------------------------------------------------------------------------

### Additional Resources

*   [izgah-core.md](./izgah-core.md) — The core platform; see §15 for the changed rules of §6 and §8.
*   [izgah-extensions.md](./izgah-extensions.md) — The extension architecture; §14 for token alignment.
*   [AGENTS.md](../../AGENTS.md) — Language, design document, `modern-web-guidance` and definition-of-done rules.
*   [SITEMAP.md](./SITEMAP.md) — The document index and planned routes.

## Detailed Implementation Plan

The document was approved on 2026-11-20; the steps below are implemented against it. Each step ends with its own commit(s) and passes the AGENTS.md definition of done: `pnpm lint`, `pnpm check`, `pnpm test` and the relevant `pnpm test:e2e`; if the extension changed, `pnpm lint && pnpm check && pnpm test` in `extensions/`. Before front-end steps, as AGENTS.md requires, `npx modern-web-guidance@latest search "<need>"` + `retrieve` is run (theme/colour scheme, self-hosted fonts, roving focus + shortcuts, paste/drag-drop, sticky headings, bottom navigation, container queries, view transitions).

**Added to the fixed dependency boundary ([`package.json`](../../package.json) `devDependencies`):** `@fontsource-variable/schibsted-grotesk@^5.3.0`, `@fontsource-variable/jetbrains-mono@^5.3.0` (both `OFL-1.1`; the lockfile pins `5.3.0`). The fonts are copied into `build/client` at build time, so they are not runtime dependencies. No other package is added; Lucide icon paths are copied without a package (ISC).

| Step | Track | Scope | Main files | Dependency |
| :--- | :--- | :--- | :--- | :--- |
| A1 | Server | Theme cookie, `setTheme` action, font preload | `src/hooks.server.ts`, `src/app.html`, `src/routes/(app)/settings/+page.server.ts`, `vite.config.ts` | Phase 1 `sanitizeInternalPath` |
| A2 | Server | Shared scope query and the new updates endpoint | `src/lib/server/feed/query.ts`, `src/routes/api/internal/feed/updates/+server.ts`, `src/routes/(app)/+page.server.ts` | — |
| A3 | Server/client | Shared visible-tab poller; the notification bell moves onto it (F16) | `src/lib/client/visibility-poller.ts`, `NotificationBell.svelte` | — |
| A4 | Pure modules | `date` (`dayKey`, `dayLabel`, `todayKey`), `merge`, `group-by-day`, `paste`, `keyboard-filter` + vitest | `src/lib/format/date.ts`, `src/lib/feed/*.ts`, `src/lib/share/paste.ts`, `src/lib/client/keyboard-filter.ts` | Phase 1 `date.ts` |
| B1 | UI | Design system: layers, tokens, classes, `Icon`/`Avatar`/`Toaster`, fonts (F9, F11, F12) | `src/lib/styles/*.css`, `src/lib/components/ui/*` | A1 |
| B2 | UI | Shell: rail, icon rail, top bar, bottom tab bar, `/sections` (F10) | `src/routes/(app)/+layout.svelte`, `src/lib/components/shell/*`, `src/routes/(app)/sections/+page.*` | B1 |
| B3 | UI | Feed core: `FeedView`, `feed-state`, the `PostCard` family (F13, F15, F17) | `src/lib/components/feed/*`, `src/lib/feed/feed-state.svelte.ts`, the `/` and `/sections/[slug]` pages | B2, A4 |
| B4 | UI | `ShareForm`, `InlineComposer`, `ComposerController`, paste/drop | `src/lib/components/share/*`, `src/lib/share/*` | B3 |
| B5 | UI | Shortcuts, day groups, the last-visit divider, `NewPostsPill` | `src/lib/components/shell/KeyboardHelpDialog.svelte`, `FeedView.svelte`, `NewPostsPill.svelte` | B4, A2, A3 |
| Phase 6 | UI | Other screens (§13) | The related routes | B2 |
| Phase 7 | Extension | Token alignment (§14) | `extensions/src/styles/tokens.css`, `extensions/package.json` | B1 tokens frozen |
| Phase 8 | Wrap-up | An enforced CSP straight away + the m8 Docker CSP scenario, a visual and accessibility tour, clean-up | `svelte.config.js`, `tests/e2e/m8-docker-smoke.spec.ts` | All |

The A and B tracks touch different files and can run in parallel; the B steps share layout and feed files, so they run in order.

### Verification Plan

*   **Unit tests (`vitest`):**
    *   `date.ts`: `dayKey`/`dayLabel` in Istanbul time under a UTC environment (the `20:59Z` and `21:00Z` midnight boundary, a year change, the "Today/Yesterday/weekday/date" labels).
    *   `merge.ts`: appended pages kept when new items arrive, a deleted item inside the window dropped, a reset on `> 25` new items, `nextCursor` kept.
    *   `group-by-day.ts`, `paste.ts` (WhatsApp text, comment lines in `text/uri-list`, text without a URL), `keyboard-filter.ts` (Turkish Q `/` and `?` with Shift, Caps Lock `J`, `isComposing`, editable targets, `Ctrl/Meta/Alt`, an open dialog).
    *   `tokens-contrast.test.ts`: parses `src/lib/styles/tokens.css` and recomputes the threshold of every pair in the §1 table (`4.5:1` text, `3:1` controls and focus) for both themes.
*   **Integration tests (`vitest` + PostgreSQL):** `GET /api/internal/feed/updates` — `401`, `403`, `400`, `404`; the `afterId` boundary (two rows in the same microsecond); the feed excluding silent shares and a section including them; own and deleted shares excluded; the `type` filter; the `100` cap. The `setTheme` action — a cookie for a valid value, rejection of an invalid value, `returnTo` cleaning; the `data-theme` change and preload links in the `handle` output. The `X-Frame-Options`, `X-Content-Type-Options` and `Referrer-Policy` headers on HTML responses (Phase 1); before Phase 8, the absence of `Content-Security-Policy` and `Content-Security-Policy-Report-Only` headers.
*   **End to end (`Playwright`, Chromium/Firefox/WebKit + a `375 × 812` mobile project):** No-JS inline sharing (`javaScriptEnabled: false`); the right `data-theme` on first paint from the theme cookie; `j`/`k`/`l`/`?` and the off switch; paste-to-share (Chromium only; a synthetic `ClipboardEvent`); the last-visit divider (`localStorage` seeded with `addInitScript`); the new-posts pill (60 s with `page.clock`, a second user shares through the API); on mobile the bottom tab bar, a single "main navigation", a visible notification bell and the bar hiding while a text field has focus; `/sections` without JavaScript; "load more → like → items kept"; the Decision 1 scenarios: focus on the inline form at the top of the feed, the dialog on a scrolled feed and with a partly visible form, the dialog-specific scenarios on `/resources/[id]` (§12).
*   **CSP smoke test (Phase 8):** The CSP scenario in `tests/e2e/m8-docker-smoke.spec.ts` runs against the production image with `pnpm test:docker`; zero `securitypolicyviolation` events on every main route and a `Content-Security-Policy` header on every response. It is the precondition for pushing the commit that enables enforced mode, and later CSP-affecting changes, to `main` (§11).
*   **Visual and accessibility tour (Phase 8):** Screenshots at `375 / 768 / 1280px` × light/dark × three engines in the browser pane; a keyboard-only tour; `prefers-reduced-motion`; focus ring visibility under Windows `forced-colors` emulation.
*   **Extension:** `cd extensions && pnpm lint && pnpm check && pnpm test && pnpm test:e2e && pnpm verify:manifests`.
