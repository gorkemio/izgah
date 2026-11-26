# Künye prototype

Static pages for the review gate in [izgah-ui-v4.md](../../izgah-ui-v4.md) §9. The app does not load anything from this folder.

| Page | Shows |
| :--- | :--- |
| [index.html](./index.html) | Feed: index, register and the docked reading pane (≥ 1280 px); a history suggestion and an AI-added section; mobile layout below 768 px |
| [resource.html](./resource.html) | Resource page with the AI summary, share history and discussion |
| [share.html](./share.html) | Share form with a suggested section and the `#section` hint |
| [admin-ai.html](./admin-ai.html) | `/admin/ai` ("Smart capture") |
| [site.html](./site.html) | izgah.com, built from the same stylesheet |

The yellow panel in the corner switches the theme, the font (A: Ysabeau Office, B: Atkinson Hyperlegible Next, the chosen one and the default) and the wordmark variant (2, "iz" + "gah", is the chosen one and the default). Settings live in the URL (`?theme=dark&font=b&mark=2`); `&shot=1` hides the panel for screenshots.

View it with any static server, for example:

```sh
python3 -m http.server 4180 --bind 127.0.0.1 --directory docs/designs/prototypes/kunye
```

Notes:

*   Names, notes and counts are demo data. Link titles are the real titles of the linked pages, except the YouTube video.
*   Browsers don't let pages fake `:visited`, so the `demo-visited` class shows how an opened link looks.
*   Fonts are copied from `@fontsource-variable/ysabeau-office` and `@fontsource-variable/atkinson-hyperlegible-next` (SIL Open Font License, see `fonts/`).
