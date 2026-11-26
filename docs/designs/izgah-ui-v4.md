# Izgah UI v4 — "Künye"

*   **Author:** Gorkem Inanc Ozdemir
*   **Status:** Proposed. Implementation (roadmap R3) starts after the prototype review in §9.
*   **Date:** 2026-11-26

--------------------------------------------------------------------------------

## Overview

A *künye* is the imprint block of a book: who, what, where, when. In v4 every share has two parts: the **note**, the member's own words and the largest text on the screen, and the **künye**, one compact line that identifies the link (title, site, type, sections, discussion).

v4 replaces the visual language of [izgah-ui-v3.md](./izgah-ui-v3.md). It keeps v3's mechanics: `light-dark()` token slots and cookie/SSR theming ([izgah-themes.md](./izgah-themes.md)), the CSP and font self-hosting rules and the stable E2E hooks ([izgah-ui-v2.md](./izgah-ui-v2.md) §2, §9, §11, §12), the JavaScript-free flows and the keyboard model.

## The problem

v3 ("Studio") is well built, but in 2026 it reads as the default look of generated interfaces: a serif display face on a warm off-white background, a coloured stripe on the active item, pill chips, cards inside cards, uppercase monospace micro-labels and a right rail of KPI tiles. izgah.com repeats the template: a pill kicker, a centred serif headline, two buttons, a shadowed screenshot, a six-card grid and a callout with a left stripe. [izgah-ui-v2.md](./izgah-ui-v2.md) §4 had banned most of these; v3 brought them back.

## Principles

1.  **Ink and paper frame; colour belongs to content and state.** Neutral white and neutral near-black surfaces. No cream, no warm grey, no blue-black.
2.  **Links look like links.** One accent: link blue, underlined. Opened links fade: the browser's `:visited` *is* the reading trace. Since Chrome 136 visited history is partitioned per site, so it shows what you opened from Izgah; Firefox and Safari use global history. The server records nothing. In `forced-colors` mode `LinkText` and `VisitedText` take over by themselves.
3.  **Rules, not boxes.** Hairlines and space. No card inside a card, no pills, no shadows (except `dialog` and `popover`), corner radius at most 3 px.
4.  **One family.** Hierarchy from size, weight (400/600) and italics. No uppercase micro-labels; monospace only for code, URLs and `kbd` (the system `ui-monospace` stack).
5.  **People first.** The note is the most readable text in an entry; the künye is one tight line.
6.  **Every element earns its place.** No decorative icons; words where possible ("3 comments").
7.  **Motion:** 120 ms colour transitions and a View Transition between list and detail. Nothing else.
8.  JavaScript-free and keyboard parity, WCAG 2.2 AA (AAA in high contrast) and the stable E2E hooks are unchanged.

## 1. Tokens

| Role | Light (on `#FFFFFF`) | Dark (on `#0F0F10`) |
| :--- | :--- | :--- |
| Ink | `#121212` — 18.7:1 | `#F2F2F0` — 17.1:1 |
| Secondary | `#4A4A4A` — 8.9:1 | `#B4B4B0` — 9.2:1 |
| Tertiary | `#666666` — 5.7:1 | `#929290` — 6.2:1 |
| Link | `#1F3FD0` — 7.8:1 | `#9DB7FF` — 9.7:1 |
| Visited | `#5F5878` — 6.7:1 | `#ABA5C6` — 8.2:1 |
| Control border | `#767676` — 4.5:1 | `#77777A` — 4.3:1 |
| Danger | `#B42318` — 6.6:1 | `#FF9A8F` — 9.4:1 |
| Rule (decorative) | `#DADADA` | `#2A2A2C` |
| Selected row | `#F3F3F3` | `#19191B` |

Palettes shrink to Light, Dark and High contrast (light and dark variants); the accents and "dim" are removed (§8). High contrast raises tertiary text to at least 7:1 and rules to at least 4.5:1.

## 2. Typography

One variable family with italics and `latin-ext`, self-hosted from Fontsource: **Atkinson Hyperlegible Next** (`@fontsource-variable/atkinson-hyperlegible-next`, SIL OFL 1.1). It was designed for legibility and keeps `I l 1` and `O 0` apart in URLs and API keys. The base size is 16 px.

*Decision, 2026-11-26:* chosen by the maintainer after the prototype review over **Ysabeau Office** (a humanist sans on a Garamond skeleton). Its default zero is slashed; R3 checks whether a plain-zero alternate is available for times and counts, and keeps the slashed zero where telling `0` from `O` matters (URLs, keys, code).

Excluded on purpose, because they are model defaults: Inter, Geist, Space Grotesk, IBM Plex, Newsreader, Fraunces, Instrument Serif, JetBrains Mono.

| Token | Size / line height | Weight | Use |
| :--- | :--- | :--- | :--- |
| `--t-page` | 1.375rem / 1.25 | 600 | Page `h1` |
| `--t-note` | 1rem / 1.55 | 400 | Notes, comments, body text |
| `--t-title` | 1rem / 1.4 | 500 | Link titles (blue, underlined) |
| `--t-kunye` | 0.875rem / 1.45 | 400 | Künye line, form hints |
| `--t-ui` | 0.875rem / 1.3 | 500 | Navigation, buttons, labels |
| `--t-meta` | 0.8125rem / 1.3 | 400, tabular | Times and counts |

