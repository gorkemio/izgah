# Izgah UI v4 — "Künye"

*   **Author:** Gorkem Inanc Ozdemir
*   **Status:** Approved (2026-11-26, after the prototype review in §9). Implementation is roadmap R3.
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

*Decision, 2026-11-26:* chosen by the maintainer after the prototype review over **Ysabeau Office** (a humanist sans on a Garamond skeleton). Its zero is slashed and the font has no plain alternate, so Izgah ships a modified copy of the latin subset whose zero is plain (`scripts/fonts/plain-zero.py` rebuilds the counter from the capital O at every weight; the copy is renamed "Atkinson Hyperlegible Next Izgah"). Times, counts and dates read `10:05`. URLs, keys and code are set in the system monospace, which keeps its own slashed or dotted zero where telling `0` from `O` matters.

Excluded on purpose, because they are model defaults: Inter, Geist, Space Grotesk, IBM Plex, Newsreader, Fraunces, Instrument Serif, JetBrains Mono.

| Token | Size / line height | Weight | Use |
| :--- | :--- | :--- | :--- |
| `--t-page` | 1.375rem / 1.25 | 600 | Page `h1` |
| `--t-note` | 1rem / 1.5 | 400 | Notes, comments, body text (at most 68ch in the feed) |
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

*   Time (tabular figures) and name sit in a 104 px left gutter; the note, the link title and the künye line share one column.
*   The künye line keeps one order: site · type · language · stars · author · sections · first share · silent and preview state · comments · likes. Counts are links or buttons themselves ("2 comments", "5 likes").
*   Actions with nothing to report ("Comment", "Like", "Actions") wait at the end of the line, shown on hover, focus and selection and always on touch. "Actions" holds Preview, Copy, Edit and Delete; Space opens the preview on wide screens. *Decision, 2026-11-26:* option A of the refinement review (§11).
*   A thumbnail, when there is one, sits on the right at a fixed 16:10 ratio and 112 px wide; never a full-width banner.
*   The selected entry gets the "selected row" surface; no stripe.
*   Day dividers are a full-width rule with the date on the left and the count on the right ("Tuesday 25 November · 7 links").
*   Suggestions (author and admins only): "Suggested: Frontend — Add · Dismiss" in secondary ink.

## 5. Language

Turkish uses the name's metaphor: sharing is **"İz bırak"** ("leave a trace") and the unit is **"iz"**. English stays plain: "Add a link", "links". The wordmark is `izgah` set in the UI family with **"iz" in ink at weight 600 and "gah" in tertiary ink at weight 400**, no underline: it puts the trace (*iz*) first. It is plain text in the markup (`iz<span>gah</span>`), so the accessible name stays "izgah" and forced-colors mode keeps it readable. *Decision, 2026-11-26:* chosen by the maintainer over an underlined and an italic variant.

## 6. izgah.com

The site is built like the product, from the same CSS, with a live HTML register instead of PNG screenshots:

*   A left-aligned two-line statement, then the live specimen with side notes, then the install commands. *Decision, 2026-11-26* (§11): the product comes before the command; the specimen answers j/k, Space and Like with a small script and offers a CSS-only Light · Dark choice.
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

A set of static pages with realistic data (the feed with a reading pane in light and dark, a resource page, the share form with suggestions, `/admin/ai`, mobile, and izgah.com, with a font switch) was reviewed by the maintainer; the chosen font and any changes are recorded here. The prototype was removed once R3 shipped; it remains in the Git history of pull request #4.

*   2026-11-26 — Font: Atkinson Hyperlegible Next (§2). Wordmark: "iz" + "gah" (§5). R3 can start.

## 10. Implementation notes (R3)

