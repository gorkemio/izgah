# İzgah Arayüz Cilası — "Sinyal" Detay İşçiliği

*   **Author:** Antigravity (Aşama 0–1 Denetim; Faz 2 Modern Derinlik Eki)
*   **Status:** Faz 1 & Faz 2 Approved
*   **Date:** 2026-11-24

--------------------------------------------------------------------------------

## Overview

Bu doküman, İzgah web arayüzü ile Chrome/Firefox/Safari tarayıcı eklentisinin mevcut **"Sinyal"** görsel kimliğini ([izgah-ui-v2.md](./izgah-ui-v2.md), [izgah-themes.md](./izgah-themes.md)) koruyarak daha keskin, tutarlı ve rafine bir kalite düzeyine taşınması için yapılan ekran denetimini ve uygulama planını tanımlar.

Çalışma bir **yeniden tasarım değildir**; mevcut bilgi mimarisi, renk paletleri, yazı tipi çifti (`Schibsted Grotesk Variable` + `JetBrains Mono Variable`), etkileşim modeli ve E2E kancaları aynen korunur. Odak noktası:

*   Koyu tema ve mobil kırılımda tespit edilen somut görsel/kontrast hatalarının giderilmesi (aktif yönetim sekmesinde görünmez rozet, mobilde kısa sayfalarda tepe boşluğu, koyu temada birleşen giriş bölünmüş ekranı).
*   v1'den kalan stil artıklarının (`--color-border`, `--radius-md/lg`, `font-weight: 600`, sabit `ui-monospace`, yasaklı `⚠` emojisi) Sinyal sistemine tamamen hizalanması.
*   Tipografi ritmi, `tabular-nums`, form/tablo yoğunluğu, mikro etkileşimler (alt çizgili düğme hover'ları yerine keskin Sinyal çerçeve/zemin geri bildirimi), boş/yükleniyor durumları ve eklenti-web tutarlılığının cilalanması.

Hiçbir yeni renk token'ı, yeni bağımlılık, CSS çerçevesi, ikon paketi, satır içi betik veya veritabanı değişikliği gerektirmez.

## The Problem (Aşama 0 — Ekran Bazlı Denetim Bulguları)

Denetim, `.local-data/rapor/izgah-proje-raporu/ekran-goruntuleri/` altındaki beş klasör (`1-masaustu-acik`, `2-masaustu-koyu`, `3-mobil-acik`, `4-tema-vitrini`, `5-tarayici-eklentisi`), genel bağlam raporu (`izgah-proje-raporu.pdf`) ve ilgili kaynak kodun birebir karşılaştırılmasıyla yapılmıştır. Her ekran grubu için en fazla 5 somut bulgu aşağıda listelenir.

### 1. Ortak Tasarım Sistemi ve Temel İlkeller (`tokens`, `base`, `components`)

1.  **`src/lib/styles/components.css:39-63` — Düğme hover/active geri bildirimi zayıf ve tablo içi yıkıcı varyant eksik**
    *   **Sorun:** `.btn-primary:hover` ve `.btn-danger:hover` yalnızca `text-decoration: underline` uyguluyor; düğmelerde bağlantı gibi alt çizgi çıkması görsel kaliteyi düşürüyor. `:active` geri bildirimi ve `.btn:hover` kenarlık vurgusu yok; ayrıca tablo satırları için ikincil yıkıcı varyant bulunmadığından yönetim tabloları katı kırmızı düğmelerle doluyor.
    *   **Önerilen Düzeltme:** `.btn-primary:hover` için alt çizgi kaldırılıp `box-shadow: inset 0 0 0 1px var(--color-on-signal)` (2px mürekkep iç çerçeve); `.btn-danger:hover` için `opacity: 0.9`; `.btn:hover` için `border-color: var(--color-text)`; `:active:not(:disabled)` için `opacity: 0.85` ve `border-color`/`color`/`opacity` geçişleri eklenir. Tablo satırları için `.btn-danger-outline` (`color: var(--color-danger); border-color: var(--color-danger)`, hover'da katı `--color-danger` + `--color-on-danger`) tanımlanır.
2.  **`src/lib/styles/components.css:97-109` — Native `<select>` oku sağ kenara yapışıyor**
    *   **Sorun:** Paylaşım penceresi (`05-paylasim-penceresi`), Yönetim Üyeler (`13-yonetim-uyeler`) ve Denetim Kaydı (`17-yonetim-denetim-kaydi`) ekranlarında `<select>` açılır oku sağ kenara neredeyse 1–2px mesafede duruyor.
    *   **Önerilen Düzeltme:** `select` alanlarına yeterli `padding-inline-end` ve `line-height` düzeni verilir; platform desteği `modern-web-guidance` üzerinden doğrulanır (CSP uyumlu, polyfill yok).
3.  **`src/lib/styles/components.css:200-208` — Yapışkan gün başlıkları alttaki içerikten keskin ayrılmıyor**
    *   **Sorun:** `.day-heading` (`Bugün`, `Dün`…) kaydırma sırasında gönderilerin üstünde duruyor ancak alt saç çizgisi (`border-block-end`) taşımıyor (`izgah-ui-v2.md` §6 şemasında ayırıcı çizgi öngörülüyor).
    *   **Önerilen Düzeltme:** `.day-heading` altına `border-block-end: 1px solid var(--color-line)` eklenir ve üst/alt boşluk ritmi (`--space-4` / `--space-2`) dengelenir.
4.  **`src/lib/styles/components.css:237-290` ve `src/lib/styles/base.css:100-107` — Katman giriş geçişi ve `forced-colors` cilası eksik**
    *   **Sorun:** `<dialog>` ve `[popover]` açılışında aşamalı `@starting-style` opaklık geçişi yok; `@media (forced-colors: active)` altında `.unseen-mark`, `.badge-count`, `.btn-primary` ve katman sınırları için açık sistem rengi tanımları eksik.
    *   **Önerilen Düzeltme:** `transition-behavior: allow-discrete` + `@starting-style` ile yalnız opaklık giriş geçişi (`prefers-reduced-motion: reduce` altında `0ms`) ve kapsamlı `@media (forced-colors: active)` kuralları eklenir.
5.  **`src/lib/styles/tokens.css:157-180` (ve bileşen stilleri) — v1 token ve ağırlık artıkları**
    *   **Sorun:** `ShareComposerDialog`, `PostCard`, `NotificationBell`, `settings/api-keys` ve `/admin/*` dosyalarında hâlâ `--color-border`, `--color-surface-muted`, `--radius-md/lg` gibi v1 takma adları ve Schibsted Grotesk'in tanımlı ağırlık ölçeği (`400 / 500 / 700 / 800`, `izgah-ui-v2.md` §2) dışındaki `font-weight: 600` değerleri kullanılıyor.
    *   **Önerilen Düzeltme:** İlgili bileşenlerde v1 takma adları Sinyal token'larına (`--color-line`, `--color-surface`, `--radius-1/2`, `--space-*`) ve `500`/`700` ağırlıklarına çekilir (geriye dönük uyumluluk için `tokens.css` eşlemeleri korunabilir).

### 2. Uygulama Kabuğu ve Bildirimler (`+layout.svelte`, `SiteHeader`, `BottomTabBar`, `NotificationBell`)

1.  **`src/routes/(app)/+layout.svelte:452-477` — Mobilde kısa sayfalarda başlık üstünde ~140px boşluk**
    *   **Sorun:** `3-mobil-acik/07-bolumler.png` görüntüsünde üst çubuk ile `Bölümler` başlığı arasında devasa beyaz boşluk oluşuyor. Kök neden: `.app-shell` `display: grid; min-block-size: 100dvh;` tanımlı ancak `@media (max-width: 767px)` altında `grid-template-rows` verilmediği için CSS Grid, içerik ekrandan kısayken 1. satırı (`header`) ve 2. satırı (`main`) eşit esnetiyor.
    *   **Önerilen Düzeltme:** `@media (max-width: 767px)` içine `.app-shell { grid-template-rows: auto minmax(0, 1fr); }` eklenir.
2.  **`src/lib/components/shell/SiteHeader.svelte:51-86,234-251` — Ray arama kutusu iki katlı ve hantal**
    *   **Sorun:** Masaüstü sol raydaki arama alanı iki ayrı satır (`[Ara…]` + alt satırda sağa yaslı `[/] [Ara]`) kaplıyor (`04-ana-akis.png`); bölüm sayfasında (`08-bolum-akisi.png`) `[ ] Bu Bölüm` ile sıkışıyor. Ayrıca `.brand:hover` genel `a:hover` limon dolgusunu aldığı için marka karesi (`.brand::after`) hover'da kayboluyor (`SiteHeader.svelte:217-232`).
    *   **Önerilen Düzeltme:** Arama girdisi ve kompakt `Ara` gönder düğmesi tek satırda hizalanır (JS'siz çalışır, `"Ara"` düğmesi korunur), `/` `kbd` ipucu kompakt konumlandırılır; `Bu Bölüm` onay kutusu yalnız bölüm sayfasında ikinci satır olarak açılır. `.brand:hover` arka planı `transparent` tutularak Sinyal karesi korunur.
3.  **`src/lib/components/shell/SiteHeader.svelte:145-168,300-322` — Yönetim sayfalarında üst üste iki limon blok**
    *   **Sorun:** `/admin/*` sayfalarında (`13`–`18` ekran görüntüleri) `+ Paylaş` (`.btn-primary`) ile hemen altındaki aktif `Yönetim` (`.rail-admin[aria-current='page']`) 8px aralıkla üst üste iki parlak limon blok oluşturuyor; görsel hiyerarşi çatışıyor.
    *   **Önerilen Düzeltme:** `.rail-compose` bloğu üstte/altta saç çizgisi veya belirgin boşluk (`--space-3` + `border-block-start: 1px solid var(--color-line)`) ile yönetimsel gezinmeden görsel olarak ayrılır; `.nav-item` ve `.menu-item` üzerine `background-color var(--dur-1) var(--ease)` geçişi eklenir.
4.  **`src/lib/components/notifications/NotificationBell.svelte:254-337` — Bildirim panelinde v1 stilleri ve etkisiz hover**
    *   **Sorun:** Panel (`06-bildirimler.png`) v1 token'ları, `0.78rem` sans tarih metni ve `font-weight: 600` kullanıyor; `.notif-mark-all-btn:hover` (`--color-surface-muted`) dinlenme durumuyla (`--color-surface`) aynı renk olduğu için hover'da hiç değişmiyor; yükleniyor/boş durum tek düz paragraf.
    *   **Önerilen Düzeltme:** Sinyal token'larına (`--color-line`, `--space-*`, `--text-meta` + `tabular-nums`, `.btn .btn-outline`) geçirilir; her okunmamış bildirim satırına ince `.unseen-mark` göstergesi, yüklenme durumuna durağan `.skeleton` blokları eklenir.
5.  **`src/lib/components/shell/BottomTabBar.svelte:86-113` — Alt sekme çubuğu etkileşim ve yüksek kontrast cilası**
    *   **Sorun:** Mobil alt çubukta (`3-mobil-acik/04-ana-akis.png`) aktif sekme geçişsiz, `Paylaş` öğesinin ikon/etiket ağırlığı diğer sekmelerle neredeyse aynı ve `forced-colors` altında aktif sekme ayrımı eksik.
    *   **Önerilen Düzeltme:** `.tab` için `background-color`/`color` geçişi, aktif sekmede üst ince ayırıcı/net kontrast ve `@media (forced-colors: active)` için `Highlight`/`HighlightText` kuralı eklenir.

### 3. Ana Akış, Bölüm Akışı ve Paylaşım Formu/Penceresi (`FeedView`, `PostCard`, `LinkAttachment`, `PostActions`, `ShareComposerDialog`, `NewPostsPill`)

1.  **`src/lib/components/feed/ShareComposerDialog.svelte:628-656,720-776` — Satır içi formda çift kutu görünümü ve dialogda sıkışık odak halkası**
    *   **Sorun:** Akış başındaki kapalı satır içi form (`04-ana-akis.png`) `surface` zeminli dış kutu içinde yine `surface` zeminli `.text-input` kullandığından girdi arka plandan ayrışmıyor ve "kutu içinde kutu" hissi veriyor. Dialog modunda (`05-paylasim-penceresi.png`) `Not` alanının odak halkası hemen altındaki `Bölümler (isteğe bağlı)` efsanesine fiziksel olarak temas ediyor. Ayrıca dosya v1 token'ları ve tekrarlı `.primary-btn`/`.secondary-btn` kuralları barındırıyor.
    *   **Önerilen Düzeltme:** `.text-input` zemini `var(--color-bg)` yapılır; `.composer-form` ve `.composer-more` aralığı `--space-4` olarak açılır (odak halkası çakışmaz); tüm renk/boşluk/buton stilleri Sinyal token'larına (`--color-*`, `--space-*`, `--radius-2`) hizalanır; `Not` alanına aşamalı `field-sizing: content` (`max-block-size: 14rem`) eklenir.
2.  **`src/lib/components/feed/PostCard.svelte:697-755,826-839,841-1035` — Geçişsiz kart satırları, ağır alt çizgili atıf ve v1 dialog artıkları**
    *   **Sorun:** `.share-card` hover/odak değişimi anlık sıçrıyor (`transition` yok); `.attribution-notice a` (`İlk paylaşan: Zeynep Demir · 24 Kas 2026…`) tüm satır boyunca alt çizgili olduğu için ek kutusunun altında görsel gürültü yaratıyor (`04-ana-akis.png`); `PostCard` içindeki düzenle/sil dialogları v1 `.primary-btn` (`--color-primary` yani mürekkep zemin!) kullanarak Sinyal'in limon birincil düğme dilinden sapıyor.
    *   **Önerilen Düzeltme:** `.share-card` için `transition: background-color var(--dur-1) var(--ease)`; `.attribution-notice a` için varsayılan `text-decoration: none` + `border-block-end: 1px solid var(--color-line)` veya ince hover vurgusu (okunaklılık ve erişilebilir bağlantı ayrımı korunarak); düzenle/sil dialogları ve JS'siz paneller Sinyal token'larına ve `.btn` diline geçirilir.
3.  **`src/lib/components/feed/LinkAttachment.svelte:41,85-171` — Küçük harf içerik türü tutarsızlığı ve çerçevesiz önizleme görseli**
    *   **Sorun:** Ek meta satırında içerik türü küçük harf (`makale`) görünürken kaynak detayda büyük baş harfli (`Makale`). `.card-thumbnail` kenarlıksız olduğundan açık temada açık gri/beyaz görseller arka planla eriyor, koyu temada (`2-masaustu-koyu/04-ana-akis.png`) keskin beyaz bir yama gibi parlıyor; `.link-attachment` hover'da geçişsiz.
    *   **Önerilen Düzeltme:** İçerik türü baş harfi büyük (`Makale`, `Repo`, `Video`…) tutarlı hale getirilir; `.card-thumbnail` üzerine `border: 1px solid var(--color-line)` ince iç çerçeve eklenir; `.link-attachment` için `background-color` + `border-color` mikro geçişi uygulanır.
4.  **`src/lib/components/feed/FeedView.svelte:423-434,479-487,511-553` — Yalın boş durum ve yükleme sinyali eksikliği**
    *   **Sorun:** `.empty-feed` yalnızca yalın bir `<p>` ve düz metin bağlantı gösteriyor; "Daha fazla yükle" düğmesi yüklenirken `aria-busy` taşımıyor; `.last-seen-label` ince üst kenar hizalaması daha keskin bir etiket çerçevesiyle güçlendirilebilir.
    *   **Önerilen Düzeltme:** Boş akışta yapılandırılmış boş durum bloğu (`.btn btn-outline` sıfırlama eylemiyle), "Daha fazla yükle" üzerinde `aria-busy={loadingMore}` ve `.last-seen-label` için net `tabular-nums` + kenar boşluğu cilası eklenir.
5.  **`src/lib/components/feed/PostActions.svelte:129-163` ve `NewPostsPill.svelte:121-145` — Eylem çubuğu geçişleri ve balon hover'ı**
    *   **Sorun:** `.action` düğmelerinde `transition` yok; `NewPostsPill:hover` yalnızca `text-decoration: underline` veriyor ve sayı için `tabular-nums` açıkça belirtilmemiş.
    *   **Önerilen Düzeltme:** `.action` için `background-color` + `color` geçişi, `NewPostsPill` için `font-variant-numeric: tabular-nums` ve alt çizgisiz temiz hover/active geri bildirimi (`opacity: 0.92`) eklenir.

### 4. Bölümler Dizini (`/sections`)

1.  **`src/routes/(app)/sections/+page.svelte:57-80` — Satır tıklama/hover yüzeyi dar**
    *   **Sorun:** `07-bolumler.png` ekranında her satırda yalnızca `# Frontend` başlığı etkileşimli görünüyor; satırların hover zemin vurgusu ve kapanış alt çizgisi yok.
    *   **Önerilen Düzeltme:** Her bölüm satırı (`.section-list li`) genişletilmiş bağlantı/hover yüzeyi (`background: var(--color-surface)` + `var(--dur-1)` geçiş), kapanış `border-block-end: 1px solid var(--color-line)` ve tutarlı yatay iç boşlukla (`--space-3`) cilalanır.
2.  **`src/routes/(app)/sections/+page.svelte:15-17` — "Bölümleri yönet" eylemi başlıkta zayıf kalıyor**
    *   **Sorun:** `.btn-quiet` çerçevesiz düz metin gibi sağ üstte asılı duruyor (`07-bolumler.png`).
    *   **Önerilen Düzeltme:** `.btn-outline` kullanılarak etkileşimli yönetim bağlantısı netleştirilir.
3.  **`src/routes/(app)/sections/+page.svelte:20-21,82-84` — Boş durum yetersiz**
    *   **Sorun:** Bölüm yoksa yalnızca tek satır `<p class="empty">Henüz bölüm yok.</p>` çıkıyor.
    *   **Önerilen Düzeltme:** Saç çizgisiyle çerçevelenmiş, rehberleyici metin ve admin için `"Bölümleri yönet"` eylemli boş durum bloğu eklenir.

### 5. Kaynak Detayı (`/resources/[id]`, `ResourceHero.svelte`)

1.  **`src/lib/components/resource/ResourceHero.svelte:142-168,225-234` — İki birincil limon düğme yan yana çatışıyor**
    *   **Sorun:** `09-kaynak-detay.png` (açık ve koyu) görüntüsünde hem `"Kaynağa git (developer.chrome.com) ↗"` hem de beğenilmiş durumdaki `"5 beğeni"` düğmesi tam limon dolgu alıyor; tek birincil CTA hiyerarşisi bozuluyor.
    *   **Önerilen Düzeltme:** `.hero-like-btn.is-liked` katı limon dolgu yerine `border-color: var(--color-text); background: var(--color-surface); color: var(--color-text); font-weight: 700` + dolu kalp ikonu ile (akıştaki `PostActions` diliyle uyumlu) stillenir; tek limon CTA `"Kaynağa git"` olur. Sayaçlar `tabular-nums` alır.
2.  **`src/routes/(app)/resources/[id]/+page.svelte:634-652,765-769` — Zaman çizelgesi omurgası kart negatif marjıyla çakışıyor**
    *   **Sorun:** Sağ sütundaki `Paylaşım Geçmişi` (`.timeline`) `border-inline-start` çizgisi taşırken içindeki kompakt `PostCard` `margin-inline: calc(-1 * var(--space-3))` uyguladığı için kart hover zemini ve kenarlığı omurga çizgisinin üstüne taşıyor (`09-kaynak-detay.png`).
    *   **Önerilen Düzeltme:** `.timeline :global(.share-card)` için `margin-inline: 0; padding-inline: var(--space-3);` uygulanır ve zaman çizelgesi öğeleri omurgayla temiz hizalanır.
3.  **`src/routes/(app)/resources/[id]/+page.svelte:453-462,807-862` — Yorum aksiyonları hizasız ve avatarsız**
    *   **Sorun:** `09-kaynak-detay.png` yorum listesinde `Düzenle` ve `Sil` düğmeleri `.comment-action-btn` iç boşluğu yüzünden yorum metninin 8px sağından başlıyor; yorum yazarlarında monogram avatar yok; `.comment-date` ve `.char-counter` `tabular-nums` eksik.
    *   **Önerilen Düzeltme:** Yorum başlığına 24px `Avatar` eklenir; `.comment-actions` üzerine `margin-inline-start: calc(-1 * var(--space-2))` ile sol hiza eşitlenir; `.comment-date` ve `.char-counter` `tabular-nums` alır.
4.  **`src/routes/(app)/resources/[id]/+page.svelte:926-970` — Yerel buton stilleri global `.btn` cilasından kopuk**
    *   **Sorun:** `.primary-btn`, `.secondary-btn`, `.danger-btn` sayfada yeniden tanımlanmış ve `text-decoration: underline` hover kullanıyor.
    *   **Önerilen Düzeltme:** Global `.btn` sınıfları ve mikro etkileşimlerle hizalanır.
5.  **`src/routes/(app)/resources/[id]/+page.svelte:441-442,785-787` — Boş yorum durumu düz paragraf**
    *   **Sorun:** Yorum olmadığında üst/alt ritmi olmayan tek bir `<p>` satırı görünüyor.
    *   **Önerilen Düzeltme:** `padding-block: var(--space-5); border-block-end: 1px solid var(--color-line);` ile nefes alan boş durum bloğu eklenir.

### 6. Arama (`/search`)

1.  **`src/routes/(app)/search/+page.svelte:372-406` — Kapsam segmentinde geçiş eksik ve hover seçici geniş**
    *   **Sorun:** `.segment` düğmeleri geçişsiz; seçili segmentin hover'ı seçili olmayanlarla ayrılmamış (`10-arama.png`).
    *   **Önerilen Düzeltme:** `.segment` için `background-color` geçişi ve `.segment:not(:has(input:checked)):hover` kısıtı eklenir.
2.  **`src/routes/(app)/search/+page.svelte:267-273,466-473` — Sonuç özeti ile liste arasında ayırıcı çizgi yok**
    *   **Sorun:** `3 sonuç bulundu · Tüm İzgah` satırı (`10-arama.png`) ilk sonuç kartıyla arada ince bir sınır olmadan birleşiyor ve sayı `tabular-nums` taşımıyor.
    *   **Önerilen Düzeltme:** `.search-summary` altına `border-block-end: 1px solid var(--color-line); padding-block-end: var(--space-3);` ve `font-variant-numeric: tabular-nums` eklenir.
3.  **`src/routes/(app)/search/+page.svelte:228-265,436-464` — Boş durum ve arama ipuçlarındaki kod örnekleri zemin ayrımından yoksun**
    *   **Sorun:** `senkronizasyon`, `sveltejs/kit` gibi arama örnekleri düz metin içinde yalnızca font farkıyla duruyor.
    *   **Önerilen Düzeltme:** `.tips code` öğelerine `padding: 1px var(--space-1); background: var(--color-surface); border: 1px solid var(--color-line); border-radius: var(--radius-1);` çip cilası verilir.
4.  **`src/routes/(app)/search/+page.svelte:295-305,475-486` — Sayfalama satırı `tabular-nums` ve hizalama**
    *   **Sorun:** `Sayfa X / Y` metninde `tabular-nums` yok; sayfalama çubuğunda üst ayırıcı eksik.
    *   **Önerilen Düzeltme:** `tabular-nums` ve `border-block-start: 1px solid var(--color-line)` eklenir.

### 7. Hesap Ayarları, Tema Vitrini ve API Anahtarları (`/settings`, `/settings/api-keys`, `ThemeForm`, `PaletteForm`)

1.  **`src/lib/components/shell/PaletteForm.svelte:185-234` — "Yüksek kontrast" etiketi iki satıra sarıp kart hizasını bozuyor**
    *   **Sorun:** `11-ayarlar.png` ve `4-tema-vitrini/gorunum-ayarlari-*` görüntülerinde `minmax(9.5rem, 1fr)` darlığı nedeniyle `"Yüksek kontrast"` iki satıra düşerken `"Varsayılan"` ve `"Loş"` tek satırda kalıyor; radyo ve onay ikonu dikey eksende kayıyor.
    *   **Önerilen Düzeltme:** Kart alt sınırı `minmax(10.75rem, 1fr)` (vurgu kartları `minmax(8.5rem, 1fr)`) yapılır, `.palette-option` için `grid-template-rows: auto 1fr; align-items: start;` ve `border-color`/`background-color` geçişi eklenir.
2.  **`src/lib/components/shell/PaletteForm.svelte:248-258` — Loş ve koyu palet önizleme çerçevesi silik**
    *   **Sorun:** `4-tema-vitrini/gorunum-ayarlari-koyu-los-pembe.png` görüntüsünde koyu palet önizleme kutularının `1px solid var(--color-line)` sınırı dış kart zeminiyle neredeyse birleşiyor.
    *   **Önerilen Düzeltme:** `.theme-preview:not(.accent-swatch)` kenarlığı `var(--color-line-strong)` ile netleştirilir.
3.  **`src/routes/(app)/settings/api-keys/+page.svelte:313,323,369` — Yasaklı `⚠` emoji ikonu**
    *   **Sorun:** `izgah-ui-v2.md` §4'te yasaklanan `⚠` emojisi 3 hata bloğunda yer alıyor.
    *   **Önerilen Düzeltme:** Mevcut Lucide `<Icon name="alert" size={16} />` bileşeniyle değiştirilir.
4.  **`src/routes/(app)/settings/api-keys/+page.svelte:490-512,625-788` — API Anahtarları sayfası v1 boyut/token kalıntıları**
    *   **Sorun:** `12-api-anahtarlari.png` sayfasında `.settings-subnav` aralığı (`0.5rem`) kardeş `/settings` sayfasından (`var(--space-1)`) farklı; girdiler `48px` ve `1.5px` kenarlıklı; `.danger-btn` `--color-on-danger` yerine `--color-bg` kullanıyor; `.key-dates` mono/`tabular-nums` değil; `...` yerine `…` kullanılmamış.
    *   **Önerilen Düzeltme:** Alt gezinme `/settings` ile birebir hizalanır; tüm butonlar `.btn`, girdiler `.field`, tarihler `--text-meta` (`tabular-nums`) ve tipografik `…` kullanılır.
5.  **`src/routes/(app)/settings/+page.svelte:363-385` (ve `api-keys:490-512`) — Pasif alt gezinme sekmesi hover'da aktif gibi limon doluyor**
    *   **Sorun:** `.settings-subnav a` için özel `:hover` tanımı olmadığından açık temada global `a:hover` pasif sekmeyi limon dolguya boyuyor.
    *   **Önerilen Düzeltme:** `.settings-subnav a:not([aria-current='page']):hover { background: var(--color-surface); color: var(--color-text); }` ve geçiş eklenir.

### 8. Yönetim Paneli (`/admin/+layout.svelte` ve `users`, `sections`, `unassigned`, `jobs`, `audit`, `metrics`)

1.  **`src/routes/(app)/admin/+layout.svelte:56-121` — KRİTİK: Koyu temada aktif sekme rozeti görünmez siyah kare + çift padding + mobil 4 satır taşma**
    *   **Sorun:** `2-masaustu-koyu/15-yonetim-atanmamis.png` ve `16-yonetim-onizleme-isleri.png` görüntülerinde aktif sekme içindeki `.subnav-badge`, `background: var(--color-bg)` (`#0A0A0A`) ve `color: inherit` (`--color-on-signal = #0A0A0A`) çakışması yüzünden **tamamen okunmaz siyah bir kareye** dönüşüyor (`1:1` kontrast). Ayrıca `.admin-container` (satır 59) `.app-main` üzerine ikinci bir iç boşluk ekliyor, `.admin-subnav-link:focus-visible` iki katmanlı Sinyal halkasını eziyor, `:hover` etkisiz (`--color-surface-muted === --color-surface`) ve mobilde sekmeler 4 satıra yayılıyor (`3-mobil-acik/13-yonetim-uyeler.png`).
    *   **Önerilen Düzeltme:** Aktif sekme içindeki `.subnav-badge` için `background: var(--color-on-signal); color: var(--color-signal); border-color: var(--color-on-signal);` (`9.5:1–15.6:1` AAA kontrast, tüm 4 vurgu ve 5 palette!); `.admin-container` çift padding kaldırılır; yerel `focus-visible` silinerek global halka korunur; `.subnav-badge` `font: var(--text-micro); font-variant-numeric: tabular-nums;` alır; mobilde `.admin-subnav-list` yatay kaydırmalı tek satır şeride (`overflow-x: auto; flex-wrap: nowrap;`) alınır.
2.  **`src/routes/(app)/admin/{users,sections,unassigned,jobs,audit,metrics}/+page.svelte` — `h1` ölçeği, sabit `ui-monospace`, yasaklı `⚠` emojisi ve sönük panel girdileri**
    *   **Sorun:** 6 sayfanın tamamında `h1` `font-size: 1.5rem` (`--text-display` değil); 5 sayfada `code` için `var(--font-mono)` yerine sistem `ui-monospace` sabit yazılmış; 4 sayfada (`users:213`, `sections:286`, `unassigned:65`, `jobs:34`) yasaklı `⚠` emojisi var; `.panel` (`surface`) içindeki form girdileri de `background: var(--color-surface)` olduğu için devre dışı gibi görünüyor (`13`–`17`).
    *   **Önerilen Düzeltme:** Tüm `h1`'ler `var(--text-display)` (`letter-spacing: -0.03em`), tüm mono alanlar `var(--font-mono)` + `tabular-nums`, tüm `⚠` emojileri `<Icon name="alert" size={16} />` ve `.panel` içi girdiler `background: var(--color-bg)` yapılır.
3.  **`src/routes/(app)/admin/users/+page.svelte:795-895` ve `admin/sections/+page.svelte:977-1077` — Şişkin tablo satırları ve kırmızı düğme duvarı**
    *   **Sorun:** `13-yonetim-uyeler.png` ekranında her üye satırında `Rol` (`select` + `Rolü Kaydet`) ve `İşlemler` (`Parola Sıfırla` + katı kırmızı `Pasifleştir`) dikey yığılıp satır yüksekliğini ~120px'e çıkarıyor, `Kayıt` tarihi iki satıra bölünüyor; hem Üyeler hem Bölümler tablolarında her satırdaki katı kırmızı `Pasifleştir`/`Sil` düğmeleri agresif bir kırmızı sütun oluşturuyor.
    *   **Önerilen Düzeltme:** Tablo satırları kompaktlaştırılır (`padding: var(--space-2) var(--space-3)`, `min-block-size: 36px` masaüstü, `44px` coarse pointer), tarihler `white-space: nowrap` + `--text-meta` + `tabular-nums` olur; `inline-role-form` ve `row-actions` yatay hizalanır; satır içi `Pasifleştir`/`Sil` düğmeleri `.btn-danger-outline` (yalnız onay dialogunda dolu `.btn-danger`) yapılır; durum çipleri (`Aktif`, `Davet bekliyor`, `Pasif`) `--text-micro` mono + net görsel ayrım kazanır; satırlara `tbody tr:hover` vurgusu eklenir.
4.  **`src/routes/(app)/admin/audit/+page.svelte:84-112,268-302` — Kelime ortasından kırılan e-postalar ve dağınık UUID/JSON sütunları**
    *   **Sorun:** `17-yonetim-denetim-kaydi.png` görüntüsünde `.sub-meta { word-break: break-all }` kuralı `elif@izgah.te / st` ve `mert@izgah.t / est` şeklinde e-postaları bölüyor; `Tarih` sans fontta (`tabular-nums` yok); UUID ve JSON sütunları sıkışık.
    *   **Önerilen Düzeltme:** `Tarih` sütunu `var(--text-meta)` + `tabular-nums`; e-postalar `word-break: normal; overflow-wrap: anywhere` + `min-inline-size` ile tek satır okunaklılık; UUID ve JSON değerleri `var(--font-mono)` + `font-size: 0.78rem` + düzenli `max-inline-size` sarma ile hizalanır.
5.  **`src/routes/(app)/admin/metrics/+page.svelte:203-306` ve `admin/jobs/+page.svelte:179-332` — Metriklerde `tabular-nums` ve sayısal hizalama eksik**
    *   **Sorun:** `18-yonetim-metrikler.png` ve `16-yonetim-onizleme-isleri.png` ekranlarında metrik değerleri ve sayısal tablo sütunları (`Son 7 Gün`, `Son 30 Gün`, `Deneme`, `Paylaşımlar`) `tabular-nums` ve masaüstünde sağa hizalama (`text-align: end`) taşımıyor; özet kart başlıkları hiyerarşik olarak sönük; boş durumlar yalın paragraf.
    *   **Önerilen Düzeltme:** Sayısal hücreler `font: var(--text-meta); font-variant-numeric: tabular-nums; text-align: end;` (dar `@container` altında `start`); özet kart etiketleri `--text-micro` uppercase + büyük `tabular-nums` değer; boş durumlar çerçeveli/nefes alan bloklara taşınır.

### 9. Giriş, Davet Kabulü, Parola Sıfırlama ve Hata Sayfası (`AuthLayout`, `login`, `auth/*`, `ErrorContent`, `+error`)

1.  **`src/lib/components/auth/AuthLayout.svelte:28-36,52-57` — Koyu temada marka paneli sayfa zeminiyle birleşiyor**
    *   **Sorun:** `2-masaustu-koyu/01-giris.png` görüntüsünde `.auth-brand` ham `#0a0a0a` kullandığı için koyu temanın `#0a0a0a` sayfa zeminiyle tamamen birleşip bölünmüş düzen kontrastını kaybediyor (üstelik token dışı sabit hex içeriyor).
    *   **Önerilen Düzeltme:** Yalnız mevcut token'larla `background: light-dark(var(--color-text), var(--color-surface)); color: light-dark(var(--color-bg), var(--color-text));` uygulanır; açık temada koyu mürekkep paneli, tüm koyu paletlerde (Varsayılan `#141414`, Loş `#262626`, YK `#121212`) net yüzey ayrımı ve AAA kontrast korunur.
2.  **`src/routes/login/+page.svelte:170,205,236`, `src/routes/auth/accept-invite/+page.svelte:168,182,231,270`, `src/routes/auth/reset-password/+page.svelte:162,178,240` — 10 yerde yasaklı `⚠` emoji ve `...` tutarsızlığı**
    *   **Sorun:** Üç kimlik doğrulama sayfasında toplam 10 `⚠` emoji ikonu (`izgah-ui-v2.md` §4 ihlali) ve gönderiliyor metinlerinde üç nokta `...` (`login:242`, `accept-invite:276`, `reset-password:246`) bulunuyor.
    *   **Önerilen Düzeltme:** `<Icon name="alert" size={16} />` ve tipografik `…` kullanılır.
3.  **`src/lib/components/auth/AuthLayout.svelte:123-214` — Alt çizgili birincil düğme hover'ı ve geçişsiz kontroller**
    *   **Sorun:** `.primary-btn:hover` yalnızca `text-decoration: underline` veriyor; `.toggle-btn` ve `input` geçişsiz; form alanlarında `.hint` ile `input` aralığı dar.
    *   **Önerilen Düzeltme:** Sinyal iç çerçeve hover (`inset 0 0 0 1px var(--color-on-signal)`), `:active` geri bildirimi, `transition` ve dengeli alan içi boşluk (`--space-2`) eklenir.
4.  **`src/lib/components/ErrorContent.svelte:57` — 404 sayfasında İngilizce `"Not Found"` sızıntısı**
    *   **Sorun:** `19-hata-404.png` (açık, koyu ve mobil) görüntülerinde Türkçe `Sayfa bulunamadı` başlığının hemen altında SvelteKit'in ham İngilizce `"Not Found"` mesajı görünüyor.
    *   **Önerilen Düzeltme:** `page.status === 404` iken mesaj `'Not Found'` ise `"Aradığınız sayfa taşınmış ya da silinmiş olabilir."` (ve `500` `'Internal Error'` için Türkçe karşılık) gösterilir.
5.  **`src/routes/+error.svelte:18-31` ve `ErrorContent.svelte:78-85` — Hata sayfasında Sinyal marka karesi ve köşe detayı eksik**
    *   **Sorun:** `19-hata-404.png` üstündeki `İzgah` yazısı `SiteHeader`'daki limon Sinyal karesinden (`::after`) yoksun; `.error-code` köşe yarıçapı eksik ve `tabular-nums` garantilenmemiş.
    *   **Önerilen Düzeltme:** `.brand::after` Sinyal karesi, `.brand:hover` koruma kuralı ve `.error-code` üzerine `border-radius: var(--radius-1); font-variant-numeric: tabular-nums;` eklenir.

### 10. Tarayıcı Eklentisi (`extensions/src/styles/tokens.css`, `popup/*`, `options/*`)

1.  **`extensions/src/styles/tokens.css:31-92,166-180,209-256` — Zeminle birleşen girdiler, alt çizgili `Kaydet` hover'ı ve eksik web token hizalaması**
    *   **Sorun:** `5-tarayici-eklentisi/02-ayarlar-baglanti-dogrulandi.png` görüntüsünde `Kaydet` düğmesi altı çizili görünüyor (`.btn-primary:hover` `text-decoration: underline`); tüm girdiler `background: var(--color-surface)` olduğu için Ayarlar kartı (`surface`) içinde düz/sönük kalıyor; web `tokens.css` ile ortak `--space-*`, `--dur-*`, `font-synthesis: none`, `-webkit-font-smoothing` ve `@media (forced-colors: active)` kuralları eksik.
    *   **Önerilen Düzeltme:** Web `tokens.css` ile boşluk, süre ve `forced-colors` token'ları hizalanır; girdiler `background: var(--color-bg)` yapılır; `.btn-primary:hover` alt çizgi yerine `inset` mürekkep çerçeve + `:active` geri bildirimine geçer; `.btn-danger-outline` eklenir.
2.  **`extensions/src/entrypoints/popup/popup.css:16-36` — Sinyal marka karesi eksikliği ve yalın kurulum ekranı**
    *   **Sorun:** `01-popup-kurulum-gerekli.png` üst-sol köşeye yığılmış yalın bir metin bloğu; ne kurulum ekranında ne paylaşım başlığında İzgah'ın Sinyal marka karesi (`::after`) bulunuyor (`03-popup-paylasim-formu.png`).
    *   **Önerilen Düzeltme:** `h1` başlıklarına web kabuğuyla uyumlu Sinyal marka karesi (`.brand-mark` / `::after`), kurulum ekranına saç çizgili temiz yüzey çerçevesi ve dengeli dikey ritim eklenir (erişilebilir metin `"İzgah'a paylaş"` test uyumluluğu için korunur).
3.  **`extensions/src/entrypoints/popup/popup.css:70-126` ve `tokens.css:169-180` — Eski `<fieldset>` çizgisi, sıkışık `<select>` oku ve sans karakter sayacı**
    *   **Sorun:** `03-popup-paylasim-formu.png` ve `04-popup-paylasim-formu-koyu.png` görüntülerinde `Konu Bölümleri (isteğe bağlı)` efsanesi kenarlık çizgisini ortadan kesiyor; `İçerik türü` `<select>` oku sağ kenara yapışmış; `0 / 1000` karakter sayacı mono yazı tipinde değil.
    *   **Önerilen Düzeltme:** `.sections-fieldset` kenarlığı ince `--color-line` ve temiz başlık ritmine alınır; `<select>` sağ iç boşluğu açılır; `.char-counter` ve `.source-badge` `var(--font-mono)` + `tabular-nums` yapılır.
4.  **`extensions/src/entrypoints/options/options.css:1-90` ve `options/index.html:129-137` — Ağırlığı dengesiz durum kutusu ve aşırı baskın silme düğmesi**
    *   **Sorun:** `02-ayarlar-baglanti-dogrulandi.png` ekranında `Bağlantı durumu` kutusu kalın/koyu `--color-line-strong` kenarlıkla form alanlarıyla yarışıyor; `Kayıtlı anahtarı sil` düğmesi tam dolu kırmızı (`.btn-danger`) olarak birincil `Kaydet` düğmesinden daha çok dikkat çekiyor.
    *   **Önerilen Düzeltme:** Durum kartı `border-color: var(--color-line); background: var(--color-bg);` + sol üst durum göstergesiyle sakinleştirilir; `Kayıtlı anahtarı sil` düğmesi `.btn-danger-outline` ile ikincil yıkıcı düzeye çekilir.
5.  **`extensions/src/entrypoints/popup/popup.css:42-95` — Meta ve rozet hiyerarşisi web Sinyal'le hizalı değil**
    *   **Sorun:** `.user-badge`, `.source-badge` ve `#link-check-loading` tipografi ağırlıkları (`font-weight: 600`) ve aralıkları web `.badge` / `--text-meta` standartlarından sapıyor.
    *   **Önerilen Düzeltme:** `font-weight: 500/700`, `--space-*` ve web `.badge` / `--text-meta` ritmine hizalanır.

## Goals

*   **Sinyal Kimliğini Güçlendirme:** Hiçbir yasaklı klişe (gradyan, blur, `> 4px` yarıçap, gölge yığını, yeni renk, emoji) eklemeden, yalnızca tipografi ritmi, boşluk tutarlılığı, hiyerarşi ve mikro etkileşimlerle tüm ekranları rafine etmek.
*   **Kritik Görsel Hataları Sıfırlama:** Koyu temada görünmez yönetim sekmesi rozeti, mobilde kısa sayfa tepe boşluğu, koyu temada birleşen giriş paneli, 404 İngilizce `"Not Found"` sızıntısı ve 17 yasaklı `⚠` emojisini tamamen temizlemek.
*   **Web ve Eklenti Bütünlüğü:** Web uygulaması ile tarayıcı eklentisi arasında girdi zemini, düğme hover/active davranışı, marka imi, `tabular-nums` ve `forced-colors` tutarlılığı sağlamak.
*   **Sıfır Regresyon:** Tüm 2 açık × 3 koyu palet × 4 vurgu kombinasyonunda WCAG 2.2 AA (YK paletlerde AAA), sıfır CSP ihlali, JS'siz akışların tam çalışması ve [izgah-ui-v2.md](./izgah-ui-v2.md) §12 sabit E2E kancalarının birebir korunması.

## Non-Goals

*   Yeni sayfa, rota, API ucu, veritabanı sütunu veya yeni etkileşim özelliği eklemek.
*   Mevcut Sinyal palet değerlerini değiştirmek veya yeni renk token'ı üretmek (yalnız mevcut `--color-*` token'ları kullanılır).
*   Eklenti davranışını, manifest izinlerini veya çerez/depolama sözleşmelerini değiştirmek.
*   Yeni npm bağımlılığı, CSS çerçevesi, ikon paketi veya polyfill eklemek.
*   `tests/e2e` içindeki sabit DOM kancalarını veya erişilebilir adları değiştirmek.

## Technical Plan (Architecture)

### 1. Renk ve Kontrast Garantisi (Yeni Token Yok)

Yeni renk token'ı eklenmez; tüm düzeltmeler mevcut `--color-*` semantik token'larını kullanır:

*   **Aktif yönetim sekmesi rozeti (koyu tema hatası çözümü):** `background: var(--color-on-signal); color: var(--color-signal); border-color: var(--color-on-signal);` — tüm 4 vurgu renginde `#0A0A0A` üzerinde `9.51:1` (Pembe) ile `15.65:1` (Kireç) arası AAA kontrast sağlar.
*   **Giriş bölünmüş marka paneli:** `background: light-dark(var(--color-text), var(--color-surface)); color: light-dark(var(--color-bg), var(--color-text));` — açık paletlerde `#0A0A0A`/`#000000` zemin üstü beyaz metin (`≥ 19.8:1`), koyu paletlerde `#141414`/`#262626`/`#121212` yüzey üstü açık metin (`≥ 12.9:1`) ve vurgu kelime işareti (`≥ 7.2:1`) sağlar.
*   **Tablo/ayar yıkıcı tetikleyicileri (`.btn-danger-outline`):** Dinlenme durumunda `--color-danger` metin + çerçeve üzerinde `--color-bg` (`≥ 6.57:1` açık, `≥ 7.47:1` koyu); hover'da `--color-danger` dolgu + `--color-on-danger` metin (`≥ 6.57:1`).

### 2. Aşamalı Geliştirme ve Modern Web Rehberleri

Aşama 2'deki her ajan, dokunduğu alanla ilgili modern platform kalıplarını uygulamadan önce `npx modern-web-guidance@latest search "<ihtiyaç>"` + `retrieve` çalıştırır:

*   **A1:** `<dialog>` / `[popover]` giriş geçişi (`@starting-style` + `transition-behavior: allow-discrete`), `forced-colors`, `<select>` stilleme, `prefers-reduced-motion`.
*   **A2:** `field-sizing: content` (satır içi/dialog not alanı), container queries (`@container`), `content-visibility`.
*   **A3:** CSS Anchor Positioning + `popover` hizalaması, mobil alt gezinme + `safe-area-inset`, görünüm erişilebilirliği.
*   **A4:** Erişilebilir boş durumlar, form doğrulama (`:user-invalid`), Invoker Commands (`command="--copy"`).
*   **A5:** Duyarlı veri tabloları (`@container` + `tabular-nums` + erişilebilir kaydırma bölgesi).
*   **A6:** Erişilebilir kimlik doğrulama formları (`autocomplete`, `:user-invalid`), eklenti popup/options `color-scheme` ve `forced-colors`.

Baseline "widely available" olmayan tüm özellikler (`@starting-style`, `field-sizing`, anchor positioning, `text-wrap`, View Transitions) yalnızca aşamalı geliştirme olarak kalır.

### 3. Sürü Dosya Sahipliği Matrisi (Aşama 2 — Çakışmasız)

Paylaşılan CSS token ve temel bileşen sınıflarını **yalnız A1** değiştirir; diğer ajanların ortak sınıf ihtiyacı (ör. `.btn-danger-outline`, `.empty-state-box`, `select` padding) A1 üzerinden tanımlanır ve board üzerinden duyurulur.

| Ajan | Sahip Olduğu Dosyalar | Temel Teslimatlar |
| :--- | :--- | :--- |
| **A1** (Token & Temel) | `src/lib/styles/{tokens,base,components}.css` | `.btn` hover/active cilası (alt çizgi kalkar, `inset` çerçeve), `.btn-danger-outline`, `<select>` sağ boşluk, `.day-heading` alt ayırıcı, `@starting-style` dialog/popover opaklık geçişi, `forced-colors` kuralları |
| **A2** (Akış) | `src/lib/components/feed/**` | `ShareComposerDialog` (`--color-bg` girdi, odak halkası aralığı, Sinyal token'ları, `field-sizing`), `PostCard` (geçiş, atıf cilası, dialog buton hizalaması), `LinkAttachment` (büyük baş harf tür, thumbnail `1px` çerçeve), `FeedView` (boş durum, `aria-busy`, son ziyaret cilası), `PostActions` & `NewPostsPill` |
| **A3** (Kabuk & Tema) | `src/lib/components/shell/**`, `src/lib/components/notifications/NotificationBell.svelte`, `src/routes/(app)/+layout.svelte` | Mobil `.app-shell` `grid-template-rows: auto minmax(0, 1fr)` düzeltmesi, tek satır ray arama + `.brand:hover`, `+ Paylaş`/`Yönetim` ayrımı, `NotificationBell` Sinyal yenilemesi + iskelet, `BottomTabBar` geçiş/forced-colors, `PaletteForm` kart hizası + önizleme çerçevesi |
| **A4** (İçerik Ekranları) | `src/routes/(app)/{resources,search,sections,settings}/**`, `src/lib/components/resource/ResourceHero.svelte` | `ResourceHero` tek limon CTA (beğeni ink-framed), zaman çizelgesi omurga hizası, yorum avatar + hizalı aksiyon + `tabular-nums`, `/search` ayırıcı + kod çipleri, `/sections` tam satır hover + boş durum, `/settings` & `/settings/api-keys` (3 `⚠` → `Icon`, v1 temizliği, alt gezinme hover) |
| **A5** (Yönetim) | `src/routes/(app)/admin/**` | Aktif sekme rozeti koyu tema kontrast düzeltmesi, çift padding temizliği, mobil yatay sekme şeridi, 6 sayfada `h1` → `--text-display`, `var(--font-mono)` + `tabular-nums`, 4 `⚠` → `Icon`, panel girdileri `--color-bg`, kompakt tablo yoğunluğu + `.btn-danger-outline`, `audit` e-posta sarma düzeltmesi, `metrics`/`jobs` sağ hizalı sayılar |
| **A6** (Giriş, Hata & Eklenti) | `src/routes/{login,auth}/**`, `src/lib/components/auth/**`, `src/routes/+error.svelte`, `src/lib/components/ErrorContent.svelte`, `extensions/src/**` | `AuthLayout` koyu tema `light-dark()` panel ayrımı, 10 `⚠` → `Icon` + `…`, `ErrorContent` Türkçe 404 mesajı + marka karesi, eklenti `tokens.css` web hizalaması (`--color-bg` girdiler, alt çizgisiz hover, `forced-colors`), `popup` marka karesi + kurulum kartı + modern fieldset/select/mono sayaç, `options` sakin durum kartı + outline silme düğmesi |

## Alternatives Considered

### Alternative A: Hover Geri Bildirimi İçin Yeni Renk Token'ları Eklemek (`--color-signal-hover`, `--color-surface-hover`)

Her palet için ayrı hover renk yuvaları tanımlanabilirdi; ancak 2 açık × 3 koyu palet × 4 vurgu matrisinde ek kontrast çiftleri ve yeni renkler gerektirirdi. Sinyal'in "yeni renk yok" kısıtı ve mevcut token'larla çözülebilen `inset` çerçeve / `border-color: var(--color-text)` / `opacity` geri bildirimleri nedeniyle reddedildi.

### Alternative B: `AuthLayout` Marka Panelini Koyu Temada Tamamen Kaldırmak

Koyu temada sol marka panelini gizlemek veya tek sütuna düşürmek kolaydı; ancak açık/koyu tema arasında düzen sıçramasına yol açar ve Sinyal'in bölünmüş giriş kimliğini bozardı. Mevcut `--color-surface` token'ı ile `light-dark(var(--color-text), var(--color-surface))` kullanmak hem kimliği hem kontrastı korur.

### Alternative C: Yönetim Tablolarında Yıkıcı İşlemleri Taşma Menüsüne (`PopoverPanel`) Taşımak

Her satırdaki `Parola Sıfırla` / `Pasifleştir` / `Sil` düğmelerini bir `⋯` menüsüne gizlemek satırı daha da daraltırdı; ancak `tests/e2e/m7-admin-panel.spec.ts` doğrudan görünür satır düğmelerini hedefliyor ve 10–15 kişilik ekipte tek tık erişim daha pratik. Yatay kompakt hizalama + `.btn-danger-outline` hem E2E sözleşmesini korur hem kırmızı görsel gürültüyü giderir.

## Verification Plan

Onay sonrası Aşama 2 (her ajan kendi alanı için `lint`, `check`, `test`) ve Aşama 3 (tek ajan birleştirme ve doğrulama, `feat/ui-polish` dalı) aşağıdaki kapılardan geçer:

1.  **Veritabanı Ön Koşulu:** `docker compose up -d` ile PostgreSQL ayakta.
2.  **Kök Proje Kontrolleri:**
    *   `pnpm lint` (ESLint + Prettier)
    *   `pnpm check` (`svelte-check --fail-on-warnings`)
    *   `pnpm test` (`tests/unit/tokens-contrast.test.ts` dahil tüm birim ve entegrasyon testleri)
    *   `pnpm test:e2e` (Chromium, Firefox, WebKit + mobil projeler; sabit §12 kancaları)
    *   `pnpm test:docker` (üretim imajında sıfır CSP `securitypolicyviolation`)
3.  **Tarayıcı Eklentisi Kontrolleri (`cd extensions`):**
    *   `pnpm lint && pnpm check && pnpm test` (ve manifest doğrulaması)
4.  **Önce / Sonra Görsel Karşılaştırma:**
    *   `SHOTS_DIR=./.local-data/shots-after pnpm exec playwright test -c .local-data/report-kit/playwright.config.ts`
    *   `.local-data/shots-after/` görüntüleri `.local-data/rapor/izgah-proje-raporu/ekran-goruntuleri/` ile aynı klasör ve dosya adları üzerinden ekran başına karşılaştırılır; önce/sonra özeti raporlanır.
    *   `.local-data/` ve rapor dosyaları asla commit'lenmez; `feat/ui-polish` dalı `main`'e birleştirilmez (PR kullanıcı tarafından açılır).

--------------------------------------------------------------------------------

## Faz 2 — Modern Derinlik ve Mikro Etkileşimler ("Sinyal — Linear / Raycast Çizgisi")

*   **Status:** Approved (2026-11-24)
*   **Scope:** `feat/ui-polish` dalı üzerine ikinci cilalama katmanı. [izgah-ui-v2.md](./izgah-ui-v2.md) §3–§4'teki ilgili kısıtlar bu bölümdeki kesin sınırlarla güncellenmiştir.

### Overview

Faz 1, Sinyal'in sert 2–4px editöryel düzlemi içinde tüm tipografi, hizalama, kontrast ve bileşen pürüzlerini temizledi. Kullanıcı geri bildirimi doğrultusunda Faz 2, İzgah'ın mevcut Sinyal kimliğini ve tüm 2 açık × 3 koyu palet × 4 vurgu renk sistemini **hiçbir yeni renk eklemeden** koruyarak arayüzü **Linear / Raycast çizgisinde** çağdaş, dokunsal ve derinlikli bir düzeye taşır.

### Goals

*   **Yumuşak Modern Geometri:** 4px köşe sınırını kaldırarak hiyerarşik yarıçap ölçeğine (`4 / 8 / 12px` + etiket/çip/balon için `9999px` hap) geçmek.
*   **Tema-Duyarlı Derinlik:** Açık temalarda katmanlı ve yumuşak gölgelerle havada duran kart/katman hissi; koyu temalarda ağır gölge yerine **yüzey açıklığı ayrımı + `1px` üst ışık kenarlığı** (`specular top-edge highlight`) ile cam kullanmadan modern derinlik sağlamak.
*   **Kontrollü Yüzey Işığı ve Vurgu Parıltısı:** Çok düşük opaklıklı yüzey ışığı (`in oklab`) ve yalnızca **birincil buton, aktif gezinme ve odak halkasında** tutarlı vurgu parıltısı (accent glow) sunmak.
*   **Dokunsal Mikro Etkileşimler:** Compositor-only (`transform`, `scale`, `translate`, `opacity`) ve Baseline Widely Available `linear()` yay eğrisiyle beğeni tepkisi, buton basışı, kart yükselmesi, tetikleyiciden açılan katmanlar ve akıcı View Transitions kazandırmak.
*   **Katı Erişilebilirlik Koruması:** Yüksek kontrast paletlerinde (`data-light-theme='contrast'`, `data-dark-theme='contrast'`) ve `@media (prefers-contrast: more)` / `@media (forced-colors: active)` altında **tüm gölge, gradyan ve parıltıları tamamen kapatıp** düz ve keskin görünümü korumak; `prefers-reduced-motion: reduce` altında tüm hareketleri sıfırlamak.

### Non-Goals & Korunan Yasaklar

*   **Glassmorphism / `backdrop-filter: blur`:** Yasak kalır (eklenmez).
*   **Yeni Renk ve Yasaklı Tonlar:** Mor/indigo, turuncu/amber ve krem/kirli beyaz zemin yasağı sürer; yeni `--color-*` hex renk token'ı eklenmez. Tüm efektler mevcut token'lardan nötr siyah/beyaz alfa veya `color-mix(in oklab, ...)` ile türetilir.
*   **Metin, Buton ve Arka Plan Dolgusunda Gradyan:** Kesinlikle yasaktır; gradyan yalnız yüzey/kenar ışığında ve çok düşük opaklıkta kullanılır.
*   **Yeni Bağımlılık / CSP / DOM Kancaları:** Yeni npm paketi, CSS çerçevesi, ikon paketi, polyfill veya satır içi betik yoktur; JS'siz akışlar ve [izgah-ui-v2.md](./izgah-ui-v2.md) §12 sabit E2E kancaları değişmez.

### Technical Plan (Faz 2 Architecture)

#### 1. `izgah-ui-v2.md` §3–§4 Kural Güncelleme Matrisi

| Konu | Mevcut (`izgah-ui-v2.md`) | Faz 2 Kuralı | Kesin Sınır |
| :--- | :--- | :--- | :--- |
| Köşe yarıçapı | `2px` / `4px`; hap yok | `--radius-1: 4px`, `--radius-2: 8px`, `--radius-3: 12px`, `--radius-pill: 9999px` | Kart/panel en fazla `12px`; hap yalnız etiket, durum çipi, sayaç rozeti ve yeni paylaşım balonunda |
| Gölge / derinlik | Yalnız dialog/popover | Açıkta katmanlı yumuşak gölge (`--shadow-card`, `--shadow-card-hover`, `--shadow-overlay`); koyuda gölge yerine yüzey açıklığı + `1px` üst ışık kenarlığı | `contrast` paletlerinde, `prefers-contrast: more` ve `forced-colors: active` altında tümü `none` |
| Gradyan | Tamamen yasak | Yalnız yüzey/kenar ışığında ve çok düşük opaklıkta (`2%–4%`, `in oklab`) | Metinde, butonda ve arka plan dolgusunda yok; `contrast` paletlerde ve yüksek kontrast modunda kapalı |
| Vurgu parıltısı | Yok | Yalnız birincil buton, aktif gezinme ve `:focus-visible` dış halesinde (`color-mix(in oklab, var(--color-signal) ...)`) | Başka öğelerde yok; `contrast` paletlerde, `prefers-contrast: more` ve `forced-colors` altında kapalı |
| Hareket & mikro etkileşim | Yalnız renk/opaklık | `prefers-reduced-motion: no-preference` opt-in ile `linear()` yaylı beğeni, buton `:active` `scale: 0.98`, kart hover `-1px`, dialog/popover `scale+translate`, rafine `::view-transition-*` | Yalnız compositor özellikleri (`transform`/`scale`/`translate`/`opacity`); `reduce` altında `0ms`/`none` |
| Blur / yeni renk | Yasak | **Değişmez (yasak sürer)** | `backdrop-filter` yok; `tokens-contrast.test.ts` (213/213) aynen geçer |

#### 2. Token Mimarisi (`src/lib/styles/tokens.css` & `extensions/src/styles/tokens.css`)

Mevcut `--light-*`, `--dark-*` ve `--accent` hex değerleri **değişmez**. Renk uzayı güvenliği için (`modern-web-guidance` `visual-effects` + `color` rehberleri, Chromium `oklch` nötr renk kayması hatasından kaçınmak için) tüm `color-mix()` ve yüzey ışığı gradyanları **`in oklab`** uzayında hesaplanır (gradyanlar için `@supports (background: linear-gradient(in oklab, white, black))` ile `--in-oklab` koruyucusu kullanılır):

*   **Köşe Ölçeği:**
    *   `--radius-1: 4px` (`kbd`, monogram avatar, kod parçacığı, kompakt kare rozet)
    *   `--radius-2: 8px` (`.btn`, form girdisi, `<select>`, gezinme öğesi, tablo içi aksiyon)
    *   `--radius-3: 12px` (`.panel`, `.link-attachment`, satır içi paylaşım kutusu, `<dialog>`, `[popover]`, `.table-wrapper`, palet önizleme kartı, eklenti kartları)
    *   `--radius-pill: 9999px` (`.tag`, `.status-pill`, filtre/tür çipleri, `.badge-count` / `.subnav-badge`, `NewPostsPill`)
*   **Palet Yuvaları (Açık Varsayılan vs Koyu Varsayılan/Loş vs Yüksek Kontrast):**
    *   **Açık Varsayılan (`[data-light-theme='default']`):**
        *   `--light-shadow-card: 0 1px 2px rgb(10 10 10 / 0.04), 0 4px 12px rgb(10 10 10 / 0.03);`
        *   `--light-shadow-card-hover: 0 2px 4px rgb(10 10 10 / 0.06), 0 8px 20px rgb(10 10 10 / 0.06);`
        *   `--light-shadow-overlay: 0 4px 12px rgb(10 10 10 / 0.08), 0 16px 36px rgb(10 10 10 / 0.12);`
        *   `--light-edge-highlight: inset 0 1px 0 rgb(255 255 255 / 0.85);`
        *   `--light-surface-sheen: linear-gradient(to bottom var(--in-oklab), rgb(255 255 255 / 0.72), rgb(10 10 10 / 0.015));`
        *   `--light-glow-primary: 0 2px 10px color-mix(in oklab, var(--accent) 42%, transparent);`
        *   `--light-glow-primary-hover: 0 4px 16px color-mix(in oklab, var(--accent) 56%, transparent);`
        *   `--light-glow-nav: 0 2px 10px color-mix(in oklab, var(--accent) 34%, transparent);`
        *   `--light-glow-focus: 0 0 14px color-mix(in oklab, var(--accent) 42%, transparent);`
    *   **Koyu Varsayılan & Loş (`[data-dark-theme='default']`, `[data-dark-theme='dim']`):**
        *   Gölge yerine yüzey açıklığı + `1px` üst ışık kenarlığı (`specular highlight`):
        *   `--dark-shadow-card: inset 0 1px 0 rgb(255 255 255 / 0.07);`
        *   `--dark-shadow-card-hover: inset 0 1px 0 rgb(255 255 255 / 0.13);`
        *   `--dark-shadow-overlay: inset 0 1px 0 rgb(255 255 255 / 0.11);`
        *   `--dark-edge-highlight: inset 0 1px 0 rgb(255 255 255 / 0.09);`
        *   `--dark-surface-sheen: linear-gradient(to bottom var(--in-oklab), rgb(255 255 255 / 0.035), transparent 55%);`
        *   `--dark-glow-primary: inset 0 1px 0 rgb(255 255 255 / 0.25), 0 0 16px color-mix(in oklab, var(--accent) 26%, transparent);`
        *   `--dark-glow-primary-hover: inset 0 1px 0 rgb(255 255 255 / 0.35), 0 0 22px color-mix(in oklab, var(--accent) 38%, transparent);`
        *   `--dark-glow-nav: inset 0 1px 0 rgb(255 255 255 / 0.22), 0 0 12px color-mix(in oklab, var(--accent) 22%, transparent);`
        *   `--dark-glow-focus: 0 0 14px color-mix(in oklab, var(--accent) 36%, transparent);`
    *   **Yüksek Kontrast Paletleri (`[data-light-theme='contrast']` ve `[data-dark-theme='contrast']`):**
        *   Tüm `--*-shadow-*`, `--*-edge-highlight`, `--*-surface-sheen` değerleri `none`; tüm `--*-glow-*` değerleri `0 0 0 0 transparent` olarak sıfırlanır.
        *   Aynı sıfırlama `@media (prefers-contrast: more)` ve `@media (forced-colors: active)` kurallarıyla sistem düzeyinde de garantilenir.
    *   **Semantik Eşleme (`:root, .theme-preview`):** `--shadow-card`, `--shadow-card-hover`, `--shadow-overlay`, `--edge-highlight`, `--surface-sheen`, `--glow-primary`, `--glow-primary-hover`, `--glow-nav`, `--glow-focus` `light-dark()` üzerinden çözülür; böylece `/settings` palet önizleme kartları da kendi derinlik/düz karakterini doğru yansıtır.
*   **Odak Halkası (WCAG 1.4.11 / 2.4.7 Korunarak):**
    *   İç kontrast çerçevesi (`2px var(--color-focus-inner)`) ve `2px` zemin boşluğu aynen korunur; dışına yalnız standart/loş paletlerde yumuşak vurgu halosu (`var(--glow-focus)`) eklenir; `contrast` paletlerde, `prefers-contrast: more` ve `forced-colors: active` altında düz kalır.

#### 3. Mikro Etkileşimler ve Hareket Sistemi

Tüm mekânsal animasyonlar `@media (prefers-reduced-motion: no-preference)` içine alınır (`modern-web-guidance` `motion`, `physics-based-easing` ve `natural-interactions` rehberleri); yalnızca compositor özellikleri (`opacity`, `scale`, `translate`) canlandırılır:

*   **Düğme Basışı:** `.btn:active:not(:disabled)` için `scale: 0.98` (`100ms`); hover'da birincil düğme parıltısı yumuşakça genişler (`--glow-primary-hover`), gölge/parıltı sınır yerine `1px` gerçek `border` ile desteklenir (`forced-colors` güvenliği).
*   **Beğeni / Kaydet Yay Tepkisi:** `PostActions` ve `ResourceHero` beğeni düğmesinde `aria-pressed="true"` durumuna geçişte kalp ikonunda `linear()` yay eğrili mikro nabız (`@keyframes signal-pop`, `scale: 1 → 1.24 → 0.94 → 1.03 → 1`, `320ms`, `ease-out` yedekli — `linear()` custom property yerine doğrudan kuralda yazılır).
*   **Kart ve Ek Kutusu Derinliği:** `.link-attachment`, `/sections` kartları, `.palette-option` ve `.metric-card` hover'da `translate: 0 -1px` + `--shadow-card-hover`; `.card-thumbnail` içindeki görsel `overflow: hidden` içinde hafifçe `scale: 1.02` büyür (`220ms`).
*   **Top-Layer Açılış (`<dialog>` / `[popover]`):** `@starting-style` üzerinde `opacity: 0; scale: 0.97; translate: 0 4px;` → `opacity: 1; scale: 1; translate: 0 0;` (`180ms` açılış; kapanış anında kalarak E2E/a11y temizliğini korur).
*   **View Transitions:** Mevcut `+layout.svelte`, `PostCard.svelte` ve `admin/sections/+page.svelte` `startViewTransition` kancaları üzerine `base.css` içinde rafine `::view-transition-old(root)` / `::view-transition-new(root)` cross-fade + `4px` kayma (`180ms`, yalnız `no-preference` altında).

#### 4. Faz 2 Sürü Dosya Sahipliği (A1–A6, Çakışmasız)

| Ajan | Dosyalar | Faz 2 Teslimatları |
| :--- | :--- | :--- |
| **A1** (Token & Temel) | `src/lib/styles/{tokens,base,components}.css` | `--radius-1/2/3/pill`, `--in-oklab`, açık gölge / koyu `1px` üst ışık / düşük opaklık yüzey ışığı, 3 noktalı vurgu parıltısı, `contrast` + `prefers-contrast` + `forced-colors` sıfırlaması, `:focus-visible` glow, `.btn` press (`scale: 0.98`) + `.btn-primary` glow, pill `.tag`/`.badge`, `@starting-style` `scale+translate` dialog/popover, `@keyframes signal-pop`, `::view-transition-*` cilası |
| **A2** (Akış) | `src/lib/components/feed/**` | `LinkAttachment` (`--radius-3`, `--shadow-card` / `--shadow-card-hover`, `--surface-sheen`, hover `-1px`, thumbnail `scale: 1.02`), `PostCard` modern kart/ek ritmi + pill bölüm etiketleri, `PostActions` yaylı beğeni animasyonu, `ShareComposerDialog` (`--radius-3`, `--surface-sheen`, odak derinliği), `FeedFilterBar` pill çipler, `NewPostsPill` pill + vurgu parıltısı + giriş hareketi |
| **A3** (Kabuk & Tema) | `src/lib/components/shell/**`, `src/lib/components/notifications/NotificationBell.svelte`, `src/routes/(app)/+layout.svelte` | Sol ray aktif öğe `--glow-nav` + `+ Paylaş` `--glow-primary`, ray arama kutusu `--radius-2` + odak derinliği, `NotificationBell` & hesap menüsü `--radius-3` + `--shadow-overlay` + üst ışık, `BottomTabBar` aktif sekme pill/parıltı, `PaletteForm` önizleme kartlarında canlı derinlik/üst ışık/YK düz görünümü + hover `-1px`, `KeyboardHelpDialog` rafine tuş kapakları |
| **A4** (İçerik Ekranları) | `src/routes/(app)/{resources,search,sections,settings}/**`, `src/lib/components/resource/ResourceHero.svelte` | `ResourceHero` (`--radius-3`, `--shadow-card`, `--surface-sheen`, yaylı beğeni, parıltılı tek CTA), `/sections` kartları (`--radius-3`, hover `-1px` + derinlik/üst ışık), `/search` segment çubuğu ve sonuç alanı cilası, `/settings` ve `/settings/api-keys` panelleri (`--radius-3`, `--surface-sheen`, pill durum çipleri) |
| **A5** (Yönetim) | `src/routes/(app)/admin/**` | Yönetim alt sekmeleri (`--radius-2`, aktif sekmede `--glow-nav`, pill `.subnav-badge`), 6 sayfada `.panel`, `.metric-card` ve `.table-wrapper` (`--radius-3`, açıkta `--shadow-card`, koyuda üst ışık kenarlığı + `--surface-sheen`), pill durum çipleri (`Aktif`, `Davet bekliyor`, `Pasif`), satır içi buton/select `--radius-2` uyumu |
| **A6** (Giriş, Hata & Eklenti) | `src/routes/{login,auth}/**`, `src/lib/components/auth/**`, `src/routes/+error.svelte`, `src/lib/components/ErrorContent.svelte`, `extensions/src/**` | `AuthLayout` marka panelinde çok düşük opaklıklı nötr mühendislik nokta deseni + üst ışık (`contrast` ve `prefers-contrast: more` altında kapalı) + form kartı `--radius-3` + birincil buton parıltısı, 404 kartı `--radius-3` + yüzey ışığı; eklenti `tokens.css`, `popup.css`, `options.css` üzerinde tam hizalı yarıçap, açık gölge / koyu üst ışık, birincil buton parıltısı ve `prefers-contrast: more` desteği |

### Faz 2 Verification Plan

Faz 1 ile aynı tam doğrulama kapısı çalıştırılır:

1.  **Kontrast ve Kısıt Denetimi:** `tokens-contrast.test.ts` (213/213); kod tabanında sıfır `backdrop-filter`, sıfır mor/turuncu/krem veya yeni renk token'ı, sıfır buton/metin gradyanı, yüksek kontrast paletlerinde (`contrast`) ve `prefers-contrast: more` altında sıfır gölge/gradyan/parıltı doğrulaması.
2.  **Kök ve Eklenti Test Kapıları:** `pnpm lint && pnpm check && pnpm test && pnpm test:e2e && pnpm test:docker` + `cd extensions && pnpm lint && pnpm check && pnpm test`.
3.  **Görsel Karşılaştırma:** `SHOTS_DIR=./.local-data/shots-after pnpm exec playwright test -c .local-data/report-kit/playwright.config.ts` ile tüm 71 ekran görüntüsü (açık, koyu, mobil, tema vitrini — **Yüksek Kontrast paletlerinin düz kaldığı dâhil** — ve tarayıcı eklentisi) yenilenir ve karşılaştırılır.
4.  **Doküman Güncellemesi:** Onay sonrası [izgah-ui-v2.md](./izgah-ui-v2.md) §3–§4'e Faz 2 referans notu işlenir; tüm değişiklikler `feat/ui-polish` dalında kalır.
