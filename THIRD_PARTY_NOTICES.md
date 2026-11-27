# Third-party notices

Izgah bundles the following third-party assets and source code. Their licenses apply to those files only.

| Component                                                                                  | Where                     | License                   |
| :----------------------------------------------------------------------------------------- | :------------------------ | :------------------------ |
| [Geist](https://github.com/vercel/geist-font) (via `@fontsource-variable/geist`)           | web app, extensions, site | SIL Open Font License 1.1 |
| [shadcn-svelte](https://github.com/huntabyte/shadcn-svelte) components, copied and adapted | `src/lib/components/ui/`  | MIT                       |
| [Lucide](https://github.com/lucide-icons/lucide) icons (via `@lucide/svelte`)              | web app, site             | ISC                       |

The Geist font files are unmodified. The full text of the SIL Open Font License for Geist is in [`site/assets/fonts/OFL.txt`](./site/assets/fonts/OFL.txt) and [`extensions/public/OFL.txt`](./extensions/public/OFL.txt).

Interaction ideas from [21st.dev](https://21st.dev) were rewritten from scratch in Svelte (izgah-ui-v5.md §9); no 21st.dev source code is included.

Runtime npm dependencies keep their own licenses; see each package in `node_modules` or `pnpm licenses list`.
