# İzgah — Site Haritası

## Tasarım Dokümanları

| Doküman | Tarih | Yazar | Bileşenler | Açıklama |
| :--- | :--- | :--- | :--- | :--- |
| [izgah-core.md](./izgah-core.md) | 2026-11-14 | Gorkem Inanc Ozdemir | PostgreSQL / Drizzle ORM, Auth & API Keys, Unfurl Worker & Media Cache, SvelteKit Web UI, `/api/v1/*` HTTP API, Admin & Telemetry, Docker / Dokploy | İzgah çekirdek platformunun veri modeli, kimlik doğrulama ve kişisel API anahtarları, SSRF korumalı arka plan önizleme servisi, yerel platform arayüz kuralları, eklenti API sözleşmesi ve Dokploy yayın mimarisi. |
| [izgah-extensions.md](./izgah-extensions.md) | 2026-11-19 | Gorkem Inanc Ozdemir | WXT + TypeScript (Manifest V3), Chrome / Firefox / Safari Web Extensions, `popup` & `options` UI, `contextMenus` & `Alt+Shift+I`, `/api/v1/*` HTTP Client, Safari Xcode Converter | İzgah masaüstü tarayıcı eklentilerinin yalıtılmış `extensions/` paket mimarisi, en dar izin sınırı, çift paylaşım ve admin sessiz ekleme açılır penceresi, sağ tık ve klavye kısayolu tetikleyicileri, Türkçe hata eşlemesi ve Chrome/Firefox/Safari dağıtım planı. |
| [izgah-ui-v2.md](./izgah-ui-v2.md) | 2026-11-20 | Gorkem Inanc Ozdemir | App Shell, `FeedView` & `PostCard`, Inline Composer & Paste-to-Share, Keyboard Shortcuts, `izgah_theme` Cookie, Security Headers & CSP, `/api/internal/feed/updates`, Sabit E2E Kancaları | Web arayüzü v2: §2 (font yükleme mekanizması), §9 (tema çerezi), §11 (zorunlu CSP) ve §12 (sabit E2E kancaları) bağlayıcı kalır; görsel dil, palet ve bileşen katmanı [izgah-ui-v3.md](./izgah-ui-v3.md) ile güncellenmiştir. |
| [izgah-themes.md](./izgah-themes.md) | 2026-11-22 | Gorkem Inanc Ozdemir | Light / Dark Palettes (Default, Dim, High Contrast), Accent Colors, `light-dark()` Token Slots, `izgah_theme_light` / `izgah_theme_dark` / `izgah_accent` Cookies, `/settings?/setPalette` | Mod + gündüz/gece paleti + vurgu mekanizması, `light-dark()` CSS yuvaları ve çerez/SSR uygulaması korunur; palet ve vurgu renk değerleri [izgah-ui-v3.md](./izgah-ui-v3.md) §1 ile güncellenmiştir. |
| [izgah-i18n-oss.md](./izgah-i18n-oss.md) | 2026-11-25 | Gorkem Inanc Ozdemir | `src/lib/i18n` (en/tr catalogs, ICU subset, AsyncLocalStorage locale), `izgah_locale` Cookie & `DEFAULT_LOCALE`, `APP_TIME_ZONE` / `INSTANCE_NAME` / `SOURCE_URL`, English Search Stemming, Extension `_locales` & Store Build | İngilizce temel dil + tam Türkçe çeviri, çalışma zamanı örnek ayarları ve tek mağaza eklentisi ile açık kaynak (AGPL-3.0) self-host modeli. |
| [izgah-ui-v3.md](./izgah-ui-v3.md) | 2026-11-24 | Gorkem Inanc Ozdemir | İzgah Stüdyo Design System (Primitive/Semantic/Component Tokens, 5 Palet × 4 Çift Kutuplu Vurgu), `Newsreader` + `Geist` + `JetBrains Mono`, 3 Sütunlu Ana Akış + Sağ Bağlam Rayı (`rail-summary.ts`), `⌘K` Komut Paleti (`/api/internal/search/quick`), `SidePeekDialog`, `Tooltip`, `Skeleton`, `AvatarStack`, `SegmentedControl`, Eklenti v3 Hizalaması | Onaylı v3 ("İzgah Stüdyo") görsel ve etkileşim sistemi: hassas kabuk/ayarlar/yönetim + editoryal serif başlıklar ve sıcak alabaster/grafit yüzeyler + 3 sütunlu ana akış ve içerik türüne duyarlı medya kartları; 20 palet×vurgu kombinasyonunda WCAG 2.2 AA/AAA kontrast tablosu. |
| [extensions/README.md](../../extensions/README.md) | 2026-11-20 | Gorkem Inanc Ozdemir | Eklenti Kurulumu, CWS / AMO İzin Gerekçeleri, Dağıtım Kanalları | Yalıtılmış `extensions/` geliştirme komutları, Playwright E2E önkoşulu, CWS & Firefox AMO izin/gizlilik beyanları ve Chrome `Unlisted` / Firefox `.xpi` / macOS Safari Xcode dağıtım adımları. |
| [README.md](../../README.md) | 2026-11-25 | Gorkem Inanc Ozdemir | Overview, Quick Start, Self-hosting, Environment | İngilizce proje tanıtımı, yerel geliştirme, ortam değişkenleri ve self-host özeti ([README.tr.md](../../README.tr.md) Türkçe). |
| [docs/deploy/](../deploy/) | 2026-11-25 | Gorkem Inanc Ozdemir | Docker Compose + Caddy, Dokploy, Backups | Adım adım self-host kılavuzları, yedekleme ve `N -> N-1` geri alma. |

