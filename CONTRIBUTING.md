# Contributing to Izgah

Thanks for helping! Izgah is a small project, so the process is light.

## Before you start

- For anything bigger than a bug fix, open an issue first so we can agree on the approach.
- Design decisions live in [`docs/designs/`](./docs/designs). If your change contradicts an approved design, or needs a decision the documents do not cover, raise it in the issue before writing code.
- Security problems: please follow [SECURITY.md](./SECURITY.md) instead of opening a public issue.

## Development setup

See the [quick start in the README](./README.md#quick-start-development). In short: `pnpm install`, `cp .env.example .env`, `docker compose up -d`, `pnpm db:migrate`, `pnpm dev`.

The browser extensions are a separate package: `pnpm --dir extensions install`.

## Definition of done

A change is ready when all of these pass:

```sh
pnpm lint && pnpm check && pnpm test
pnpm test:e2e                 # for UI changes
pnpm --dir extensions lint && pnpm --dir extensions check && pnpm --dir extensions test   # for extension changes
```

## Guidelines

- **Language:** code, identifiers, comments and commit messages are in English.
- **UI text:** never hard-code user-facing strings. Add a key to `src/lib/i18n/messages/en.ts` and the same key to `tr.ts` (the type checker and `tests/unit/i18n-messages.test.ts` fail if a locale is missing a key or a placeholder). Extension strings live in `extensions/public/_locales/{en,tr}/messages.json`.
- **Platform first:** prefer native platform features (`<dialog>`, `popover`, View Transitions, container queries, `Intl`) over libraries and polyfills. Features that are not Baseline "widely available" must be progressive enhancements. We support the last two major versions of Chrome, Firefox and Safari.
- **Works without JavaScript:** core flows are forms and links first; JavaScript enhances them.
- **Design tokens:** components use semantic tokens (`--color-*`, `--space-*`, `--radius-*`, `--text-*`) from `src/lib/styles/tokens.css`, never raw colours or ad-hoc sizes. Colours come from `tokens/kunye.json`: edit it and run `pnpm tokens`, never the generated `palette.css` files.
- **Accessibility:** WCAG 2.2 AA in every palette. The Playwright a11y tour (`tests/e2e/m15-a11y-tour.spec.ts`) checks contrast with axe.
- **Secrets:** never commit `.env` files, and never embed secrets in client code or the extensions.
- **Database:** migrations are generated with `pnpm db:generate` and must be expand-and-contract safe (version N must not break N-1).

## Commits and pull requests

- Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:` …).
- Keep pull requests focused; include screenshots for UI changes (light and dark).
- By contributing you agree that your contribution is licensed under the [AGPL-3.0](./LICENSE).

## Translations

English (`en`) is the source language. To add a language:

1. Add the code to `LOCALES` in `src/lib/i18n/locales.ts` (plus its `Intl` tag and native name).
2. Copy `src/lib/i18n/messages/en.ts` to `<code>.ts` and translate the values; keep `{placeholders}` and `{count, plural, …}` blocks intact.
3. Add `extensions/public/_locales/<code>/messages.json`.
4. Run `pnpm check && pnpm test`.
