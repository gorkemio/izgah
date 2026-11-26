# Izgah UI v5 — "Fener"

*   **Author:** Gorkem Inanc Ozdemir
*   **Status:** Approved (2026-11-27, milestone M0). Replaces the visual language of [izgah-ui-v4.md](./izgah-ui-v4.md) and the JavaScript policy of earlier documents (§13). The theme and fonts are chosen in the M1 theme lab (§16).
*   **Date:** 2026-11-27

--------------------------------------------------------------------------------

## Overview

A *fener* is a lantern or a lighthouse. v5 gives Izgah a premium, elegant interface: a calm neutral base in dark and light, one warm accent, solid surfaces with hairline borders, icons, faces, site icons and considered motion. It is built on Tailwind CSS v4, shadcn-svelte and Bits UI, with themes and interactions adapted from the 21st.dev catalogue.

v5 keeps what works underneath: server rendering and SvelteKit form actions, the single token source and its generated palettes, the theme cookies, the enforced CSP, self-hosted fonts, English and Turkish parity, the accessibility targets and the stable E2E hooks.

## The problem

v4 ("Künye", approved 2026-11-26) removed icons, avatars, shadows, rounded corners and motion to avoid the look of generated interfaces. The team that uses Izgah every day read the result as unfinished: "amateurish". A walkthrough of the running app (feed, resource page, share form, search, dark mode, mobile) shows why:

*   **Nothing anchors the eye.** Every entry is the same block of text: no faces, no site icons, no type glyphs, and thumbnails only where a preview has one.
*   **Controls look like browser defaults.** Native checkboxes and selects in the share form; link-blue underlined titles everywhere.
*   **Wide screens are half empty.** A 224 px rail and a 720 px register leave the right half blank until an entry is opened.
*   **Nothing responds.** A like, a new share or a finished preview changes the page without any sign.
*   **Craft slips.** An empty icon slot pushes the search text to the right (`src/routes/(app)/search/+page.svelte:157`), the scope picker reads "All of Izgah In section", the rail placeholder reads "Search.", and `/admin` answers 404.

Screen-by-screen feedback from the team is collected during the review of this document and recorded in §17.

## Decisions (2026-11-27)

| Topic | Decision |
| :--- | :--- |
| Visual direction | Premium and elegant, without decorative gradients (§3.0), in dark and light; an effect level setting (§7). The 21st.dev-styled and the gradient-led labs were rejected as generic (§16). |
| JavaScript | Required. Pages still render on the server and every change still goes through a SvelteKit form action, but the separate no-JavaScript fallbacks are removed (§8). |
| Toolkit | Tailwind CSS v4, shadcn-svelte components copied into the repository on top of Bits UI, `@lucide/svelte` icons and Svelte's own motion APIs (§1). |
| 21st.dev | A source of themes and interactions, rewritten in Svelte; never imported as React (§9). |
| New data | A site icon per domain and member profile photos (§10). |
| Scope | The web app, the browser extensions (§11) and izgah.com (§12). |
| Theme and fonts | Chosen by the maintainer in the theme lab (milestone M1) and recorded in §16. |

## Principles

1.  **Make it feel alive.** The team opens Izgah every day; colour, depth and motion are part of the product, not decoration to minimise.
2.  **Content stays on top.** Effects frame notes, titles and images and never compete with them. Text never sits directly on a gradient, glow or image without a solid layer underneath.
3.  **Colour for meaning, not decoration:** one accent for the active item, the selected entry, focus, counts, likes and the mark. No decorative gradients.
4.  **Depth with restraint.** Five elevation levels; glass only on persistent chrome, on at most four surfaces.
5.  **Recognise before reading.** Avatars, site icons, content-type glyphs, thumbnails, and controls with an icon and a label. An icon is never the only carrier of meaning.
6.  **Motion explains change.** Every animation answers "what just happened?": added, removed, moved, liked, loading, done.
7.  **Effects are adjustable.** "Full" and "Reduced" levels; reduced applies by itself under reduced motion, reduced transparency, high contrast and forced colours.
8.  **The server is the source of truth.** Server rendering, form actions and server validation stay; the client adds optimistic feedback on top.
9.  **Accessible by default.** WCAG 2.2 AA (text at 7:1 in the high contrast palettes), full keyboard use, visible focus, stable E2E hooks and accessible names.
10. **Own the look.** The 21st.dev catalogue supplies parts, not an identity. The warm Lantern accent, Geist and the trail line keep Izgah recognisable.

## 1. Toolkit

### 1.1 Styling: Tailwind CSS v4

*   `@tailwindcss/vite` runs before `sveltekit()` in [`vite.config.ts`](../../vite.config.ts). There is no `tailwind.config.*`; configuration lives in CSS.
*   [`src/app.css`](../../src/app.css) keeps explicit cascade layers and imports Tailwind's parts into them, so Preflight replaces today's reset and utilities win over component classes. The exact import set is confirmed by the compatibility check in M1:

```css
@layer reset, theme, tokens, base, components, utilities;

@import 'tailwindcss/theme.css' layer(theme);
@import 'tailwindcss/preflight.css' layer(reset);
@import 'tailwindcss/utilities.css' layer(utilities);
@import 'tw-animate-css';

@import './lib/styles/palette.css'; /* generated by pnpm tokens */
@import './lib/styles/tokens.css'; /* light-dark() resolution, non-colour tokens */
@import './lib/styles/theme.css'; /* @theme inline mapping, variants, effect utilities */
@import './lib/styles/base.css';
```

