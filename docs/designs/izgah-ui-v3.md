# İzgah Arayüz v3 — "İzgah Stüdyo"

*   **Author:** Gorkem Inanc Ozdemir
*   **Status:** Approved
*   **Date:** 2026-11-24

--------------------------------------------------------------------------------

## Overview

Bu doküman, İzgah web arayüzünün ve Chrome/Firefox/Safari tarayıcı eklentisinin üçüncü sürümünü (**"İzgah Stüdyo"**) tanımlar. Önceki "Sinyal" görsel dilinin (`#C8F542` neon limon, sert siyah kenarlıklar, tekdüze ek kutuları ve boş sağ alan) yerini; **hassas araç kabuğu**, **editoryal başlık tipografisi ile sıcak yüzeyler** ve **3 sütunlu canlı akış ile zengin medya kartlarını** tek bir tutarlı tasarım sisteminde birleştiren görsel ve etkileşim mimarisi alır.

Bağlayıcı çekirdek kurallar korunur:

*   [izgah-ui-v2.md](./izgah-ui-v2.md) **§2** (Fontsource kendi sunucusundan sunum + `latin`/`latin-ext` ön yükleme mekanizması), **§9** (tema çerezleri + SSR flaşsız uygulama), **§11** (güvenlik başlıkları ve zorunlu CSP, satır içi betik yok) ve **§12** (sabit E2E kancaları ve erişilebilir adlar) geçerliliğini sürdürür.
*   [izgah-themes.md](./izgah-themes.md) içindeki **mod + gündüz/gece paleti + vurgu** çerez ve `light-dark()` mekanizması aynen korunur; palet ve vurgu değerleri İzgah Stüdyo diline güncellenir.
*   [izgah-core.md](./izgah-core.md) veri modeli, kimlik doğrulama, önizleme işçisi ve `/api/v1/*` sözleşmesi değişmez; **hiçbir veritabanı göçü (migration) gerekmez**.

**Görsel sentez:**

*   **Kabuk, gezinme, `⌘K` komut paleti, ayarlar ve yönetim:** Tam yükseklikte (`100dvh`) yapışkan sol ray, ince üst bağlam çubuğu, saç çizgili ayar satırları, KPI şeritli sade yönetim tabloları.
*   **Akış kartları, kaynak detayı ve başlık tipografisi:** Yalnız sayfa `h1`, gün `h2`, kaynak `h3` başlıkları ve marka kelime işaretinde serif (`Newsreader Variable`); sıcak alabaster (açık) ve sıcak grafit (koyu) yüzeyler.
*   **Akış yerleşimi, medya önizlemeleri, paylaşım akışı ve etkileşim çubuğu:** Masaüstü ana akışta dengeli 3 sütun (sol ray + okuma sütunu + veritabanı sorgularıyla beslenen sağ bağlam rayı), kapak görselli medya kartları, görselsiz bağlantılarda kompakt/özel kartlar, avatar yığını.
*   **Tarayıcı eklentisi:** Sıcak editoryal kaynak özeti + net bölüm çipleri; davranış ve `/api/v1/*` sözleşmesi değişmez.

#### Temel Kavramlar

*   **Üç Katmanlı Token Mimarisi:** `Primitive` (ham tonlar) → `Semantic` (`--color-*`, `light-dark()` yuvaları) → `Component` (`--card-*`, `--btn-*`, `--rail-*`). Bileşenler ham renk değeri kullanmaz.
*   **Çift Kutuplu Vurgu (`--accent-light` / `--accent-dark`):** Her vurgu seçeneği açık ve koyu şemada ayrı kalibre edilir; böylece açık temada da metin, kenarlık, ikon ve dolgu olarak WCAG 2.2 AA (`≥ 4.5:1`) taşır.
*   **Sağ Bağlam Rayı (`FeedContextRail`):** `≥ 1280px` masaüstünde **yalnız ana akış (`/`)** ekranında mevcut PostgreSQL tablolarından üretilen üç özet modülü: *Bugünün özeti*, *Çok konuşulanlar* (son 7 gün) ve *Bu hafta en çok paylaşanlar*.
*   **Yandan Önizleme (`SidePeekDialog`):** Masaüstünde akıştan kopmadan bir kaynağın detaylarını ve yorumlarını sağdan açılan `<dialog>` içinde gösteren aşamalı geliştirme (JS kapalıyken doğrudan `/resources/[id]` bağlantısı).
*   **Komut Paleti (`CommandPalette`):** `⌘K` / `Ctrl+K` ile açılan; bölümler, hızlı eylemler ve canlı arşiv aramasını tek yerde toplayan klavye-öncelikli modal `<dialog>`.

--------------------------------------------------------------------------------

## The Problem

Önceki "Sinyal" arayüzü işlevsel olarak çalışsa da görsel ve yapısal açıdan beş temel sorunu çözememiştir:

1.  **Aşırı doygun neon limon blokları:** Aynı ekranda 3–4 ayrı `#C8F542` blok + siyah kenarlık + parıltı (ör. yönetim ekranında "Paylaş", "Yönetim", "Üyeler" ve "Davet Oluştur" aynı anda neon blok olarak yarışır).
2.  **Masaüstünde ölü sağ boşluk:** `248px` sol ray + sola yaslı `680px` sütun, `1440px` ekranda sağda `~500px` boş alan bırakır.
3.  **Tipografi ve yüzey yorgunluğu:** Form ipuçları ve ayar açıklamalarının `JetBrains Mono` ile dizilmesi, `800` ağırlıklı ağır başlıklar, tüm girdi ve kartlarda sert `#808080` kenarlıklar ve yapay `--surface-sheen` gradyanı.
4.  **Tekdüze ek kutuları ve kalabalık yönetim satırları:** Görselsiz repo/web bağlantıları ile kapak görselli makale/videolar aynı dikdörtgen kutuda ezilir; yönetim tablosu her satırda 4 ayrı çerçeveli kontrol yığar.
5.  **Eksik modern etkileşimler:** `⌘K` komut paleti, yandan önizleme (side peek), avatar yığını, düzenli tooltip ve tutarlı segmented control bulunmaz.

--------------------------------------------------------------------------------

## Goals

*   **Seçkin ve Tutarlı Görsel Kimlik:** Sıcak alabaster (`#FAFAF8`) ve sıcak grafit (`#0D0E10`) yüzey hiyerarşisi, kontrollü orman/adaçayı teal vurgusu ve disiplinli tipografi ayrımı (`Newsreader` yalnız seçili başlıklarda; `Geist` arayüz/notlarda; `JetBrains Mono` yalnız teknik metada).
*   **Tam WCAG 2.2 AA / Yüksek Kontrast AAA:** 5 palet (2 açık + 3 koyu) × 4 vurgu = 20 kombinasyonun tamamında metin `≥ 4.5:1`, kontrol sınırı ve odak `≥ 3:1`; yüksek kontrast paletlerinde metin/ikincil metin/tehlike `≥ 7:1` (AAA), `line ≥ 4.5:1`, sıfır gölge/ışıma/gradyan.
*   **Gerçek Veriye Dayalı 3 Sütunlu Ana Akış:** Sağ bağlam rayı yalnız mevcut veritabanındaki gerçek verileri gösterir; ek şema göçü, önbellek katmanı veya yeni altyapı gerektirmez.
*   **İçerik Türüne Duyarlı Akış Kartları:** Kapak görselli kaynaklarda zengin medya önizlemesi; görselsiz bağlantılarda repo/sosyal/kompakt şerit varyantları.
*   **Dayanıklılık, Güvenlik ve JS'siz Çalışma:** Sıfır satır içi betik (zorunlu CSP uyumu), çerez + SSR ile flaşsız tema, JS kapalıyken tüm çekirdek akışlar (paylaşım, gezinme, arama, detay, tema, yönetim) eksiksiz çalışır; tüm yeni etkileşimler (`⌘K`, Side Peek) aşamalı geliştirmedir.
*   **Korunan İşlevsellik ve E2E Sözleşmesi:** WebKit popover düzeltmesi, mobil üst boşluk, Türkçe 404, yönetim tablosu hizaları ve `izgah-ui-v2.md` §12 kancaları korunur.

--------------------------------------------------------------------------------

## Non-Goals