## Uygulama ve API Rotaları (izgah-core)

### Web Arayüzü Rotaları

*   `/` ([src/routes/(app)/+page.svelte](../../src/routes/(app)/+page.svelte)) — Ters kronolojik ana akış, içerik türü süzgeci, imleçli sayfalama ve paylaşım penceresi
*   `/sections` ([src/routes/(app)/sections/+page.svelte](../../src/routes/(app)/sections/+page.svelte)) — Konu bölümleri dizini (JS'siz ve mobil alt sekme çubuğu hedefi)
*   `/sections/[slug]` ([src/routes/(app)/sections/[slug]/+page.svelte](../../src/routes/(app)/sections/[slug]/+page.svelte)) — Konu bölümü akışı (normal ve sessiz kaynaklar)
*   `/resources/[id]` ([src/routes/(app)/resources/[id]/+page.svelte](../../src/routes/(app)/resources/[id]/+page.svelte)) — Kanonik kaynak detayları, paylaşım geçmişi, ortak beğeni ve yorum dizisi
*   `/search` ([src/routes/(app)/search/+page.svelte](../../src/routes/(app)/search/+page.svelte)) — Türkçe + İngilizce + URL parçası araması (`Tüm İzgah` / `Bu Bölüm` kapsam seçimi)
*   `/login` ([src/routes/login/+page.svelte](../../src/routes/login/+page.svelte)) — E-posta ve parola ile giriş ekranı
*   `/auth/accept-invite` ([src/routes/auth/accept-invite/+page.svelte](../../src/routes/auth/accept-invite/+page.svelte)) — 24 saat geçerli tek kullanımlık üye davet kabul ve parola belirleme ekranı
*   `/auth/reset-password` ([src/routes/auth/reset-password/+page.svelte](../../src/routes/auth/reset-password/+page.svelte)) — 24 saat geçerli tek kullanımlık parola sıfırlama ekranı
*   `/settings` ([src/routes/(app)/settings/+page.svelte](../../src/routes/(app)/settings/+page.svelte)) — Üye hesap bilgileri, görünüm (mod, palet, vurgu), tek tuş kısayolları ve parola değiştirme ekranı
*   `/settings/api-keys` ([src/routes/(app)/settings/api-keys/+page.svelte](../../src/routes/(app)/settings/api-keys/+page.svelte)) — Kişisel API anahtarı üretme ve iptal etme ekranı
*   `/admin/users` ([src/routes/(app)/admin/users/+page.svelte](../../src/routes/(app)/admin/users/+page.svelte)) — Üye yönetimi, davet/sıfırlama bağlantısı üretimi, rol ve pasifleştirme
*   `/admin/sections` ([src/routes/(app)/admin/sections/+page.svelte](../../src/routes/(app)/admin/sections/+page.svelte)) — Konu bölümü oluşturma, yeniden adlandırma, sıralama ve silme
*   `/admin/unassigned` ([src/routes/(app)/admin/unassigned/+page.svelte](../../src/routes/(app)/admin/unassigned/+page.svelte)) — Herhangi bir bölüme atanmamış paylaşımları listeleme ve toplu bölümlendirme
*   `/admin/jobs` ([src/routes/(app)/admin/jobs/+page.svelte](../../src/routes/(app)/admin/jobs/+page.svelte)) — Hatalı (`dead`) önizleme işlerini inceleme ve yeniden kuyruğa alma
*   `/admin/audit` ([src/routes/(app)/admin/audit/+page.svelte](../../src/routes/(app)/admin/audit/+page.svelte)) — Admin işlem ve güvenlik denetim kayıtları (`audit_logs`)
*   `/admin/metrics` ([src/routes/(app)/admin/metrics/+page.svelte](../../src/routes/(app)/admin/metrics/+page.svelte)) — 1. ay aktif paylaşan/arayan üye, kanal dağılımı ve sıfır sonuç oranı ölçüm ekranı

### HTTP API ve Sistem Uçları

*   `GET /api/v1/me` ([src/routes/api/v1/me/+server.ts](../../src/routes/api/v1/me/+server.ts)) — Bearer API anahtarı ile aktif kullanıcı ve rol doğrulaması
*   `GET /api/v1/sections` ([src/routes/api/v1/sections/+server.ts](../../src/routes/api/v1/sections/+server.ts)) — Sıralı konu bölümleri listesi
*   `GET /api/v1/links/check` ([src/routes/api/v1/links/check/+server.ts](../../src/routes/api/v1/links/check/+server.ts)) — Kanonik URL çözümleme ve erken çift kayıt kontrolü
*   `POST /api/v1/links` ([src/routes/api/v1/links/+server.ts](../../src/routes/api/v1/links/+server.ts)) — Bağlantı paylaşımı oluşturma ve önizleme işini kuyruğa ekleme
*   `OPTIONS /api/v1/*` ([src/hooks.server.ts](../../src/hooks.server.ts)) — Tarayıcı eklentileri için CORS öndenetim yanıtları
*   `ALL /api/auth/[...all]` ([src/routes/api/auth/[...all]/+server.ts](../../src/routes/api/auth/[...all]/+server.ts)) — Better Auth oturum uç noktaları (`sign-in/email`, `sign-out`, `get-session`)
*   `POST /logout` ([src/routes/logout/+server.ts](../../src/routes/logout/+server.ts)) — Çerez oturumunu sonlandırma ve `/login` yönlendirmesi
*   `GET /api/internal/links/check` ([src/routes/api/internal/links/check/+server.ts](../../src/routes/api/internal/links/check/+server.ts)) — Web paylaşım penceresi için çerez ve `Origin` korumalı erken çift kayıt kontrolü
*   `GET /api/internal/feed/updates` ([src/routes/api/internal/feed/updates/+server.ts](../../src/routes/api/internal/feed/updates/+server.ts)) — Görünür sekmede `afterId` sonrası yeni paylaşım sayısı (`{ newCount }`, en fazla `100`)
*   `GET /api/internal/search/quick` ([src/routes/api/internal/search/quick/+server.ts](../../src/routes/api/internal/search/quick/+server.ts)) — `⌘K` komut paleti için `searchResources(..., { recordLog: false })` üzerine kurulu çerez + `Origin` korumalı hızlı arama ucu (en fazla `6` sonuç, `search_logs`'a yazmaz, oturum başına dakikada `120` istek sınırı)
*   `GET / POST /api/internal/notifications` ([src/routes/api/internal/notifications/+server.ts](../../src/routes/api/internal/notifications/+server.ts)) — Görünür sekme duyarlı okunmamış bildirim sorgusu ve okundu işaretleme
*   `GET /media/thumbnails/[assetKey]` ([src/routes/media/thumbnails/[assetKey]/+server.ts](../../src/routes/media/thumbnails/[assetKey]/+server.ts)) — Oturum/anahtar doğrulamalı yerel WebP kapak görseli sunumu
*   `GET /healthz` ([src/routes/healthz/+server.ts](../../src/routes/healthz/+server.ts)) — Uygulama süreç canlılık kontrolü ([Dockerfile](../../Dockerfile) `HEALTHCHECK` hedefi)
*   `GET /readyz` ([src/routes/readyz/+server.ts](../../src/routes/readyz/+server.ts)) — PostgreSQL, göç durumu ve `MEDIA_STORAGE_DIR` (`/data/thumbnails`) hacim yazma hazırlık kontrolü

### İşletim, Göç ve Yedekleme Giriş Noktaları

*   `node build/index.js` ([src/hooks.server.ts](../../src/hooks.server.ts)) — Üretim HTTP sunucusu ve süreç içi önizleme işçisi ([scripts/docker-entrypoint.sh](../../scripts/docker-entrypoint.sh) üzerinden `exec` ile PID 1)
*   `node build/migrate.js` ([src/lib/server/db/migrate.ts](../../src/lib/server/db/migrate.ts)) — `pg_advisory_lock(74829104)` altında tekil bağlantılı `drizzle/` göç çalıştırıcısı
*   `node build/cli.js` ([src/cli.ts](../../src/cli.ts)) — İlk admin ve parola sıfırlama kurtarma CLI aracı (`create-admin`, `reset-admin`)
*   [scripts/docker-entrypoint.sh](../../scripts/docker-entrypoint.sh) — Konteyner başlangıç doğrulaması, göç çalıştırma ve sunucu devri
*   [scripts/pre-deploy-backup.sh](../../scripts/pre-deploy-backup.sh) — Şema göçü içeren yayınlar öncesi ana sunucuda elle çalıştırılan `pg_dump -Fc` yedek betiği
*   [scripts/offbox-backup.sh](../../scripts/offbox-backup.sh) — Ana sunucuda günlük zamanlanan `pg_dump -Fc` + `/data/thumbnails` sunucu dışı S3 yedekleme betiği

## Tarayıcı Eklentileri (`extensions/`)

*   [extensions/wxt.config.ts](../../extensions/wxt.config.ts) — WXT MV3 manifest üreticisi (Chrome/Firefox/Safari, en dar izinler, `Alt+Shift+I`, Gecko ayarları)
*   [extensions/src/entrypoints/background.ts](../../extensions/src/entrypoints/background.ts) — Sağ tık `"İzgah'a paylaş"` menüsü, `action.openPopup()` + standalone pencere yedeği ve oturum bağlam devri
*   [extensions/src/entrypoints/popup/main.ts](../../extensions/src/entrypoints/popup/main.ts) — Paylaşım açılır penceresi kontrolcüsü (canlı çift kontrol, bölüm/içerik türü, admin sessiz ekleme, hata eşlemesi)
*   [extensions/src/entrypoints/options/main.ts](../../extensions/src/entrypoints/options/main.ts) — Ayarlar sayfası kontrolcüsü (sunucu kökeni normalizasyonu, API anahtarı doğrulama, `/api/v1/me` testi)
*   [extensions/src/lib/api-client.ts](../../extensions/src/lib/api-client.ts) — `X-Client-Name`, `X-Client-Version` ve 10 sn zaman aşımı destekli `/api/v1/*` HTTP istemcisi
*   [extensions/scripts/verify-manifests.mjs](../../extensions/scripts/verify-manifests.mjs) — Chrome/Firefox/Safari MV3 manifest, portsuz köken (`--require-https-origin`) ve PNG IHDR doğrulama betiği
*   [extensions/scripts/build-safari.mjs](../../extensions/scripts/build-safari.mjs) — WXT Safari derlemesi ve `xcrun safari-web-extension-converter` (`--require-xcode`) sarmalayıcı betiği
*   [extensions/tests/e2e/extension-popup-and-options.spec.ts](../../extensions/tests/e2e/extension-popup-and-options.spec.ts) — Chromium unpacked MV3 eklenti E2E test paketi (`CUJ 1`–`CUJ 5`)
*   [extensions/README.md](../../extensions/README.md) — Geliştirici kurulumu, izin/gizlilik gerekçeleri ve üç tarayıcı dağıtım kılavuzu