*   Svelte `<style>` blocks are unlayered and beat every utility class. A screen moved to v5 therefore loses its scoped styles for every property that utilities now set. Scoped CSS remains only for what utilities cannot express well: complex selectors, keyframes and `view-transition-name`.
*   Class lists are sorted by `prettier-plugin-tailwindcss`. Conditional classes go through `cn()` in `src/lib/utils.ts` (re-exporting the `cn` package, as shadcn-svelte expects); variants use `tailwind-variants`.

### 1.2 Components: shadcn-svelte on Bits UI

*   Components are added with the shadcn-svelte CLI into `src/lib/components/ui/<name>/` and from then on are our code. Imports use `#lib/…` like the rest of the code base: `components.json` points the aliases there, and anything written as `$lib/` is rewritten.
*   First set: button, input, textarea, label, field, checkbox, switch, radio-group, select, combobox (command in a popover), command, dialog, alert-dialog, sheet, drawer, popover, dropdown-menu, tooltip, hover-card, tabs, toggle-group, badge, avatar, card, separator, skeleton, sonner, table, pagination, sidebar, scroll-area, kbd, empty, spinner.
*   Components use the v5 tokens only (§2): no raw colours, no ad-hoc radii.
*   Today's native wrappers (`src/lib/components/ui/Dialog.svelte`, `PopoverPanel.svelte`, `Toaster.svelte`, `Skeleton.svelte`) move to `src/lib/components/legacy/` in M1 and are deleted when their last user moves (M11).
*   The `toasts` API in [`src/lib/client/toast.svelte.ts`](../../src/lib/client/toast.svelte.ts) and its `Toaster` stay: they already pause on hover and focus and use separate polite and assertive live regions. Toasts take the v5 look through the migration bridge (§16) and are restyled with the screens; `svelte-sonner` is not used.

### 1.3 Icons

*   `@lucide/svelte` with one import per icon. Sizes 16 and 20 px, stroke width 1.75.
*   Decorative icons are `aria-hidden`. An icon-only button has an accessible name and a tooltip with the same text. Navigation items and primary actions show an icon and a label.

### 1.4 Motion

*   CSS transitions and `@starting-style` for the entry of popovers, menus and dialogs; `tw-animate-css` for the `data-state` animations that shadcn-svelte components expect.
*   `svelte/transition` (`fly`, `fade`, `scale`, `crossfade`), `svelte/animate` (`flip`) and `svelte/motion` (`Spring`, `Tween`) for lists, numbers and direct manipulation.
*   The View Transitions API for page-level changes (feed to resource, panel open and close, section switch), as `src/routes/(app)/+layout.svelte` already does.
*   `motion/mini` (about 2.5 KB) only if a spring or drag interaction cannot be built with the above, and only through a note in this document.
*   Presets live in `src/lib/motion/`: durations, easings, spring settings, transition wrappers and an `AnimatedNumber.svelte` built on `Tween`.

### 1.5 Not used

React or any React runtime, Framer Motion, WebGL shaders in the app, CSS-in-JS, fonts or images from third-party CDNs, `backdrop-filter` on list rows.

## 2. Tokens

### 2.1 One source

*   `tokens/kunye.json` is renamed `tokens/izgah.json` and keeps generating the three palettes (`src/lib/styles/palette.css`, `extensions/src/styles/palette.css`, `site/palette.css`) through `pnpm tokens` ([`scripts/tokens/build.ts`](../../scripts/tokens/build.ts)). `tests/unit/tokens-sync.test.ts` keeps failing on stale output.
*   The four palettes stay: light and dark, each standard and high contrast. Theme cookies and attributes are unchanged ([izgah-themes.md](./izgah-themes.md)).
*   Colours still resolve with `light-dark()`, so a utility such as `bg-card` follows the theme without a `dark:` variant. A `dark` custom variant (matching `data-theme="dark"`, or `prefers-color-scheme: dark` while the theme is `system`) exists for the few non-colour differences, such as shadows.

### 2.2 Roles

| Group | Roles |
| :--- | :--- |
| shadcn semantic | `background`, `foreground`, `card`, `card-foreground`, `popover`, `popover-foreground`, `primary`, `primary-foreground`, `secondary`, `secondary-foreground`, `muted`, `muted-foreground`, `accent`, `accent-foreground`, `destructive`, `destructive-foreground`, `border`, `input`, `ring`, `sidebar-*` |
| Brand | `brand-1`, `brand-2`, `brand-3` (gradient stops), `brand-foreground` (text on the gradient), `glow` |
| Content | `link`, `visited`, `highlight`, `highlight-foreground` |
| Status | `success`, `warning`, `info`, each with `-foreground` and `-soft` |
| Surfaces | `surface-raised`, `overlay`, `glass`, `glass-border`, `backdrop` |
| Faces | `avatar-1` … `avatar-8` (backgrounds for initials) |
| Non-colour | radius scale (§3.3), shadow scale per scheme (§3.4), durations, easings |

Today's `--color-*`, `--radius-*`, `--shadow-lg` and `--text-*` custom properties clash with Tailwind's theme namespaces: `--color-accent` is the brand blue today, while in shadcn-svelte `accent` is a hover surface. In M1 they are renamed to `--k-*` in one mechanical change; M11 deletes them.

### 2.3 Contrast tests

`tests/unit/tokens-contrast.test.ts` checks, in all four palettes:

*   `foreground` and `muted-foreground` on `background`, `card` and `popover`;
*   every `*-foreground` on its fill, and `brand-foreground` on each gradient stop;
*   `link` and `visited` on `background` and `card`;
*   each avatar tone with its initials colour;
*   `input` and `ring` (control boundaries and focus) and `primary` (filled controls) against `background` and `card`. `border` is decorative and has no minimum.