*   **Çevrimiçi / Varlık Takibi ve Gerçek Zamanlı İtme:** "Çevrimiçi" göstergeleri, `"N çevrimiçi"` sayaçları, `"CANLI"` rozetleri ve WebSocket/SSE **yoktur** (mevcut 60 sn görünür sekme yoklaması korunur).
*   **Okundu / Okuma Hedefi Takibi:** Haftalık okuma ilerleme çubuğu veya sunucu taraflı okundu/okunmadı kaydı **yoktur** (yalnız mevcut yerel `localStorage` son ziyaret ayırıcısı korunur).
*   **Yazar Hover Kartı (`HoverCard`):** Sayfada bulunmayan ek yazar istatistikleri ve fazladan sorgu gerektirdiğinden kapsam dışıdır; yazar adı mevcut sade hâliyle kalır.
*   **Eklenti Davranış Değişikliği ve Yeni `/api/v1/*` Uçları:** Eklenti popup'ında `"Kaydet / Son Kayıtlar"` sekmesi **yoktur**; mevcut popup/options akışı ve `/api/v1/*` sözleşmesi korunur, yalnızca İzgah Stüdyo görsel diline geçirilir.
*   **Veritabanı Göçü (Migration):** Yeni tablo, sütun veya indeks göçü yapılmaz.
*   **Ağır JS/CSS Çerçeveleri:** Tailwind, React/Vue port'ları, MUI/shadcn port'ları, ikon paketi veya polyfill eklenmez.

--------------------------------------------------------------------------------

## Technical Plan (Architecture)

### 1. Token Sistemi (Primitive → Semantic → Component)

Tüm belirteçler [`src/lib/styles/tokens.css`](../../src/lib/styles/tokens.css) içinde `@layer tokens` katmanında yaşar. Üç katman kesin biçimde ayrılır:

1.  **Primitive katman (`--p-*`):** Ham nötr ve vurgu basamakları (yalnız `tokens.css` içinde palet yuvalarına atanır; bileşenler doğrudan `--p-*` kullanmaz).
2.  **Semantic katman (`--light-*`, `--dark-*`, `--accent-*` → `--color-*`):** [izgah-themes.md](./izgah-themes.md) §4'teki `light-dark()` ve `.theme-preview` kalıbı aynen korunur. Mod (`data-theme`) yalnızca `color-scheme` çevirir.
3.  **Component katman:** Yüzey katmanları (`--color-surface-1`, `--color-surface-2`, `--color-surface-3`), gölge/üst ışık (`--shadow-xs/sm/lg`, `--specular-top`), köşe yarıçapları (`--radius-*`), kabuk ölçüleri (`--rail-w`, `--context-rail-w`, `--read-w`, `--topbar-h`).

> **Geriye dönük uyumluluk takma adları:** Geçiş süresince `--color-surface` → `var(--color-surface-2)`, `--color-signal` → `var(--color-accent)` ve `--color-on-signal` → `var(--color-on-accent)` eşlemeleri korunur; tüm v3 bileşenleri doğrudan yeni `--color-*` adlarını kullanır.

#### 1.1 Açık Paletler (`data-light-theme`)

| Token | Rol | Varsayılan (`default` — Sıcak Alabaster) | Kontrast (`default`) | Yüksek Kontrast (`contrast`) | Kontrast (`contrast`) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--light-bg` | Ana tuval | `#FAFAF8` | — | `#FFFFFF` | — |
| `--light-surface-1` | Kartlar, yan ray, modal | `#FFFFFF` | `bg` 1.04 | `#FFFFFF` | — |
| `--light-surface-2` | Hover, girdi, ikincil yüzey | `#F3F2EE` | `s1` 1.11 | `#F0EFEA` | `s1` 1.15 |
| `--light-surface-3` | Aktif gezinme / basılı | `#E8E6DF` | `s1` 1.24 | `#E2E0D8` | `s1` 1.31 |
| `--light-text` | Birincil metin | `#141413` | `bg` **17.64** · `s2` **16.46** ✓ | `#000000` | `bg` **21.00** · `s2` **18.24** (AAA ✓) |
| `--light-text-secondary` | Ekip notu, açıklama | `#52514D` | `s1` **7.95** · `s2` **7.09** ✓ | `#262522` | `s1` **15.33** · `s2` **13.31** (AAA ✓) |
| `--light-text-muted` | Meta, zaman, sayaç | `#63625C` | `bg` **5.85** · `s2` **5.46** ✓ | `#42413D` | `bg` **10.22** · `s2` **8.88** (AAA ✓) |
| `--light-line` | Dekoratif `1px` ayraç | `#E6E4DD` | dekoratif (1.22) | `#73716A` | `bg` **4.88** (≥ 3:1 ✓) |
| `--light-line-strong` | Etkileşimli kontrol sınırı | `#77756E` | `bg` **4.41** · `s2` **4.12** ✓ | `#1C1B19` | `bg` **17.21** · `s2` **14.95** ✓ |
| `--light-danger` | Hata / yıkıcı metin | `#C81E1E` | `s1` **5.74** · `s2` **5.12** ✓ | `#961007` | `s1` **8.85** · `s2` **7.68** (AAA ✓) |
| `--light-on-danger` | Tehlike dolgusu metni | `#FFFFFF` | `danger` **5.74** ✓ | `#FFFFFF` | `danger` **8.85** (AAA ✓) |
| `--light-focus-inner` | Odak halkası iç çizgisi | `#141413` | `bg` **17.64** ✓ | `#000000` | `bg` **21.00** ✓ |
| `--light-highlight-bg` / `-fg` | Arama eşleşmesi, yeni etiketi | `#FEF3C7` / `#141413` | **16.55** ✓ | `#FDE047` / `#000000` | **15.93** ✓ |
| `--light-backdrop` | `dialog::backdrop` | `rgb(20 20 19 / 0.44)` | — | `rgb(0 0 0 / 0.65)` | — |

#### 1.2 Koyu Paletler (`data-dark-theme`)

| Token | Varsayılan (`default` — Sıcak Grafit) | Kontrast (`default`) | Loş (`dim` — Loş Arduvaz) | Kontrast (`dim`) | Yüksek Kontrast (`contrast`) | Kontrast (`contrast`) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `--dark-bg` | `#0D0E10` | — | `#1A1C20` | — | `#000000` | — |
| `--dark-surface-1` | `#141518` | `bg` 1.07 | `#22252B` | `bg` 1.09 | `#0E0F11` | `bg` 1.08 |
| `--dark-surface-2` | `#1C1E22` | `s1` 1.12 | `#2B2F37` | `s1` 1.12 | `#181A1E` | `s1` 1.12 |
| `--dark-surface-3` | `#25282E` | `s1` 1.27 | `#353A44` | `s1` 1.29 | `#24272D` | `s1` 1.29 |
| `--dark-text` | `#F3F3F1` | `bg` **17.38** · `s2` **15.02** ✓ | `#EFEFED` | `bg` **14.82** · `s2` **11.66** ✓ | `#FFFFFF` | `bg` **21.00** · `s2` **17.42** (AAA ✓) |
| `--dark-text-secondary` | `#A3A4A8` | `s1` **7.33** · `s2` **6.70** ✓ | `#B4B7BE` | `s1` **7.65** · `s2` **6.68** ✓ | `#E5E5E2` | `s1` **15.19** · `s2` **13.80** (AAA ✓) |
| `--dark-text-muted` | `#8E9096` | `bg` **6.05** · `s2` **5.23** ✓ | `#9FA3AC` | `bg` **6.75** · `s2` **5.31** ✓ | `#CECEC9` | `bg` **13.30** · `s2` **11.03** (AAA ✓) |
| `--dark-line` | `#26282F` | dekoratif (1.31) | `#353A44` | dekoratif (1.49) | `#808288` | `bg` **5.47** (≥ 3:1 ✓) |
| `--dark-line-strong` | `#6C6F78` | `bg` **3.85** · `s2` **3.32** ✓ | `#808592` | `bg` **4.62** · `s2` **3.64** ✓ | `#C8CACF` | `bg` **12.81** · `s2` **10.62** ✓ |
| `--dark-danger` | `#F87171` | `s1` **6.60** · `s2` **6.03** ✓ | `#FCA5A5` | `s1` **8.09** · `s2` **7.07** ✓ | `#FFA3A3` | `s1` **10.06** · `s2` **9.14** (AAA ✓) |
| `--dark-on-danger` | `#0D0E10` | `danger` **6.98** ✓ | `#1A1C20` | `danger` **8.99** ✓ | `#000000` | `danger` **11.02** (AAA ✓) |
| `--dark-focus-inner` | `#F3F3F1` | `bg` **17.38** ✓ | `#EFEFED` | `bg` **14.82** ✓ | `#FFFFFF` | `bg` **21.00** ✓ |
| `--dark-highlight-bg` / `-fg` | `#362D12` / `#FDE68A` | **10.94** ✓ | `#3E3314` / `#FEF08A` | **10.69** ✓ | `#4A3B08` / `#FEF08A` | **9.40** ✓ |
| `--dark-backdrop` | `rgb(0 0 0 / 0.70)` | — | `rgb(0 0 0 / 0.65)` | — | `rgb(0 0 0 / 0.82)` | — |

