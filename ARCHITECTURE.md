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
- Pages live under [`src/routes/(app)`](<./src/routes/(app)>) and are server-rendered. Every mutation is a SvelteKit form action submitted with `use:enhance` and validated on the server. JavaScript is required ([izgah-ui-v5.md](./docs/designs/izgah-ui-v5.md) §8); a `<noscript>` banner says so.
- `/api/internal/*` serves the enhanced web UI (feed updates, quick search, notifications) with cookie sessions and same-origin checks.
- `/api/v1/*` is the stable contract for the browser extensions and other clients: personal API keys (`izk_…`), no cookies.

## Domain model

[`src/lib/server/db/schema.ts`](./src/lib/server/db/schema.ts):

- **canonical_resources** — one row per canonical URL (title, description, thumbnail, provider metadata, like/comment counters, search vectors).
- **link_shares** — a member sharing a resource, with an optional note; may be hidden from the feed ("silent") and attached to sections via **link_share_sections**.
- **sections**, **resource_comments**, **resource_likes**, **notifications**, **search_logs**, **audit_logs**.
- **users**, **sessions**, **accounts**, **api_keys**, **invite_tokens** (invites and password resets; no e-mail is sent).
- **unfurl_jobs** — the preview queue.
- **site_icons** — one stored icon per domain, refreshed at most every 30 days; **users.avatar_asset_key** points at a member's profile photo.
- **enrichment_jobs**, **resource_enrichments**, **instance_settings** — smart capture: page text, optional AI summaries and section suggestions, and the encrypted provider settings.

## Link previews

[`src/lib/server/unfurl`](./src/lib/server/unfurl): a worker claims jobs with `FOR UPDATE SKIP LOCKED`, fetches pages through [`safe-fetch.ts`](./src/lib/server/unfurl/safe-fetch.ts) (DNS pinning, private-range blocking, port/redirect limits), runs provider adapters (GitHub, YouTube, X, generic HTML meta) and stores resized WebP thumbnails with `sharp`. A circuit breaker backs off failing hosts.

## Smart capture

[`src/lib/server/smart-capture`](./src/lib/server/smart-capture): `#section` hashtags in notes, section suggestions from the team's history, and a second worker that extracts page text and, when an admin has configured a provider, asks the model for a summary, keywords and section suggestions ([izgah-smart-capture.md](./docs/designs/izgah-smart-capture.md)). Model output is suggest-only by default and never runs tools.

## Search

Trigger-maintained `tsvector` columns combine the `simple`, `english` and `turkish` dictionaries over `unaccent`ed text, plus trigram/ILIKE matching for URL fragments ([`search/service.ts`](./src/lib/server/search/service.ts)).

## UI

- Svelte 5 runes with the UI v5 "Fener" toolkit ([izgah-ui-v5.md](./docs/designs/izgah-ui-v5.md)): shadcn-svelte components copied into [`src/lib/components/ui`](./src/lib/components/ui) on Bits UI, Tailwind CSS v4 utilities, `@lucide/svelte` icons and Svelte's own motion APIs ([`src/lib/motion`](./src/lib/motion)). Native `<dialog>` for confirmations and the reading pane, View Transitions and container queries stay.
- One neutral near-black/off-white look with hairline borders, light and dark, the Jade theme by default and the Geist typeface. Colours for the app, the extensions and izgah.com come from one source, [`tokens/izgah.json`](./tokens/izgah.json) (`pnpm tokens` writes the palette CSS); [`src/lib/styles/tokens.css`](./src/lib/styles/tokens.css) resolves them into shadcn-style semantic roles with `light-dark()`, and [`theme.css`](./src/lib/styles/theme.css) maps those roles to Tailwind utilities. A cookie-backed "Reduced" effect level (also forced by reduced motion, reduced transparency, high contrast and forced colours) turns animation off.
- Site icons and profile photos are stored like thumbnails: re-encoded WebP files in the content-addressed media store, served by `/media/thumbnails/*` to signed-in members only.
- i18n in [`src/lib/i18n`](./src/lib/i18n): typed message catalogs (`en` is the source), resolved per request.

## Browser extensions

[`extensions/`](./extensions) is a separate WXT package (Chrome, Firefox, Safari). It only talks to `/api/v1/*` with the member's API key and never holds other secrets.

## Design documents

Approved designs are in [`docs/designs/`](./docs/designs), indexed in [SITEMAP.md](./docs/designs/SITEMAP.md). Start with `izgah-core.md`, then `izgah-ui-v5.md`, `izgah-i18n-oss.md` and `izgah-roadmap.md`.