Thresholds: 4.5:1 for text, 3:1 for control boundaries and focus rings, 7:1 for text in the high contrast palettes. The "radius at most 3 px" check becomes "radius scale matches §3.3". The checks live in `tests/unit/tokens-v5-contrast.test.ts`; the Künye checks in `tests/unit/tokens-contrast.test.ts` stay until M11 removes the legacy variables.

Only the default theme ships in `src/lib/styles/palette.css`; the other candidates are generated into `src/lib/styles/palette-lab.css`, which only the theme lab loads.

## 3. Visual language

### 3.0 What "premium" means here

The first theme lab (three 21st.dev community themes with saturated gradients, glow on every control and lifted cards) read as generic, generated UI. The direction below comes from measuring Linear, Raycast, Vercel, Mercury and Stripe in the browser on 2026-11-27:

| Observed in the references | Rule for Izgah |
| :--- | :--- |
| Near-black (`#08090a`, `#07080a`) or off-white (`#fafafa`) pages; surfaces lifted with 2–8 % white, not new hues | One neutral system for every theme; only the accent changes |
| Borders as 6–12 % alpha of the foreground, often 0.5–1 px; shadows that are mostly a 1 px ring plus a short drop | `hairline` borders and ring-plus-drop elevation (§3.4) |
| One accent, slightly desaturated (indigo, warm amber) and used sparingly | Accent only for the active item, focus, likes, links, counts and the mark |
| Depth from surfaces a few steps apart, not from colour | Solid `background`, `card` and `popover` steps; no decorative gradients (images are the only gradients on screen) |
| Primary buttons in solid ink (white on dark, black on light) with a lit top edge | `bg-ink` + `tactile` for primary actions; the accent fill is secondary |
| Neo-grotesque type at weights 400–590 with negative tracking on large sizes (−0.022 em to −0.06 em) | Medium weights and tight tracking for display sizes (§3.2) |

Not used, because they read as generated: decorative gradients of any kind (backgrounds, borders, text, buttons), glow, shimmer, cards that jump on hover, uppercase micro-labels, emoji as icons.

### 3.1 Colour

*   **Dark first.** The default dark palette is the reference design; light is an equal.
*   **Neutrals (shared).** Dark: page `#09090b`, cards `#111114`, popovers `#16161a`, text `#f4f4f5` / `#9b9ca3`, hairlines `rgb(255 255 255 / 0.07)`. Light: page `#fbfbfc`, cards white, text `#17171a` / `#5f6168`, hairlines `rgb(0 0 0 / 0.07)`.
*   **Accent (per theme).** Lab candidates, with the choice recorded in §16:
    *   **Lantern:** warm amber `#f2b867` (dark) / `#9a5a0e` (light). The *fener* itself: a warm light in the dark.
    *   **Indigo night:** `#8e94f8`; the quiet register of Linear and Mercury.
    *   **Jade:** `#55d0a6`.
*   **Where colour goes:** the active rail indicator (a 2 px accent line), the focus `halo`, the selected entry's accent border, liked hearts, unread counts, links and the mark. Everything else is neutral. The `brand-*` roles stay in the tokens for izgah.com and illustrations but are not used in the app.
*   Link titles in the feed use `foreground`; the `:visited` reading trace stays as the `visited` colour.

### 3.2 Typography

*   **Geist** (OFL, self-hosted from Fontsource, latin and latin-ext for Turkish ğ, ş, ı, İ) for body and display, chosen in the theme lab over Inter and Instrument Serif + Inter (§16). The normal latin and latin-ext files are preloaded; italics load on demand.
*   Weights 400 (body), 500 (UI and names), 560 (display); no 700.
*   Tracking: −0.006 em on body text, −0.01 em on titles, −0.03 em to −0.04 em on display sizes.

| Token | Size / line height | Weight | Use |
| :--- | :--- | :--- | :--- |
| `display` | 2.5rem / 1.05 | 560 | Empty states, auth pages, izgah.com |
| `title` | 1.75rem / 1 | 560 | Page `h1` |
| `section` | 1.125rem / 1.3 | 560 | Card and dialog headings |
| `body` | 0.9375rem / 1.55 | 400 | Notes, comments, descriptions |
| `small` | 0.8125rem / 1.45 | 400–500 | Controls, facts line, hints |
| `meta` | 0.75rem / 1.3 | 400, tabular | Times and counts |

### 3.3 Shape

| Token | Value | Use |
| :--- | :--- | :--- |
| `radius-sm` | 6 px | Chips inside inputs, `kbd` |
| `radius-md` | 8 px | Buttons, inputs, menu items |
| `radius-lg` | 12 px | Cards, popovers, thumbnails |
| `radius-xl` | 16 px | Dialogs, sheets, the composer |
| `radius-full` | 9999 px | Avatars, pills, switches |

### 3.4 Elevation

| Level | Surface | Shadow | Use |
| :--- | :--- | :--- | :--- |
| 0 | `background` | none | The page |
| 1 | `card` | `sm` and a hairline border | Feed entries, panels |
| 2 | `surface-raised` | `md` | Hovered cards, sticky headers |
| 3 | `popover` or glass | `lg` | Menus, popovers, hover cards, the command palette |
| 4 | `popover` | `xl` over `backdrop` | Dialogs and sheets |

