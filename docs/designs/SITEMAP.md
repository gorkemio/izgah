# Izgah — Sitemap

## Design Documents

| Document | Date | Author | Components | Description |
| :--- | :--- | :--- | :--- | :--- |
| [izgah-core.md](./izgah-core.md) | 2026-11-14 | Gorkem Inanc Ozdemir | PostgreSQL / Drizzle ORM, Auth & API Keys, Unfurl Worker & Media Cache, SvelteKit Web UI, `/api/v1/*` HTTP API, Admin & Telemetry, Docker / Dokploy | The core platform: data model, authentication and personal API keys, the SSRF-guarded background preview service, native-platform UI rules, the extension API contract and the single-container deployment. |
| [izgah-extensions.md](./izgah-extensions.md) | 2026-11-19 | Gorkem Inanc Ozdemir | WXT + TypeScript (Manifest V3), Chrome / Firefox / Safari Web Extensions, `popup` & `options` UI, `contextMenus` & `Alt+Shift+I`, `/api/v1/*` HTTP Client, Safari Xcode Converter | The desktop browser extensions: the isolated `extensions/` package, the narrowest permission set, the share popup with duplicate detection and admin silent adds, right-click and keyboard-shortcut triggers, error mapping and the Chrome / Firefox / Safari distribution plan. |
| [izgah-ui-v2.md](./izgah-ui-v2.md) | 2026-11-20 | Gorkem Inanc Ozdemir | App Shell, `FeedView` & `PostCard`, Inline Composer & Paste-to-Share, Keyboard Shortcuts, `izgah_theme` Cookie, Security Headers & CSP, `/api/internal/feed/updates`, Fixed E2E Hooks | Web UI v2: §2 (font loading), §9 (theme cookie), §11 (enforced CSP) and §12 (fixed E2E hooks) remain binding; the visual language, palettes and component layer were replaced by [izgah-ui-v3.md](./izgah-ui-v3.md) and then [izgah-ui-v4.md](./izgah-ui-v4.md). |
| [izgah-themes.md](./izgah-themes.md) | 2026-11-22 | Gorkem Inanc Ozdemir | Light / Dark Palettes (Default, High Contrast), `light-dark()` Token Slots, `izgah_theme_light` / `izgah_theme_dark` Cookies, `/settings?/setPalette` | The mode plus day/night palette mechanism, the `light-dark()` CSS slots and the cookie/SSR implementation remain. Accent colours and the Dim palette were removed in [izgah-ui-v4.md](./izgah-ui-v4.md) §8 (old cookie values fall back to the default); colour values are generated from `tokens/kunye.json` (v4 §11). |
| [izgah-i18n-oss.md](./izgah-i18n-oss.md) | 2026-11-25 | Gorkem Inanc Ozdemir | `src/lib/i18n` (en/tr catalogs, ICU subset, AsyncLocalStorage locale), `izgah_locale` Cookie & `DEFAULT_LOCALE`, `APP_TIME_ZONE` / `INSTANCE_NAME` / `SOURCE_URL`, English Search Stemming, Extension `_locales` & Store Build | English as the base language with a full Turkish translation, runtime instance settings and one store extension: the open-source (AGPL-3.0) self-hosting model. |
| [izgah-roadmap.md](./izgah-roadmap.md) | 2026-11-26 | Gorkem Inanc Ozdemir | Positioning, Moat, Must-haves, Removals, Phases R0–R10 | Product direction after the open-source release; revisits the AI, read-later, mobile share, SMTP and OAuth non-goals of izgah-core. |
| [izgah-smart-capture.md](./izgah-smart-capture.md) | 2026-11-26 | Gorkem Inanc Ozdemir | `#section` Hashtags, History Suggestions, Page Text Search, `enrichment_jobs`, OpenRouter / Anthropic / OpenAI / Gemini / Custom Providers, `/admin/ai`, `instance_settings` | Section suggestions and optional, admin-enabled AI enrichment (summary, keywords, sections) that never slows down sharing. |
| [izgah-ui-v4.md](./izgah-ui-v4.md) | 2026-11-26 | Gorkem Inanc Ozdemir | "Künye" Tokens, One Type Family, Index · Register · Reading Pane, `:visited` Trace, izgah.com | The current visual language, replacing v3: implemented in R3 and refined on 2026-11-26 (§11: one colour source in `tokens/kunye.json`, no icons, feed entry option A, izgah.com specimen). |
| [izgah-ui-v3.md](./izgah-ui-v3.md) | 2026-11-24 | Gorkem Inanc Ozdemir | "Izgah Studio" Design System (Primitive/Semantic/Component Tokens, 5 Palettes × 4 Bipolar Accents), `Newsreader` + `Geist` + `JetBrains Mono`, Three-Column Feed + Right Context Rail (`rail-summary.ts`), `⌘K` Command Palette (`/api/internal/search/quick`), `SidePeekDialog`, `Tooltip`, `Skeleton`, `AvatarStack`, `SegmentedControl`, Extension v3 Alignment | Superseded by v4. The v3 ("Izgah Studio") visual and interaction system: a precise shell, settings and admin, editorial serif headings on warm alabaster and graphite surfaces, a three-column feed with content-aware media cards, and a WCAG 2.2 AA/AAA contrast table for all 20 palette × accent combinations. The command palette, quick search and `SidePeekDialog` remain. |
| [extensions/README.md](../../extensions/README.md) | 2026-11-20 | Gorkem Inanc Ozdemir | Extension Setup, CWS / AMO Permission Justifications, Distribution Channels | Development commands for the isolated `extensions/` package, the Playwright E2E prerequisite, CWS and Firefox AMO permission and privacy statements, and the store, Firefox `.xpi` and macOS Safari Xcode distribution steps. |
| [README.md](../../README.md) | 2026-11-26 | Gorkem Inanc Ozdemir | Overview, Self-hosting, Environment, Development | Project introduction, self-hosting summary, environment variables and local development ([README.tr.md](../../README.tr.md) in Turkish). |
| [docs/deploy/](../deploy/) | 2026-11-25 | Gorkem Inanc Ozdemir | Docker Compose + Caddy, Dokploy, Backups | Step-by-step self-hosting guides, backups and `N -> N-1` rollback. |

