# Izgah

**Your team's shared link library.** Izgah is a small, self-hosted place where a team collects the useful links it finds on the internet — videos, repositories, social posts, articles and web pages — and discusses and searches them later, instead of losing them in a chat group.

[izgah.com](https://izgah.com) · [Self-hosting](#self-hosting) · [Browser extensions](#browser-extensions) · [Türkçe README](./README.tr.md)

> izgah.com is the project website. It does **not** host an instance: every team runs Izgah on its own server and domain.

## Features

- **Feed** — a reverse-chronological stream of shared links with content-aware cards (video, repo, social, article, web), likes, comments and "new posts" updates.
- **Sections** — admin-managed topics. A link can live in several sections, and admins can add "silent" links to sections without posting them to the feed.
- **Search** — full-text search across titles, descriptions, notes and URL parts, in English and Turkish, plus a `⌘K` / `Ctrl+K` command palette.
- **Smart capture** — `#section` in a note files the link; sections are suggested from your team's history; admins can optionally connect OpenRouter, Anthropic, OpenAI, Gemini or a local OpenAI-compatible model for short summaries, search keywords and section suggestions. Off until configured; page text is searchable.
- **Link previews** — an in-process unfurl worker fetches titles, descriptions and cover images (with SSRF protection) and stores resized WebP thumbnails locally.
- **Browser extensions** — Chrome, Firefox and Safari extensions share the current tab with a personal API key.
- **Works without JavaScript** — every core flow (sharing, navigation, search, details, themes, admin) is a plain form or link first; JavaScript only enhances it.
- **Accessible themes** — light and dark, each in a standard and a high-contrast palette, all meeting WCAG 2.2 AA (AAA in high contrast). Links you have opened fade, through the browser's own `:visited`; the server records nothing.
- **English and Turkish UI** — each member picks a language; the instance has its own default.
- **Small footprint** — one Node.js container and PostgreSQL. No external e-mail, queue or cache service.

## Tech stack

SvelteKit 2 (Svelte 5) on Node.js 22 · PostgreSQL 16 (`unaccent`, `pg_trgm`) · Drizzle ORM · Better Auth · WXT for the browser extensions.

## Quick start (development)

Requirements: Node.js ≥ 22, pnpm, Docker (for PostgreSQL).

```sh
pnpm install
cp .env.example .env          # then set BETTER_AUTH_SECRET to a random 32+ character value
docker compose up -d          # local PostgreSQL with the izgah and izgah_test databases
pnpm db:migrate
pnpm cli create-admin --email admin@example.com --name "First Admin"   # prints a one-time invite link
pnpm dev
```

Open the printed invite link to set the admin password, then invite your team from **Admin → Members**.

Checks (all must pass before a change is done):

```sh
pnpm lint
pnpm check
pnpm test        # unit + PostgreSQL integration tests
pnpm test:e2e    # Playwright (Chromium, Firefox, WebKit, mobile)
```

## Self-hosting

Izgah ships as a single Docker image. A production setup is the app container, PostgreSQL 16 and a persistent volume for thumbnails, behind a reverse proxy that terminates HTTPS.

```sh
export POSTGRES_PASSWORD='…' BETTER_AUTH_SECRET='…' ORIGIN='https://links.example.com'
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml exec app node build/cli.js create-admin --email you@example.com --name "Admin"
```

The app port binds to `127.0.0.1` only. Always put a reverse proxy (Caddy, Traefik, Nginx) in front of it; otherwise clients could forge `X-Forwarded-For` and bypass per-IP rate limits.

Step-by-step guides:

- [Docker Compose + Caddy](./docs/deploy/docker-compose.md)
- [Dokploy](./docs/deploy/dokploy.md)

### Environment variables

| Name                    | Required           | Default            | Description                                                                                              |
| :---------------------- | :----------------- | :----------------- | :------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`          | yes                | —                  | PostgreSQL connection URI.                                                                               |
| `BETTER_AUTH_SECRET`    | yes                | —                  | Session signing secret (at least 32 characters).                                                         |
| `ORIGIN`                | yes, in production | —                  | Public HTTPS origin of your instance (e.g. `https://links.example.com`); used for CSRF and invite links. |
| `DEFAULT_LOCALE`        | no                 | `en`               | Language for members who have not picked one (`en` or `tr`).                                             |
| `APP_TIME_ZONE`         | no                 | `UTC`              | IANA time zone used for dates and "today" (e.g. `Europe/Istanbul`).                                      |
| `INSTANCE_NAME`         | no                 | `Izgah`            | Name shown in the sidebar, sign-in page and browser tab titles.                                          |
| `SOURCE_URL`            | no                 | this repository    | Link to the source code shown in Settings (AGPL-3.0 §13). Point it at your fork if you modify Izgah.     |
| `ADMIN_BOOTSTRAP_EMAIL` | no                 | —                  | When no active admin exists, logs a one-time setup link for this address on startup.                     |
| `GITHUB_TOKEN`          | no                 | —                  | Read-only token that raises GitHub API limits for repository previews.                                   |
| `DATABASE_POOL_MAX`     | no                 | `12`               | PostgreSQL pool size.                                                                                    |
| `HOST` / `PORT`         | no                 | `0.0.0.0` / `3000` | HTTP listen address.                                                                                     |
| `ADDRESS_HEADER`        | no                 | `x-forwarded-for`  | Header that carries the real client IP behind your proxy.                                                |
| `XFF_DEPTH`             | no                 | `1`                | Number of trusted proxies in front of the app.                                                           |
| `MEDIA_STORAGE_DIR`     | no                 | `/data/thumbnails` | Persistent directory for WebP thumbnails.                                                                |
| `MEDIA_MIN_FREE_BYTES`  | no                 | `536870912`        | Stop writing thumbnails below this much free disk space.                                                 |
| `MEDIA_MIN_FREE_RATIO`  | no                 | `0.15`             | Stop writing thumbnails below this free-space ratio.                                                     |
| `UNFURL_CONCURRENCY`    | no                 | `3`                | Parallel link-preview jobs.                                                                              |
| `LOG_LEVEL`             | no                 | `info`             | JSON log level (`debug`, `info`, `warn`, `error`).                                                       |
| `AI_FEATURES`           | no                 | `on`               | `off` hides the optional AI settings (Admin → Smart capture) and stops all AI calls.                     |
| `AI_CONCURRENCY`        | no                 | `1`                | Parallel enrichment jobs (1–4).                                                                          |

### Admin recovery

```sh
# Create another admin (prints a one-time invite link):
docker exec -it <app-container> node build/cli.js create-admin --email admin@example.com --name "Admin"
# 24-hour password reset link for an existing admin:
docker exec -it <app-container> node build/cli.js reset-admin --email admin@example.com
```

Both commands are written to the audit log and revoke the account's sessions and API keys.

### Backups

`scripts/offbox-backup.sh` (daily `pg_dump` + thumbnails to S3-compatible storage) and `scripts/pre-deploy-backup.sh` (manual dump before releases with migrations) run on the host. See [docs/deploy/dokploy.md](./docs/deploy/dokploy.md#backups) for cron examples and a restore drill.

## Browser extensions

The extensions live in [`extensions/`](./extensions). Members install the extension, open its options, enter **their instance's address** and a personal API key from **Settings → API keys**. No address is built in, so one published extension works with every Izgah instance; teams can also build their own copy with a fixed address. See [extensions/README.md](./extensions/README.md).

## Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) — how the pieces fit together.
- [docs/designs/](./docs/designs) — approved design documents (in Turkish; the project started as a Turkish team tool).
- [CONTRIBUTING.md](./CONTRIBUTING.md) — development workflow, translations and pull requests.
- [SECURITY.md](./SECURITY.md) — how to report a vulnerability.

## License

Izgah is free software under the [GNU Affero General Public License v3.0](./LICENSE). If you run a modified version for others over a network, you must offer them its source code. The bundled font (Atkinson Hyperlegible Next) is under the SIL Open Font License; icons are from Lucide (ISC). See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