Every shadow is a 1 px ring (light alpha in dark, black alpha in light) plus a short, soft drop. High contrast drops shadows and uses 2 px borders.

### 3.5 Glass

*   Glass (`glass` fill, `backdrop-filter: blur(20px) saturate(150%)`, `glass-border`) appears on at most four persistent surfaces: the rail, the mobile top bar and tab bar, sticky page headers and the command palette.
*   Where `backdrop-filter` is unsupported, or effects are reduced, these surfaces use the opaque `surface-raised`.

### 3.6 Faces, icons and images

*   **Avatars:** the member's photo (§10.2), or initials on a tone chosen from the user id (`avatar-1` … `avatar-8`). Sizes 20, 24, 32, 40 and 64 px. Avatar stacks show at most three faces and "+N".
*   **Site icons:** 16 or 20 px rounded squares next to the domain in every link (§10.1); a letter tile on a neutral surface when there is none.
*   **Content type:** one Lucide glyph per type (video, repo, social, article, web) in filters, chips and the facts line.
*   **Thumbnails:** rich cards for `video` and `repo` (a wide image above the text, cropped from the stored 1200×630 asset); compact cards for the other types (a 16:10 image on the right). Every image has fixed dimensions, so nothing shifts while loading.

### 3.7 The signature trail

*   *İz* means trace. A thin solid accent line is the one recurring motif: the active rail item's indicator and the progress bar during navigation.
*   It is the only element allowed to animate continuously, and only while something is happening (navigation, upload, a pending preview).

## 4. Layout and shell

| Width | Layout |
| :--- | :--- |
| ≥ 1280 px | Glass rail (248 px, collapsible to a 72 px icon rail and remembered in a cookie) · feed column (at most 720 px) · reading pane (420 px), open by default on the first entry |
| 1024–1279 px | Rail and feed; details open in a sheet from the right |
| 768–1023 px | Icon rail and feed |
| < 768 px | Glass top bar (wordmark, search, notifications) · feed · glass bottom tab bar with a sliding indicator; the composer opens as a drawer |

*   **Rail:** wordmark, search trigger (`⌘K`), "Add a link" (the solid ink primary button), Feed, Notifications with a count, sections with a colour dot and their link count, All sections, Admin; the member's avatar menu at the bottom (profile, appearance, effect level, shortcuts, sign out).
*   **Command palette (`⌘K`):** shadcn-svelte Command on the existing `GET /api/internal/search/quick` contract, grouped into links (with site icons), sections, actions and recent searches.
*   **Notifications:** a popover (a sheet on mobile) with avatars, grouped by day, with "Mark all as read".
*   **Toasts:** svelte-sonner at the bottom right (above the tab bar on mobile), with an action button where one helps ("Undo", "Open").

## 5. Screens

### 5.1 Feed entry

```
[avatar] Priya Nair · 18:41 · AI tools                             [⋯]
Ran the new models on a laptop — surprisingly fast for long PDFs.
┌────────────────────────────────────────────────────────────────┐
│ [icon] github.com · repo · Go · ★ 154K              [thumbnail] │
│ ollama/ollama                                                   │
│ Get up and running with large language models locally.         │
└────────────────────────────────────────────────────────────────┘
[♥ 5]   [💬 2]   [↗ Open]   [⧉ Copy]
```

*   One card per share at elevation 1; on hover its hairline darkens; it does not move.
*   The note stays the most readable text. The link card holds the site icon, the facts line (the künye order from [`src/lib/format/kunye.ts`](../../src/lib/format/kunye.ts)), the title, a two-line description and the thumbnail.
*   Actions: like, comment, open and copy. The menu holds preview, edit and delete (author and admins) and section changes.
*   Entries newer than the last visit carry a small accent dot; the last-visit divider is a labelled piece of the trail.
*   The root keeps `article.share-card` and `id="share-{id}"`.

### 5.2 Day timeline

A sticky glass day header with the date and the number of links; a faint vertical trail joins the avatars of the day.

### 5.3 Composer

*   Collapsed at the top of the feed as a large field ("Paste a link or drop a chat message…") that expands in place with the accent focus halo. `n` or "Add a link" opens it as a dialog anywhere (a drawer on mobile); `?compose=1` stays as a deep link that opens it.
*   Fields: the URL (with a live site icon and the duplicate check), the note (with the `#section` hint), sections as a searchable multi-select combobox with chips, the content type as a toggle group with glyphs, and "Only add to sections" as a switch.
*   A duplicate shows the existing share as an inline card; smart-capture suggestions appear as chips with Add and Dismiss.

### 5.4 Filters and sorting

A toggle group of content-type chips with a sliding indicator, and "Most discussed" as a sort option in a dropdown.

### 5.5 Loading and empty states

Pulsing placeholders with the shape of a feed entry. Empty states use a large glyph on a muted tile, one sentence and one action; no illustrations.

### 5.6 Reading pane and resource page

*   Header: a large rounded thumbnail, the site icon, the title, facts as chips, and Open, Copy and Like.
*   The description, the labelled machine summary ([izgah-smart-capture.md](./izgah-smart-capture.md) §10), the share history as a timeline with avatars, and sections as chips.
*   Discussion: a comment thread with avatars; edit and delete from a menu, with an alert dialog for delete; a composer that sends with `⌘↵` and shows a character counter.
*   A shared-element View Transition carries the thumbnail and title from the feed card.

### 5.7 Search

A large field with an operator hint, scope tabs ("All of Izgah", "This section"), type chips, results as feed entries with `<mark>` highlights, and an empty state with suggestions. This fixes the empty icon slot and the scope labels.