*   Tokens, the single font (with the plain zero from §2), the four palettes (light and dark × standard and high contrast) and the removals in §8, in the app, the extensions and izgah.com. `tests/unit/tokens-contrast.test.ts` checks every palette, link and visited colour, and the 3px radius ceiling.
*   The index rail with the wordmark, a text-only bottom tab bar, the register entry (gutter, note, künye line, ruled day headings with counts), flat resource, settings and admin pages, and the auth layout.
*   Words instead of icons in the shell: "Notifications" with an unread count in link blue, "Actions" on each entry, "Close" and "Copy" in the reading pane.
*   The reading pane: from 1280 px `SidePeekDialog` opens non-modally (`show()`) as a docked column of `--pane-w`, and the register makes room for it (`html:has(dialog.is-docked[open])`). Moving focus to another entry (j/k, Tab, click) shows that entry; Escape closes it. Below 1280 px it stays a modal drawer.
*   The content-type filter is a native "Filter" disclosure (`<details>`), open while a type is active; the `?type=` URLs are unchanged.
*   The extension icons and the favicon use the Künye mark: an ink square with a paper stem and a link-blue dot.
*   izgah.com is rebuilt from the prototype: a live HTML specimen instead of screenshots, in English and Turkish.

Kept on purpose: `PostCard` and `LinkAttachment` keep their names and test hooks (`ui-v2.md` §12) and are restyled as the register entry; `rail-summary.ts` stays for the "Most discussed" sort.

## 11. Refinement (2026-11-26)

A pass over the app, the extensions and izgah.com after R3, approved by the maintainer as proposals Ö1–Ö22 with feed entry option A. It refines Künye without changing its language, so it is recorded here rather than in a v5.

*   **One colour source (Ö18).** `tokens/kunye.json` holds the four palettes; `pnpm tokens` (`scripts/tokens/build.ts`) writes `src/lib/styles/palette.css`, `extensions/src/styles/palette.css` and `site/palette.css`. `tests/unit/tokens-sync.test.ts` fails when a file is stale; the contrast test reads the generated palette. The extension's old v3 high-contrast colours and blue primary button are gone. Weights are 600 and 500 everywhere (Ö8).
*   **No icons (Ö2–Ö4).** Every icon became a word ("Close", "Clear", "Settings", "Actions") or was removed, with `Icon`, `icons.ts`, `Avatar`, `AvatarStack`, `SegmentedControl` and `Tooltip`; Lucide left `THIRD_PARTY_NOTICES.md`. Press scaling and entry animations were removed.
*   **Feed entry, option A (Ö5–Ö7).** One künye line in a fixed order (§4); the description, the "Open" link and the separate stats row are gone; day headings carry the date for the last week ("Bugün 25 Kasım Çarşamba"); a link without a title shows its address.
*   **Rules, not boxes (Ö9, Ö10, Ö13).** Admin forms are ruled sections, KPI strips one line of facts, tabs ink and bold without a stripe; secondary buttons are outlined and destructive ones outlined in danger ink. Settings use radio lists and a native checkbox; section choices are a checkbox list.
*   **Sections index (Ö11).** A ruled list with the number of links per section, silent ones included.
*   **Catalogue card (Ö12).** The resource page and the reading pane share one order: title, künye line and a small 16:10 cover beside them, then the abstract and the actions. The künye facts come from `src/lib/format/kunye.ts`.
*   **Palette (Ö14).** Link results read as a künye line; scopes are underlined words.
*   **Copy (Ö15).** Turkish titles and buttons are in sentence case like the English ones; "Ana Akış" and "Link Paylaş" stay as fixed test names (`ui-v2.md` §12). No copy speaks of cards.
*   **Dates (Ö16).** `formatWhen` gives "25 Kas 17:20" / "Nov 25, 17:20" with the year only when it differs, in comments, share history, notifications and admin tables; the audit log keeps seconds.
*   **Extension (Ö17, Ö19, Ö20).** "İz bırak" / "Add a link", the iz + gah wordmark, "Settings" as a word, the ink primary button, notices as text between rules. The size target is measured as the stores do: zip ≤ 150 KB and JS+CSS gzip ≤ 30 KB, checked by `verify-manifests` (`izgah-extensions.md`). No manual theme choice: the popup follows the system theme and contrast.
*   **izgah.com (Ö21, Ö20b, Ö22).** See §6. The gutter (104 px) and the 68ch measure match the app.

Not done: a font subset for the extension (Ö19b) needs fontTools, which is not installed here; the font stays the shared latin and latin-ext files.

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