#### 1.3 Vurgu Renkleri (`data-accent`) — Açık ve Koyu Ayrı Kalibre Edilmiş 4 Seçenek

Yeni beyaz liste: `teal` *(varsayılan)* | `cobalt` | `terracotta` | `plum`. Eski `izgah_accent` çerez değerleri (`lime`/`cyan`/`pink`/`blue`) beyaz liste dışındadır ve [izgah-themes.md](./izgah-themes.md) §3 kuralı gereği güvenli biçimde varsayılan `teal`'e düşer.

| Vurgu (`data-accent`) | Açık (`--accent-l` / `--on-l`) | Açık Kontrast (`on/acc` · `acc/bg` · `acc/s2` · `acc/hc-s2`) | Açık Yumuşak (`soft` / `text`) | Koyu (`--accent-d` / `--on-d`) | Koyu Kontrast (`on/acc` · `acc/bg` · `acc/dim-s2` · `acc/hc-s2`) | Koyu Yumuşak (`soft` / `text`) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Orman Teal** (`teal`, varsayılan) | `#0F766E` / `#FFFFFF` | **5.47** · **5.24** · **4.89** · **4.75** ✓ | `#E6F4F1` / `#0D635C` (**6.28** ✓) | `#2DD4BF` / `#061A18` | **9.65** · **10.37** · **7.21** · **9.36** ✓ | `#122A28` / `#5EEAD4` (**10.23** ✓) |
| **Kobalt** (`cobalt`) | `#1D4ED8` / `#FFFFFF` | **6.70** · **6.41** · **5.98** · **5.82** ✓ | `#EFF6FF` / `#1E40AF` (**8.01** ✓) | `#60A5FA` / `#071324` | **7.32** · **7.60** · **5.28** · **6.85** ✓ | `#142238` / `#93C5FD` (**8.85** ✓) |
| **Kiremit** (`terracotta`) | `#9A3412` / `#FFFFFF` | **7.31** · **6.99** · **6.52** · **6.35** ✓ | `#FDECE3` / `#7C2D12` (**8.16** ✓) | `#FB923C` / `#1C0D03` | **8.37** · **8.53** · **5.93** · **7.70** ✓ | `#2E1D11` / `#FDBA74` (**9.58** ✓) |
| **Erik** (`plum`) | `#6D28D9` / `#FFFFFF` | **7.10** · **6.80** · **6.34** · **6.17** ✓ | `#F3EEFF` / `#5B21B6` (**7.91** ✓) | `#C4B5FD` / `#180C2E` | **10.06** · **10.46** · **7.27** · **9.44** ✓ | `#231A38` / `#DDD6FE` (**11.85** ✓) |

*   **Sonuç:** 5 palet × 4 vurgu = **20 kombinasyonun tamamı** metin (`≥ 4.5:1`), yumuşak dolgu içi metin (`≥ 4.5:1`), kontrol sınırı (`≥ 3:1`) ve odak halkası (`≥ 3:1`) koşullarını sağlar.
*   **Yüksek kontrast kuralı:** `[data-light-theme='contrast']`, `[data-dark-theme='contrast']`, `@media (prefers-contrast: more)` ve `@media (forced-colors: active)` altında `--shadow-*`, `--specular-top` ve tüm odak/vurgu ışımaları `none` olur; yüzeyler tamamen düz, sınırlar yüksek kontrastlı kalır.

--------------------------------------------------------------------------------

### 2. Tipografi, Fontsource Paketleri ve Kesin Serif Sınırı

#### 2.1 Yeni ve Güncellenen `devDependencies` Paketleri

| Paket ve Sürüm | Lisans | Kapsam ve Gerekçe |
| :--- | :--- | :--- |
| `@fontsource-variable/newsreader@^5.3.0` (`5.3.0`) | `OFL-1.1` | Editoryal serif başlık fontu (`latin` + `latin-ext`: `ı İ ş Ş ğ Ğ`, `wght` + `opsz`, normal + italic). Kendi sunucumuzdan sunulur, CDN yok. |
| `@fontsource-variable/geist@^5.3.0` (`5.3.0`) | `OFL-1.1` | Arayüz ve ekip notları sans-serif fontu (`latin` + `latin-ext`, `wght` `400..700`). `@fontsource-variable/schibsted-grotesk@5.3.0` paketinin yerini alır. |
| `@fontsource-variable/jetbrains-mono@5.3.0` *(mevcut)* | `OFL-1.1` | Teknik meta (`latin` + `latin-ext`, `tabular-nums`: saat, alan adı, repo yıldızı, sayaç, `kbd`). |
| `@axe-core/playwright@^4.14.0` (`4.14.0`) | `MPL-2.0` | `tests/e2e/m15-a11y-tour.spec.ts` erişilebilirlik turunda gerçek tarayıcıda hesaplanmış stilleri **yalnız `color-contrast` kuralıyla** otomatik doğrulamak için geliştirme/test bağımlılığı (üretim derlemesine girmez). |

*   **Kaldırılan paket:** `@fontsource-variable/schibsted-grotesk@5.3.0` kök projeden ve `extensions/package.json`'dan kaldırılır.
*   **CSS aileleri:**
    *   `--font-display: 'Newsreader Variable', Georgia, 'Iowan Old Style', serif`
    *   `--font-sans: 'Geist Variable', system-ui, -apple-system, 'Segoe UI', sans-serif`
    *   `--font-mono: 'JetBrains Mono Variable', ui-monospace, SFMono-Regular, Menlo, monospace`
*   **Ön yükleme (`src/lib/server/http/theme.ts`):** `PRELOADED_FONT_PATTERN` güncellenir: `/geist-latin(?:-ext)?-wght-normal|newsreader-latin(?:-ext)?-opsz-normal/` eşleşen dosyalar ön yüklenir; mono ve italik `unicode-range` + `font-display: swap` ile talep üzerine yüklenir. `vite.config.ts` `.woff2` satır içine almama kuralı (`font-src 'self'`) aynen korunur.

#### 2.2 Serif Kullanım Sınırı

*   **Serif (`--font-display`) YALNIZ şu dört yerde kullanılır:**
    1. Sayfa başlıkları (`h1` — ör. "Ana Akış", bölüm adı, "Ayarlar", "Üye Yönetimi", giriş başlığı).
    2. Akış gün başlıkları (`h2.day-heading` — "Bugün", "Dün", "Salı", italik `600`).
    3. Akış kartı ve kaynak detayındaki kaynak başlıkları (`h3.attachment-title`, `h1.resource-title`, sağ ray "Çok konuşulanlar" başlıkları, eklenti başlık önizlemesi).
    4. Sol ray ve giriş ekranındaki "İzgah" marka kelime işareti.
*   **Gezinme, formlar, etiketler, ipuçları, ayar satırları, yönetim tabloları, ekip notları ve yorumlar** kesinlikle `--font-sans` (`Geist Variable`) kullanır.
*   **`JetBrains Mono`** yalnız saat, tarih, alan adı, repo yıldızı/dili, sayaçlar, URL alanları ve `kbd` içindedir; form ipuçları ve açıklama paragrafları (`.field-hint`) asla monospace olmaz.

#### 2.3 Tipografi Ölçeği