## Application and API Routes (izgah-core)

### Web UI Routes

*   `/` ([src/routes/(app)/+page.svelte](../../src/routes/(app)/+page.svelte)) — Reverse-chronological feed, content type filter, cursor pagination and the share form
*   `/sections` ([src/routes/(app)/sections/+page.svelte](../../src/routes/(app)/sections/+page.svelte)) — Section index (the no-JS and mobile tab bar target)
*   `/sections/[slug]` ([src/routes/(app)/sections/[slug]/+page.svelte](../../src/routes/(app)/sections/[slug]/+page.svelte)) — Section feed (regular and silent resources)
*   `/resources/[id]` ([src/routes/(app)/resources/[id]/+page.svelte](../../src/routes/(app)/resources/[id]/+page.svelte)) — Canonical resource details, share history, shared likes and comment thread
*   `/search` ([src/routes/(app)/search/+page.svelte](../../src/routes/(app)/search/+page.svelte)) — Turkish, English and URL-fragment search (scope: the whole instance or this section)
*   `/login` ([src/routes/login/+page.svelte](../../src/routes/login/+page.svelte)) — Sign-in with e-mail and password
*   `/auth/accept-invite` ([src/routes/auth/accept-invite/+page.svelte](../../src/routes/auth/accept-invite/+page.svelte)) — Accept a one-time member invite (valid for 24 hours) and set a password
*   `/auth/reset-password` ([src/routes/auth/reset-password/+page.svelte](../../src/routes/auth/reset-password/+page.svelte)) — One-time password reset (valid for 24 hours)
*   `/settings` ([src/routes/(app)/settings/+page.svelte](../../src/routes/(app)/settings/+page.svelte)) — Account details, language, appearance (mode and palettes), single-key shortcuts and password change
*   `/settings/api-keys` ([src/routes/(app)/settings/api-keys/+page.svelte](../../src/routes/(app)/settings/api-keys/+page.svelte)) — Create and revoke personal API keys
*   `/admin/users` ([src/routes/(app)/admin/users/+page.svelte](../../src/routes/(app)/admin/users/+page.svelte)) — Member management, invite and reset links, roles and deactivation
*   `/admin/sections` ([src/routes/(app)/admin/sections/+page.svelte](../../src/routes/(app)/admin/sections/+page.svelte)) — Create, rename, reorder and delete sections
*   `/admin/unassigned` ([src/routes/(app)/admin/unassigned/+page.svelte](../../src/routes/(app)/admin/unassigned/+page.svelte)) — List shares without a section and file them in bulk
*   `/admin/jobs` ([src/routes/(app)/admin/jobs/+page.svelte](../../src/routes/(app)/admin/jobs/+page.svelte)) — Inspect failed (`dead`) preview jobs and requeue them
*   `/admin/audit` ([src/routes/(app)/admin/audit/+page.svelte](../../src/routes/(app)/admin/audit/+page.svelte)) — Admin action and security audit log (`audit_logs`)
*   `/admin/metrics` ([src/routes/(app)/admin/metrics/+page.svelte](../../src/routes/(app)/admin/metrics/+page.svelte)) — Active sharing and searching members, channel mix and zero-result rate
*   `/admin/ai` ([src/routes/(app)/admin/ai/+page.svelte](../../src/routes/(app)/admin/ai/+page.svelte)) — Smart capture: history suggestions, optional AI provider, key, model, features, privacy, limits and the enrichment queue ([izgah-smart-capture.md](./izgah-smart-capture.md))

