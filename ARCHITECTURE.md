# Architecture

Izgah is one SvelteKit application (Node adapter) plus PostgreSQL. Everything else — the link-preview queue, thumbnails, sessions, rate limits — runs inside that single process.

```
browser / extension ──HTTPS──▶ reverse proxy ──▶ SvelteKit app (Node 22) ──▶ PostgreSQL 16
                                                   │  ├─ in-process unfurl worker (FOR UPDATE SKIP LOCKED)
                                                   │  └─ thumbnails on a local volume (/data/thumbnails)
                                                   └─ outbound fetches for previews (SSRF-guarded)
```

## Request flow

- [`src/hooks.server.ts`](./src/hooks.server.ts) is the front door: request IDs, security headers and CSP, locale and theme resolution, session lookup, CSRF/origin checks for `/api/internal/*`, Bearer API keys and CORS for `/api/v1/*`, admin gating and rate limits.
- Pages live under [`src/routes/(app)`](<./src/routes/(app)>) and are server-rendered. Every mutation is a SvelteKit form action, so it works without JavaScript; `use:enhance` upgrades it.
- `/api/internal/*` serves the enhanced web UI (feed updates, quick search, notifications) with cookie sessions and same-origin checks.
- `/api/v1/*` is the stable contract for the browser extensions and other clients: personal API keys (`izk_…`), no cookies.

## Domain model

[`src/lib/server/db/schema.ts`](./src/lib/server/db/schema.ts):

- **canonical_resources** — one row per canonical URL (title, description, thumbnail, provider metadata, like/comment counters, search vectors).
- **link_shares** — a member sharing a resource, with an optional note; may be hidden from the feed ("silent") and attached to sections via **link_share_sections**.
- **sections**, **resource_comments**, **resource_likes**, **notifications**, **search_logs**, **audit_logs**.
- **users**, **sessions**, **accounts**, **api_keys**, **invite_tokens** (invites and password resets; no e-mail is sent).
- **unfurl_jobs** — the preview queue.
- **enrichment_jobs**, **resource_enrichments**, **instance_settings** — smart capture: page text, optional AI summaries and section suggestions, and the encrypted provider settings.

## Link previews

[`src/lib/server/unfurl`](./src/lib/server/unfurl): a worker claims jobs with `FOR UPDATE SKIP LOCKED`, fetches pages through [`safe-fetch.ts`](./src/lib/server/unfurl/safe-fetch.ts) (DNS pinning, private-range blocking, port/redirect limits), runs provider adapters (GitHub, YouTube, X, generic HTML meta) and stores resized WebP thumbnails with `sharp`. A circuit breaker backs off failing hosts.

## Smart capture

[`src/lib/server/smart-capture`](./src/lib/server/smart-capture): `#section` hashtags in notes, section suggestions from the team's history, and a second worker that extracts page text and, when an admin has configured a provider, asks the model for a summary, keywords and section suggestions ([izgah-smart-capture.md](./docs/designs/izgah-smart-capture.md)). Model output is suggest-only by default and never runs tools.

## Search

Trigger-maintained `tsvector` columns combine the `simple`, `english` and `turkish` dictionaries over `unaccent`ed text, plus trigram/ILIKE matching for URL fragments ([`search/service.ts`](./src/lib/server/search/service.ts)).

## UI

- Svelte 5 runes, no UI framework. Native `<dialog>`, `popover`, View Transitions and container queries.
- The "Künye" visual language ([izgah-ui-v4.md](./docs/designs/izgah-ui-v4.md)): one type family, rules instead of boxes, words instead of icons. Colours for the app, the extensions and izgah.com come from one source, [`tokens/izgah.json`](./tokens/izgah.json) (`pnpm tokens` writes the palette CSS); [`src/lib/styles/tokens.css`](./src/lib/styles/tokens.css) maps them to semantic `light-dark()` tokens in four palettes (light and dark, standard and high contrast).
- i18n in [`src/lib/i18n`](./src/lib/i18n): typed message catalogs (`en` is the source), resolved per request.

## Browser extensions

[`extensions/`](./extensions) is a separate WXT package (Chrome, Firefox, Safari). It only talks to `/api/v1/*` with the member's API key and never holds other secrets.

## Design documents

Approved designs are in [`docs/designs/`](./docs/designs), indexed in [SITEMAP.md](./docs/designs/SITEMAP.md). Start with `izgah-core.md`, then `izgah-ui-v4.md`, `izgah-i18n-oss.md` and `izgah-roadmap.md`.
