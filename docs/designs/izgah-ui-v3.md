# Izgah UI v3 — "Izgah Studio"

*   **Author:** Gorkem Inanc Ozdemir
*   **Status:** Superseded by [izgah-ui-v4.md](./izgah-ui-v4.md) (2026-11-26); the command palette (§7), quick search, the context rail data (§5) and `SidePeekDialog` remain
*   **Date:** 2026-11-24

> **2026-11-26:** [izgah-ui-v4.md](./izgah-ui-v4.md) ("Künye") replaced this visual language after the prototype review. The sections that code still cites stay valid where v4 does not override them.

--------------------------------------------------------------------------------

## Overview

This document defines the third version (**"Izgah Studio"**) of the Izgah web interface and of the Chrome/Firefox/Safari browser extension. It replaces the previous "Signal" visual language (`#C8F542` neon lime, hard black borders, uniform attachment boxes and an empty right-hand area) with a visual and interaction architecture that combines a **precise tool shell**, **editorial heading typography on warm surfaces** and a **three-column live feed with rich media cards** in one coherent design system.

The binding core rules remain:

*   [izgah-ui-v2.md](./izgah-ui-v2.md) **§2** (self-hosted Fontsource fonts plus the `latin`/`latin-ext` preload mechanism), **§9** (theme cookies and flash-free SSR), **§11** (security headers and an enforced CSP, no inline scripts) and **§12** (fixed E2E hooks and accessible names) stay in force.
*   The **mode + day/night palette + accent** cookie and `light-dark()` mechanism of [izgah-themes.md](./izgah-themes.md) stays as it is; the palette and accent values are updated to the Izgah Studio language.
*   The data model, authentication, preview worker and `/api/v1/*` contract of [izgah-core.md](./izgah-core.md) do not change; **no database migration is needed**.

**Visual synthesis:**

*   **Shell, navigation, `⌘K` command palette, settings and admin:** A full-height (`100dvh`) sticky left rail, a thin top context bar, hairline settings rows, plain admin tables with KPI strips.
*   **Feed cards, resource details and heading typography:** A serif (`Newsreader Variable`) only for the page `h1`, day `h2`, resource `h3` headings and the wordmark; warm alabaster (light) and warm graphite (dark) surfaces.
*   **Feed layout, media previews, share flow and action bar:** A balanced three-column desktop feed (left rail + reading column + a right context rail fed by database queries), media cards with cover images, compact or special cards for links without images, avatar stacks.
*   **Browser extension:** A warm editorial resource summary and clear section chips; the behaviour and the `/api/v1/*` contract do not change.

#### Key Concepts

*   **Three-layer token architecture:** `Primitive` (raw tones) → `Semantic` (`--color-*`, `light-dark()` slots) → `Component` (`--card-*`, `--btn-*`, `--rail-*`). Components never use raw colour values.
*   **Bipolar accent (`--accent-light` / `--accent-dark`):** Each accent option is calibrated separately for the light and the dark scheme, so it meets WCAG 2.2 AA (`≥ 4.5:1`) as text, border, icon and fill in the light theme too.
*   **Right context rail (`FeedContextRail`):** On desktops `≥ 1280px`, **on the feed (`/`) only**, three summary modules built from the existing PostgreSQL tables: *Today's summary*, *Most discussed* (last 7 days) and *Top sharers this week*.
*   **Side peek (`SidePeekDialog`):** A progressive enhancement that shows a resource's details and comments in a `<dialog>` sliding in from the right on desktop, without leaving the feed (a plain `/resources/[id]` link without JavaScript).
*   **Command palette (`CommandPalette`):** A keyboard-first modal `<dialog>`, opened with `⌘K` / `Ctrl+K`, that brings sections, quick actions and live archive search together.

--------------------------------------------------------------------------------

## The Problem

The previous "Signal" interface worked, but it left five visual and structural problems unsolved:

1.  **Oversaturated neon lime blocks:** Three or four separate `#C8F542` blocks with black borders and glow on one screen (for example, "Share", "Admin", "Members" and "Create invite" competing as neon blocks on the admin screen at once).
2.  **Dead space on the right on desktop:** A `248px` left rail plus a left-aligned `680px` column leaves `~500px` empty on the right of a `1440px` screen.
3.  **Typography and surface fatigue:** Form hints and settings descriptions set in `JetBrains Mono`, heavy `800`-weight headings, hard `#808080` borders on every input and card, and an artificial `--surface-sheen` gradient.
4.  **Uniform attachment boxes and crowded admin rows:** Repository or web links without images are squeezed into the same rectangle as articles and videos with covers; the admin table stacks four separately framed controls in every row.
5.  **Missing modern interactions:** No `⌘K` command palette, side peek, avatar stack, consistent tooltip or segmented control.

--------------------------------------------------------------------------------

## Goals

*   **A distinctive, consistent visual identity:** A warm alabaster (`#FAFAF8`) and warm graphite (`#0D0E10`) surface hierarchy, a restrained forest/sage teal accent and a disciplined split of typefaces (`Newsreader` only for selected headings; `Geist` for the interface and notes; `JetBrains Mono` only for technical metadata).
*   **Full WCAG 2.2 AA / high-contrast AAA:** In all 20 combinations of 5 palettes (2 light + 3 dark) × 4 accents, text `≥ 4.5:1`, control boundaries and focus `≥ 3:1`; in the high-contrast palettes text, secondary text and danger `≥ 7:1` (AAA), `line ≥ 4.5:1`, and no shadows, glows or gradients.
*   **A three-column feed built on real data:** The right context rail shows only real data from the existing database; it needs no schema migration, cache layer or new infrastructure.
*   **Content-aware feed cards:** Rich media previews for resources with cover images; repository, social and compact strip variants for links without images.
*   **Resilience, security and working without JavaScript:** No inline scripts (enforced CSP), flash-free themes through cookies and SSR, every core flow (sharing, navigation, search, details, themes, admin) works fully without JavaScript; every new interaction (`⌘K`, side peek) is a progressive enhancement.
*   **Preserved functionality and E2E contract:** The WebKit popover fix, the mobile top spacing, the Turkish 404, the admin table alignment and the `izgah-ui-v2.md` §12 hooks are kept.

--------------------------------------------------------------------------------

## Non-Goals

*   **Online presence and real-time push:** **No** "online" indicators, "N online" counters, "LIVE" badges or WebSocket/SSE (the existing 60-second poll on visible tabs stays).
*   **Read tracking or reading goals:** **No** weekly reading progress bar and no server-side read/unread record (only the existing local `localStorage` last-visit divider stays).
*   **Author hover card (`HoverCard`):** Out of scope, because it would need author statistics that are not on the page and extra queries; the author name stays as plain as it is.
*   **Extension behaviour changes and new `/api/v1/*` endpoints:** The extension popup gets **no** "Save / Recent" tab; the existing popup and options flow and the `/api/v1/*` contract stay, moved to the Izgah Studio visual language only.
*   **Database migrations:** No new table, column or index migration.
*   **Heavy JS/CSS frameworks:** No Tailwind, React/Vue ports, MUI/shadcn ports, icon packages or polyfills.