### 5.8 Sections

The index is a grid of cards: name, description, link count, last activity and an avatar stack of recent sharers. A section page opens with a header card.

### 5.9 Settings

Tabs: Profile (photo and name), Appearance (theme, high contrast, effect level), Shortcuts, Password, and API keys (a table, a create dialog and a one-time reveal with copy).

### 5.10 Admin

One layout with tabs. Tables with row menus, confirmation dialogs, KPI cards, section ordering by drag handle (the keyboard move buttons stay), and a redirect from `/admin` to `/admin/users`.

### 5.11 Sign-in, invite and password reset

An aurora background with the wordmark and a glass card that holds the form; reduced effects show a plain surface.

### 5.12 Errors

404 and 500 pages with the wordmark, a short message, the request id with a copy button, and a way home.

## 6. Interactions and motion

| Moment | Motion | Duration | Reduced effects |
| :--- | :--- | :--- | :--- |
| Like | The heart springs and fills with the accent, the count rolls | 300–450 ms | Colour change and count update only |
| Own new share | Slides in from the composer (`in:fly`); other entries move with `animate:flip`; its border briefly takes the accent | 250 ms | Appears in place |
| New shares from others | The "N new links" pill drops in; on click the new entries are highlighted | 200 ms | The pill without motion |
| Pending preview | The title placeholder pulses; the finished card cross-fades in | 200 ms | No pulse, instant swap |
| Link hover card | Bits UI LinkPreview with thumbnail, title, description and facts; opens after 400 ms of hover or on focus | 150 ms | No animation |
| Delete | The card collapses; a toast offers Undo (§10.3) | 200 ms | Removed in place |
| `j` / `k` selection | The selection highlight slides between entries | 150 ms | Jumps |
| Feed to resource | Shared-element View Transition of thumbnail and title | 250 ms | None |
| Panels and sheets | Slide and fade | 200 ms | Instant |
| Tabs, toggle groups, tab bar | The indicator slides under the active item | 200 ms spring | Jumps |
| Counters and badges | Numbers roll (`Tween`) | 300 ms | Instant |
| Navigation | The trail runs across the top as a progress bar | While loading | A static bar |
| Copy | The icon turns into a check for 1.5 s | 150 ms | Icon swap |

## 7. Effect levels and performance

*   `<html data-effects="full | reduced">` is set by the server from the `izgah_effects` cookie (default `full`), with the same placeholder mechanism as the theme ([`src/app.html`](../../src/app.html), [`src/hooks.server.ts`](../../src/hooks.server.ts)) and the allow-list in [`src/lib/types/appearance.ts`](../../src/lib/types/appearance.ts). It is changed in Settings → Appearance and in the avatar menu.
*   Reduced effects apply automatically under `prefers-reduced-motion: reduce`, `prefers-reduced-transparency: reduce` (where supported), `prefers-contrast: more` and `forced-colors: active`, whatever the cookie says.
*   In reduced mode: no glass (opaque surfaces), no continuous animation; durations are 0 ms, except fades of at most 100 ms where a change would otherwise go unnoticed.
*   Performance rules: only `transform` and `opacity` animate; no `backdrop-filter` on list items; at most four glass surfaces; no WebGL in the app; `content-visibility: auto` stays on long lists; thumbnails, avatars and site icons have fixed dimensions.
*   Budgets: JavaScript for the feed route grows by at most 60 KB gzip over the baseline measured in M1; total CSS stays under 60 KB gzip.

## 8. JavaScript policy

*   JavaScript is required for the app. A `<noscript>` banner, translated and injected through an `app.html` placeholder, explains this.
*   Kept: server rendering of every page, SvelteKit form actions for every change (through `use:enhance`), server-side validation and error envelopes, `html[data-hydrated]` as the E2E readiness signal, and URL state for filters, search and pagination.
*   Removed: the inline no-JavaScript modes (`?edit=` and `?delete=` on entries, `?editComment=` and `?deleteComment=` on the resource page), the fallback branches guarded by `hydrated`, the admin no-JavaScript confirmation pages ([izgah-ui-v2.md](./izgah-ui-v2.md) F8) and other query-parameter fallbacks for dialogs. `?compose=1` stays as a deep link.
*   The eleven E2E scenarios that run with JavaScript off (in `m5`, `m9`, `m12`, `m16` and `m17`) are converted to scenarios with JavaScript on when they check server behaviour (language of server errors, redirects, validation), and removed when they only check a fallback interface.
*   The browser extensions are unaffected; they use `/api/v1`.

## 9. Using 21st.dev

### 9.1 Access

The 21st CLI (`npm i -g @21st-dev/cli`, then `21st login` by the maintainer) is used to search the catalogue and read component code; the 21st MCP server may be used the same way when it is connected. Nothing is installed from the catalogue into the app as-is.

### 9.2 Three uses

1.  **Themes.** 21st.dev's shadcn themes are CSS variables. Theme lab candidates come from there and are mapped onto the roles in §2.2 and the contrast tests in §2.3.
2.  **Interactions.** A component's behaviour is rewritten in Svelte 5 with Bits UI, our tokens and `svelte/motion`; its Tailwind classes may carry over.
3.  **izgah.com sections** (§12).

### 9.3 Gates for anything adapted

*   **License:** MIT, Apache-2.0 or ISC, credited in [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md). Without a clear licence the component is a visual reference only, and our code is written from scratch.
*   Keyboard and screen-reader behaviour (Bits UI primitives where they exist), a reduced-effects version, all four palettes, no hard-coded text, no external assets, and the budgets in §7.

