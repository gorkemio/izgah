# Izgah — Project Rules for Contributors and Coding Agents

## Product
- **Izgah** is an open-source (AGPL-3.0), self-hosted link library for small teams: members share useful links into a reverse-chronological feed, organise them in admin-managed sections, discuss and search them. Each team runs its own instance on its own domain; [izgah.com](https://izgah.com) only describes the project.
- Chrome, Firefox and Safari extensions (`extensions/`) share the current tab through `/api/v1` with a personal API key.

## Rules
- **Language:** code, identifiers, comments and commit messages are in English. The UI is English-first with a full Turkish translation (`docs/designs/izgah-i18n-oss.md`).
- **No hard-coded UI text:** add every user-facing string to `src/lib/i18n/messages/en.ts` and `tr.ts` and use `t('key')`; extension strings go to `extensions/public/_locales/{en,tr}/messages.json` and `msg('key')`. Never call `t()` at module scope on the server (it would freeze one language); build schemas and label maps per request.
- **Design documents:** approved designs live in `docs/designs/`. If code contradicts a document, or a decision is needed that no document covers, stop and ask the maintainer.
- **Platform first:** before adding a component, form, animation, accessibility, security or performance feature in the front end, run `npx modern-web-guidance@latest search "<need>"`, `retrieve` the matching guide and follow it. Prefer native platform APIs (`<dialog>`, `popover`, View Transitions, container queries, `Intl`) over heavy libraries and polyfills.
- **Browser support:** the last two major versions of Chrome, Firefox and Safari. Features that are not Baseline "widely available" are progressive enhancements only.
- **Works without JavaScript:** core flows are forms and links first; JavaScript enhances them.
- **Definition of done:** a change is not finished until `pnpm lint`, `pnpm check` and `pnpm test` pass (and the same in `extensions/` for extension changes; `pnpm test:e2e` for UI changes).
- **Secrets and environment:** never commit `.env` files (keep `.env.example` as the template). Never embed secrets in client code or the browser extensions. Instance settings are runtime environment variables (`DEFAULT_LOCALE`, `APP_TIME_ZONE`, `INSTANCE_NAME`, `SOURCE_URL`, …), never build-time constants.