--------------------------------------------------------------------------------

## Technical Plan (Architecture)

### 1. Token System (Primitive → Semantic → Component)

All tokens live in [`src/lib/styles/tokens.css`](../../src/lib/styles/tokens.css) in the `@layer tokens` layer. The three layers are kept strictly apart:

1.  **Primitive layer (`--p-*`):** Raw neutral and accent steps (assigned to palette slots inside `tokens.css` only; components never use `--p-*` directly).
2.  **Semantic layer (`--light-*`, `--dark-*`, `--accent-*` → `--color-*`):** The `light-dark()` and `.theme-preview` pattern of [izgah-themes.md](./izgah-themes.md) §4 stays as it is. The mode (`data-theme`) only switches `color-scheme`.
3.  **Component layer:** Surface layers (`--color-surface-1`, `--color-surface-2`, `--color-surface-3`), shadows and top highlight (`--shadow-xs/sm/lg`, `--specular-top`), corner radii (`--radius-*`), shell sizes (`--rail-w`, `--context-rail-w`, `--read-w`, `--topbar-h`).

> **Backward-compatible aliases:** During the transition the mappings `--color-surface` → `var(--color-surface-2)`, `--color-signal` → `var(--color-accent)` and `--color-on-signal` → `var(--color-on-accent)` stay; every v3 component uses the new `--color-*` names directly.

#### 1.1 Light Palettes (`data-light-theme`)

| Token | Role | Default (`default` — Warm Alabaster) | Contrast (`default`) | High Contrast (`contrast`) | Contrast (`contrast`) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--light-bg` | Main canvas | `#FAFAF8` | — | `#FFFFFF` | — |
| `--light-surface-1` | Cards, side rail, modal | `#FFFFFF` | `bg` 1.04 | `#FFFFFF` | — |
| `--light-surface-2` | Hover, inputs, secondary surface | `#F3F2EE` | `s1` 1.11 | `#F0EFEA` | `s1` 1.15 |
| `--light-surface-3` | Active navigation / pressed | `#E8E6DF` | `s1` 1.24 | `#E2E0D8` | `s1` 1.31 |
| `--light-text` | Primary text | `#141413` | `bg` **17.64** · `s2` **16.46** ✓ | `#000000` | `bg` **21.00** · `s2` **18.24** (AAA ✓) |
| `--light-text-secondary` | Team note, description | `#52514D` | `s1` **7.95** · `s2` **7.09** ✓ | `#262522` | `s1` **15.33** · `s2` **13.31** (AAA ✓) |
| `--light-text-muted` | Meta, time, counters | `#63625C` | `bg` **5.85** · `s2` **5.46** ✓ | `#42413D` | `bg` **10.22** · `s2` **8.88** (AAA ✓) |
| `--light-line` | Decorative `1px` divider | `#E6E4DD` | decorative (1.22) | `#73716A` | `bg` **4.88** (≥ 3:1 ✓) |
| `--light-line-strong` | Interactive control boundary | `#77756E` | `bg` **4.41** · `s2` **4.12** ✓ | `#1C1B19` | `bg` **17.21** · `s2` **14.95** ✓ |
| `--light-danger` | Error / destructive text | `#C81E1E` | `s1` **5.74** · `s2` **5.12** ✓ | `#961007` | `s1` **8.85** · `s2` **7.68** (AAA ✓) |
| `--light-on-danger` | Text on a danger fill | `#FFFFFF` | `danger` **5.74** ✓ | `#FFFFFF` | `danger` **8.85** (AAA ✓) |
| `--light-focus-inner` | Inner line of the focus ring | `#141413` | `bg` **17.64** ✓ | `#000000` | `bg` **21.00** ✓ |
| `--light-highlight-bg` / `-fg` | Search match, "new" label | `#FEF3C7` / `#141413` | **16.55** ✓ | `#FDE047` / `#000000` | **15.93** ✓ |
| `--light-backdrop` | `dialog::backdrop` | `rgb(20 20 19 / 0.44)` | — | `rgb(0 0 0 / 0.65)` | — |

#### 1.2 Dark Palettes (`data-dark-theme`)

| Token | Default (`default` — Warm Graphite) | Contrast (`default`) | Dim (`dim` — Dim Slate) | Contrast (`dim`) | High Contrast (`contrast`) | Contrast (`contrast`) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `--dark-bg` | `#0D0E10` | — | `#1A1C20` | — | `#000000` | — |
| `--dark-surface-1` | `#141518` | `bg` 1.07 | `#22252B` | `bg` 1.09 | `#0E0F11` | `bg` 1.08 |
| `--dark-surface-2` | `#1C1E22` | `s1` 1.12 | `#2B2F37` | `s1` 1.12 | `#181A1E` | `s1` 1.12 |
| `--dark-surface-3` | `#25282E` | `s1` 1.27 | `#353A44` | `s1` 1.29 | `#24272D` | `s1` 1.29 |
| `--dark-text` | `#F3F3F1` | `bg` **17.38** · `s2` **15.02** ✓ | `#EFEFED` | `bg` **14.82** · `s2` **11.66** ✓ | `#FFFFFF` | `bg` **21.00** · `s2` **17.42** (AAA ✓) |
| `--dark-text-secondary` | `#A3A4A8` | `s1` **7.33** · `s2` **6.70** ✓ | `#B4B7BE` | `s1` **7.65** · `s2` **6.68** ✓ | `#E5E5E2` | `s1` **15.19** · `s2` **13.80** (AAA ✓) |
| `--dark-text-muted` | `#8E9096` | `bg` **6.05** · `s2` **5.23** ✓ | `#9FA3AC` | `bg` **6.75** · `s2` **5.31** ✓ | `#CECEC9` | `bg` **13.30** · `s2` **11.03** (AAA ✓) |
| `--dark-line` | `#26282F` | decorative (1.31) | `#353A44` | decorative (1.49) | `#808288` | `bg` **5.47** (≥ 3:1 ✓) |
| `--dark-line-strong` | `#6C6F78` | `bg` **3.85** · `s2` **3.32** ✓ | `#808592` | `bg` **4.62** · `s2` **3.64** ✓ | `#C8CACF` | `bg` **12.81** · `s2` **10.62** ✓ |
| `--dark-danger` | `#F87171` | `s1` **6.60** · `s2` **6.03** ✓ | `#FCA5A5` | `s1` **8.09** · `s2` **7.07** ✓ | `#FFA3A3` | `s1` **10.06** · `s2` **9.14** (AAA ✓) |
| `--dark-on-danger` | `#0D0E10` | `danger` **6.98** ✓ | `#1A1C20` | `danger` **8.99** ✓ | `#000000` | `danger` **11.02** (AAA ✓) |
| `--dark-focus-inner` | `#F3F3F1` | `bg` **17.38** ✓ | `#EFEFED` | `bg` **14.82** ✓ | `#FFFFFF` | `bg` **21.00** ✓ |
| `--dark-highlight-bg` / `-fg` | `#362D12` / `#FDE68A` | **10.94** ✓ | `#3E3314` / `#FEF08A` | **10.69** ✓ | `#4A3B08` / `#FEF08A` | **9.40** ✓ |
| `--dark-backdrop` | `rgb(0 0 0 / 0.70)` | — | `rgb(0 0 0 / 0.65)` | — | `rgb(0 0 0 / 0.82)` | — |