### HTTP API and System Endpoints

*   `GET /api/v1/me` ([src/routes/api/v1/me/+server.ts](../../src/routes/api/v1/me/+server.ts)) — Current user and role for a Bearer API key
*   `GET /api/v1/sections` ([src/routes/api/v1/sections/+server.ts](../../src/routes/api/v1/sections/+server.ts)) — Ordered section list
*   `GET /api/v1/links/check` ([src/routes/api/v1/links/check/+server.ts](../../src/routes/api/v1/links/check/+server.ts)) — Canonical URL resolution and early duplicate check
*   `POST /api/v1/links` ([src/routes/api/v1/links/+server.ts](../../src/routes/api/v1/links/+server.ts)) — Create a share and queue its preview job
*   `OPTIONS /api/v1/*` ([src/hooks.server.ts](../../src/hooks.server.ts)) — CORS preflight responses for the browser extensions
*   `ALL /api/auth/[...all]` ([src/routes/api/auth/[...all]/+server.ts](../../src/routes/api/auth/[...all]/+server.ts)) — Better Auth session endpoints (`sign-in/email`, `sign-out`, `get-session`)
*   `POST /logout` ([src/routes/logout/+server.ts](../../src/routes/logout/+server.ts)) — End the cookie session and redirect to `/login`
*   `GET /api/internal/links/check` ([src/routes/api/internal/links/check/+server.ts](../../src/routes/api/internal/links/check/+server.ts)) — Cookie- and `Origin`-guarded early duplicate check for the web share form
*   `GET /api/internal/feed/updates` ([src/routes/api/internal/feed/updates/+server.ts](../../src/routes/api/internal/feed/updates/+server.ts)) — Number of new shares after `afterId` for visible tabs (`{ newCount }`, at most `100`)
*   `GET /api/internal/search/quick` ([src/routes/api/internal/search/quick/+server.ts](../../src/routes/api/internal/search/quick/+server.ts)) — Cookie- and `Origin`-guarded quick search for the `⌘K` command palette, built on `searchResources(..., { recordLog: false })` (at most `6` results, nothing written to `search_logs`, `120` requests per minute per session)
*   `GET / POST /api/internal/notifications` ([src/routes/api/internal/notifications/+server.ts](../../src/routes/api/internal/notifications/+server.ts)) — Unread notifications for visible tabs and marking them read
*   `GET /media/thumbnails/[assetKey]` ([src/routes/media/thumbnails/[assetKey]/+server.ts](../../src/routes/media/thumbnails/[assetKey]/+server.ts)) — Local WebP thumbnails for authenticated sessions or API keys
*   `GET /healthz` ([src/routes/healthz/+server.ts](../../src/routes/healthz/+server.ts)) — Process liveness (the [Dockerfile](../../Dockerfile) `HEALTHCHECK` target)
*   `GET /readyz` ([src/routes/readyz/+server.ts](../../src/routes/readyz/+server.ts)) — Readiness: PostgreSQL, migration state and a writable `MEDIA_STORAGE_DIR` (`/data/thumbnails`)

