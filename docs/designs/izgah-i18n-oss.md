# Izgah — English-first i18n and open-source self-hosting

*   **Author:** Gorkem Inanc Ozdemir
*   **Status:** Approved
*   **Date:** 2026-11-25

--------------------------------------------------------------------------------

## Overview

Izgah started as a Turkish-only tool for one team. It is now an open-source project (AGPL-3.0) that any team self-hosts on its own domain; [izgah.com](https://izgah.com) only describes the project. This document records the decisions that follow from that:

1.  **English is the base language, Turkish is a full second language.** Members choose their language; each instance has its own default.
2.  **Nothing instance-specific is built in.** Time zone, instance name and default language are runtime settings; the browser extension works with any instance.

It supersedes the "UI text is Turkish (`tr-TR`)" rule in `AGENTS.md` and narrows [izgah-ui-v3.md](./izgah-ui-v3.md) §10: the fixed accessible names listed there are now the **Turkish** strings of the stable E2E contract (tests run with `DEFAULT_LOCALE=tr`); the English strings are their counterparts.

## Goals

*   Every user-facing string of the web app, server responses and the browser extensions exists in `en` and `tr`; a missing key fails `pnpm check`.
*   Language is resolved without a URL prefix (it is a closed app; links shared inside a team must work for every member).
*   Server-rendered HTML, hydration and JavaScript-off flows all use the same language — no flash, no mismatch.
*   No build-time network access and no heavy dependency.

## Non-goals

*   Translating user content (notes, comments, link titles).
*   Right-to-left languages (the formatter and `lang` attribute are ready, but no RTL locale ships now).
*   Translating the Turkish design documents in `docs/designs/`.

## Design

### 1. Message catalogs (`src/lib/i18n`)

*   `messages/en.ts` — the source of truth: a flat `as const` object of `key → template` (≈ 810 keys). `MessageKey` is derived from it, so `t('unknown.key')` is a type error.
*   `messages/tr.ts` — typed `Record<MessageKey, string>`, so a missing or extra key is a type error. `tests/unit/i18n-messages.test.ts` also checks that both locales use the same placeholders.
*   Templates are plain strings with a small ICU subset handled by `format.ts`: `{name}` and `{count, plural, =0 {…} one {# item} other {# items}}` (`#` is the locale-formatted number, branches via `Intl.PluralRules`).
*   Keys are dot-separated by area (`nav.feed`, `admin.users.invite`, `errors.rateLimited`).

**Why not Paraglide JS?** It was the first candidate. Its current version loads its message-format plugin from a CDN at build time, which makes Docker and CI builds depend on network access to a third-party host, and adds a code generation step for ~1,000 messages that a 100-line typed module covers. Both catalogs are bundled (≈ 15 KB gzip each); this is acceptable for a team-sized app and keeps message lookup synchronous.

### 2. Locale resolution

Order, on every request (`hooks.server.ts`):

1.  `izgah_locale` cookie — the member's explicit choice (Settings → Language). Same pattern as the theme cookie: a JS-off form posts to `/settings?/setLocale`, which sets the cookie and redirects back.
2.  `DEFAULT_LOCALE` environment variable — the instance default (`en` if unset).

There is deliberately no `Accept-Language` step: a team decides its default once, and members override it explicitly.

The resolved locale is stored in an `AsyncLocalStorage` scope around the whole `handle` (`src/lib/server/i18n.ts`), so server code (`t()` in services, form actions and API errors) reads it without threading parameters. `transformPageChunk` writes it to `<html lang="%izgah.lang%">`. In the browser, `getLocale()` reads `document.documentElement.lang`; changing the language always reloads the page, so no reactive lookups are needed.

Server values that are evaluated at import time cannot be translated (they would freeze in one language). Validation schemas with messages are therefore built per request (`createLinkBodySchema()`), and label maps are functions (`auditActionLabels()`).

Code outside a request (CLI, the unfurl worker, tests) uses the instance default via `setFallbackLocale()`.

### 3. Formatting

*   Dates (`src/lib/format/date.ts`): `Intl.DateTimeFormat` per locale, cached; day headings use `Intl.RelativeTimeFormat` for "Today"/"Yesterday" and weekday names from `Intl`.
*   Numbers: `formatNumber` / `formatCompactNumber` (`19.8K` / `19,8 B`).
*   Time zone: `APP_TIME_ZONE` (runtime, default `UTC`) replaces the hard-coded `Europe/Istanbul`, both for formatting and for the SQL "start of today" in the feed rail. The server writes it to `<html data-tz>` so browser-side formatting uses the same zone (`src/lib/instance.ts`).

### 4. Server messages and stored errors

*   Form `fail()` payloads, `error()` messages and `/api/v1` JSON errors are translated with the request locale. `/api/v1` errors keep their stable `code` field; clients should switch on `code`, not on `message`.
*   Diagnostics that are stored or logged — unfurl job errors (`unfurl_jobs.last_error_message`), safe-fetch and adapter messages, CLI output — are written in English. They are operator-facing, and the stable `last_error_code` is shown next to them in the admin queue.

### 5. Search

A new migration adds `english` stemming to the resource and note `tsvector` triggers (next to `simple` and `turkish`, all over `unaccent`) and backfills existing rows; queries OR the `english` `websearch_to_tsquery` with the existing two. Highlighting folds case with the active locale and treats `ı/i` as equal in both languages.

### 6. Instance settings (runtime environment)

| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `DEFAULT_LOCALE` | `en` | Default UI language (`en`, `tr`). |
| `APP_TIME_ZONE` | `UTC` | IANA time zone for dates and "today" (validated at start-up). |
| `INSTANCE_NAME` | `Izgah` | Name in the sidebar wordmark, sign-in page and `<title>` (`<meta name="application-name">`). |
| `SOURCE_URL` | `https://github.com/gorkemio/izgah` | "Source code" link in Settings (AGPL-3.0 §13). |

### 7. Browser extension

*   UI strings and manifest fields use the WebExtension i18n API (`_locales/{en,tr}/messages.json`, `default_locale: "en"`, `__MSG_*__` in the manifest); the browser picks the language.
*   **Store build** (`WXT_IZGAH_STORE_BUILD=1`): no `host_permissions` and no built-in server address. Members enter their instance's address in the options page; requests rely on the existing `Access-Control-Allow-Origin: *` on `/api/v1` (Bearer keys, never cookies), which the extension already used for non-default addresses. One published extension therefore serves every instance and asks for no host permission at install.
*   **Self build** (`WXT_IZGAH_ORIGIN=https://links.example.com`): unchanged behaviour — that address is the default and the only host permission.

### 8. Testing

*   Unit and integration tests run with `DEFAULT_LOCALE=tr`, `APP_TIME_ZONE=Europe/Istanbul` and `INSTANCE_NAME=İzgah` (`vitest.config.ts`, `tests/setup/locale.ts`), and the Playwright web server starts with the same values, so the existing Turkish assertions keep guarding the stable accessible-name contract. The extension's unit tests pin the Turkish catalog the same way (`extensions/tests/setup-locale.ts`).
*   `tests/unit/i18n-messages.test.ts` and `i18n-english.test.ts` cover the formatter, plurals, catalog key/placeholder parity and English formatting; `tests/integration/m14-i18n.test.ts` covers locale resolution, request scoping across `await` and English stemming in search; `extensions/tests/unit/i18n.test.ts` covers the extension catalogs.
*   `tests/e2e/m16-i18n.spec.ts` covers English via the cookie, switching language with and without JavaScript, `lang` on `<html>`, and translated server errors.

## Alternatives considered

*   **URL-prefixed locales (`/en/…`, `/tr/…`).** Better for public SEO, worse for a closed team app: shared links would force the sharer's language on the reader. Rejected.
*   **Paraglide JS / i18next.** See §1. i18next additionally ships a runtime several times larger than the catalogs.
*   **Store the language on the user row.** Would need a migration and an extra query per request for no benefit over a long-lived cookie; can be added later if members want the choice to follow them across devices.

## Risks

| Risk | Mitigation |
| :--- | :--- |
| A string is missed and stays Turkish | Keys are typed; an AST sweep for Turkish literals was run over `src/` before merge; English E2E pass over the main screens. |
| Translations drift (placeholder renamed in one locale) | Parity test on keys and placeholders. |
| Changing `APP_TIME_ZONE` shifts "today" boundaries | Documented as an install-time setting. |