### 9.4 Candidates

Seen in the catalogue; licences are checked when a component is adopted.

| 21st.dev reference | Where in Izgah |
| :--- | :--- |
| `link-preview` | Link hover card |
| `animated-tabs`, `expandable-tabs` | Type filter, settings tabs, mobile tab bar |
| `dot-loader` | Loading states (rewritten without gradients) |
| `toolbar` | Entry action bar |
| `sidebar`, `sidebar-news` | The rail and its notice card (for example "Install the extension") |
| `spotlight-card`, `shine-border` | Section cards and the focused composer |
| `theme-switcher-1` | Theme and effect level switch |
| Sign-in category, `aurora-background` | Sign-in pages and empty states |
| Hero, Features and Shaders categories | izgah.com only |

## 10. Server additions

### 10.1 Site icons

*   A new `site_icons` table: `domain` (primary key, the same value as `canonical_resources.domain`), `asset_key` (nullable, references `media_assets`), `status` (`ok`, `none` or `failed`), `source_url` and `fetched_at`.
*   The unfurl worker ([`src/lib/server/unfurl/worker.ts`](../../src/lib/server/unfurl/worker.ts)) refreshes a domain's icon after a successful unfurl, at most once every 30 days. Candidates, in order: `<link rel="apple-touch-icon">`; `<link rel="icon">` in PNG or WebP with the largest `sizes` up to 256; `/favicon.ico` when it embeds a PNG. The `<link>` tags come from the existing head parser in [`html-meta.ts`](../../src/lib/server/unfurl/adapters/html-meta.ts).
*   Downloads go through `safe-fetch.ts` (the same SSRF guards, redirect rules and timeouts) with a 256 KB limit. SVG icons are never fetched (they can carry scripts); ICO files that hold only BMP images are skipped.
*   Images become 64×64 WebP through `sharp` (a size option on the writer in [`storage.ts`](../../src/lib/server/media/storage.ts)), are stored content-addressed with reference counting (`upsertAndIncrementMediaAssetInTx`, `decrementMediaAssetRefInTx`) and are served by the existing authenticated route `/media/thumbnails/[assetKey]`.
*   Privacy: only the server contacts the site; viewers never load an icon from a third party.
*   Feed, search and resource queries join `site_icons` by domain; without an icon the interface shows a letter tile.

### 10.2 Profile photos

*   A new nullable `users.avatar_asset_key` column referencing `media_assets`. Better Auth's `image` column stays unused.
*   Actions in [`src/routes/(app)/settings/+page.server.ts`](../../src/routes/(app)/settings/+page.server.ts): `setAvatar` (multipart upload) and `removeAvatar`. Admins can remove a member's photo from `/admin/users`.
*   Validation: JPEG, PNG or WebP by magic bytes (`detectRasterFormat`), at most 5 MB and `MAX_INPUT_PIXELS`, centre-cropped to 256×256 WebP with EXIF removed, and the disk guards of `hasSufficientMediaDiskSpace`.
*   A new `checkAvatarUploadRateLimit(userId)` in [`rate-limit.ts`](../../src/lib/server/auth/rate-limit.ts) allows 10 changes per 15 minutes. Every change and removal is written to the audit log.
*   A replaced photo releases its reference; orphans are removed by the existing `cleanupOrphanMediaAssets`.

### 10.3 Undo delete

*   A `restoreLinkShare` service function and a `?/restoreShare` action: allowed for the author or an admin, only for shares deleted within the last 30 seconds, with the same row locking as `softDeleteLinkShare` in [`src/lib/server/links/service.ts`](../../src/lib/server/links/service.ts).
*   When the deleted share was the resource's last active one, `softDeleteLinkShare` has already detached the thumbnail. Restoring re-queues the resource's unfurl job; because assets are content-addressed, fetching the same image attaches the same asset again.

### 10.4 Tests

Integration tests follow the patterns of `tests/integration/m4-unfurl-worker-and-media.test.ts` and `m2-auth-and-api-keys.test.ts`; unit tests cover icon candidate selection, PNG extraction from ICO files and avatar validation.

## 11. Browser extensions

*   The popup and options pages get the v5 tokens (from the generated palette), rounded controls, the solid ink primary button and CSS-only motion. They stay plain TypeScript; Bits UI is not used there.
*   The store budget stays: zip at most 150 KB, JavaScript and CSS at most 30 KB gzip, enforced by `extensions/scripts/verify-manifests.mjs`. The display font is not bundled. The popup follows the system theme and contrast, as today.
*   Done when `pnpm lint`, `pnpm check`, `pnpm test` and `pnpm test:e2e` pass in `extensions/`.

## 12. izgah.com

*   Rebuilt in the v5 style without a build step: hand-written CSS on the generated `site/palette.css` and a small script. An aurora hero with the statement and a copyable install command, a live v5 product specimen, a bento grid of real features, how it runs (one container), "What it doesn't do", "What runs on your server, and what leaves it", and the roadmap, in English and Turkish.
*   The honesty rules of [izgah-ui-v4.md](./izgah-ui-v4.md) §6 stay: concrete facts only, no invented testimonials, logos or statistics.
*   Claims that Izgah works without JavaScript are removed here and in `README.md` and `README.tr.md`.

## 13. Relation to earlier documents

