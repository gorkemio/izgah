# Izgah browser extensions

Manifest V3 extensions for **Chrome**, **Firefox** (≥ 128) and **macOS Safari** that share the current page or a right-clicked link to an Izgah instance through its `/api/v1` API, using the member's personal API key.

This directory is a separate package (its own `package.json`, lockfile, build output and tests). Design: [docs/designs/izgah-extensions.md](../docs/designs/izgah-extensions.md) and [docs/designs/izgah-i18n-oss.md](../docs/designs/izgah-i18n-oss.md) §7. The UI is localized (English, Turkish) through `public/_locales/`.

## Two kinds of builds

| Build                                                    | Command                                                     | Server address                             | Host permission                                         |
| :------------------------------------------------------- | :---------------------------------------------------------- | :----------------------------------------- | :------------------------------------------------------ |
| **Store build** — one extension for every Izgah instance | `pnpm build:store` / `pnpm zip:store`                       | entered by each member in the options page | none (requests use the server's `/api/v1` CORS headers) |
| **Instance build** — a private copy for one team         | `WXT_IZGAH_ORIGIN=https://links.example.com pnpm build:all` | built in as the default                    | `https://links.example.com/api/v1/*` only               |

Members of any instance can use the store build: install it, open its options, enter the instance address and paste a personal API key from **Settings → API keys** in the web app.

## Setup

Requirements: Node.js ≥ 22 and pnpm.

```sh
pnpm --dir extensions install
cp extensions/.env.example extensions/.env      # optional; .env is never committed
pnpm --dir extensions exec playwright install chromium   # for the E2E tests
```

| Variable                | Default                 | Purpose                                                                                                                      |
| :---------------------- | :---------------------- | :--------------------------------------------------------------------------------------------------------------------------- |
| `WXT_IZGAH_STORE_BUILD` | unset                   | `1` builds the store variant (no default address, no host permission).                                                       |
| `WXT_IZGAH_ORIGIN`      | `http://localhost:3000` | Default server and the single `host_permissions` entry of instance builds. `https://` is required outside local development. |
| `WXT_GECKO_ID`          | `extension@izgah.com`   | Firefox add-on ID (`browser_specific_settings.gecko.id`). Use your own ID for a private instance build.                      |
| `SAFARI_BUNDLE_ID`      | `com.izgah.extension`   | Bundle ID of the Safari container app.                                                                                       |
| `DEVELOPMENT_TEAM`      | unset                   | Apple Developer team ID for signing.                                                                                         |

Personal API keys (`izk_…`) are never built into the extension; each member enters their own in the options page (`browser.storage.local`).

## Development and checks

```sh
pnpm --dir extensions dev            # Chrome (dev:firefox for Firefox)
pnpm --dir extensions lint
pnpm --dir extensions check
pnpm --dir extensions test           # Vitest
pnpm --dir extensions test:e2e       # Playwright + Chrome MV3
pnpm --dir extensions verify:manifests                         # instance builds
pnpm --dir extensions verify:manifests -- --require-https-origin
```

Load an unpacked build: Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → `extensions/.output/chrome-mv3/`; Firefox → `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → `extensions/.output/firefox-mv3/manifest.json`; Safari → `pnpm --dir extensions build:safari` (needs full Xcode), open the generated `extensions/safari/` project and enable **Allow unsigned extensions** in Safari's Developer settings.

## Triggers

- **Keyboard:** `Alt+Shift+I` opens the share popup (`commands._execute_action`); change it in `chrome://extensions/shortcuts`, Firefox's **Manage Extension Shortcuts** or Safari settings.
- **Context menu:** "Share to Izgah" on pages and links. It opens the toolbar popup where supported and falls back to `popup.html?mode=standalone`; the context is kept in `browser.storage.session` (`izgah_pending_share_v1`) for at most 10 seconds and consumed once.

## Store listing: permissions and privacy

- **Single purpose:** save the page or link the user explicitly chose to their own team's Izgah server, after checking whether the team already shared it.
- **`activeTab`:** read the active tab's URL and title only when the user clicks the toolbar button or presses the shortcut. No background tab access, no browsing history.
- **`contextMenus`:** show the "Share to Izgah" item on the page or link the user right-clicked.
- **`storage`:** `storage.local` (`izgah_settings_v1`) keeps the server address, API key and last verified profile on the device only (`storage.sync` is not used); `storage.session` keeps the right-click context (10 s) and a sections/profile cache (60 s).
- **Host access:** the store build requests none. Requests go only to the address the user entered, and only to its `/api/v1/*` endpoints, relying on the server's `Access-Control-Allow-Origin` header. Instance builds request access to that single `/api/v1/*` origin.
- **Data and code:** no remote code (`script-src 'self'; object-src 'none'`), no analytics or telemetry, nothing sold or shared with third parties (`data_collection_permissions.required: ['none']`).

## Publishing

### Store build (recommended, serves every instance)

```sh
pnpm --dir extensions zip:store
```

Upload the Chrome zip to the Chrome Web Store (public listing) and the Firefox zip plus its `-sources.zip` to addons.mozilla.org. Paste the permissions and privacy text above into the review forms.

### Private instance build

```sh
WXT_IZGAH_ORIGIN=https://links.example.com WXT_GECKO_ID=links@example.com pnpm --dir extensions build:all
WXT_IZGAH_ORIGIN=https://links.example.com pnpm --dir extensions verify:manifests -- --require-https-origin
```

Publish as **Unlisted** on the Chrome Web Store, or sign an unlisted `.xpi` on AMO ("On your own") and share it with your team.