## 3. Layout

| Width | Layout |
| :--- | :--- |
| ≥ 1280 px | **Index** (220 px: search, Feed, Read later, Notifications, sections with right-aligned counts, account) · **Register** (at most 720 px) · **Reading pane** (resource, share history and discussion; today's `SidePeekDialog` content becomes a docked pane; `j`/`k` move the selection) |
| 1024–1279 px | Index and register; details open as today's side peek |
| 768–1023 px | Collapsed index (accessible names kept) and register |
| < 768 px | Register and bottom bar; the share form is a bottom sheet |

No top bar, no breadcrumb, no right-rail dashboard.

## 4. Register entry

```
18:41   Priya Nair   Ran the new models on a laptop — surprisingly fast for long PDFs.
                     ollama/ollama
                     github.com · code · Go · AI tools · 2 comments · 5 likes
```

*   Time (tabular figures) and name sit in a left gutter; the note, the link title and the künye line share one column.
*   Like, Read later, Copy and More are text buttons at the end of the künye line, shown on hover and focus and always on touch.
*   A thumbnail, when there is one, sits on the right at a fixed 16:10 ratio and 112 px wide; never a full-width banner.
*   The selected entry gets the "selected row" surface; no stripe.
*   Day dividers are a full-width rule with the date on the left and the count on the right ("Tuesday 25 November · 7 links").
*   Suggestions (author and admins only): "Suggested: Frontend — Add · Dismiss" in secondary ink.

## 5. Language

Turkish uses the name's metaphor: sharing is **"İz bırak"** ("leave a trace") and the unit is **"iz"**. English stays plain: "Add a link", "links". The wordmark is `izgah` set in the UI family with **"iz" in ink at weight 600 and "gah" in tertiary ink at weight 400**, no underline: it puts the trace (*iz*) first. It is plain text in the markup (`iz<span>gah</span>`), so the accessible name stays "izgah" and forced-colors mode keeps it readable. *Decision, 2026-11-26:* chosen by the maintainer over an underlined and an italic variant.

## 6. izgah.com

The site is built like the product, from the same CSS, with a live HTML register instead of PNG screenshots:

*   A left-aligned two-line statement and, right under it, the install commands: for a self-hosted tool the call to action is a command, not a button.
*   Features as an annotated list of real links (design documents, source files), not a card grid; `:visited` works on the page itself.
*   "Why it exists" (the WhatsApp story), "What it doesn't do" (when Karakeep or Linkwarden is the better choice), "What runs on your server and what leaves it", and the public roadmap.
*   Concrete facts only (one container, no external services). No invented testimonials, round statistics, emoji bullets or gradients. English and Turkish.

## 7. Components

| Today (v3) | v4 |
| :--- | :--- |
| `PostCard` + `LinkAttachment` (card in card) | `RegisterEntry`: one block, rules between entries |
| `FeedContextRail` | Removed; "Most discussed" becomes a sort option |
| `TopContextBar` | Removed; search lives in the index, `⌘K` stays |
| `Avatar`, `AvatarStack` | Removed; names as text |
| `SegmentedControl` (type filter) | A "Filter" disclosure (`<details>`) and search operators |
| `SidePeekDialog` | Docked reading pane at ≥ 1280 px; a dialog below that |
| `PaletteForm` (20 previews) | System / Light / Dark and High contrast as a radio list |
| Pills, badges, status pills | Plain text with tabular figures; state words ("failed") in danger ink |

## 8. Removals

The accent colours (`teal`, `cobalt`, `terracotta`, `plum`) and the `dim` palette are removed; old cookie values fall back to the defaults through the existing allow-list (`pickAllowed`). Newsreader, Geist and JetBrains Mono are removed, as are `--color-signal` and the other v2 aliases.

## 9. Acceptance (prototype review)

`docs/designs/prototypes/kunye/` holds static pages with realistic data: the feed with a reading pane (light and dark), a resource page, the share form with suggestions, `/admin/ai`, mobile, and izgah.com, with a font switch. The maintainer reviews them; the chosen font and any changes are recorded here before R3 starts.

*   2026-11-26 — Font: Atkinson Hyperlegible Next (§2). Wordmark: "iz" + "gah" (§5). R3 can start.

## Alternatives considered

*   **"Vitrin" (image-first gallery).** Strong for design- and video-heavy teams, weak for text-heavy archives and search. Not chosen.
*   **"Baskı" (daily or weekly edition).** Reads like a digest but slows chronological scanning; it may return as the weekly digest page (R7).
*   **Keeping v3 and toning it down.** Dropping the serif and the warm background still leaves the card-and-pill structure that makes it look generated.

## Risks

| Risk | Mitigation |
| :--- | :--- |
| `:visited` is a weak signal in browsers without partitioning | It is a hint, not a feature; nothing depends on it. |
| Removing accents and palettes upsets members who chose them | Cookies fall back silently; high contrast stays. |
| E2E hooks depend on v3 class names | The §12 hooks (`article.share-card`, …) stay as class names on the new elements. |