#### 1.3 Accent Colours (`data-accent`) — Four Options, Calibrated Separately for Light and Dark

The new allow-list: `teal` *(default)* | `cobalt` | `terracotta` | `plum`. Old `izgah_accent` cookie values (`lime`/`cyan`/`pink`/`blue`) are outside the allow-list and, by the rule in [izgah-themes.md](./izgah-themes.md) §3, fall back safely to the default `teal`.

| Accent (`data-accent`) | Light (`--accent-l` / `--on-l`) | Light contrast (`on/acc` · `acc/bg` · `acc/s2` · `acc/hc-s2`) | Light soft (`soft` / `text`) | Dark (`--accent-d` / `--on-d`) | Dark contrast (`on/acc` · `acc/bg` · `acc/dim-s2` · `acc/hc-s2`) | Dark soft (`soft` / `text`) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Forest Teal** (`teal`, default) | `#0F766E` / `#FFFFFF` | **5.47** · **5.24** · **4.89** · **4.75** ✓ | `#E6F4F1` / `#0D635C` (**6.28** ✓) | `#2DD4BF` / `#061A18` | **9.65** · **10.37** · **7.21** · **9.36** ✓ | `#122A28` / `#5EEAD4` (**10.23** ✓) |
| **Cobalt** (`cobalt`) | `#1D4ED8` / `#FFFFFF` | **6.70** · **6.41** · **5.98** · **5.82** ✓ | `#EFF6FF` / `#1E40AF` (**8.01** ✓) | `#60A5FA` / `#071324` | **7.32** · **7.60** · **5.28** · **6.85** ✓ | `#142238` / `#93C5FD` (**8.85** ✓) |
| **Terracotta** (`terracotta`) | `#9A3412` / `#FFFFFF` | **7.31** · **6.99** · **6.52** · **6.35** ✓ | `#FDECE3` / `#7C2D12` (**8.16** ✓) | `#FB923C` / `#1C0D03` | **8.37** · **8.53** · **5.93** · **7.70** ✓ | `#2E1D11` / `#FDBA74` (**9.58** ✓) |
| **Plum** (`plum`) | `#6D28D9` / `#FFFFFF` | **7.10** · **6.80** · **6.34** · **6.17** ✓ | `#F3EEFF` / `#5B21B6` (**7.91** ✓) | `#C4B5FD` / `#180C2E` | **10.06** · **10.46** · **7.27** · **9.44** ✓ | `#231A38` / `#DDD6FE` (**11.85** ✓) |

*   **Result:** **All 20 combinations** of 5 palettes × 4 accents meet the thresholds for text (`≥ 4.5:1`), text inside a soft fill (`≥ 4.5:1`), control boundaries (`≥ 3:1`) and the focus ring (`≥ 3:1`).
*   **High-contrast rule:** Under `[data-light-theme='contrast']`, `[data-dark-theme='contrast']`, `@media (prefers-contrast: more)` and `@media (forced-colors: active)`, `--shadow-*`, `--specular-top` and every focus or accent glow become `none`; surfaces stay completely flat and boundaries stay high-contrast.

--------------------------------------------------------------------------------

### 2. Typography, Fontsource Packages and a Strict Serif Boundary

#### 2.1 New and Updated `devDependencies`

| Package and version | License | Scope and reason |
| :--- | :--- | :--- |
| `@fontsource-variable/newsreader@^5.3.0` (`5.3.0`) | `OFL-1.1` | Editorial serif heading font (`latin` + `latin-ext`: `ı İ ş Ş ğ Ğ`, `wght` + `opsz`, normal + italic). Self-hosted, no CDN. |
| `@fontsource-variable/geist@^5.3.0` (`5.3.0`) | `OFL-1.1` | Sans-serif for the interface and team notes (`latin` + `latin-ext`, `wght` `400..700`). Replaces `@fontsource-variable/schibsted-grotesk@5.3.0`. |
| `@fontsource-variable/jetbrains-mono@5.3.0` *(existing)* | `OFL-1.1` | Technical metadata (`latin` + `latin-ext`, `tabular-nums`: time, domain, repository stars, counters, `kbd`). |
| `@axe-core/playwright@^4.14.0` (`4.14.0`) | `MPL-2.0` | A development/test dependency that checks the computed styles in a real browser **with the `color-contrast` rule only** in the accessibility tour `tests/e2e/m15-a11y-tour.spec.ts` (not part of the production build). |

*   **Removed package:** `@fontsource-variable/schibsted-grotesk@5.3.0` is removed from the root project and from `extensions/package.json`.
*   **CSS families:**
    *   `--font-display: 'Newsreader Variable', Georgia, 'Iowan Old Style', serif`
    *   `--font-sans: 'Geist Variable', system-ui, -apple-system, 'Segoe UI', sans-serif`
    *   `--font-mono: 'JetBrains Mono Variable', ui-monospace, SFMono-Regular, Menlo, monospace`
*   **Preloading (`src/lib/server/http/theme.ts`):** `PRELOADED_FONT_PATTERN` is updated: files matching `/geist-latin(?:-ext)?-wght-normal|newsreader-latin(?:-ext)?-opsz-normal/` are preloaded; mono and italic load on demand through `unicode-range` + `font-display: swap`. The `vite.config.ts` rule that never inlines `.woff2` files (`font-src 'self'`) stays as it is.

#### 2.2 Serif Boundary

