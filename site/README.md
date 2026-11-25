# izgah.com

The static project site, published to GitHub Pages by `.github/workflows/site.yml` whenever `site/` changes on `main`. No build step: plain HTML and CSS, English at `/` and Turkish at `/tr/`.

Preview locally with any static server, e.g. `npx -y serve site`.

## Domain setup (once)

1. In the repository settings → **Pages**, set **Source** to **GitHub Actions** and the custom domain to `izgah.com` (the `CNAME` file keeps it).
2. At your DNS provider, point the apex `izgah.com` to GitHub Pages with `A` records `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153` (and `AAAA` `2606:50c0:8000::153`, `2606:50c0:8001::153`, `2606:50c0:8002::153`, `2606:50c0:8003::153`), and add `CNAME www → <owner>.github.io`.
3. Enable **Enforce HTTPS** once the certificate is issued.

Screenshots in `assets/` come from a local instance with demo data (1440×900, light and dark, English and Turkish).