| Document | Replaced by v5 | Still binding |
| :--- | :--- | :--- |
| [izgah-ui-v4.md](./izgah-ui-v4.md) | Principles 1–8, tokens (§1), typography (§2), layout (§3), the register entry (§4), components (§7), the icon and avatar removals (§8, §11) | The wordmark text "iz" + "gah" (restyled), the Turkish wording "İz bırak" and "iz" (§5), the reading pane mechanics, the künye order as the facts line, the izgah.com honesty rules (§6) |
| [izgah-ui-v2.md](./izgah-ui-v2.md) | The no-JavaScript rules and fallbacks (§8, §13) | Self-hosted fonts (§2), the theme cookie (§9), the feed updates contract (§10), the CSP (§11), the E2E hooks (§12, amended by §14 here) |
| [izgah-ui-v3.md](./izgah-ui-v3.md) | — (already superseded) | The command palette behaviour and the quick search contract, restyled |
| [izgah-themes.md](./izgah-themes.md) | — | The `light-dark()` mechanism and the palette cookies, extended by the effects cookie (§7) |
| [izgah-core.md](./izgah-core.md) | The no-JavaScript requirement and the query-parameter fallbacks | Everything else |
| [izgah-roadmap.md](./izgah-roadmap.md) | Principle 5 and the "Remove or simplify" rows about avatars, cards, pills, shadows and the single type family | The product direction and phases; v5 is added as phase R3b |
| [SITEMAP.md](./SITEMAP.md) | The `?edit=`, `?delete=`, `?editComment=` and `?deleteComment=` modes (updated in M3 and M4) | The routes |

## 14. E2E contract

*   **Kept:** `article.share-card` with `id="share-{id}"`, `#share-composer-inline`, `#share-composer-dialog`, `#main-content h1`, `.comment-list`, `.search-summary`, `.notification-badge`, `#notification-bell-popover`, `#command-palette-dialog`, `#keyboard-help-dialog`, `#new-api-key-value`, `#issued-link-value`, `html[data-hydrated]`, and the Turkish accessible names in [izgah-ui-v2.md](./izgah-ui-v2.md) §12.
*   **Changed in the same commit as the markup:** `dialog:modal` and `dialog[open]` become `[role="dialog"]` (Bits UI dialogs are not `<dialog>` elements); `details.feed-filter > summary` becomes the type toggle group, which keeps the accessible name "İçerik türü süzgeci"; `a.card-menu-item` becomes `[role="menuitem"]`; `.link-attachment img.card-thumbnail` stays as class names on the new link card.
*   **Removed** with their fallbacks: the no-JavaScript scenarios listed in §8.
*   **New:** the effect level switch, avatar upload and removal, site icons, undo delete, the link hover card, and reduced effects (no `backdrop-filter`, no running animations).
*   The axe tour in `tests/e2e/m15-a11y-tour.spec.ts` runs in light, dark, high contrast and reduced effects.

## 15. Milestones

| # | Milestone | Exit |
| :--- | :--- | :--- |
| M0 | This document; `AGENTS.md`, `CONTRIBUTING.md` and the roadmap updated | Maintainer approval |
| M1 | Compatibility check, baseline sizes, Tailwind and tokens, shadcn-svelte first set, motion presets, effects cookie, `<noscript>`, demo seed data, the theme lab | Tests green; theme and fonts chosen and recorded in §16 |
| M2 | Shell: rail, mobile bars, command palette, notifications, toasts, keyboard help | Tests green |
| M3 | Feed and composer | Tests green |
| M4 | Reading pane, resource page, discussion | Tests green |
| M5 | Search and sections | Tests green |
| M6 | Settings, admin, sign-in and error pages | Tests green |
| M7 | Interactions and motion (§6) | Tests green, reduced effects verified |
| M8 | Site icons, profile photos, undo delete (§10) | Integration tests green |
| M9 | Browser extensions (§11) | Extension tests and size budget green |
| M10 | izgah.com and README claims (§12) | Reviewed in both languages |
| M11 | Remove legacy styles and wrappers, update `ARCHITECTURE.md` and `THIRD_PARTY_NOTICES.md`, full verification, size report, screenshot gallery | Everything below passes |

Work happens on the `feat/ui-v5` branch; `main` receives v5 in one step after M11, so the team never sees a half-migrated interface. M8 (`src/lib/server/`, `drizzle/`), M9 (`extensions/`) and M10 (`site/`) touch separate folders and can run in parallel sessions once their prerequisites are met (M0 for M8, the theme choice in M1 for M9 and M10).

## 16. Decision log