*   **The serif (`--font-display`) is used ONLY in these four places:**
    1. Page headings (`h1` — for example "Feed", the section name, "Settings", "Member management", the sign-in heading).
    2. Feed day headings (`h2.day-heading` — "Today", "Yesterday", "Tuesday", italic `600`).
    3. Resource titles on feed cards and resource details (`h3.attachment-title`, `h1.resource-title`, the "Most discussed" titles in the right rail, the extension's title preview).
    4. The "Izgah" wordmark in the left rail and on the sign-in screen.
*   **Navigation, forms, labels, hints, settings rows, admin tables, team notes and comments** always use `--font-sans` (`Geist Variable`).
*   **`JetBrains Mono`** appears only in times, dates, domains, repository stars and language, counters, URL fields and `kbd`; form hints and description paragraphs (`.field-hint`) are never monospace.

#### 2.3 Type Scale

| Token | Size / line height | Weight | Family | Tracking | Use |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--text-display` | `clamp(1.625rem, 1.35rem + 1.1vw, 2rem)` / `1.15` | `600` | Serif | `-0.02em` | Page `h1`, resource detail `h1` |
| `--text-day` | `1.125rem` / `1.2` | `600` (italic) | Serif | `-0.01em` | Day heading `h2` |
| `--text-title` | `1.0625rem` / `1.32` | `600` | Serif | `-0.01em` | Link attachment title `h3` |
| `--text-section` | `1rem` / `1.35` | `600` | Sans | `-0.01em` | Panel and section subheadings (`h2` in settings and admin) |
| `--text-body` | `0.9375rem` (`15px`) / `1.6` | `400` | Sans | `0` | Team notes, comments, form inputs |
| `--text-ui` | `0.84375rem` (`13.5px`) / `1.35` | `500` | Sans | `0` | Navigation, buttons, labels, table cells, author name (`600`) |
| `--text-hint` | `0.8125rem` (`13px`) / `1.45` | `400` | Sans | `0` | Form hints, settings descriptions |
| `--text-meta` | `0.75rem` (`12px`) / `1.3` | `400` | Mono | `0` | Time, domain, counters, repository statistics (`tabular-nums`) |
| `--text-micro` | `0.75rem` (`12px`) / `1.2` | `500` | Mono | `0.03em` | Badges, table `th`, `kbd` |

--------------------------------------------------------------------------------

### 3. Spacing, Corners, Surface Layers and the Focus Ring

*   **Spacing grid (`4px`):** `--space-1` (`4px`), `--space-2` (`8px`), `--space-3` (`12px`), `--space-4` (`16px`), `--space-5` (`24px`), `--space-6` (`32px`), `--space-7` (`48px`), `--space-8` (`64px`).
*   **Corner radii:** `--radius-xs: 5px` (`kbd`, small badges), `--radius-sm: 7px` (buttons, inputs, navigation items), `--radius-md: 11px` (attachment boxes, side rail cards, tables), `--radius-lg: 14px` (post cards, modal `<dialog>`, `⌘K`), `--radius-pill: 9999px` (avatars, status pills, section chips).
*   **Surface and depth:**
    *   **Light (`default`):** `surface-1` (`#FFFFFF`) cards on `bg` (`#FAFAF8`) + `1px solid var(--color-line)` + a light layered shadow (`0 1px 2px rgb(20 20 19 / 0.04), 0 4px 14px rgb(20 20 19 / 0.03)`).
    *   **Dark (`default`, `dim`):** Instead of a drop shadow, a step in surface lightness (`bg → surface-1 → surface-2`) + `1px solid var(--color-line)` + a `1px` top highlight (`inset 0 1px 0 rgb(255 255 255 / 0.05)`).
    *   **High contrast and `forced-colors`:** Shadow and top highlight are `none`.
*   **Focus ring (`:focus-visible`):** A sharp two-layer ring (a `2px` `var(--color-bg)` separator + `2px` `var(--color-accent)`; since every accent has `≥ 4.75:1` contrast in every theme, it meets WCAG 1.4.11 directly; `outline: 2px solid transparent; outline-offset: 2px;` guarantees visibility in Windows High Contrast).

--------------------------------------------------------------------------------

### 4. App Shell and Layout Breakpoints

| Width | Left rail | Top bar | Centre column | Right context rail |
| :--- | :--- | :--- | :--- | :--- |
| `≥ 1280px` | Full rail (`238px`), `position: sticky; inset-block-start: 0; block-size: 100dvh; align-self: start;` | A thin `48px` sticky context bar (location + `⌘K` trigger + notification summary) | `≤ 672px` on the feed; `≤ 1000px` on sections, settings and admin | **On the feed (`/`) only**, `280px` (`Today's summary`, `Most discussed`, `Top sharers this week`); absent on `/sections/[slug]` and other routes |
| `1024–1279px` | Full rail (`238px`, full `100dvh`) | `48px` top bar | `≤ 680px` (centred) | Hidden (`display: none`) |
| `768–1023px` | Icon rail (`68px`, full `100dvh`; accessible names kept) | `48px` top bar | `≤ 680px` | Hidden |
| `< 768px` | Becomes a top bar (`54px`: wordmark + notification bell) plus a fixed bottom tab bar (`62px`, `viewport-fit=cover`, hidden while a text field has focus) | — | Full width, `16px` side padding | Hidden |

*   **Full-height left rail:** In the `.app-shell` grid, `<header class="site-header">` always carries `position: sticky; inset-block-start: 0; block-size: 100dvh; align-self: start; overflow-y: auto;` on desktop; it fills the viewport height regardless of content length, and the profile block sits at the bottom edge through `margin-block-start: auto`.
*   **Active navigation style:** The active item in the left rail is not a full neon block; it stands out calmly and clearly with a `var(--color-surface-2)` background + `1px` `var(--color-line)` + a `3px` vertical `var(--color-accent)` stripe on the left edge.

--------------------------------------------------------------------------------

### 5. Right Context Rail — Queries, Indexes and Performance

The right rail (`src/lib/components/feed/FeedContextRail.svelte`) is shown **on the feed (`/`) only** (`≥ 1280px`); it does not appear on `/sections/[slug]` or other routes. All data is read directly from the existing PostgreSQL tables ([`src/lib/server/db/schema.ts`](../../src/lib/server/db/schema.ts)); there is no online indicator, live badge or read tracking.

Data loader module: `src/lib/server/feed/rail-summary.ts` (`getFeedRailSummary()`).

#### 5.1 Today's Summary (`todayShares`, `todayComments`)

The start of the day is computed in PostgreSQL without new time zone code, using the **`APP_TIME_ZONE`** constant (`'Europe/Istanbul'`) in [`src/lib/format/date.ts`](../../src/lib/format/date.ts) (`date_trunc('day', now() AT TIME ZONE ${APP_TIME_ZONE}) AT TIME ZONE ${APP_TIME_ZONE}`). *(Since [izgah-i18n-oss.md](./izgah-i18n-oss.md), `APP_TIME_ZONE` is a runtime setting that defaults to `UTC`.)*

```sql
-- 1a. Today's feed shares
SELECT count(*)::int AS share_count
FROM link_shares
WHERE deleted_at IS NULL
  AND is_feed_visible = true
  AND created_at >= (date_trunc('day', now() AT TIME ZONE $tz) AT TIME ZONE $tz);

-- 1b. Today's comments
SELECT count(*)::int AS comment_count
FROM resource_comments
WHERE deleted_at IS NULL
  AND created_at >= (date_trunc('day', now() AT TIME ZONE $tz) AT TIME ZONE $tz);
```

*   **Index use:**
    *   `1a`: A direct **index-only scan** over the existing partial composite index `link_shares_feed_cursor_idx (is_feed_visible, created_at DESC, id DESC) WHERE deleted_at IS NULL` (`< 0.2 ms`).
    *   `1b`: `resource_comments` only has a `(resource_id, created_at ASC)` index. For a team of 10–15 people the table is small and the scan takes `< 0.5 ms`; no new migration is needed.

#### 5.2 Most Discussed (Top 3 Resources by Comments in the Last 7 Days)

```sql
SELECT
  cr.id,
  cr.title,
  cr.domain,
  cr.like_count,
  count(rc.id)::int AS recent_comment_count
FROM resource_comments rc
INNER JOIN canonical_resources cr ON cr.id = rc.resource_id
WHERE rc.deleted_at IS NULL
  AND rc.created_at >= now() - interval '7 days'
  AND EXISTS (
    SELECT 1
    FROM link_shares ls
    WHERE ls.resource_id = cr.id
      AND ls.deleted_at IS NULL
      AND ls.is_feed_visible = true
  )
GROUP BY cr.id
ORDER BY recent_comment_count DESC, cr.like_count DESC, cr.created_at DESC
LIMIT 3;
```

*   **Index use:** The last 7 days of comments form a narrow subset; it joins on the `canonical_resources` primary key (`id`); the `EXISTS` subquery uses the existing `link_shares_resource_history_idx (resource_id, created_at ASC)` index and keeps deleted or silent-only resources out of the feed's right rail (`< 0.8 ms`).

#### 5.3 Top Sharers This Week (Top 5 Active Members in the Last 7 Days)

```sql
SELECT
  u.id,
  u.name,
  count(ls.id)::int AS share_count
FROM link_shares ls
INNER JOIN users u ON u.id = ls.author_id
WHERE ls.deleted_at IS NULL
  AND ls.is_feed_visible = true
  AND ls.created_at >= now() - interval '7 days'
  AND u.is_active = true
GROUP BY u.id, u.name
ORDER BY share_count DESC, u.name ASC
LIMIT 5;
```

*   **Index use:** The row range of the last 7 days is scanned through the existing partial index `link_shares_feed_cursor_idx (is_feed_visible, created_at DESC, id DESC) WHERE deleted_at IS NULL` and joined with the `users` primary key (`< 0.4 ms`).

#### 5.4 Caching and Performance Decision

*   The three queries run in parallel with the feed page query through `Promise.all`, only in `src/routes/(app)/+page.server.ts`.
*   **No cache:** For a closed team of 10–15 people the three queries take `< 2 ms` in total, so there is no in-memory TTL cache or invalidation mechanism. Every request returns current data, and the risk of stale data from a missed invalidation point disappears.
*   When a list comes back empty (for example, no comments in the last 7 days), the card shows a clean empty state ("No discussions in the last 7 days").

--------------------------------------------------------------------------------

### 6. Card Anatomy and Content-Aware Link Attachments

The `PostCard` root element (`<article class="share-card" id="share-{id}" tabindex="-1">`) and the accessibility hooks of [izgah-ui-v2.md](./izgah-ui-v2.md) §12 are kept. Posts are calm cards on `surface-1` with `14px` corners and a `1px` border.

*   **Link attachment variants (`LinkAttachment.svelte`):**
    1.  **Media card with a cover image (only when `thumbnailAssetKey` exists and the image has loaded):**
        *   `video`: A full-width rounded `1200/630` cover on top with a play icon badge in the bottom right; below it the mono domain/type, the serif `h3` title and a two-line description.
        *   `article` / `web` (with an image): When the container is `≥ 480px`, the serif `h3` title, mono meta and a two-line description on the left and a `186px` `1200/630` cover on the right (full width on top in narrow containers).
    2.  **Repository card without an image (`contentType === 'repo'` and no image):** A mono `owner/repo` title with a git icon, a two-line description below it, and a coloured language dot plus a mono star count (`★ 19.8k`) on the right or below.
    3.  **Social / quote card without an image (`contentType === 'social'` and no image):** An author/source line on top and a plain text summary; no empty cover column is reserved.
    4.  **Compact web / article card without an image (other links without images or with failed previews):** A single-line compact strip: a two-letter domain badge (`domain-badge`) on the left, the serif `h3` title with the mono domain/type in the middle and an external-link icon on the right. A half-finished or empty grey box is never shown.
*   **Action bar (`PostActions.svelte`):** On the left a plain numeric like button (`aria-label="{count} likes — {title}"` is kept; the visible text is just `{count}`), a comment counter link, and copy and open-in-new-tab icons with tooltips; on the right the "First shared by" or multiple-share context and an `AvatarStack` when there is one.

--------------------------------------------------------------------------------

### 7. Component Inventory and New Modern Components

#### 7.1 State Matrix of Base and Existing Components

| Component / class | File | States |
| :--- | :--- | :--- |
| `.btn` (`primary`, `subtle`, `ghost`, `outline`, `danger`, `danger-soft`, `icon`) | `src/lib/styles/components.css` | `default`, `hover`, `active` (`scale: 0.98`), `focus-visible`, `disabled`/`aria-disabled`, `loading` (`aria-busy`), `forced-colors` |
| `.field`, `.input`, `.textarea`, `.select` | `src/lib/styles/components.css` | `default`, `hover`, `focus-visible`, `invalid` (`:user-invalid`), `disabled`, `readonly` |
| `.tag`, `.badge`, `.status-pill`, `.kbd` | `src/lib/styles/components.css` | `default`, `hover` (when a link), `accent`, `active`/`pending`/`passive`, `forced-colors` |
| `Icon` (~32 Lucide line paths, `1.5px`, copied without a package, ISC) | `src/lib/components/ui/Icon.svelte`, `icons.ts` | `default`, `filled` (active heart), `size` (`14/16/18/20`) |
| `Avatar` | `src/lib/components/ui/Avatar.svelte` | `default` (four soft neutral tones chosen deterministically from the author name), `self` (soft accent tone), `size` (`22/26/30/34`), `aria-hidden` |
| `Dialog`, `PopoverPanel` | `src/lib/components/ui/` | `closed`, `open` (`@starting-style`), `focus-trap`, `dirty-guard`; the WebKit popover position fix is kept |
| `SiteHeader`, `BottomTabBar`, `TopContextBar` | `src/lib/components/shell/` | `default`, `hover`, `aria-current="page"`, `icon-rail` (`768–1023px`), `mobile` (`< 768px`); the bottom bar hides while the keyboard is open |
| `FeedView`, `PostCard`, `LinkAttachment`, `PostActions`, `FeedContextRail` | `src/lib/components/feed/` | `default`, `unseen`, `hover`, `focus-visible` (`j`/`k`), `loading` (skeleton / load more), `empty` (filtered / empty archive), `error` |
| `ShareComposerDialog` (`feed` & `dialog`) | `src/lib/components/feed/ShareComposerDialog.svelte` | `collapsed`, `expanded`, `checking-duplicate`, `duplicate-found`, `submitting`, `field-error`, `no-js` |
| `NotificationBell` | `src/lib/components/notifications/NotificationBell.svelte` | `idle`, `unread-badge`, `open`, `loading`, `empty`, `error` |

#### 7.2 New Modern Components — Reasons, States and Behaviour Without JavaScript

| Component | File | Why it is needed | States | Without JavaScript |
| :--- | :--- | :--- | :--- | :--- |
| **`⌘K` command palette** (`CommandPalette`) | `src/lib/components/shell/CommandPalette.svelte` + `src/routes/api/internal/search/quick/+server.ts` | Reduces the promise "find it in the archive in seconds" to one shortcut (`⌘K` / `Ctrl+K`); offers scope tabs (`All`, `Links`, `Sections`, `Actions`), live matches and keyboard navigation (`↑↓ ↵ Esc`). | `closed`, `open`, `idle` (sections + actions), `searching` (skeleton), `results` (highlighted with `<mark>`), `empty` ("Clear search"), `error` | The left rail has a `<search aria-label="Site search">` form (`GET /search`); before hydration the `⌘K` trigger works as a link to `/search`. |
| **Side peek** (`SidePeekDialog`) | `src/lib/components/feed/SidePeekDialog.svelte` | Lets a member inspect a resource's preview, share history and comments in a drawer from the right (`480px`) without losing the scroll position in the feed. | `closed`, `loading` (skeleton), `ready` (preview + history + comments + "Open full page ↗"), `error` (direct link fallback) | The "Preview" item on the card is a real `<a href="/resources/{id}">` link; without JavaScript it opens the resource page directly. |
| **Toast** (`Toaster`, renewed) | `src/lib/components/ui/Toaster.svelte` | A live-region notice that does not shift the layout, with tones (`neutral`, `success`, `error`) and an optional action ("Show"), for copying, sharing, like errors and saved settings. | `hidden`, `entering`, `visible`, `dismissed`; one `role="status"` plus `role="alert"` for errors | After server actions, in-page `<p role="status">` / `<div role="alert">` banners appear; `Toaster` stays a harmless empty live region. |
| **Tooltip** (`Tooltip`) | `src/lib/components/ui/Tooltip.svelte` | Explains visually what icon buttons (copy, open in a new tab, preview) and shortcut hints do. Visible on desktop (`hover: hover`), off under `pointer: coarse`. | `hidden`, `visible` (`:hover` / `:focus-visible`, closes with `Esc`; progressive `popover="hint"` in supporting browsers) | Works with plain CSS `:hover` / `:focus-visible`; screen readers always read the trigger's `aria-label`. |
| **Skeleton** (`Skeleton` / `.skeleton`) | `src/lib/components/ui/Skeleton.svelte` | Prevents layout shift (CLS) while a preview is processed (`unfurlStatus: queued/running`) and while the side peek and `⌘K` load. | `pulsing` (soft opacity `0.55 ↔ 0.85`, no gradient), `static` (under `prefers-reduced-motion` and in high contrast) | During SSR it is drawn as a still placeholder only on cards whose `unfurlStatus` is pending. |
| **Avatar stack** (`AvatarStack`) | `src/lib/components/ui/AvatarStack.svelte` | Shows the members who shared or discussed the same resource as compact overlapping monograms (with a `+N` overflow badge). | `default`, `overflow` (`+N`) | Plain HTML/CSS; needs no JavaScript and comes with a text summary for screen readers. |
| **Segmented control** (`SegmentedControl` / `.segmented`) | `src/lib/components/ui/SegmentedControl.svelte` | A single-row tactile picker for the content type filter, the colour mode (`System / Light / Dark`) and the search scope. | `default`, `hover`, `active`/`checked`, `focus-visible`, `disabled` | The navigation variant is a group of `<a href>` links, the form variant a group of native `<input type="radio">` + `<label>`; both work fully without JavaScript. |

#### 7.3 `GET /api/internal/search/quick` and the `searchResources` Logging Rule

*   The `searchResources` function in [`src/lib/server/search/service.ts`](../../src/lib/server/search/service.ts) gets a **`recordLog?: boolean`** option that defaults to `true` (with `recordLog: false` no row is written to `search_logs`).
*   The `GET /api/internal/search/quick` endpoint calls `searchResources({ ..., limit: 6, recordLog: false })` behind the cookie session and the `Origin`/`Sec-Fetch-Site: same-origin` guard (the same as `GET /api/internal/feed/updates`) and responds with `Cache-Control: no-store`.
*   So keystrokes in `⌘K` (debounced by 200 ms) do not pollute the `search_logs` metrics; when the member presses Enter in `⌘K` to go to the full search page (`/search?q=...`), the existing `recordLog: true` behaviour applies unchanged.

--------------------------------------------------------------------------------

### 8. Motion Rules

| Token / interaction | Duration | Easing | Animation | `prefers-reduced-motion: reduce` |
| :--- | :--- | :--- | :--- | :--- |
| `--dur-fast` (hover, colour, border) | `120ms` | `cubic-bezier(0.2, 0, 0, 1)` | `background-color`, `border-color`, `color`, `opacity` | `0ms` |
| `--dur-base` (dialog, `⌘K`, popover) | `180ms` | `cubic-bezier(0.2, 0, 0, 1)` | `@starting-style` opacity + `scale(0.98)` | `0ms`, no `scale` |
| `--dur-panel` (`SidePeekDialog` drawer) | `220ms` | `cubic-bezier(0.2, 0, 0, 1)` | `translateX(16px → 0)` from the right + opacity | `0ms`, no slide |
| Button press (`:active`) | `90ms` | `cubic-bezier(0.2, 0, 0, 1)` | `scale: 0.98` | Off |
| Like heart (`aria-pressed="true"`) | `280ms` | `ease-out` | A light `1 → 1.2 → 1` pulse | Off |
| Skeleton loader | `1400ms` | `ease-in-out` | Only `opacity: 0.55 ↔ 0.85` (no gradient) | A still block |
| Card ↔ detail View Transition | `180ms` | `cubic-bezier(0.2, 0, 0, 1)` | Progressive `startViewTransition` | Disabled entirely |

*   There is **no** card lift (`translateY`) or bounce on hover (it avoids visual jitter in a dense feed).

--------------------------------------------------------------------------------

### 9. Screen-by-Screen Redesign Summary

*   **Feed (`/`):** Three columns (full-height left rail + `48px` top context bar + feed column + right context rail), a `SegmentedControl` content type filter, an inline share card with the member's avatar, serif italic day dividers, content-aware cards and a `SidePeekDialog` "Preview" link.
*   **Section feed (`/sections/[slug]`):** Left rail + `48px` top context bar + a single reading column (no right context rail), with the same content type filter, inline sharing and card system.
*   **Resource details (`/resources/[id]`):** A wide cover, a serif `h1` title and a calm action strip (teal primary "Open link", like, copy, `AvatarStack`), a clean comment thread below and, on the right, a share history timeline with a vertical rule and section chips.
*   **Settings (`/settings`, `/settings/api-keys`):** Hairline rows (label and description on the left, control on the right); a `System / Light / Dark` segmented control; realistic mini interface preview cards (2 light + 3 dark palettes); four accent colour pills (`Forest Teal`, `Cobalt`, `Terracotta`, `Plum`); the single-key shortcuts switch.
*   **Admin (`/admin/*`):** Plain underlined admin tabs (no neon blocks); a strip of three tabular KPIs on top (on `Members` and `Metrics`); simplified table rows (pills with status dots, a compact role picker, `btn-ghost` + `btn-danger-soft` row actions); every existing no-JS confirmation fallback is kept.
*   **Sign-in, invite, password reset (`/login`, `/auth/*`) and error pages:** A warm dark graphite colophon panel on the left (serif heading and a sample team card preview) and an alabaster or graphite form card; the Turkish 404 and error pages in the same Izgah Studio language.
*   **Browser extension (`extensions/src/**`):**
    *   Popup (`420px` wide): A serif `Izgah` wordmark and a settings icon on top (**no "Save / Recent" tab**; the existing popup/options behaviour and `/api/v1/*` flow stay as they are); a warm preview box for the captured page (domain + type + title); the note field with a character counter; rounded section chips; a content type picker; the row "Don't post to the feed (add silently to the selected sections only)", **visible only when `user.role === 'admin'`**; a full-width teal primary "Share" button.
    *   `extensions/src/styles/tokens.css`: Aligned with the Izgah Studio light and dark (`prefers-color-scheme`) tokens and the `Geist Variable` + `Newsreader Variable` (`latin` + `latin-ext`) fonts; `OFL.txt` is updated.

--------------------------------------------------------------------------------

### 10. Preserved Fixed E2E Hooks and Change Policy

All fixed CSS/DOM hooks of [izgah-ui-v2.md](./izgah-ui-v2.md) §12 (`article.share-card`, `#share-composer-dialog`, `#main-content h1`, `#notification-bell-popover`, `.notification-badge`, `.inline-card-panel`, `.conflict-box`, `.comment-list`, `#delete-comment-dialog`, `.search-summary`, `#new-api-key-value`) and accessible names (`"Link Paylaş"`, `"Ana gezinme"`, `"Paylaşım işlemleri"`, `"Daha fazla yükle"`, `"İçerik türü süzgeci"`, `"Site içi arama"`, `"İzgah içinde ara"`, `"Bildirimler"`, `"Yönetim"`, `"Ana Akış"`) **are kept**. These names are the Turkish-locale contract; see the i18n note at the end of this document.

*   **Tests updated on purpose:**
    *   `tests/unit/tokens-contrast.test.ts`: Adapted to the new structure of 5 palettes (`default`/`contrast` light, `default`/`dim`/`contrast` dark) × 4 bipolar accents (`teal`/`cobalt`/`terracotta`/`plum`) and the rule that every accent reaches `≥ 4.5:1` in both light and dark.
    *   `tests/integration/m10-ui-v2.test.ts` and `tests/e2e/m12-ui-v2-shell.spec.ts` / `m15-a11y-tour.spec.ts`: The old accent names (`lime`/`cyan`/`pink`/`blue` → `teal`/`cobalt`/`terracotta`/`plum`) and the font preload pattern (`schibsted-grotesk` → `geist` + `newsreader`) are updated in the same commit.

--------------------------------------------------------------------------------

### 11. Implementation Plan (File Ownership)

Before any front-end component, form, animation or accessibility work, each area runs `npx modern-web-guidance@latest search "<need>"`, retrieves the matching guide and follows it.

| Area | Responsibility | File ownership | Order / dependency |
| :--- | :--- | :--- | :--- |
| **A1** | Design system, fonts and base UI | `package.json`, `pnpm-lock.yaml`, `src/routes/+layout.svelte`, `src/lib/types/appearance.ts`, `src/lib/server/http/theme.ts`, `src/lib/styles/**`, `src/lib/components/ui/**` (`Tooltip`, `Skeleton`, `AvatarStack`, `SegmentedControl`, `Avatar`, `Icon`, `Toaster`, `Dialog`, `PopoverPanel`) | **Runs first** and commits |
| **A2** | Feed, right context rail and side peek | `src/lib/server/feed/rail-summary.ts`, `src/routes/(app)/+page.server.ts`, `src/lib/components/feed/**` (`FeedView`, `PostCard`, `LinkAttachment`, `PostActions`, `ShareComposerDialog`, `FeedFilterBar`, `NewPostsPill`, `FeedContextRail`, `SidePeekDialog`) | After A1 |
| **A3** | Shell, top bar and `⌘K` | `src/routes/(app)/+layout.svelte`, `src/lib/components/shell/**`, `src/lib/components/notifications/**`, `src/lib/server/search/service.ts` (`recordLog`), `src/routes/api/internal/search/quick/+server.ts`, `CommandPalette.svelte` | After A1 |
| **A4** | Content screens | `src/routes/(app)/{resources,search,sections,settings}/**`, `src/lib/components/resource/**` | After A1 |
| **A5** | Admin | `src/routes/(app)/admin/**` | After A1 |
| **A6** | Sign-in, errors and extension | `src/routes/{login,auth}/**`, `src/lib/components/auth/**`, `src/routes/+error.svelte`, `src/routes/(app)/+error.svelte`, `src/lib/components/ErrorContent.svelte`, `extensions/**` | After A1 |
| **A7** | Tests and verification | `tests/unit/tokens-contrast.test.ts`, integration and unit tests for `rail-summary` and `quick-search` (including that it writes nothing to `search_logs`), E2E adaptations + `m15` with `@axe-core/playwright` (`color-contrast`) | After A1–A6 |

--------------------------------------------------------------------------------

## Alternatives Considered

### Alternative A: A Pure Dark Tool Line (Sans Only + Obsidian)
It offers high technical precision, but sans-serif-only headings and cold obsidian and platinum tones stay too sterile for long Turkish team notes and articles. Its shell, settings, admin and `⌘K` layer were taken and balanced with editorial reading and social feed elements.

### Alternative B: A Pure Editorial Library Line (Single Column)
Reading is very calm, but a single-column structure slows down dense admin and settings work and the flow of a fast team feed. Its heading typography and warm neutral surfaces were taken and combined with the three-column feed.

### Alternative C: A 30-Second In-Memory TTL Cache for the Right Rail
It would skip three short queries on repeated feed requests, but a forgotten invalidation at any write point (sharing, commenting, deleting, deactivating a member) would risk stale data. For a team of 10–15 people the queries total `< 2 ms`, so the cache was rejected.

### Alternative D: A "Save / Recent" Tab in the Extension
It would need a new read endpoint in the existing `/api/v1/*` contract and a change in extension behaviour. Left out of scope.

--------------------------------------------------------------------------------

## Risks & Mitigations

| Risk | Impact | Mitigation |
| :--- | :--- | :--- |
| The `.woff2` files of the new Fontsource packages (`newsreader`, `geist`) clash with the CSP `font-src 'self'`, or a preload is missed | FOUT / CSP violation | `vite.config.ts` `assetsInlineLimit` never inlines `.woff2`; the `theme.ts` preload pattern is checked by a unit test and the `pnpm test:docker` CSP smoke test. |
| Members with an old `izgah_accent=lime` cookie move to v3 | Invalid accent attribute | `pickAllowed(ACCENT_VALUES, raw, 'teal')` silently drops old values outside the allow-list to `teal`. |
| `⌘K` live search inflates the `search_logs` metrics | Wrong search and zero-result rates | `searchResources` is called with `recordLog: false`; an integration test checks that `GET /api/internal/search/quick` adds no row to `search_logs`. |
| `SidePeekDialog` or `⌘K` breaks focus management or the `j`/`k` shortcuts | Keyboard accessibility regression | Both use the native `<dialog>` (`showModal()`); the `overlayOpen()` check in `+layout.svelte` pauses single-key shortcuts while a `dialog:modal` is open. |
| `resource_comments` has no index on `created_at` alone | Scan time in a very large archive | `< 0.5 ms` for a team of 10–15 people; at a growth threshold, one backward-compatible partial index migration speeds it up. |
| The extension package grows with two fonts | A large `.zip`/`.xpi` | The extension packages only the `latin` + `latin-ext` `wght-normal` (`geist`) and `opsz-normal` (`newsreader`) files; checked by `pnpm verify:manifests`. |

--------------------------------------------------------------------------------

## Verification Plan

*   **Unit tests (`pnpm test`):**
    *   `tests/unit/tokens-contrast.test.ts`: All 20 combinations of 5 palettes × 4 accents (`4.5:1` text and accent text, `3:1` controls and focus, `7:1` AAA and `line ≥ 4.5:1` in high contrast, no shadows or glows in high contrast).
    *   `theme.ts` unit tests: the new `ACCENT_VALUES`, an old `lime` cookie falling back to `teal`, the new font preload pattern (`geist` + `newsreader`).
    *   New tests for `CommandPalette` filtering and shortcuts and the side peek helpers.
*   **Integration tests (`pnpm test` + PostgreSQL):**
    *   `GET /api/internal/search/quick`: session and origin checks (`401`/`403`), at most `6` results, and **no row added to `search_logs`** (the same query through `/search` with `recordLog: true` still adds one).
    *   `getFeedRailSummary`: the `APP_TIME_ZONE` day boundary, the ranking of comments in the last 7 days (silent and deleted excluded), the sharers of the last 7 days (inactive members excluded).
*   **Static checks:** `pnpm lint && pnpm check`.
*   **End to end (`pnpm test:e2e`):** All existing E2E scenarios (`m5`–`m15`, Chromium/Firefox/WebKit + mobile) plus `⌘K`, the side peek (a drawer with JavaScript, `/resources/[id]` without), persistence of the new themes and accents, and a scan with `@axe-core/playwright` **using only the `color-contrast` rule** in `m15-a11y-tour.spec.ts` (in the light, dark, dim and high-contrast palettes).
*   **Production image and CSP (`pnpm test:docker`):** Zero `securitypolicyviolation` events; the new fonts load from `'self'` on every route.
*   **Extension (`cd extensions`):** `pnpm lint && pnpm check && pnpm test && pnpm verify:manifests`.
*   **Visual quality gate:** Screenshots of every screen are taken with Playwright and compared one to one with the Direction D prototype.

--------------------------------------------------------------------------------

## Implementation Notes — 2026-11-25 Audit

The v3 implementation (`f39855e..7525156`) was audited against this document. The items below were fixed; the remaining differences are listed on purpose.

**Fixed**

*   **§1 / WCAG 1.4.11:** The left rail search box and the `⌘K` trigger are interactive controls, so they use a `--color-line-strong` border instead of `--color-line`.
*   **§2.2:** The serif heading in the drag-and-drop layer became sans (`--text-section`).
*   **§2.3:** Every font size below `12px` (`0.6875rem`, `0.71875rem`) was raised to the smallest step, `0.75rem`.
*   **§4:** The reading column is `680px` below `1280px`; settings screens use `--wide-w` (`1000px`).
*   **§4 top bar:** The breadcrumb became `<nav aria-label="Page location">` + `<ol>` (separators in CSS, `aria-current="page"`); the mapping for the non-existent `/admin/invites` was removed; the help button uses `Tooltip` instead of `title`; the `⌘K` hint shows `Ctrl+K` depending on the platform.
*   **§7.1 state matrix:** An `error` state for "Load more" in the feed (an inline error + "Try again"); an error toast when saving a theme or palette fails.
*   **§7.2 Toast:** Mouse hover and keyboard focus are tracked separately; a focused toast never closes by itself (WCAG 2.2.1).
*   **§9 extension:** The popup header has the serif `Izgah` wordmark and a settings button with an icon.
*   **Duplication:** `.banner`, `.kpi-strip`, `.page-header h1` / `.page-lead` are defined once in `components.css` instead of being copied page by page; `CONTENT_TYPE_LABELS` has one source; the unused `.btn-lg`, `.btn-quiet`, `.btn-danger-outline`, `.badge-count` and `signal-pop` were removed; the `select` arrow follows the theme.

**Deliberately left open**

*   **Notification summary in the §4 top bar:** The bell stays in the left rail. Moving it to the top bar would need two `NotificationBell` instances to share one client store (otherwise there would be double polling and diverging read state); it will be a separate task.
*   **One `SegmentedControl`:** `ThemeForm` and the search scope still use their own markup (their no-JS form and link behaviours differ); the visual sizes were aligned, merging the components is a separate task.
*   **Admin table, empty state and dialog title styles:** Still per page; moving them to shared classes is planned.
*   **Spacing grid:** Values outside the `4px` grid in components (`5px`, `6px`, `9px` and so on) will move to the `--space-*` tokens step by step.

> **2026-11-25 — i18n:** The interface is now English-first with a full Turkish translation ([izgah-i18n-oss.md](./izgah-i18n-oss.md)). The fixed accessible names in §10 are the contract of the Turkish locale (`DEFAULT_LOCALE=tr`); the E2E tests run with that setting, and the English equivalents are in `src/lib/i18n/messages/en.ts`.