### Operations, Migration and Backup Entry Points

*   `node build/index.js` ([src/hooks.server.ts](../../src/hooks.server.ts)) — Production HTTP server and in-process preview worker (PID 1 via `exec` in [scripts/docker-entrypoint.sh](../../scripts/docker-entrypoint.sh))
*   `node build/migrate.js` ([src/lib/server/db/migrate.ts](../../src/lib/server/db/migrate.ts)) — Single-connection `drizzle/` migration runner under `pg_advisory_lock(74829104)`
*   `node build/cli.js` ([src/cli.ts](../../src/cli.ts)) — Recovery CLI for the first admin and password resets (`create-admin`, `reset-admin`)
*   [scripts/docker-entrypoint.sh](../../scripts/docker-entrypoint.sh) — Container start-up checks, migrations and hand-over to the server
*   [scripts/pre-deploy-backup.sh](../../scripts/pre-deploy-backup.sh) — Manual `pg_dump -Fc` backup on the host before releases with schema migrations
*   [scripts/offbox-backup.sh](../../scripts/offbox-backup.sh) — Daily `pg_dump -Fc` plus `/data/thumbnails` backup to off-site S3-compatible storage

## Browser Extensions (`extensions/`)

*   [extensions/wxt.config.ts](../../extensions/wxt.config.ts) — WXT MV3 manifest generator (Chrome / Firefox / Safari, narrowest permissions, `Alt+Shift+I`, Gecko settings)
*   [extensions/src/entrypoints/background.ts](../../extensions/src/entrypoints/background.ts) — The "Add to Izgah" context menu, `action.openPopup()` with a standalone window fallback, and the hand-over of session context
*   [extensions/src/entrypoints/popup/main.ts](../../extensions/src/entrypoints/popup/main.ts) — Share popup controller (live duplicate check, sections and content type, admin silent adds, error mapping)
*   [extensions/src/entrypoints/options/main.ts](../../extensions/src/entrypoints/options/main.ts) — Options page controller (server origin normalisation, API key validation, `/api/v1/me` test)
*   [extensions/src/lib/api-client.ts](../../extensions/src/lib/api-client.ts) — `/api/v1/*` HTTP client with `X-Client-Name`, `X-Client-Version` and a 10-second timeout
*   [extensions/scripts/verify-manifests.mjs](../../extensions/scripts/verify-manifests.mjs) — Checks the Chrome / Firefox / Safari MV3 manifests, port-less origins (`--require-https-origin`) and PNG IHDR headers
*   [extensions/scripts/build-safari.mjs](../../extensions/scripts/build-safari.mjs) — WXT Safari build and `xcrun safari-web-extension-converter` (`--require-xcode`) wrapper
*   [extensions/tests/e2e/extension-popup-and-options.spec.ts](../../extensions/tests/e2e/extension-popup-and-options.spec.ts) — End-to-end tests of the unpacked MV3 extension in Chromium (`CUJ 1`–`CUJ 5`)
*   [extensions/README.md](../../extensions/README.md) — Developer setup, permission and privacy justifications, and distribution guides for the three browsers
