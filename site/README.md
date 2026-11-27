# izgah.com

The static project site, published to GitHub Pages by `.github/workflows/site.yml` whenever `site/` changes on `main`. No build step: plain HTML and CSS, English at `/` and Turkish at `/tr/`.

Preview locally with any static server, e.g. `npx -y serve site`.

GitHub Pages lets browsers cache every file for 10 minutes, so a new page can meet an old stylesheet right after a deploy. Both pages link `palette.css?v=<version>`, `styles.css?v=<version>` and `site.js?v=<version>`: when you change any of them, set the same new version in `index.html` and `tr/index.html` so browsers fetch the matching files at once.

`palette.css` is generated from `tokens/izgah.json`, the colour source shared with the app and the extensions: edit the JSON and run `pnpm tokens` at the repository root, never the CSS.

## Domain setup (once)

1. In the repository settings → **Pages**, set **Source** to **GitHub Actions** and the custom domain to `izgah.com` (the `CNAME` file keeps it).
2. At your DNS provider, point the apex `izgah.com` to GitHub Pages with `A` records `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153` (and `AAAA` `2606:50c0:8000::153`, `2606:50c0:8001::153`, `2606:50c0:8002::153`, `2606:50c0:8003::153`), and add `CNAME www → <owner>.github.io`.
3. Enable **Enforce HTTPS** once the certificate is issued.

The page is set in the app's v5 type and colours (Geist and the Jade palette, `docs/designs/izgah-ui-v5.md` §12) and follows the system's light or dark scheme. Product images in `assets/shots/` are real screenshots of the app running on the local demo data (`pnpm seed:demo`), in English and Turkish, light and dark, as WebP; retake them when the interface changes visibly, and keep `docs/images/feed-*.png` (the README images) in step. The feature tiles' small vignettes are plain HTML and marked `aria-hidden`. `site.js` only adds the Copy button to the install commands. `assets/og.png` and `assets/og-tr.png` are 1200×630 captures of the top of each page for link previews; retake them when the opening text changes.
