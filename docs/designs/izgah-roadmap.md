# Izgah — Product roadmap

*   **Author:** Gorkem Inanc Ozdemir
*   **Status:** Approved (direction). From R3 on, each phase gets its own design document before code.
*   **Date:** 2026-11-26

--------------------------------------------------------------------------------

## Overview

Izgah is a shared link library for small teams: members post useful links with a short note into a reverse-chronological feed, admins file them into sections, each URL has one discussion, and search finds them in English and Turkish. The core ([izgah-core.md](./izgah-core.md)) is solid: sharing never waits for the network, previews are fetched safely in the background, every change is a server form action, and an instance is one container plus PostgreSQL.

This document records the product direction after the open-source release: where Izgah sits among similar tools, what makes it hard to replace, what is missing, what to remove, and the order of work. It revisits several non-goals of the core design (see [Changed decisions](#changed-decisions)).

## Where Izgah sits

| Tool (Nov 2026) | Shape | AI | Teams |
| :--- | :--- | :--- | :--- |
| Karakeep | Personal archive of links, notes and images; full-page archiving with a headless browser | Tagging and summaries (OpenAI-compatible or Ollama), semantic search, MCP server | Shared lists |
| Linkwarden | Archive with page preservation (screenshot, PDF, readable copy) | Tagging with local or hosted models, custom prompts | Collections with per-member permissions |
| Raindrop.io (hosted) | Personal bookmarks | An assistant proposes reorganisation; the user approves | Shared collections |
| WhatsApp, Slack, Discord | Chat | — | Everyone, but links scroll away |

None of them is a **team feed with one discussion per link**. Izgah is closer to a private Lobsters for 5–50 people than to a bookmark manager. That sets two rules:

1.  **Don't chase personal-archive features.** No full-page archives, highlights, reader mode, per-user folders or freeform tags. Teams that need those should run Karakeep or Linkwarden, and izgah.com says so.
2.  **Every feature must make the team's collection more valuable:** better filed, easier to find, easier to bring in, easier to take out.

## Principles

1.  **Sharing is instant.** Nothing on the share path waits for the network; enrichment happens afterwards.
2.  **People write notes, machines describe links.** A model never writes in a member's voice, and machine text is labelled.
3.  **Suggest by default.** Automatic changes are opt-in, say who made them and can be undone in one click.
4.  **Your server, your keys.** Optional AI uses the instance's own key or a local model; admins see exactly what leaves the server; the operator can switch AI off with one variable.
5.  **Server first.** Pages render on the server and every change goes through a form action with server-side validation. Since [UI v5](./izgah-ui-v5.md) JavaScript is required and new flows need no separate no-JavaScript fallback.
6.  **One container.** New background work reuses the in-process PostgreSQL job pattern: no Redis, no headless browser.

## Moat

| Feature | Why it is hard to copy |
| :--- | :--- |
| Chat export import (WhatsApp `.txt`, Telegram JSON, Slack export): links, notes, authors and dates | Solves the cold start: a team opens Izgah with years of history on day one. It is also why Izgah exists. |
| Section suggestions learned from the team's own history | Improves with use, needs no API key, reflects how *this* team files things. |
| Trails: ordered, annotated reading paths ("Frontend for new joiners") | Sections are buckets; a trail has an author and an order. Fits the name (*iz* means trace) and compounds as onboarding material. |
| Ask the library + MCP endpoint | A hand-curated, annotated archive becomes context for members' own AI tools. MCP 2026-07-28 is a stateless `POST` and works with the existing personal API keys. |
| Privacy-first AI | Own key or local model, an explicit "what leaves the server" list, an operator kill switch. |
| Optional public sections and trails, RSS | A growth loop for an open-source project ("published with Izgah"). |
| Visited links as the reading trace | The browser's `:visited` shows what you opened, without server-side tracking. |

## Must-haves

| Area | Missing today |
| :--- | :--- |
| Finding | Search inside page text with a matching snippet; search in comments; `from:`, `in:` and `type:` operators. |
| Personal | A "Read later" list (an explicit save; still no read tracking). |
| Repair | Edit title and description, refresh a preview, dead-link check with a Wayback Machine fallback. |
| Getting data out | Export (JSON, Netscape bookmarks HTML, CSV); read API (`GET /api/v1/links`, `/api/v1/search`); token-protected RSS/Atom. |
| Getting data in | Bookmark HTML import (browsers, Pocket, Raindrop, Pinboard, Linkding); installable PWA with an Android share target; an iOS Shortcut (Safari has no `share_target`); a `/share` bookmarklet. |
| Team rhythm | Weekly digest page; outgoing webhooks (Slack, Discord, Telegram); @mentions; follow a section; Web Push. |
| Identity | Passkeys; optional OIDC; optional SMTP. Invite links stay the default. |
| First run | An admin checklist on an empty instance: create sections, invite members, install the extension, import a chat. |

## Remove or simplify

| What | Why |
| :--- | :--- |
| Right-rail "today" counters and the "top sharers" ranking | Vanity numbers for a ten-person team; rankings create pressure. "Most discussed" becomes a sort option. |
| Four accent colours, the "dim" palette and the preview-card picker | A strong identity has one accent; 20 palette × accent combinations are a contrast-testing burden. Keep System / Light / Dark plus high contrast. |
| Three type families | One family; hierarchy from size, weight and italics. |
| The breadcrumb bar and the second search field | "Izgah / Feed", the `h1` and the active menu item say the same thing three times; the screen has two search inputs. |
| Monogram avatars and `AvatarStack` | There are no photos; initials in circles are noise. Names are enough. |
| Nested cards, pills, shadows, coloured left stripes, uppercase monospace labels | Recognisable generated-UI patterns (see [izgah-ui-v4.md](./izgah-ui-v4.md)). |
| The permanent content-type strip | It takes the best space on the feed; it moves to a "Filter" disclosure and search operators (`?type=` URLs keep working). |
| Separate admin tabs for preview jobs and metrics | One "System" page: queues, AI usage, health. |
| Back-compat aliases (`--color-signal`, …) and page-local copies of shared styles | Already recorded as debt in [izgah-ui-v3.md](./izgah-ui-v3.md). |

Kept: one resource per URL, silent resources, `⌘K`, single-key shortcuts, the Safari extension and the audit log.

> **UI v5 note (2026-11-27):** [izgah-ui-v5.md](./izgah-ui-v5.md) reverses the rows above about monogram avatars (they return, with profile photos), about nested cards, pills and shadows (cards, chips and an elevation scale are part of the v5 language), and about a single type family (v5 allows a display face). The single accent rule becomes one brand gradient; the removed accent picker and the "dim" palette stay removed. JavaScript-free flows are no longer kept.

## Changed decisions

| [izgah-core.md](./izgah-core.md) said | Now |
| :--- | :--- |
| No AI summaries or automatic sectioning | Optional, admin-enabled, off until configured: [izgah-smart-capture.md](./izgah-smart-capture.md). |
| No read/unread tracking and no personal bookmark list | A personal "Read later" list (an explicit save). Still no read tracking: the browser's `:visited` shows what you opened. |
| No mobile share sheet | PWA with an Android share target; an iOS Shortcut. |
| No SMTP and no OAuth | Optional SMTP; passkeys; optional OIDC. All off by default; invite links remain. |
| No freeform tags | Unchanged. Sections, the `#section` shortcut and hidden AI keywords cover the need without tag sprawl. |
| Every flow works without JavaScript | JavaScript is required; server rendering and form actions stay ([izgah-ui-v5.md](./izgah-ui-v5.md) §8). |
| The v3 visual language | Replaced by [izgah-ui-v4.md](./izgah-ui-v4.md) ("Künye", 2026-11-26), then by [izgah-ui-v5.md](./izgah-ui-v5.md) ("Fener", approved 2026-11-27). |

## Phases

| Phase | Scope | Exit criteria |
| :--- | :--- | :--- |
| R0 | Design documents: this one, [smart capture](./izgah-smart-capture.md), [UI v4](./izgah-ui-v4.md) | Approved |
| R1 | Smart capture: `#section`, history suggestions, page text in search, optional AI enrichment, `/admin/ai` | Specified tests pass |
| R2 | Künye prototype with realistic data | Maintainer review ([izgah-ui-v4.md](./izgah-ui-v4.md) §9) |
| R3 | Künye implementation: tokens → shell → register → reading pane → resource and search → settings and admin → sign-in and errors → extension → izgah.com; the removals above | Existing E2E contract green; axe colour-contrast clean |
| R3b | UI v5 "Fener" ([izgah-ui-v5.md](./izgah-ui-v5.md)): Tailwind CSS v4 and shadcn-svelte, the theme lab, every screen, interactions and motion, site icons, profile photos, undo delete, extensions, izgah.com | E2E contract green as amended by v5 §14; axe clean in light, dark, high contrast and reduced effects |
| R4 | Find and return: page-text snippets, comment search, operators, read later, manual metadata edits, dead-link check | — |
| R5 | In and out: export, bookmark and chat imports, read API, RSS, webhooks, MCP | — |
| R6 | Share from anywhere: PWA and share target, iOS Shortcut, `/share`, suggestions in the extension, multi-link paste | — |
| R7 | Team rhythm: weekly digest, @mentions, follow a section, Web Push, optional SMTP | — |
| R8 | Identity: passkeys, optional OIDC | — |
| R9 | Library intelligence: Ask, an admin tidy-up assistant (propose → approve), related links | — |
| R10 | Trails and public pages | — |

## Measuring

Instance-local only; nothing leaves the server. `/admin/metrics` gains: the share of feed links without a section after seven days, the suggestion acceptance rate (history vs AI), the zero-result search rate (already in `search_logs`) and import volume.
