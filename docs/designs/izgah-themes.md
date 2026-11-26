# Izgah Themes — Dim, High Contrast and Accent Colour

*   **Author:** Gorkem Inanc Ozdemir
*   **Status:** Mechanism Active — accent colours and the Dim palette were removed in [izgah-ui-v4.md](./izgah-ui-v4.md) §8
*   **Date:** 2026-11-22

> **UI v4 note (2026-11-26):** Künye removed the accent colours and the Dim palette ([izgah-ui-v4.md](./izgah-ui-v4.md) §8); old `izgah_accent` and `dim` cookie values fall back to the default through the allow-list. The colours of the four remaining palettes (light and dark × standard and high contrast) are generated from `tokens/kunye.json` with `pnpm tokens` (v4 §11). §1 and §2 below are a historical record.

> **UI v3 transition note (2026-11-24):** The **mode + day/night palette + accent** architecture of this document, the cookie/SSR contract (§3), the `light-dark()` + `.theme-preview` CSS layer (§4) and the `/settings` flow with previews (§5) stay as they are. The values in **§1 (Palettes)** and **§2 (Accent Colours — `lime`/`cyan`/`pink`/`blue` → `teal`/`cobalt`/`terracotta`/`plum`)** were updated by [izgah-ui-v3.md](./izgah-ui-v3.md#1-token-system-primitive--semantic--component).

--------------------------------------------------------------------------------

## Overview

This document adds named themes on top of the "Signal" visual language of [izgah-ui-v2.md](./izgah-ui-v2.md). The existing System / Light / Dark **mode** choice stays as it is; in addition, the member picks a **light theme**, a **dark theme** and an **accent colour** in the "Appearance" section of `/settings` (GitHub's "day theme / night theme" model). In System mode, the chosen light theme applies when the operating system is light and the chosen dark theme when it is dark.

This document changes the "Custom themes and colour choice" non-goal of `izgah-ui-v2.md` and the "`light-dark()` is not used" decision in its Alternative F; those sections link here. The data model, the extension behaviour and the CSP do not change.

#### Key Concepts

*   **Mode (`data-theme`):** `system` | `light` | `dark`. Decides which colour scheme (light or dark) is active; its values and cookie are as in `izgah-ui-v2.md` §9.
*   **Light theme (`data-light-theme`):** The palette used while the light scheme is active: `default` | `contrast` (high contrast).
*   **Dark theme (`data-dark-theme`):** The palette used while the dark scheme is active: `default` | `dim` | `contrast` (high contrast).
*   **Accent colour (`data-accent`):** The value of `--color-signal` and `--color-focus-outer`: `lime` (default) | `cyan` | `pink` | `blue`.

## The Problem

*   There is one dark theme and it is nearly black (`#0A0A0A`); members who want a softer dark background for long reading have no option (a need similar to X's "Dim" theme).
*   Members with low vision, or who work in bright surroundings, have no theme with AAA text contrast and clearly visible control boundaries.
*   Members who find the lime accent tiring cannot pick an alternative that keeps the brand language.

## Goals

*   WCAG 2.2 AA in every light × dark × accent combination (text `4.5:1`, control boundaries and focus `3:1`); text and secondary text at `7:1` (AAA) in the high-contrast palettes.
*   No theme flash on first paint, and working without JavaScript (the same guarantee as `izgah-ui-v2.md` §9).
*   No new dependency, inline script, CSP exception or database column.

## Non-Goals

*   **Cross-device sync:** Preferences stay in cookies, per device.
*   **Extension:** The extension keeps following the system theme, the default palettes and the lime accent (`izgah-ui-v2.md` §14).
*   **Free colour choice and density:** Only the ready-made palettes below exist; there is no colour picker, density or font size setting.
*   **Animated transitions, automatic choice through `prefers-contrast`, `theme-color`:** Not in this version.

## Technical Plan (Architecture)

### 1. Palettes

The values live in [`src/lib/styles/tokens.css`](../../src/lib/styles/tokens.css); the ratios were computed with the WCAG 2.x relative luminance formula and are re-checked from the token file by [`tests/unit/tokens-contrast.test.ts`](../../tests/unit/tokens-contrast.test.ts). The default light and dark palettes are the values in the table in `izgah-ui-v2.md` §1.

| Token | Light HC (`contrast`) | Dim (`dim`) | Dark HC (`contrast`) |
| :--- | :--- | :--- | :--- |
| `bg` / `surface` | `#FFFFFF` / `#F0F0F0` | `#1C1C1C` / `#262626` | `#000000` / `#121212` |
| `text` | `#000000` (`bg` 21 · `surface` 18.43) | `#EDEDED` (14.56 · 12.93) | `#FFFFFF` (21 · 18.73) |
| `text-muted` | `#3D3D3D` (10.86 · 9.53) | `#A8A8A8` (7.17 · 6.36) | `#D0D0D0` (13.62 · 12.15) |
| `line` | `#767676` (4.54) | `#3A3A3A` (decorative) | `#7A7A7A` (4.89) |
| `line-strong` | `#1F1F1F` (16.48) | `#7F7F7F` (4.26) | `#C4C4C4` (12.04) |
| `danger` / `on-danger` | `#A3150B` (7.87) / `#FFFFFF` (7.87) | `#FF8A80` (7.47) / `#0A0A0A` (8.67) | `#FFA3A3` (11.02) / `#000000` (11.02) |
| `focus-inner` | `#000000` | `#EDEDED` | `#FFFFFF` |
| `backdrop` | `rgb(0 0 0 / 0.6)` | `rgb(0 0 0 / 0.6)` | `rgb(0 0 0 / 0.8)` |

In the high-contrast palettes `line` also passes `3:1`, so dividers and attachment box borders become perceivable boundaries too. The grey scale stays neutral; the ban on cream/sepia backgrounds, orange, purple and gradients (`izgah-ui-v2.md` §4) applies.

### 2. Accent Colours

`--color-on-signal` is `#0A0A0A` for every accent.

| Accent | Value | On `on-signal` | Dark background (`#0A0A0A` / Dim `#1C1C1C`) | On white |
| :--- | :--- | :--- | :--- | :--- |
| Lime (`lime`) | `#C8F542` | 15.65 | 15.65 / 13.47 | 1.27 |
| Cyan (`cyan`) | `#4FDDE6` | 12.08 | 12.08 / 10.40 | 1.64 |
| Pink (`pink`) | `#FF8FD0` | 9.51 | 9.51 / 8.19 | 2.08 |
| Blue (`blue`) | `#8FC4FF` | 10.85 | 10.85 / 9.34 | 1.82 |

No accent passes `3:1` on white, so the "Permitted uses of lime" table in `izgah-ui-v2.md` §1 applies unchanged to every accent (in the light theme only as a fill with ink text; in the dark theme also as text).

### 3. Cookies, Server and Action

*   **Cookies:** `izgah_theme` (mode, unchanged), `izgah_theme_light`, `izgah_theme_dark`, `izgah_accent`. The flags are the same as for `izgah_theme`: `Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly; Secure` (conditional). A missing or invalid value falls back to the default (`default`, `default`, `lime`); only allow-listed values are written into the HTML.
*   **Server:** The root element in [`src/app.html`](../../src/app.html) becomes `<html lang="tr" data-theme="%izgah.theme%" data-light-theme="%izgah.lightTheme%" data-dark-theme="%izgah.darkTheme%" data-accent="%izgah.accent%">`; [`src/hooks.server.ts`](../../src/hooks.server.ts) fills the four placeholders in the existing `transformPageChunk` wrapper. `<meta name="color-scheme" content="%izgah.colorScheme%">` in `<head>` becomes `light dark` / `light` / `dark` depending on the mode; the browser paints the canvas in the right colour before the CSS loads, and the client updates the same value on a JavaScript switch.
*   **Action:** `/settings?/setPalette` (`lightTheme`, `darkTheme`, `accent`, `returnTo`). Validation, the `303` redirect, the `x-sveltekit-action` branch and `sanitizeInternalPath` are the same as for `?/setTheme`.

### 4. CSS Architecture

*   **Palette slots:** The `--light-*` and `--dark-*` properties carry each palette's raw values; `--accent` carries the accent value.
*   **Semantic tokens:** Defined as `--color-bg: light-dark(var(--light-bg), var(--dark-bg))`; components only use the `--color-*` names.
*   **Mode:** `:root { color-scheme: light dark }`, `:root[data-theme='light'] { color-scheme: light }`, `:root[data-theme='dark'] { color-scheme: dark }`. The `@media (prefers-color-scheme: dark)` block that repeated the dark values is removed.
*   **Palette selectors:** Written without the `:root` prefix (`[data-dark-theme='dim']` and so on); because the slots and the semantic mapping are defined on `:root, .theme-preview`, the preview cards on the settings page show their own palette.
*   `light-dark()` is Baseline "widely available" as of 2026-11-13 (Chrome 123, Firefox 120, Safari 17.5); every target browser supports it.

### 5. Settings UI

*   `/settings` "Appearance": three `<fieldset>`s under the existing mode picker ("Light theme", "Dark theme", "Accent colour"). Each option is a visible native radio plus a preview card; changing the choice submits the form (`use:enhance`, no page reload), and users without JavaScript see an "Apply" button.
*   The selected option is marked by a thick border and a check mark, independent of colour; `forced-colors` uses the system colours.
*   The picker in the account menu only changes the mode.

## Alternatives Considered

### Alternative A: One Flat Theme List

The X model (System / Light / Dim / Dark / …) is simpler, but the "System" option would always have to use the default palettes, and a member who wants Dim or high contrast would give up following the operating system. Not chosen by the user.

### Alternative B: Selectors Without `light-dark()`

Each dark palette would be written twice, under `[data-theme='dark']` and under `@media (prefers-color-scheme: dark)` (six blocks for three dark palettes). Rejected because `light-dark()` is now widely available.

### Alternative C: Storing Preferences in the User Profile

This would give cross-device sync, but it needs a new column and a migration, and the value would still have to be mirrored into a cookie for the first paint. Per-device preferences were judged enough for a team of 10–15 people.

## Verification Plan

*   `tests/unit/tokens-contrast.test.ts`: the §1–§2 thresholds for every palette and accent combination.
*   `tests/integration/m10-ui-v2.test.ts`: cookie → `<html>` attributes, invalid values, `?/setPalette` validation, the `303` and enhanced branches.
*   `tests/e2e/m12-ui-v2-shell.spec.ts` and `tests/e2e/m15-a11y-tour.spec.ts`: choosing and persisting in settings; axe scans in the Dim and high-contrast palettes.
*   `pnpm test:docker`: zero CSP violations after changes to `app.html`, the hook and global styles.