| Token | Boyut / Satır Yüksekliği | Ağırlık | Aile | İzleme | Kullanım |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--text-display` | `clamp(1.625rem, 1.35rem + 1.1vw, 2rem)` / `1.15` | `600` | Serif | `-0.02em` | Sayfa `h1`, kaynak detay `h1` |
| `--text-day` | `1.125rem` / `1.2` | `600` (italic) | Serif | `-0.01em` | Gün başlığı `h2` |
| `--text-title` | `1.0625rem` / `1.32` | `600` | Serif | `-0.01em` | Bağlantı eki başlığı `h3` |
| `--text-section` | `1rem` / `1.35` | `600` | Sans | `-0.01em` | Panel/bölüm alt başlıkları (`h2` ayarlar/yönetim) |
| `--text-body` | `0.9375rem` (`15px`) / `1.6` | `400` | Sans | `0` | Ekip notları, yorumlar, form girdileri |
| `--text-ui` | `0.84375rem` (`13.5px`) / `1.35` | `500` | Sans | `0` | Gezinme, düğmeler, etiketler, tablo hücreleri, yazar adı (`600`) |
| `--text-hint` | `0.8125rem` (`13px`) / `1.45` | `400` | Sans | `0` | Form ipuçları, ayar açıklamaları |
| `--text-meta` | `0.75rem` (`12px`) / `1.3` | `400` | Mono | `0` | Zaman, alan adı, sayaç, repo istatistiği (`tabular-nums`) |
| `--text-micro` | `0.75rem` (`12px`) / `1.2` | `500` | Mono | `0.03em` | Rozet, tablo `th`, `kbd` |

--------------------------------------------------------------------------------

### 3. Aralık, Köşe, Yüzey Katmanları ve Odak Halkası

*   **Aralık ızgarası (`4px`):** `--space-1` (`4px`), `--space-2` (`8px`), `--space-3` (`12px`), `--space-4` (`16px`), `--space-5` (`24px`), `--space-6` (`32px`), `--space-7` (`48px`), `--space-8` (`64px`).
*   **Köşe yarıçapları:** `--radius-xs: 5px` (`kbd`, küçük rozet), `--radius-sm: 7px` (düğme, girdi, gezinme öğesi), `--radius-md: 11px` (ek kutusu, yan ray kartı, tablo), `--radius-lg: 14px` (gönderi kartı, modal `<dialog>`, `⌘K`), `--radius-pill: 9999px` (avatar, durum hapı, bölüm çipleri).
*   **Yüzey ve derinlik:**
    *   **Açık (`default`):** `bg` (`#FAFAF8`) üzerinde `surface-1` (`#FFFFFF`) kartlar + `1px solid var(--color-line)` + hafif katmanlı gölge (`0 1px 2px rgb(20 20 19 / 0.04), 0 4px 14px rgb(20 20 19 / 0.03)`).
    *   **Koyu (`default`, `dim`):** Düşme gölgesi yerine yüzey açıklık adımı (`bg → surface-1 → surface-2`) + `1px solid var(--color-line)` + üst `1px` yansıma (`inset 0 1px 0 rgb(255 255 255 / 0.05)`).
    *   **Yüksek kontrast & `forced-colors`:** Gölge ve üst yansıma `none`.
