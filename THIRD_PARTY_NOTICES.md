# Third-party notices

Izgah bundles the following third-party assets. Their licenses apply to those files only.

| Component                                                                                                                                       | Where                     | License                   |
| :---------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------ | :------------------------ |
| [Atkinson Hyperlegible Next](https://github.com/googlefonts/atkinson-hyperlegible-next) (via `@fontsource-variable/atkinson-hyperlegible-next`) | web app, extensions, site | SIL Open Font License 1.1 |

The latin subset of Atkinson Hyperlegible Next in `src/lib/fonts/`, `extensions/src/styles/fonts/` and `site/assets/fonts/` is a Modified Version under the OFL: its zero is unslashed (`scripts/fonts/plain-zero.py`) and it is renamed "Atkinson Hyperlegible Next Izgah". The latin-ext subset is unmodified.

The full text of the SIL Open Font License is in [`extensions/public/OFL.txt`](./extensions/public/OFL.txt).

Runtime npm dependencies keep their own licenses; see each package in `node_modules` or `pnpm licenses list`.