*   **2026-11-27 (maintainer):** the bold 21st.dev direction; JavaScript required; Tailwind CSS v4, shadcn-svelte and Bits UI; site icons, profile photos, the browser extensions and izgah.com in scope.
*   **2026-11-27 (M1 compatibility check):** Tailwind CSS 4.3.5, shadcn-svelte 1.8.2 (CLI) and Bits UI 2.22 work with SvelteKit 3.4, Vite 8 and the `#lib` alias; `pnpm check`, `pnpm test`, `pnpm test:e2e` and `pnpm test:docker` (CSP) pass. adapter-node bundles `devDependencies`, so the UI libraries stay there. Plain `tsc` cannot read named exports from `.svelte` modules, so `tsconfig.tsc.json` leaves `src/lib/components/ui/` to svelte-check. `runed` (a Bits UI dependency) declares an optional peer of Kit 2; watched in M2.
*   **Baseline before v5 (production build, gzip):** feed route JavaScript 117.2 KB and CSS 16.3 KB; all client JavaScript 176.0 KB and CSS 33.8 KB. The §7 budgets are measured against these numbers.
*   **Theme lab candidates:** starting points from the 21st.dev community themes "Violet Dusk" (Aurora), "Cyber Cyan" (Lagoon) and "Sunset Horizon" (Ember), all by serafimcloud, extended with the brand gradient, glass and glow roles and run through §2.3.
*   **2026-11-27 (maintainer feedback on the first lab):** the 21st.dev-based candidates read as generated ("AI slop"); the maintainer asked for a premium, elegant look that still uses gradients. After measuring Linear, Raycast, Vercel, Mercury and Stripe, the themes were replaced by one neutral system with three accents (Lantern, Indigo night, Jade), hairline borders, ring-plus-drop shadows, ink primary buttons and gradients used as tonal depth, one lantern light and a mesh field (§3.0, §3.1). Font candidates became Geist, Inter and Instrument Serif + Inter; Bricolage Grotesque was dropped.
*   **2026-11-27 (M1 groundwork):** the shadcn-svelte first set is in `src/lib/components/ui/`, the Künye wrappers moved to `src/lib/components/legacy/`, motion presets live in `src/lib/motion/`, the `izgah_effects` cookie and the Settings switch work, `/admin` redirects to `/admin/users`, a `<noscript>` banner explains the JavaScript requirement, `pnpm seed:demo` writes realistic local data, and the theme lab runs at `/dev/theme-lab` (development only). Lucide no longer ships brand icons, so content types use generic glyphs (§3.6).
*   **2026-11-27 (M1 theme lab, maintainer):** **Lantern** (warm amber `#f2b867` dark / `#9a5a0e` light, amber → apricot → rose) on the shared neutral system, set in **Geist** for both body and display. Indigo night and Jade stay in the lab file only. Geist replaces Atkinson Hyperlegible Next in the app at once (the extension and izgah.com follow in M9 and M10); the plain-zero Atkinson build is no longer needed by the app and goes in M11.
*   **2026-11-27 (maintainer, after the second lab):** gradients still read as generated; keep the new direction but with minimal or no gradients, in dark and light. The `lantern`, `mesh`, `sheen`, `bg-brand`, `text-brand`, `ring-brand` and `shimmer` utilities were removed; the primary button is solid ink, the selected entry has a solid accent border, loading uses a solid accent bar and pulsing placeholders.
*   **2026-11-27 (M2):** the rail, the mobile top bar, the tab bar, the account menu and the notification panel are rebuilt in Lantern with icons and labels (shadcn-svelte Popover for the menus). A migration bridge in `src/lib/styles/tokens.css` maps the Künye `--k-*` colours, radii and shadows to v5 roles, so screens that M3–M6 have not rebuilt yet keep their layout but share the Lantern palette; the bridge goes with the `--k-*` variables in M11. The Künye 3 px radius test was retired in favour of the v5 radius scale.

## 17. Open questions

*   Which screens and moments the team found amateurish, and which products they consider "premium" references.
*   Whether the body font stays Atkinson Hyperlegible Next.
*   Whether sections get a member-chosen colour or emoji (it needs a column; for now the dot colour is derived from the section id).

## Verification

*   Every milestone: `pnpm lint`, `pnpm check`, `pnpm test` and `pnpm test:e2e`; in addition `pnpm test:docker` whenever global styles, fonts, `vite.config.ts`, `src/app.html` or `src/hooks.server.ts` change (zero CSP violations against the production image).
*   E2E selectors change in the same commit as the markup (§14).
*   The axe tour is clean in light, dark, high contrast and reduced effects.
*   A manual pass in the browser on desktop, tablet and mobile, in light and dark, and with the keyboard only: feed, sharing, comments, search.
*   The budgets in §7, measured against the M1 baseline.

## Alternatives considered

*   **Polish Künye (craft and interaction only).** Cheaper and keeps v4's identity; not chosen because the team asked for a richer look.
*   **A Next.js and React rewrite to use 21st.dev components directly.** Months of work that would rewrite a server layer with nothing wrong in it; Svelte equivalents (shadcn-svelte, Bits UI, Svelte motion) cover the need.
*   **Tailwind without shadcn-svelte.** Every accessible widget would be hand-built.
*   **The stock shadcn look.** Fastest, but indistinguishable from many apps; the theme lab may still start from it.
*   **A bold interface that keeps the no-JavaScript fallbacks.** Doubles the work for every interaction; rejected by the maintainer.

## Risks

| Risk | Mitigation |
| :--- | :--- |
| v4 shipped a day earlier; a second large change follows within days | This document records the reasons; `main` receives v5 in one step |
| Bold effects tire or slow down a tool used every day | The effect level setting, the performance and readability rules, and continuous motion only for the trail |
| The common 21st.dev look makes Izgah resemble other apps | No decorative gradients, the Lantern accent and Geist; a deliberate choice in the theme lab |
| Requiring JavaScript reduces resilience on poor connections | Server rendering stays, forms post to the same actions, and a `<noscript>` banner explains the requirement |
| Tailwind or shadcn-svelte do not fit SvelteKit 3, Vite 8 or the `#lib` alias | The compatibility check is the first step of M1; the work stops there and goes back to the maintainer if it fails |
| Preflight changes how unmigrated screens look | Before and after screenshots in M1, and the E2E suite |
| Adapted code carries a licence incompatible with AGPL-3.0 | The licence gate in §9.3; otherwise written from scratch |
| Fetching site icons widens outbound requests | The SSRF-guarded `safe-fetch`, size and type limits, a 30-day cache per domain |
| Profile photos bring user-uploaded images | Re-encoding, size and pixel limits, a rate limit, audit logging and admin removal |
| The extension size budget | CSS-only changes and no new font in the extension |