*   **Odak halkası (`:focus-visible`):** İki katmanlı keskin halka (`2px` `var(--color-bg)` ayırıcı + `2px` `var(--color-accent)` — tüm vurgular her temada `≥ 4.75:1` kontrastlı olduğundan WCAG 1.4.11'i doğrudan taşır; `outline: 2px solid transparent; outline-offset: 2px;` Windows Yüksek Kontrastta görünürlüğü garanti eder).

--------------------------------------------------------------------------------

### 4. Uygulama Kabuğu ve Yerleşim Kırılımları

| Genişlik | Sol Ray | Üst Çubuk | Orta Sütun | Sağ Bağlam Rayı |
| :--- | :--- | :--- | :--- | :--- |
| `≥ 1280px` | Tam ray (`238px`), `position: sticky; inset-block-start: 0; block-size: 100dvh; align-self: start;` | İnce `48px` yapışkan bağlam çubuğu (konum + `⌘K` tetikleyici + bildirim özeti) | Ana akışta `≤ 672px`; bölüm/ayarlar/yönetimde `≤ 1000px` | **Yalnız ana akışta (`/`)** `280px` (`Bugünün özeti`, `Çok konuşulanlar`, `Bu hafta en çok paylaşanlar`); `/sections/[slug]` ve diğer rotalarda yok |
| `1024–1279px` | Tam ray (`238px`, tam `100dvh`) | `48px` üst çubuk | `≤ 680px` (ortalanmış) | Gizli (`display: none`) |
| `768–1023px` | İkon-ray (`68px`, tam `100dvh`; erişilebilir adlar korunur) | `48px` üst çubuk | `≤ 680px` | Gizli |
| `< 768px` | Üst çubuğa dönüşür (`54px`: marka + bildirim zili) + sabit alt sekme çubuğu (`62px`, `viewport-fit=cover`, metin odağında gizlenir) | — | Tam genişlik, `16px` yan boşluk | Gizli |

*   **Sol ray tam yükseklik garantisi:** `.app-shell` ızgarasında `<header class="site-header">` masaüstünde her zaman `position: sticky; inset-block-start: 0; block-size: 100dvh; align-self: start; overflow-y: auto;` özelliklerini taşır; içerik uzunluğundan bağımsız olarak görünüm yüksekliğini eksiksiz kaplar ve profil bloğu `margin-block-start: auto` ile alt kenara oturur.
*   **Aktif gezinme stili:** Sol rayda aktif öğe tam neon blok değildir; `var(--color-surface-2)` zemin + `1px` `var(--color-line)` + sol kenarda `3px` `var(--color-accent)` dikey şerit ile sakin ve net biçimde ayrışır.

--------------------------------------------------------------------------------

### 5. Sağ Bağlam Rayı — Sorgular, İndeksler ve Performans

Sağ ray (`src/lib/components/feed/FeedContextRail.svelte`) **yalnız ana akış (`/`)** sayfasında (`≥ 1280px`) gösterilir; `/sections/[slug]` ve diğer rotalarda yer almaz. Tüm veriler mevcut PostgreSQL tablolarından ([`src/lib/server/db/schema.ts`](../../src/lib/server/db/schema.ts)) doğrudan okunur; çevrimiçi göstergesi, canlı rozet veya okundu takibi yoktur.

Veri yükleyici modülü: `src/lib/server/feed/rail-summary.ts` (`getFeedRailSummary()`).

#### 5.1 Bugünün Özeti (`todayShares`, `todayComments`)

Gün başlangıcı yeni bir saat dilimi kodu yazılmadan doğrudan [`src/lib/format/date.ts`](../../src/lib/format/date.ts) içindeki **`APP_TIME_ZONE`** (`'Europe/Istanbul'`) sabiti kullanılarak PostgreSQL tarafında hesaplanır (`date_trunc('day', now() AT TIME ZONE ${APP_TIME_ZONE}) AT TIME ZONE ${APP_TIME_ZONE}`):

```sql
-- 1a. Bugünkü ana akış paylaşımları
SELECT count(*)::int AS share_count
FROM link_shares
WHERE deleted_at IS NULL
  AND is_feed_visible = true
  AND created_at >= (date_trunc('day', now() AT TIME ZONE $tz) AT TIME ZONE $tz);

-- 1b. Bugünkü yorumlar
SELECT count(*)::int AS comment_count
FROM resource_comments
WHERE deleted_at IS NULL
  AND created_at >= (date_trunc('day', now() AT TIME ZONE $tz) AT TIME ZONE $tz);
```

*   **İndeks kullanımı:**
    *   `1a`: Mevcut kısmi bileşik indeks `link_shares_feed_cursor_idx (is_feed_visible, created_at DESC, id DESC) WHERE deleted_at IS NULL` üzerinden doğrudan **Index-Only Scan** (`< 0.2 ms`).
    *   `1b`: `resource_comments` tablosunda yalnız `(resource_id, created_at ASC)` indeksi vardır. 10–15 kişilik ekipte tablo küçük olduğundan tarama `< 0.5 ms` sürer; yeni göç gerektirmez.

#### 5.2 Çok Konuşulanlar (Son 7 Günde En Çok Yorum Alan İlk 3 Kaynak)

```sql
SELECT
  cr.id,
  cr.title,
  cr.domain,
  cr.like_count,
  count(rc.id)::int AS recent_comment_count
FROM resource_comments rc
INNER JOIN canonical_resources cr ON cr.id = rc.resource_id
WHERE rc.deleted_at IS NULL
  AND rc.created_at >= now() - interval '7 days'
  AND EXISTS (
    SELECT 1
    FROM link_shares ls
    WHERE ls.resource_id = cr.id
      AND ls.deleted_at IS NULL
      AND ls.is_feed_visible = true
  )
GROUP BY cr.id
ORDER BY recent_comment_count DESC, cr.like_count DESC, cr.created_at DESC
LIMIT 3;
```

*   **İndeks kullanımı:** Son 7 günün yorumları dar alt küme üretir; `canonical_resources` birincil anahtarından (`id`) eşleşir; `EXISTS` alt sorgusu mevcut `link_shares_resource_history_idx (resource_id, created_at ASC)` indeksini kullanır ve silinmiş veya yalnız sessiz eklenmiş kaynakların ana akış sağ rayına sızmasını önler (`< 0.8 ms`).

#### 5.3 Bu Hafta En Çok Paylaşanlar (Son 7 Günde İlk 5 Aktif Üye)

```sql
SELECT
  u.id,
  u.name,
  count(ls.id)::int AS share_count
FROM link_shares ls
INNER JOIN users u ON u.id = ls.author_id
WHERE ls.deleted_at IS NULL
  AND ls.is_feed_visible = true
  AND ls.created_at >= now() - interval '7 days'
  AND u.is_active = true
GROUP BY u.id, u.name
ORDER BY share_count DESC, u.name ASC
LIMIT 5;
```

*   **İndeks kullanımı:** Mevcut kısmi indeks `link_shares_feed_cursor_idx (is_feed_visible, created_at DESC, id DESC) WHERE deleted_at IS NULL` üzerinden son 7 günün satır aralığı taranır, `users` PK ile birleştirilir (`< 0.4 ms`).

#### 5.4 Önbellek ve Performans Kararı

*   Üç sorgu yalnızca `src/routes/(app)/+page.server.ts` içinde ana akış sayfa sorgusuyla birlikte `Promise.all` olarak paralel yürütülür.
*   **Önbellek yoktur:** 10–15 kişilik kapalı ekipte üç sorgunun toplam yürütme süresi `< 2 ms` olduğundan bellek içi TTL önbelleği veya geçersiz kılma (invalidation) mekanizması kurulmaz. Böylece her istekte güncel veri döner ve eksik geçersiz kılma noktalarından doğacak bayat veri riski tamamen ortadan kalkar.
*   İlgili liste boş döndüğünde (ör. son 7 günde yorum yoksa) kart temiz bir boş durum metni gösterir ("Son 7 günde tartışma başlamadı").

--------------------------------------------------------------------------------

### 6. Kart Anatomisi ve İçerik Türüne Duyarlı Bağlantı Ekleri

`PostCard` kök öğesi (`<article class="share-card" id="share-{id}" tabindex="-1">`) ve [izgah-ui-v2.md](./izgah-ui-v2.md) §12 erişilebilirlik kancaları korunur. Gönderiler `surface-1` üzerinde `14px` köşeli, `1px` kenarlıklı sakin kartlardır.

*   **Bağlantı eki varyantları (`LinkAttachment.svelte`):**
    1.  **Kapak görselli medya kartı (yalnız `thumbnailAssetKey` mevcut ve görsel yüklendiyse):**
        *   `video`: Üstte tam genişlikte `1200/630` yuvarlatılmış kapak + sağ altta oynatma ikonu rozeti; altta mono alan adı/tür + serif `h3` başlık + 2 satır açıklama.
        *   `article` / `web` (görselli): Kapsayıcı `≥ 480px` iken solda serif `h3` başlık + mono meta + 2 satır açıklama, sağda `186px` `1200/630` kapak (dar alanda üstte tam genişlik).
    2.  **Görselsiz Repo kartı (`contentType === 'repo'` ve görsel yok):** Mono `owner/repo` başlığı + git ikonu, altında 2 satır açıklama, sağda/altta renkli dil noktası + mono yıldız sayısı (`★ 19,8B`).
    3.  **Görselsiz Sosyal / Alıntı kartı (`contentType === 'social'` ve görsel yok):** Yazar/kaynak üst satırı + sade metin özeti, boş kapak sütunu ayrılmaz.
    4.  **Görselsiz Kompakt Web / Makale kartı (diğer görselsiz veya önizlemesi başarısız bağlantılar):** Tek satırlı/kompakt şerit — solda 2 harfli alan adı rozeti (`domain-badge`), ortada serif `h3` başlık + mono alan adı/tür, sağda dış bağlantı ikonu. Yarım kalmış veya boş gri kutu asla gösterilmez.
*   **Etkileşim çubuğu (`PostActions.svelte`):** Sol tarafta yalın sayısal beğeni düğmesi (`aria-label="{count} beğeni — {title}"` korunur, görünür metin sade `{count}`), yorum sayacı linki, tooltip'li kopyala ve dış sekmede aç ikonları; sağ tarafta "İlk paylaşan" / çoklu paylaşım bağlamı ve varsa `AvatarStack`.

--------------------------------------------------------------------------------

### 7. Bileşen Envanteri ve Yeni Modern Bileşenler

#### 7.1 Temel ve Mevcut Bileşen Durum Matrisi

| Bileşen / Sınıf | Dosya | Durumlar |
| :--- | :--- | :--- |
| `.btn` (`primary`, `subtle`, `ghost`, `outline`, `danger`, `danger-soft`, `icon`) | `src/lib/styles/components.css` | `default`, `hover`, `active` (`scale: 0.98`), `focus-visible`, `disabled`/`aria-disabled`, `loading` (`aria-busy`), `forced-colors` |
| `.field`, `.input`, `.textarea`, `.select` | `src/lib/styles/components.css` | `default`, `hover`, `focus-visible`, `invalid` (`:user-invalid`), `disabled`, `readonly` |
| `.tag`, `.badge`, `.status-pill`, `.kbd` | `src/lib/styles/components.css` | `default`, `hover` (linkse), `accent`, `active`/`pending`/`passive`, `forced-colors` |
| `Icon` (~32 Lucide çizgi yolu, `1.5px`, paketsiz ISC) | `src/lib/components/ui/Icon.svelte`, `icons.ts` | `default`, `filled` (aktif kalp), `size` (`14/16/18/20`) |
| `Avatar` | `src/lib/components/ui/Avatar.svelte` | `default` (yazar adına göre deterministik 4 yumuşak nötr ton), `self` (vurgu yumuşak ton), `size` (`22/26/30/34`), `aria-hidden` |
| `Dialog`, `PopoverPanel` | `src/lib/components/ui/` | `closed`, `open` (`@starting-style`), `focus-trap`, `dirty-guard`, WebKit popover konumu korunur |
| `SiteHeader`, `BottomTabBar`, `TopContextBar` | `src/lib/components/shell/` | `default`, `hover`, `aria-current="page"`, `icon-rail` (`768–1023px`), `mobile` (`< 768px`), klavye açıkken alt çubuk gizli |
| `FeedView`, `PostCard`, `LinkAttachment`, `PostActions`, `FeedContextRail` | `src/lib/components/feed/` | `default`, `unseen`, `hover`, `focus-visible` (`j`/`k`), `loading` (skeleton / daha fazla yükle), `empty` (süzgeçli / boş arşiv), `error` |
| `ShareComposerDialog` (`feed` & `dialog`) | `src/lib/components/feed/ShareComposerDialog.svelte` | `collapsed`, `expanded`, `checking-duplicate`, `duplicate-found`, `submitting`, `field-error`, `no-js` |
| `NotificationBell` | `src/lib/components/notifications/NotificationBell.svelte` | `idle`, `unread-badge`, `open`, `loading`, `empty`, `error` |

#### 7.2 Yeni Modern Bileşenler — Gerekçe, Durumlar ve JS'siz Davranış

| Bileşen | Dosya | Neden Gerekli? | Durumlar | JS'siz Davranışı |
| :--- | :--- | :--- | :--- | :--- |
| **`⌘K` Komut Paleti** (`CommandPalette`) | `src/lib/components/shell/CommandPalette.svelte` + `src/routes/api/internal/search/quick/+server.ts` | "Arşivde saniyede bul" vaadini tek kısayola (`⌘K` / `Ctrl+K`) indirger; kapsam sekmeleri (`Tümü`, `Bağlantılar`, `Bölümler`, `Eylemler`), canlı eşleşmeler ve klavye gezinmesi (`↑↓ ↵ Esc`) sunar. | `closed`, `open`, `idle` (bölümler + eylemler), `searching` (skeleton), `results` (`<mark>` vurgulu), `empty` ("Aramayı temizle"), `error` | Sol rayda `<search aria-label="Site içi arama">` formu (`GET /search`) mevcuttur; `⌘K` tetikleyicisi hidrasyon öncesi `/search` bağlantısı olarak çalışır. |
| **Yandan Önizleme** (`SidePeekDialog`) | `src/lib/components/feed/SidePeekDialog.svelte` | Akışta kaydırma konumunu kaybetmeden bir kaynağın önizlemesini, paylaşım geçmişini ve yorumlarını sağdan açılan çekmecede (`480px`) incelemeyi sağlar. | `closed`, `loading` (skeleton), `ready` (önizleme + geçmiş + yorumlar + "Tam sayfada aç ↗"), `error` (doğrudan bağlantı yedeği) | Karttaki "Önizle" öğesi gerçek bir `<a href="/resources/{id}">` bağlantısıdır; JS kapalıyken doğrudan kaynak detay sayfasını açar. |
| **Toast** (`Toaster`, yenilenmiş) | `src/lib/components/ui/Toaster.svelte` | Kopyalama, paylaşım, beğeni hatası ve ayar kaydı için düzeni kaydırmayan, tonlu (`neutral`, `success`, `error`) ve isteğe bağlı eylemli ("Göster") canlı bölge bildirimi. | `hidden`, `entering`, `visible`, `dismissed`; tek `role="status"` + hata için `role="alert"` | Sunucu eylemleri sonrası sayfa içi `<p role="status">` / `<div role="alert">` afişleri gösterilir; `Toaster` boş canlı bölge olarak zararsız kalır. |
| **Tooltip** (`Tooltip`) | `src/lib/components/ui/Tooltip.svelte` | İkon düğmelerinin (kopyala, dış sekmede aç, önizle) ve kısayol ipuçlarının ne yaptığını görsel olarak açıklar. Masaüstünde (`hover: hover`) görünür, `pointer: coarse` altında kapalıdır. | `hidden`, `visible` (`:hover` / `:focus-visible`, `Esc` ile kapanır; destekleyen tarayıcılarda `popover="hint"` aşamalı) | Salt CSS `:hover` / `:focus-visible` ile çalışır; ekran okuyucular tetikleyicideki `aria-label` metnini her zaman okur. |
| **Skeleton** (`Skeleton` / `.skeleton`) | `src/lib/components/ui/Skeleton.svelte` | Önizleme işlenirken (`unfurlStatus: queued/running`), Side Peek ve `⌘K` yüklenirken düzen kaymasını (CLS) önler. | `pulsing` (yumuşak opaklık `0.55 ↔ 0.85`, gradyan yok), `static` (`prefers-reduced-motion` ve yüksek kontrastta) | SSR sırasında yalnız `unfurlStatus` bekleyen kartlarda durağan yer tutucu blok olarak çizilir. |
| **Avatar Yığını** (`AvatarStack`) | `src/lib/components/ui/AvatarStack.svelte` | Aynı kaynağı paylaşan veya tartışan ekip üyelerini kompakt örtüşen monogramlarla gösterir (`+N` taşma rozeti). | `default`, `overflow` (`+N`) | Saf HTML/CSS; JS gerektirmez, yanında ekran okuyucu/metin özeti bulunur. |
| **Segmented Control** (`SegmentedControl` / `.segmented`) | `src/lib/components/ui/SegmentedControl.svelte` | İçerik türü süzgeci, renk modu seçicisi (`Sistem / Açık / Koyu`) ve arama kapsamı için tek satırlı dokunsal seçici. | `default`, `hover`, `active`/`checked`, `focus-visible`, `disabled` | Gezinme varyantı `<a href>` bağlantıları, form varyantı yerel `<input type="radio">` + `<label>` grubudur; JS'siz tam çalışır. |

#### 7.3 `GET /api/internal/search/quick` ve `searchResources` Log Kuralı

*   [`src/lib/server/search/service.ts`](../../src/lib/server/search/service.ts) içindeki `searchResources` işlevine varsayılan değeri `true` olan **`recordLog?: boolean`** seçeneği eklenir (`recordLog: false` verildiğinde `search_logs` tablosuna satır yazılmaz).
*   `GET /api/internal/search/quick` ucu çerez oturumu + `Origin`/`Sec-Fetch-Site: same-origin` koruması (`GET /api/internal/feed/updates` ile aynı) altında `searchResources({ ..., limit: 6, recordLog: false })` çağırır ve `Cache-Control: no-store` ile döner.
*   Böylece `⌘K` içinde her tuş vuruşu (200ms debounce) `search_logs` metriklerini kirletmez; kullanıcı `⌘K` içinde Enter ile tam arama sayfasına (`/search?q=...`) gittiğinde mevcut `recordLog: true` davranışı aynen çalışır.

--------------------------------------------------------------------------------

### 8. Hareket Kuralları

| Token / Etkileşim | Süre | Easing | Animasyon | `prefers-reduced-motion: reduce` |
| :--- | :--- | :--- | :--- | :--- |
| `--dur-fast` (hover, renk, kenarlık) | `120ms` | `cubic-bezier(0.2, 0, 0, 1)` | `background-color`, `border-color`, `color`, `opacity` | `0ms` |
| `--dur-base` (dialog, `⌘K`, popover) | `180ms` | `cubic-bezier(0.2, 0, 0, 1)` | `@starting-style` opaklık + `scale(0.98)` | `0ms`, `scale` yok |
| `--dur-panel` (`SidePeekDialog` çekmecesi) | `220ms` | `cubic-bezier(0.2, 0, 0, 1)` | Sağdan `translateX(16px → 0)` + opaklık | `0ms`, kayma yok |
| Düğme basma (`:active`) | `90ms` | `cubic-bezier(0.2, 0, 0, 1)` | `scale: 0.98` | Kapalı |
| Beğeni kalbi (`aria-pressed="true"`) | `280ms` | `ease-out` | Hafif `1 → 1.2 → 1` nabız | Kapalı |
| Skeleton yükleyici | `1400ms` | `ease-in-out` | Yalnız `opacity: 0.55 ↔ 0.85` (gradyan yok) | Sabit durağan blok |
| Kart ↔ Detay View Transition | `180ms` | `cubic-bezier(0.2, 0, 0, 1)` | Aşamalı `startViewTransition` | Tamamen devre dışı |

*   Hover'da kart yükselmesi (`translateY`) veya zıplama **yoktur** (yoğun akışta görsel titreşimi önler).

--------------------------------------------------------------------------------

### 9. Ekran Bazlı Yeniden Tasarım Özeti

*   **Ana Akış (`/`):** 3 sütun (tam yükseklik sol ray + üst `48px` bağlam çubuğu + akış sütunu + sağ bağlam rayı), `SegmentedControl` içerik türü süzgeci, avatarlı satır içi paylaşım kartı, serif italik gün ayırıcıları, içerik türüne duyarlı kartlar, `SidePeekDialog` "Önizle" bağlantısı.
*   **Bölüm Akışı (`/sections/[slug]`):** Sol ray + üst `48px` bağlam çubuğu + tek okuma sütunu (sağ bağlam rayı yoktur), aynı içerik türü süzgeci, satır içi paylaşım ve kart sistemi.
*   **Kaynak Detayı (`/resources/[id]`):** Geniş kapak + serif `h1` başlık + sakin aksiyon şeridi (teal birincil "Kaynağa git", beğeni, kopyala, `AvatarStack`), altında temiz yorum dizisi ve sağda dikey çizgili paylaşım geçmişi zaman çizelgesi + bölüm çipleri.
*   **Ayarlar (`/settings`, `/settings/api-keys`):** Saç çizgili satır düzeni (etiket+açıklama solda, kontrol sağda); `Sistem / Açık / Koyu` segmented control; gerçekçi mini arayüz önizleme kartları (2 açık + 3 koyu palet); 4 vurgu renk hapı (`Orman Teal`, `Kobalt`, `Kiremit`, `Erik`); tek tuşlu kısayollar anahtarı.
*   **Yönetim (`/admin/*`):** Alt çizgili sade yönetim sekmeleri (neon blok yok); üstte 3'lü tabular KPI şeridi (`Üyeler` ve `Ölçümler`de); sadeleştirilmiş tablo satırları (durum noktalı haplar, kompakt rol seçici, `btn-ghost` + `btn-danger-soft` satır eylemleri); tüm mevcut JS'siz onay yedekleri korunur.
*   **Giriş, Davet, Parola Sıfırlama (`/login`, `/auth/*`) ve Hata Sayfaları:** Sıcak koyu grafit sol kolofon paneli (serif başlık + örnek ekip kartı önizlemesi) ve alabaster/grafit form kartı; Türkçe 404 ve hata sayfaları aynı İzgah Stüdyo dilinde.
*   **Tarayıcı Eklentisi (`extensions/src/**`):**
    *   Popup (`420px` genişlik): Üstte serif `İzgah` kelime işareti + ayarlar ikonu (**"Kaydet / Son Kayıtlar" sekmesi yoktur**, mevcut popup/options davranışı ve `/api/v1/*` akışı aynen korunur); yakalanan sayfa için sıcak yüzeyli önizleme kutusu (alan adı + tür + başlık); not alanı + karakter sayacı; yuvarlatılmış bölüm seçim çipleri; içerik türü seçicisi; **yalnız `user.role === 'admin'` iken görünen** `"Ana akışta yayınlama (yalnızca seçili bölümlere sessiz ekle)"` satırı; tam genişlikte teal birincil "Paylaş" düğmesi.
    *   `extensions/src/styles/tokens.css`: İzgah Stüdyo açık/koyu (`prefers-color-scheme`) token'larına ve `Geist Variable` + `Newsreader Variable` (`latin` + `latin-ext`) yazı tiplerine hizalanır; `OFL.txt` güncellenir.

--------------------------------------------------------------------------------

### 10. Korunan Sabit E2E Kancaları ve Değişiklik Politikası

[izgah-ui-v2.md](./izgah-ui-v2.md) §12'deki tüm sabit CSS/DOM kancaları (`article.share-card`, `#share-composer-dialog`, `#main-content h1`, `#notification-bell-popover`, `.notification-badge`, `.inline-card-panel`, `.conflict-box`, `.comment-list`, `#delete-comment-dialog`, `.search-summary`, `#new-api-key-value`) ve erişilebilir adlar (`"Link Paylaş"`, `"Ana gezinme"`, `"Paylaşım işlemleri"`, `"Daha fazla yükle"`, `"İçerik türü süzgeci"`, `"Site içi arama"`, `"İzgah içinde ara"`, `"Bildirimler"`, `"Yönetim"`, `"Ana Akış"`) **korunur**.

*   **Bilinçli güncellenen testler:**
    *   `tests/unit/tokens-contrast.test.ts`: Yeni 5 palet (`default`/`contrast` açık, `default`/`dim`/`contrast` koyu) × 4 çift kutuplu vurgu (`teal`/`cobalt`/`terracotta`/`plum`) yapısına ve tüm vurguların hem açıkta hem koyuda `≥ 4.5:1` kontrast sağlaması kuralına uyarlanır.
    *   `tests/integration/m10-ui-v2.test.ts` ve `tests/e2e/m12-ui-v2-shell.spec.ts` / `m15-a11y-tour.spec.ts`: Eski vurgu adları (`lime`/`cyan`/`pink`/`blue` → `teal`/`cobalt`/`terracotta`/`plum`) ve font ön yükleme deseni (`schibsted-grotesk` → `geist` + `newsreader`) aynı commit içinde güncellenir.

--------------------------------------------------------------------------------

### 11. Uygulama Planı (Dosya Sahipliği)

Her uygulama alanı ön yüz bileşeni, form, animasyon veya erişilebilirlik çalışmasından önce `npx modern-web-guidance@latest search "<ihtiyaç>"` çalıştırır, uygun rehberi `retrieve` eder ve uyar.

| Alan | Sorumluluk | Dosya Sahipliği | Sıra / Bağımlılık |
| :--- | :--- | :--- | :--- |
| **A1** | Tasarım sistemi, fontlar & temel UI | `package.json`, `pnpm-lock.yaml`, `src/routes/+layout.svelte`, `src/lib/types/appearance.ts`, `src/lib/server/http/theme.ts`, `src/lib/styles/**`, `src/lib/components/ui/**` (`Tooltip`, `Skeleton`, `AvatarStack`, `SegmentedControl`, `Avatar`, `Icon`, `Toaster`, `Dialog`, `PopoverPanel`) | **Önce çalışır**, commit'ler |
| **A2** | Akış, sağ bağlam rayı & Side Peek | `src/lib/server/feed/rail-summary.ts`, `src/routes/(app)/+page.server.ts`, `src/lib/components/feed/**` (`FeedView`, `PostCard`, `LinkAttachment`, `PostActions`, `ShareComposerDialog`, `FeedFilterBar`, `NewPostsPill`, `FeedContextRail`, `SidePeekDialog`) | A1 sonrası |
| **A3** | Kabuk, üst çubuk & `⌘K` | `src/routes/(app)/+layout.svelte`, `src/lib/components/shell/**`, `src/lib/components/notifications/**`, `src/lib/server/search/service.ts` (`recordLog`), `src/routes/api/internal/search/quick/+server.ts`, `CommandPalette.svelte` | A1 sonrası |
| **A4** | İçerik ekranları | `src/routes/(app)/{resources,search,sections,settings}/**`, `src/lib/components/resource/**` | A1 sonrası |
| **A5** | Yönetim | `src/routes/(app)/admin/**` | A1 sonrası |
| **A6** | Giriş, hata & eklenti | `src/routes/{login,auth}/**`, `src/lib/components/auth/**`, `src/routes/+error.svelte`, `src/routes/(app)/+error.svelte`, `src/lib/components/ErrorContent.svelte`, `extensions/**` | A1 sonrası |
| **A7** | Testler & doğrulama | `tests/unit/tokens-contrast.test.ts`, `rail-summary` / `quick-search` (`search_logs` yazmadığı dahil) entegrasyon ve birim testleri, E2E uyarlamaları + `m15` `@axe-core/playwright` (`color-contrast`) | A1–A6 sonrası |

--------------------------------------------------------------------------------

## Alternatives Considered

### Alternatif A: Saf Karanlık Araç Çizgisi (Yalnız Sans + Obsidyen)
Yüksek teknik hassasiyet sunar; ancak yalnızca sans-serif başlıklar ve soğuk obsidyen/platin tonlar uzun Türkçe ekip notları ve makaleler için fazla steril kalır. Kabuk, ayarlar, yönetim ve `⌘K` katmanı alınarak editoryal okuma ve sosyal akış öğeleriyle dengelendi.

### Alternatif B: Saf Editoryal Kütüphane Çizgisi (Tek Sütun)
Okuma sakinliği yüksektir; ancak tek sütunlu yapı yoğun yönetim, ayarlar ve hızlı ekip akışı akışkanlığını yavaşlatır. Başlık tipografisi ve sıcak nötr yüzey ilkeleri alınarak 3 sütunlu akışla birleştirildi.

### Alternatif C: Sağ Ray İçin 30 Saniyelik Bellek İçi TTL Önbelleği
Tekrarlayan ana sayfa isteklerinde 3 kısa sorguyu atlardı; ancak paylaşım, yorum, silme ve üye pasifleştirme gibi tüm yazma noktalarında geçersiz kılma (invalidation) unutulması hâlinde bayat veri riski doğurur. 10–15 kişilik ekipte sorguların toplamı `< 2 ms` olduğundan önbellek reddedildi.

### Alternatif D: Eklentide "Kaydet / Son Kayıtlar" Sekmesi Eklemek
Mevcut `/api/v1/*` sözleşmesine yeni okuma ucu eklemeyi ve eklenti davranışını değiştirmeyi gerektirir. Kapsam dışına alındı.

--------------------------------------------------------------------------------

## Risks & Mitigations

| Risk | Etki | Önlem / Azaltma |
| :--- | :--- | :--- |
| Yeni Fontsource paketlerinin (`newsreader`, `geist`) `.woff2` dosyaları CSP `font-src 'self'` ile çakışır veya ön yükleme kaçırılır | FOUT / CSP ihlali | `vite.config.ts` `assetsInlineLimit` `.woff2`'yi satır içine almaz; `theme.ts` ön yükleme deseni birim testiyle ve `pnpm test:docker` CSP duman testiyle doğrulanır. |
| Eski `izgah_accent=lime` çerezine sahip kullanıcılar v3'e geçer | Geçersiz vurgu özniteliği | `pickAllowed(ACCENT_VALUES, raw, 'teal')` beyaz liste dışındaki eski değerleri sessizce `teal`'e düşürür. |
| `⌘K` canlı araması `search_logs` ölçümlerini şişirir | Yanlış arama ve sıfır-sonuç oranları | `searchResources` `recordLog: false` seçeneği ile çağrılır; entegrasyon testi `GET /api/internal/search/quick` çağrısının `search_logs`'a satır eklemediğini doğrular. |
| `SidePeekDialog` veya `⌘K` odak yönetimini veya `j`/`k` kısayollarını bozar | Klavye erişilebilirliği gerilemesi | Her ikisi yerel `<dialog>` (`showModal()`) kullanır; `+layout.svelte` `overlayOpen()` kontrolü açık `dialog:modal` varken tek tuş kısayollarını otomatik durdurur. |
| `resource_comments` üzerinde yalnız `created_at` indeksi yok | Çok büyüyen arşivde tarama süresi | 10–15 kişilik ekipte `< 0.5 ms`; büyüme eşiğinde geriye dönük uyumlu tek kısmi indeks göçüyle kolayca hızlandırılır. |
| Eklenti paket boyutunun iki fontla artması | Büyük `.zip`/`.xpi` | Eklenti yalnızca `latin` + `latin-ext` `wght-normal` (`geist`) ve `opsz-normal` (`newsreader`) dosyalarını paketler; `pnpm verify:manifests` ile doğrulanır. |

--------------------------------------------------------------------------------

## Verification Plan

*   **Birim testleri (`pnpm test`):**
    *   `tests/unit/tokens-contrast.test.ts`: 5 palet × 4 vurgu = 20 kombinasyonun tamamı (`4.5:1` metin ve vurgu metni, `3:1` kontrol/odak, yüksek kontrastta `7:1` AAA ve `line ≥ 4.5:1`, yüksek kontrastta gölge/ışıma yok).
    *   `theme.ts` birim testleri: yeni `ACCENT_VALUES`, eski `lime` çerezinin `teal`'e düşmesi, yeni font ön yükleme deseni (`geist` + `newsreader`).
    *   Yeni `CommandPalette` filtreleme/kısayol ve `SidePeek` yardımcı testleri.
*   **Entegrasyon testleri (`pnpm test` + PostgreSQL):**
    *   `GET /api/internal/search/quick`: oturum/origin doğrulaması (`401`/`403`), en fazla `6` sonuç, ve **`search_logs` tablosuna satır eklemediğinin** doğrulanması (aynı sorgu `/search` üzerinden `recordLog: true` ile satır eklemeye devam eder).
    *   `getFeedRailSummary`: `APP_TIME_ZONE` gün sınırı, son 7 gün yorum sıralaması (sessiz/silinmiş hariç), son 7 gün paylaşanlar (pasif üye hariç).
*   **Statik denetim:** `pnpm lint && pnpm check`.
*   **Uçtan uca (`pnpm test:e2e`):** Tüm mevcut E2E senaryoları (`m5`–`m15`, Chromium/Firefox/WebKit + mobil) + `⌘K`, Side Peek (JS'li çekmece, JS'siz `/resources/[id]`), yeni tema/vurgu kalıcılığı ve `m15-a11y-tour.spec.ts` içinde `@axe-core/playwright` **yalnız `color-contrast` kuralı** taraması (açık, koyu, loş ve yüksek kontrast paletlerinde).
*   **Üretim imajı ve CSP (`pnpm test:docker`):** Sıfır `securitypolicyviolation`, tüm rotalarda yeni fontların `'self'` üzerinden sorunsuz yüklenmesi.
*   **Eklenti (`cd extensions`):** `pnpm lint && pnpm check && pnpm test && pnpm verify:manifests`.
*   **Görsel kalite kapısı:** `SHOTS_DIR=./.local-data/shots-v3 pnpm exec playwright test -c .local-data/report-kit/playwright.config.ts` ile tüm ekran görüntüleri alınıp Yön D prototipiyle birebir kıyaslanır.

--------------------------------------------------------------------------------

## Uygulama Notları — 2026-11-25 Denetimi

v3 uygulaması (`f39855e..7525156`) bu dokümana karşı denetlendi. Aşağıdakiler düzeltildi; kalan farklar bilinçli olarak listelenir.

**Düzeltilenler**

*   **§1 / WCAG 1.4.11:** Sol ray arama kutusu ve `⌘K` tetikleyicisi etkileşimli kontrol olduğu için `--color-line` yerine `--color-line-strong` kenarlık kullanır.
*   **§2.2:** Sürükle-bırak katmanındaki serif başlık sans (`--text-section`) oldu.
*   **§2.3:** `12px` altındaki tüm yazı boyutları (`0.6875rem`, `0.71875rem`) en küçük ölçek olan `0.75rem`'e çıkarıldı.
*   **§4:** Okuma sütunu `1280px` altında `680px`, ayarlar ekranları `--wide-w` (`1000px`).
*   **§4 üst çubuk:** Konum izi `<nav aria-label="Sayfa konumu">` + `<ol>` yapısına geçti (ayraçlar CSS ile, `aria-current="page"`); var olmayan `/admin/invites` eşlemesi kaldırıldı; yardım düğmesi `title` yerine `Tooltip` kullanır; `⌘K` ipucu platforma göre `Ctrl+K` gösterir.
*   **§7.1 durum matrisi:** Akışta "Daha fazla yükle" için `error` durumu (satır içi hata + "Tekrar dene"); tema/palet kaydı başarısız olursa hata toast'ı.
*   **§7.2 Toast:** Fareyle üzerine gelme ve klavye odağı ayrı tutulur; odaktaki toast kendiliğinden kapanmaz (WCAG 2.2.1).
*   **§9 eklenti:** Popup başlığı serif `İzgah` kelime işareti + ikonlu ayarlar düğmesi.
*   **Tekrarlar:** `.banner`, `.kpi-strip`, `.page-header h1` / `.page-lead` sayfa sayfa kopyalanmak yerine `components.css`'te tek tanım; `CONTENT_TYPE_LABELS` tek kaynak; kullanılmayan `.btn-lg`, `.btn-quiet`, `.btn-danger-outline`, `.badge-count` ve `signal-pop` kaldırıldı; `select` oku temaya uyar.

**Bilinçli olarak açık bırakılanlar**

*   **§4 üst çubukta bildirim özeti:** Zil sol rayda kalıyor. Üst çubuğa taşımak için iki ayrı `NotificationBell` örneğinin ortak bir istemci deposunu paylaşması gerekir (aksi hâlde çift yoklama ve ayrışan okundu durumu); ayrı bir iş olarak ele alınacak.
*   **Tek `SegmentedControl`:** `ThemeForm` ve arama kapsamı hâlâ kendi işaretlemesini kullanır (JS'siz form/bağlantı davranışları farklı); görsel ölçüler hizalandı, bileşen birleştirmesi ayrı iş.
*   **Yönetim tablosu / boş durum / dialog başlığı stilleri:** Hâlâ sayfa bazlı; ortak sınıflara taşınması planlı.
*   **Boşluk ızgarası:** Bileşenlerde `4px` ızgarası dışında kalan (`5px`, `6px`, `9px` vb.) değerler kademeli olarak `--space-*` token'larına taşınacak.

> **2026-11-25 — i18n:** Arayüz artık İngilizce temelli, Türkçe tam çeviriyle çalışır ([izgah-i18n-oss.md](./izgah-i18n-oss.md)). §10'daki sabit erişilebilir adlar Türkçe yerel ayarın (`DEFAULT_LOCALE=tr`) sözleşmesidir; E2E testleri bu ayarla çalışır, İngilizce karşılıkları `src/lib/i18n/messages/en.ts` içindedir.
