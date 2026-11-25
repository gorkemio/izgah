# İzgah Arayüz v2 — "Sinyal"

*   **Author:** Gorkem Inanc Ozdemir
*   **Status:** Partially Superseded by [izgah-ui-v3.md](./izgah-ui-v3.md) (§2, §9, §11 ve §12 bağlayıcı kalır)
*   **Date:** 2026-11-20

> **UI v3 Geçiş Notu (2026-11-24):** Bu dokümandaki görsel dil, renk paleti, yasaklı klişeler, bileşen envanteri, kabuk/kart yerleşimi ve eklenti renk token'ları (**§1, §3, §4, §5, §6, §7, §13 ve §14**) [izgah-ui-v3.md](./izgah-ui-v3.md) ("İzgah Stüdyo") ile güncellenmiştir. **§2** (Fontsource kendi sunucusundan yükleme ve `latin`/`latin-ext` ön yükleme mekanizması), **§9** (tema çerezleri ve SSR flaşsız uygulama), **§11** (güvenlik başlıkları ve zorunlu CSP) ile **§12** (sabit E2E kancaları ve erişilebilir adlar) bağlayıcı olarak korunur.

--------------------------------------------------------------------------------

## Overview

Bu doküman İzgah web arayüzünün ikinci sürümünü ("Sinyal") tanımlar: görsel dil ve tasarım belirteçleri (token), tipografi, uygulama kabuğu ve bilgi mimarisi, insan-önce gönderi anatomisi, dört yeni etkileşim (satır içi paylaşım + yapıştırarak paylaş, klavye kısayolları, son ziyaret ayırıcısı, yeni paylaşım balonu), açık/koyu tema çerezi, içerik güvenliği politikası (CSP), yeni `GET /api/internal/feed/updates` ucu, sabit E2E kancaları ve tarayıcı eklentisinin token hizalaması. Veri modeli, kimlik doğrulama, önizleme işçisi ve `/api/v1/*` sözleşmesi [izgah-core.md](./izgah-core.md) içinde tanımlandığı gibi kalır; UI v2 hiçbir veritabanı göçü gerektirmez.

[AGENTS.md](../../AGENTS.md) gereği bu doküman, `izgah-core.md` §6 ve §8 ile çelişen arayüz kodu yazılmadan önceki onay kontrol noktasıdır. Hangi çekirdek kuralların değiştiği ve hangilerinin korunduğu §15 içinde tablo olarak listelenir.

**Kuzey yıldızı:** *"WhatsApp'tan hızlı paylaş, X gibi oku, arşivde saniyede bul."*

#### Temel Kavramlar

*   **Sinyal:** Beyaz zemin, siyah mürekkep ve tek elektrik limon vurgudan (`#C8F542`) oluşan görsel dil. Limon yalnızca anlam taşır: aktif gezinme, birincil "Paylaş", görülmemiş içerik, seçim ve bağlantı vurgusu.
*   **Ray (`Rail`):** `≥ 1024px` genişlikte kalıcı sol gezinme sütunu; `768–1023px` arasında yalnız ikonlu dar biçime (ikon-ray) geçer.
*   **Alt Sekme Çubuğu (`Bottom Tab Bar`):** `< 768px` genişlikte başparmak erişimli, durumsuz (stateless) alt gezinme.
*   **Satır İçi Paylaşım Formu (`Inline Composer`):** Ana akış ve bölüm akışının başında, JS'siz de çalışan `?/createShare` formu.
*   **Paylaşım Denetleyicisi (`ComposerController`):** Yapıştırma, sürükle-bırak, `n` kısayolu, ray ve alt çubuktaki "Paylaş" tetikleyicilerini tek hedefe (satır içi form veya `<dialog>`) yönlendiren düzen düzeyi bağlam.
*   **Kapsam (`Scope`):** Bir akış görünümünün kimliği: ana akış (`feed`) veya belirli bir bölüm (`section:<id>`). İçerik türü süzgeci kapsamın parçası değildir.
*   **Son Ziyaret Ayırıcısı:** Kapsam başına cihazda saklanan "en son görülen paylaşım zamanı"na göre akışta görülmüş ve görülmemiş gönderileri ayıran çizgi.
*   **Yeni Paylaşım Balonu (`New Posts Pill`):** Akış açıkken başkalarının yaptığı yeni paylaşımların sayısını gösteren ve tıklanınca akışı yenileyen düğme.

## The Problem

v0.1.0 arayüzü işlevsel olarak eksiksizdir ve yerel platform primitiflerini doğru kullanır; ancak ürün vaadiyle ve ekip alışkanlığıyla dört noktada çelişir:

1.  **Bağlantı-merkezli kart, insan-merkezli vaat:** Brief "X akışı gibi" der; oysa kartta en büyük öğe bağlantı başlığıdır, paylaşanın notu (ekibin sesi) açıklamanın altına, yazar ve zaman soluk meta satırına gömülüdür.
2.  **Görsel kimlik yok:** Renkler ve yazı tipi Tailwind-slate varsayılanlarıdır (`#f8fafc`, `#0f172a`, `#cbd5e1`, `#1d4ed8`, `system-ui`); yalnız açık tema vardır (eklentide koyu tema varken); girdi kenarlıkları beyaz üzerinde `3:1`'in altında kalır (WCAG 1.4.11).
3.  **Gezinme çekirdek kavramı saklıyor:** Konu bölümleri taşınca "Menü" popover'ına gizlenir; "Ayarlar" ve "Çıkış" birincil alanı işgal eder; mobilde başparmak erişimli gezinme yoktur; ~250 satırlık `ResizeObserver` ölçüm mantığı her yüklemede düzen kaymasına yol açar.
4.  **Paylaşım WhatsApp kadar hızlı değil:** Paylaşmak için önce pencere açmak gerekir; geri dönen üye neyin yeni olduğunu göremez; açık sekmede yeni paylaşımlar sayfa yenilenmeden görünmez; arşive klavyeden hızlı erişim yoktur.

## Goals

*   **Hızlı Paylaşım:** Akış ekranında panodaki WhatsApp metninden paylaşım en fazla üç etkileşimle tamamlanır (yapıştır → isteğe bağlı not → `Ctrl/⌘ + Enter`). Masaüstü Chrome ve Firefox'ta yapıştırma için önce bir alana odaklanmak gerekmez; Safari ve mobilde satır içi URL alanı tek dokunuşla kullanılır. JS kapalıyken satır içi form aynı sunucu eylemiyle çalışır.
*   **X Gibi Okuma:** Her gönderi önce paylaşan kişiyi ve notunu, sonra bağlantı ekini gösterir. `≥ 1024px` genişlikte notu üç satır olan görselli bir gönderi en fazla `280px` dikey alan kaplar. Akış gün gruplarına ayrılır ve fare olmadan `j`/`k` ile gezilir.
*   **Arşivde Saniyede Bulma:** Her uygulama sayfasından `/` tuşuyla tek adımda arama alanına ulaşılır; bölümler `/sections` dizininde JS'siz ve mobilde de listelenir.
*   **Geri Dönüşte Bağlam:** Son ziyaret ayırıcısı ve yeni paylaşım balonu, sunucuya okundu bilgisi yazmadan "ne değişti?" sorusunu yanıtlar.
*   **Erişilebilirlik ve Dayanıklılık:** WCAG 2.2 AA (özellikle 1.4.3, 1.4.11, 2.1.4, 2.4.7, 2.4.11, 2.5.3, 2.5.8); tüm token çiftleri için hesaplanmış kontrast oranları; kaba işaretçide (`pointer: coarse`) en az `44 × 44px` dokunma hedefi; ilk boyamada tema parlaması (flash) olmaması; kabukta sıfır JS ölçümü ve sıfır düzen kayması.
*   **Dar Bağımlılık Yüzeyi:** Yalnız iki yazı tipi paketi eklenir; bileşen kütüphanesi, CSS çerçevesi, ikon paketi veya polyfill eklenmez.

## Non-Goals

*   **Komut Paleti ve Bölünmüş Görünüm:** `⌘K` komut paleti ve ana-detay bölünmüş görünüm bu sürümde yoktur.
*   **Sunucu Taraflı Okundu Bilgisi:** Son ziyaret bilgisi yalnızca cihazdaki `localStorage` içinde tutulur; cihazlar arası senkronizasyon yapılmaz (çekirdek dokümandaki "okudum/okumadım takibi yok" kararı korunur).
*   **Gerçek Zamanlı İtme:** SSE veya WebSocket kurulmaz; yeni paylaşımlar görünür sekmede 60 saniyelik yoklamayla sayılır.
*   **Özel Tema ve Renk Seçimi:** UI v2 yalnız Sistem / Açık / Koyu seçeneklerini getirir. Adlandırılmış ek temalar (Loş, Yüksek kontrast) ve hazır vurgu renkleri sonradan [izgah-themes.md](./izgah-themes.md) ile eklenmiştir; serbest renk seçimi ve yoğunluk ayarı yine yoktur.
*   **Profil Görseli, Emoji Tepkileri, İç İçe Yorumlar:** Avatarlar ad baş harflerinden üretilen monogramdır; tepki ve yorum modeli değişmez.
*   **Eklenti Davranışı:** Eklentinin popup/options davranışı değişmez; yalnız görsel token'ları hizalanır (§14).
*   **Veri Modeli:** Yeni tablo, sütun veya indeks yoktur.

## Kararlar

Taslak aşamasındaki altı açık soru kullanıcı tarafından 2026-11-20'de yanıtlanmıştır; açık soru kalmamıştır. Kararlar ilgili bölümlere işlenmiş ve doküman aynı gün onaylanmıştır.

1.  **"Link Paylaş" tetikleyicisinin hedefi:** Ray, alt sekme çubuğu, `n` ve yapıştırma/sürükle-bırak aynı kuralı izler: satır içi form **tamamen** görünür alandaysa ona odaklanılır, değilse `<dialog>` açılır (yarım görünen alana `focus()` verilirse sayfa kayar). Akış sayfalarındaki paylaşım E2E senaryoları satır içi forma çevrilir; dialoga özgü senaryolar (`Esc`, kirli form onayı, `returnValue`) dialogun açıldığı `/resources/[id]` veya `/search` sayfasına taşınır; akışta aşağı kaydırıldığında dialogun açıldığını doğrulayan yeni bir senaryo eklenir (§8.1, §12).
2.  **CSP:** Rapor modu ve `POST /csp-report` ucu **yoktur**. Faz 1 (S3) yalnız sabit güvenlik başlıklarını ekler; CSP Faz 8'de doğrudan zorunlu modda gelir. Ön koşul, üretim imajına karşı koşan m8 Docker duman testinde tüm ana rotalarda sıfır `securitypolicyviolation` olayıdır (§11).
3.  **Yeni renkler onaylandı:** Açık tema `surface` `#F5F5F5`; `line-strong` `#808080` / `#707070`; `danger` `#B42318` / `#FF7A7A` ve `on-danger` `#FFFFFF` / `#0A0A0A` (§1).
4.  **Mobil üst çubuk:** `< 768px` üst çubukta yalnız marka ve bildirim zili bulunur; "Ara" yalnız alt sekme çubuğundadır (§6).
5.  **Kısayol tercihi:** Cihaz başına `localStorage` `izgah:shortcuts` içinde kalır; sunucuya yazılmaz (§8.2).
6.  **`/sections` dizini:** Yalnız bölüm adı ve açıklaması gösterilir; paylaşım sayısı veya son paylaşım tarihi için ek sorgu yapılmaz (§6).

## Critical User Journeys (CUJs)

### CUJ U1: WhatsApp'tan Kopyalanan Metni Yapıştırarak Paylaşma

*   **Given**: Masaüstü Chrome'da oturum açmış bir üye ana akıştadır; panosunda WhatsApp'tan kopyalanmış `"Şuna bakın https://github.com/sveltejs/kit?utm_source=x"` metni vardır; odak hiçbir metin alanında değildir.
*   **When**: Üye `Ctrl + V` tuşlarına basar, açılan satır içi formda önerilen notu düzenler, bir bölüm seçer ve `Ctrl + Enter` ile gönderir.
*   **Then**: İlk `http(s)` adresi URL alanına, kalan metin not alanına dolar; erken çift kontrolü çalışır; odak not alanına geçer ve canlı bölge `"Bağlantı forma eklendi: github.com"` duyurur. Gönderimden sonra yeni gönderi akışın en üstünde görünür, form sıfırlanır (bölüm sayfasındaysa o bölüm yeniden ön seçilir) ve `"Paylaşıldı"` bildirimi gösterilir. Safari'de veya JS kapalıyken aynı sonuç satır içi URL alanına doğrudan yapıştırılarak elde edilir.

### CUJ U2: Fare Olmadan Akışı Okuma

*   **Given**: Üye ana akıştadır ve tek tuşlu kısayollar açıktır.
*   **When**: `j` ile üç gönderi aşağı iner, `l` ile birini beğenir, `o` ile bağlantıyı yeni sekmede açar, `c` ile yorumlara gider; geri döner ve `?` ile yardım penceresini açıp kısayolları kapatır.
*   **Then**: Her `j`/`k` odağı bir sonraki/önceki gönderi `<article>`'ına taşır ve odak halkası görünür; beğeni iyimser güncellenir ve duyurulur; Geri tuşu kaydırma konumunu korur; kısayollar kapatıldıktan sonra tek tuşlar hiçbir eylem tetiklemez (WCAG 2.1.4).

### CUJ U3: Geri Dönen Üyenin Yeni Olanları Görmesi

*   **Given**: Üye ana akışı dün 18:40'ta son kez görmüştür; o zamandan beri ekip yedi paylaşım yapmıştır.
*   **When**: Üye akışı açar ve sekmeyi açık bırakır; bu sırada başka bir üye iki yeni paylaşım yapar.
*   **Then**: Akışta yedi gönderi limon "Yeni" işaretiyle (ekran okuyucu için görünmez "Yeni" metniyle) görünür ve sekizinci gönderinin üstünde son ziyaret ayırıcısı yer alır. En geç 60 saniye içinde `"2 yeni paylaşım"` balonu belirir; tıklandığında akış yenilenir, odak ilk yeni gönderiye taşınır ve durum duyurulur.

### CUJ U4: Mobilde Bölüm Bulma ve O Bölüme Paylaşma

*   **Given**: Üye `375px` genişlikte bir telefondadır.
*   **When**: Alt sekme çubuğundan "Bölümler"e dokunur, `/sections` dizininden "Arayüz Tasarımı"nı seçer ve bölüm akışının başındaki satır içi forma bir bağlantı yapıştırır.
*   **Then**: Dizin JS'siz de çalışır; bölüm sayfasında form "Arayüz Tasarımı" ön seçili açılır; metin alanı odaktayken alt sekme çubuğu gizlenir ve sanal klavyenin üstünde kalmaz; gönderim sonrası paylaşım bölüm akışında görünür.

### CUJ U5: Tema Seçimi

*   **Given**: İşletim sistemi açık temadadır; üye koyu tema tercih etmektedir; tarayıcıda JS kapalıdır.
*   **When**: Üye hesap menüsünden (veya `/settings` "Görünüm" bölümünden) "Koyu"yu seçip formu gönderir ve sonra başka bir sayfaya gider.
*   **Then**: Sunucu `izgah_theme=dark` çerezini yazar ve üyeyi geldiği sayfaya yönlendirir; sonraki her HTML yanıtı `<html data-theme="dark">` ile gelir; ilk boyamada açık tema parlaması olmaz.

## Technical Plan (Architecture)

### 1. Görsel Dil: Sinyal Renk Token'ları

Gri skala nötrdür (mavi tonu yoktur). Token'lar [`src/lib/styles/tokens.css`](../../src/lib/styles/tokens.css) içinde `--color-*` önekiyle tanımlanır (eklentiyle aynı adlandırma, §14). Kontrast oranları WCAG 2.x göreli parlaklık formülüyle hesaplanmıştır ve [Verification Plan](#verification-plan) içindeki birim testiyle token dosyasından yeniden doğrulanır.

| Token | Rol | Açık | Koyu | Kontrast — Açık | Kontrast — Koyu | Eşik ve Sonuç |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `--color-bg` | Sayfa zemini | `#FFFFFF` | `#0A0A0A` | — | — | — |
| `--color-surface` | Hover/odak zemin tonu, satır içi form, görsel yer tutucu, `kbd`, kod | `#F5F5F5` *(yeni)* | `#141414` | `bg` ile `1.09:1` | `bg` ile `1.07:1` | Dekoratif; tek başına sınır olarak kullanılmaz |
| `--color-text` | Birincil metin (mürekkep) | `#0A0A0A` | `#F2F2F2` | `bg` `19.80` · `surface` `18.16` | `bg` `17.68` · `surface` `16.46` | 4.5:1 ✓ (AAA ✓) |
| `--color-text-muted` | İkincil metin, meta | `#5C5C5C` | `#A3A3A3` | `bg` `6.69` · `surface` `6.13` · `line` `5.16` | `bg` `7.85` · `surface` `7.30` · `line` `5.69` | 4.5:1 ✓ |
| `--color-line` | Saç çizgisi satır ayracı, ek kutusu kenarı | `#E2E2E2` | `#2A2A2A` | `bg` `1.30` | `bg` `1.38` · `surface` `1.28` | 3:1 ✗ → **yalnız dekoratif ayraç** |
| `--color-line-strong` | Form alanı, onay kutusu ve seçilmemiş kontrol sınırı | `#808080` *(yeni)* | `#707070` *(yeni)* | `bg` `3.95` · `surface` `3.62` | `bg` `4.00` · `surface` `3.72` | 3:1 ✓ (WCAG 1.4.11) |
| `--color-signal` | Limon vurgu | `#C8F542` | `#C8F542` | `bg` `1.27` | `bg` `15.65` · `surface` `14.56` | Açıkta metin/işaret olarak ✗ → **yalnız dolgu**; koyuda metin olarak ✓ |
| `--color-on-signal` | Limon dolgu üzerindeki metin/ikon | `#0A0A0A` | `#0A0A0A` | `signal` `15.65` | `signal` `15.65` | 4.5:1 ✓ |
| `--color-danger` | Yıkıcı eylem, hata metni | `#B42318` *(yeni)* | `#FF7A7A` *(yeni)* | `bg` `6.57` · `surface` `6.03` | `bg` `7.84` · `surface` `7.30` | 4.5:1 ✓ |
| `--color-on-danger` | Tehlike dolgusu üzerindeki metin | `#FFFFFF` | `#0A0A0A` | `danger` `6.57` | `danger` `7.84` | 4.5:1 ✓ |
| `--color-focus-inner` | Odak halkası iç çerçevesi | `#0A0A0A` | `#F2F2F2` | `bg` `19.80` | `bg` `17.68` | 3:1 ✓ (WCAG 1.4.11 / 2.4.7) |
| `--color-focus-outer` | Odak halkası dış halesi | `#C8F542` | `#C8F542` | dekoratif | dekoratif | — |
| `--color-backdrop` | `dialog::backdrop` | `rgb(10 10 10 / 0.55)` | `rgb(0 0 0 / 0.7)` | — | — | Blur yok |

**Değer ayarlamaları:** Verilen on değerin hiçbiri metin için AA eşiğini kaçırmadığından **hiçbir değer değiştirilmemiştir**. Ancak üç sınırlama ve dört ekleme yapılmıştır:

*   `line` her iki temada `3:1`'in altındadır; bu yüzden yalnız dekoratif ayraçta kullanılır, etkileşimli bir bileşenin tek görsel sınırı olamaz. Bu rol için `line-strong` eklenmiştir (F9 bulgusunun çözümü).
*   Limon açık temada beyaz üzerinde `1.27:1`'dir: açık temada asla metin rengi, ikon rengi veya tek başına durum işareti olarak kullanılmaz; her zaman mürekkep metin/ikon taşıyan dolgu ya da mürekkep çerçeveli işaret olarak görünür.
*   Koyu temada limon dolgu üzerindeki metin `--color-text` (`#F2F2F2`, `1.13:1` ✗) **olamaz**; her iki temada `--color-on-signal` kullanılır.
*   Açık tema `surface`, iki tema için `line-strong`, `danger` ve `on-danger` eklenmiştir. Başarı/uyarı için ayrı renk yoktur: durumlar mürekkep metin + ikon + `surface` zeminle anlatılır (amber/turuncu yasağı, §4).

#### Limonun İzinli Kullanımları

| Kullanım | Açık tema | Koyu tema |
| :--- | :--- | :--- |
| Aktif gezinme öğesi (ray, alt çubuk) | Limon dolgu + `on-signal` metin | Aynı |
| Birincil düğme ("Paylaş") | Limon dolgu + `on-signal` metin, `1px` mürekkep kenar | Limon dolgu + `on-signal` metin |
| Görülmemiş gönderi işareti | `8px` limon kare + `1px` mürekkep kenar + görünmez "Yeni" metni | `8px` limon kare + görünmez "Yeni" metni |
| Metin seçimi (`::selection`) | Limon zemin + `on-signal` metin | Aynı |
| Bağlantı hover/odak vurgusu | Fosforlu kalem: limon zemin + mürekkep metin | Limon metin + alt çizgi |
| Kendi gönderinin avatarı | Limon dolgu + `on-signal` monogram | Aynı |
| Odak halkası dış halesi | Dekoratif hale | Dekoratif hale |

Bağlantılar varsayılan olarak mürekkep renkli ve altı çizilidir (`text-underline-offset: 0.2em`, `1px`); mavi bağlantı rengi yoktur.

### 2. Tipografi

Yazı tipleri `@fontsource-variable/schibsted-grotesk@5.3.0` ve `@fontsource-variable/jetbrains-mono@5.3.0` paketleriyle (her ikisi `OFL-1.1`) kendi sunucumuzdan sunulur; Google Fonts veya başka bir CDN kullanılmaz.

*   **Aileler:** `--font-sans: 'Schibsted Grotesk Variable', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif` ve `--font-mono: 'JetBrains Mono Variable', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`.
*   **Kullanılan ağırlıklar:** Sans `400 / 500 / 700 / 800`, mono `400 / 500` (değişken eksenden; ek dosya yoktur).
*   **Mono'nun alanı:** Zaman, alan adı, içerik türü, sağlayıcı meta (yıldız, dil), sayaçlar, rozetler ve `kbd`. Mono metin her zaman `font-variant-numeric: tabular-nums` kullanır.
*   **Türkçe karakterler:** `ı İ ş Ş ğ Ğ` karakterleri fontsource'un `latin-ext` alt kümesindedir. Bu nedenle ön yükleme **hem `latin` hem `latin-ext`** Schibsted `wght-normal` dosyalarını kapsar (uygulama planındaki "yalnız latin" ön yükleme notu bu dokümanla düzeltilir). Büyük harfe çevirme yalnız `lang="tr"` altındaki CSS `text-transform` veya `toLocaleUpperCase('tr-TR')` ile yapılır.
*   **Yükleme:** Yazı tipleri kök [`src/routes/+layout.svelte`](../../src/routes/+layout.svelte) içinde paket CSS'iyle içe aktarılır (`font-display: swap`). [`vite.config.ts`](../../vite.config.ts) `build.assetsInlineLimit` işlevi `.woff2` dosyalarını satır içine almaz; aksi halde `data:` yazı tipi `font-src 'self'` politikasına takılır. Ön yükleme SvelteKit `resolve(event, { preload })` seçeneğiyle yapılır: `type === 'font'` olup yolu `schibsted-grotesk-latin(-ext)?-wght-normal` desenine uyan iki dosya ön yüklenir; mono ön yüklenmez.

| Token | Boyut / Satır yüksekliği | Ağırlık | Aile | İzleme (`letter-spacing`) | Kullanım |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--text-display` | `clamp(1.75rem, 1.2rem + 2vw, 2.25rem)` / `1.05` | `800` | Sans | `-0.03em` | Sayfa `h1` ("Ana Akış", bölüm adı) |
| `--text-day` | `clamp(1.375rem, 1.1rem + 1vw, 1.75rem)` / `1.1` | `800` | Sans | `-0.02em` | Gün başlığı `h2` ("Bugün", "Dün", "Salı", "18 Kasım") |
| `--text-title` | `1.0625rem` / `1.35` | `700` | Sans | `-0.01em` | Bağlantı eki başlığı `h3` |
| `--text-body` | `1rem` / `1.5` | `400` | Sans | `0` | Not, yorum, form metni |
| `--text-ui` | `0.875rem` / `1.3` | `500` | Sans | `0` | Düğme, ray öğesi, bölüm etiketi, yazar adı (`700`) |
| `--text-meta` | `0.8125rem` / `1.3` | `400` | Mono | `0` | Zaman, alan adı, tür, sayaç |
| `--text-micro` | `0.75rem` / `1.2` | `500` | Mono | `0.02em` | Rozet ("Sessiz"), `kbd`; en küçük izinli boyut |

Başlıklarda `text-wrap: balance`, notlarda `text-wrap: pretty` aşamalı geliştirme olarak kullanılır. İtalik kullanılmaz (italik dosyası içe aktarılmaz); vurgu ağırlıkla (`700`) yapılır.

### 3. Biçim, Aralık, Hareket ve Odak Halkası

> **Faz 2 Güncellemesi (2026-11-24):** Köşe yarıçapları (`4 / 8 / 12px` + `9999px` etiket/rozet hapı), açık tema katmanlı gölgeleri, koyu tema `1px` üst ışık kenarlığı, düşük opaklıklı yüzey ışığı, üç izinli vurgu parıltısı noktası (birincil buton, aktif gezinme, odak halkası) ve `prefers-reduced-motion: no-preference` opt-in mikro etkileşimleri [izgah-ui-polish.md](./izgah-ui-polish.md#faz-2--modern-derinlik-ve-mikro-etkileşimler-sinyal--linear--raycast-çizgisi) Faz 2 ile güncellenmiştir; yüksek kontrast paletlerinde (`contrast`), `prefers-contrast: more` ve `forced-colors: active` altında gölge, gradyan ve parıltı kapalı kalır.

*   **Aralık:** `4px` ızgara; `--space-1 … --space-8` = `4, 8, 12, 16, 24, 32, 48, 64px`. Mobilde yan boşluk `16px`, masaüstünde `24px`.
*   **Köşe:** `--radius-1: 2px` (etiket, `kbd`, avatar), `--radius-2: 4px` (ek kutusu, form alanı, düğme, dialog, popover, yeni paylaşım balonu). Daha büyük yarıçap ve hap (pill) biçimi yoktur.
*   **Satırlar:** Gönderiler kart kutusu değil, `1px` `--color-line` saç çizgisiyle ayrılan satırlardır. Bağlantı eki `1px` `--color-line` + `4px` köşeli kutudur.
*   **Gölge:** Yalnız `<dialog>` ve popover'da: `0 8px 24px rgb(0 0 0 / 0.12)` (koyuda `rgb(0 0 0 / 0.5)` + `1px` `--color-line` kenar). Gönderilerde, düğmelerde ve ekte gölge yoktur.
*   **Genişlikler:** Ray `248px`, ikon-ray `72px`, okuma sütunu en fazla `680px`.
*   **Hareket:** `--dur-1: 120ms`, `--dur-2: 180ms`, `--ease: cubic-bezier(0.2, 0, 0, 1)`. Yalnız opaklık, renk ve zemin rengi canlandırılır; hover'da yükselme (`translateY`) veya ölçekleme yoktur. `prefers-reduced-motion: reduce` altında tüm geçişler `0ms`'ye iner ve View Transitions devre dışı kalır.
*   **Dokunma hedefi:** Tüm etkileşimli öğeler en az `24 × 24px` (WCAG 2.5.8); `@media (pointer: coarse)` altında alt sekme çubuğu, gönderi eylemleri ve form kontrolleri en az `44 × 44px`.
*   **Arka plan kaydırma kilidi:** `html:has(dialog:modal) { overflow: hidden; }` ve aşamalı geliştirme olarak `scrollbar-gutter: stable` (F11).
*   **Yapışkan öğeler ve odak görünürlüğü:** `html { scroll-padding-block-start: var(--sticky-top); scroll-padding-block-end: var(--tab-bar-h); }` — odaklanan öğe yapışkan üst çubuk, gün başlığı veya alt sekme çubuğu altında kalmaz (WCAG 2.4.11).

#### Odak Halkası

Limon tek başına beyaz zeminde `1.27:1` olduğu için WCAG 1.4.11'i geçmez; halka iki katmanlıdır ve kontrastı iç çerçeve taşır. Halka ile öğe arasında `2px`'lik zemin renkli boşluk bırakılır; böylece limon dolgulu düğmede bile halka öğeden ayrışır.

```css
:focus-visible {
	outline: 2px solid transparent; /* Windows Yüksek Kontrast / forced-colors için görünür kalır */
	outline-offset: 2px;
	box-shadow:
		0 0 0 2px var(--color-bg),
		0 0 0 4px var(--color-focus-inner),
		0 0 0 7px var(--color-focus-outer);
}
```

*   **Açık tema:** `2px` mürekkep çerçeve (`19.80:1`) + dışında `3px` limon hale.
*   **Koyu tema (ters):** `2px` `#F2F2F2` çerçeve (`17.68:1`) + dışında `3px` limon hale (`15.65:1`).
*   `overflow: hidden` taşıyan kapsayıcılardaki öğeler (bağlantı eki içindeki genişletilmiş bağlantı gibi) halkayı kapsayıcı üzerinde `:focus-within` ile çizer; odaklanan gönderi `<article>`'ı aynı halkayı alır. Kenar çubuğu biçiminde odak göstergesi kullanılmaz.

### 4. Yasaklı Klişeler

Aşağıdakiler İzgah arayüzünde ve eklentide kullanılmaz; kod incelemesinde ret gerekçesidir. *(Not: Köşe yarıçapı, açık/koyu derinlik, düşük opaklıklı yüzey ışığı, üç izinli vurgu parıltısı ve opt-in mikro hareket kuralları [izgah-ui-polish.md](./izgah-ui-polish.md) Faz 2'deki kesin sınırlarla güncellenmiştir; serif, krem/bej, turuncu/amber, mor/indigo, `backdrop-filter`/blur, buton/metin/dolgu gradyanı, kart sol vurgu çubuğu ve emoji yasakları aynen geçerlidir.)*

| Yasak | Neden | Yerine |
| :--- | :--- | :--- |
| Serif yazı tipleri (metin veya başlık) | "Yapay zekâ varsayılanı" editoryal görünüm | Schibsted Grotesk + JetBrains Mono |
| Krem, bej, kirli beyaz zemin | Aynı varsayılan görünümün imzası | `#FFFFFF` / `#0A0A0A` |
| Turuncu ve amber tonları (uyarı dahil) | Aynı nedenle; tek vurgu kuralını bozar | Uyarılar mürekkep + ikon + `surface` |
| Kart kenarında renkli çubuk (`border-left` vurgusu) — odaklı, yeni, sessiz veya hatalı gönderi dahil | En yaygın yapay zekâ kart klişesi | Tam çerçeve, odak halkası veya `surface` zemin tonu |
| Gradyanlar (zemin, düğme, metin, iskelet parıltısı) | Klişe; düz renk sistemine aykırı | Düz renk; iskelet durağan `surface` bloktur |
| Blur ve cam efekti (`backdrop-filter`, glassmorphism) | Klişe; düşük güçlü cihazda maliyetli | Opak yüzey + `--color-backdrop` |
| Mor/indigo vurgu, Inter + slate ikilisi | v1 ve genel SaaS varsayılanı | Limon tek vurgu |
| Emoji ikonlar, "✨" ve benzeri yapay zekâ sembolleri | Tutarsız çizim, ekran okuyucuda gürültü | Lucide çizgi ikonları (`Icon`) |
| Bento ızgara, büyük gölgeli kartlar, hap düğmeler, `> 4px` köşe | Klişe; yoğunluğu düşürür | Saç çizgisi satırlar, `2/4px` köşe |
| Hover'da yükselme/ölçekleme animasyonu | Dikkat dağıtır, yoğun listede titreşim | Zemin tonu değişimi |

### 5. Bileşen Envanteri ve Stil Mimarisi

Stil katmanları `@layer reset, tokens, base, components, utilities;` sırasıyla [`src/lib/styles/tokens.css`](../../src/lib/styles/tokens.css), [`src/lib/styles/base.css`](../../src/lib/styles/base.css) ve [`src/lib/styles/components.css`](../../src/lib/styles/components.css) içinde tanımlanır. Svelte `<style>` blokları katmansız olduğu için her zaman katmanlı kuralları ezer; bu bilinçli bir karardır (bileşene özgü düzen kuralları kazanır). Koyu tema `light-dark()` semantik token'ları ve `:root[data-theme]` üzerindeki `color-scheme` ile uygulanır (§9; palet yuvaları için [izgah-themes.md](./izgah-themes.md) §4). Paylaşılan istemci tipleri `#lib/server/...` yerine `src/lib/types/` altından içe aktarılır.

**Kural:** Davranış taşımayan görsel ilkeller **CSS sınıfıdır**; Svelte bileşeni yalnız durum, olay veya erişilebilirlik davranışı taşıyan parçalar için yazılır.

#### CSS Sınıfları (`components.css`)

| Sınıf | Varyantlar | Not |
| :--- | :--- | :--- |
| `.btn` | `.btn-primary` (limon), `.btn-quiet` (çerçevesiz), `.btn-outline` (`line-strong`), `.btn-danger`, `.btn-icon` (kare, görünmez etiketli) | `<button>` ve `<a>` üzerinde aynı görünüm; `aria-disabled` stili |
| `.field` | `input`, `textarea`, `select`; `.field-error` | `1px` `line-strong` sınır; hata metni `danger` + `aria-describedby` |
| `.tag` | Bölüm bağlantısı | Mono değil sans `--text-ui`; `1px` `line` + `2px` köşe |
| `.badge` | `.badge-silent` ("Sessiz"), `.badge-pending` ("Önizleme hazırlanıyor"), `.badge-count` | Mono `--text-micro`; sayaç rozeti `.notification-badge` ile birlikte kullanılır |
| `.kbd` | — | `surface` zemin, `1px` `line-strong` alt kenar |
| `.skeleton` | `.skeleton-line`, `.skeleton-thumb` | Durağan `surface` blok; animasyon yok |
| `.day-heading` | — | Yapışkan `h2` |
| `.unseen-mark` | — | `8px` limon kare (+ açık temada mürekkep kenar) |
| `.visually-hidden` | — | Mevcut yardımcı korunur |

#### Svelte Bileşenleri ve Modüller

| Ad | Tür | Dosya | Sorumluluk |
| :--- | :--- | :--- | :--- |
| `Icon` | Bileşen | `src/lib/components/ui/Icon.svelte` | ~24 Lucide çizgi ikon yolunu satır içi SVG olarak çizer (`aria-hidden="true"`); paket yok, ISC lisans metni dosya başında |
| `Avatar` | Bileşen | `src/lib/components/ui/Avatar.svelte` | Kare monogram (`tr-TR` büyük harf, en fazla iki harf); kendi gönderin limon; dekoratif (`aria-hidden`) |
| `Toaster` | Bileşen | `src/lib/components/ui/Toaster.svelte` | Tek `role="status"` bildirim yığını + paylaşılan canlı bölge duyurucusu |
| `Dialog`, `PopoverPanel` | Bileşen (mevcut) | `src/lib/components/ui/` | API korunur; yalnız stiller token'lara geçer; F12 düzeltmesi |
| `SiteHeader` | Bileşen | `src/lib/components/shell/SiteHeader.svelte` | Tek `<header class="site-header">`: ray / ikon-ray / mobil üst çubuk (§6) |
| `BottomTabBar` | Bileşen | `src/lib/components/shell/BottomTabBar.svelte` | `< 768px` durumsuz alt gezinme |
| `NotificationBell` | Bileşen (mevcut) | `src/lib/components/notifications/` | Tek örnek; `visibility-poller` üzerine taşınır (F16) |
| `KeyboardHelpDialog` | Bileşen | `src/lib/components/shell/KeyboardHelpDialog.svelte` | `?` penceresi, sayfada geçerli kısayollar ve kapatma anahtarı |
| `FeedView` | Bileşen | `src/lib/components/feed/FeedView.svelte` | `/` ve `/sections/[slug]` ortak akış görünümü; `feed-state` örneğini oluşturur |
| `PostCard` | Bileşen | `src/lib/components/feed/PostCard.svelte` | `ShareCard.svelte`'nin yerini alır; kök `article.share-card` korunur |
| `LinkAttachment`, `PostActions`, `PostMenu` | Bileşen | `src/lib/components/feed/` | Ek kutusu, eylem satırı, `⋯` taşma menüsü ("Paylaşım işlemleri") |
| `ShareNoJsFallbacks` | Bileşen | `src/lib/components/feed/` | `?edit=`, `?delete=` satır içi JS'siz paneller (`.inline-card-panel`) |
| `ShareForm` | Bileşen | `src/lib/components/share/ShareForm.svelte` | Ortak form çekirdeği (çift kontrol, bölümler, tür, sessiz seçenek) |
| `InlineComposer`, `ShareComposerDialog` | Bileşen | `src/lib/components/share/` | `ShareForm`'u satır içi ve `<dialog>` olarak sarar |
| `NewPostsPill` | Bileşen | `src/lib/components/feed/NewPostsPill.svelte` | §8.5 |
| `FeedFilterBar` | Bileşen (mevcut) | `src/lib/components/feed/` | Davranış korunur; segment görünümü |
| `feed-state` | Modül (`.svelte.ts`) | `src/lib/feed/feed-state.svelte.ts` | Bağlamla paylaşılan akış durumu (§8.6) |
| `ComposerController` | Bağlam | `src/lib/share/composer-controller.svelte.ts` | Paylaşım tetikleyicilerinin hedef seçimi (§8.1) |
| `visibility-poller` | Modül | `src/lib/client/visibility-poller.ts` | Görünür sekme duyarlı ortak yoklayıcı |
| `date`, `merge`, `group-by-day`, `paste`, `keyboard-filter` | Saf modüller | `src/lib/format/date.ts`, `src/lib/feed/*.ts`, `src/lib/share/paste.ts`, `src/lib/client/keyboard-filter.ts` | Vitest ile birim test edilen saf mantık |

### 6. Bilgi Mimarisi ve Uygulama Kabuğu

Kabuk tamamen CSS medya sorgularıyla duyarlıdır; `ResizeObserver` ölçüm mantığı ve ilk boyamada `popover`'dan satır içine geçiş tamamen kaldırılır (F10). Bileşen içi düzenler (bağlantı eki, form) ise kapsayıcı sorgularını (`@container`) kullanır.

| Genişlik | Kabuk | İçerik |
| :--- | :--- | :--- |
| `≥ 1024px` | Tam ray (`248px`) | Tek okuma sütunu (`≤ 680px`) |
| `768–1023px` | İkon-ray (`72px`; etiketler görsel olarak gizli, erişilebilir adlar korunur) | Tek okuma sütunu |
| `< 768px` | Yapışkan üst çubuk + sabit alt sekme çubuğu | Tam genişlik, `16px` yan boşluk |

```text
≥ 1024px                                      < 768px
┌────────────────────┬───────────────────┐    ┌────────────────────────────────┐
│ İzgah              │ Ana Akış          │    │ İzgah                 Bild. 3  │
│ [İzgah içinde ara] │ Tümü Video Repo … │    ├────────────────────────────────┤
│ [☐ Bu Bölüm    Ara]│ ┌───────────────┐ │    │ Ana Akış                       │
│ ▓▓ Akış ▓▓▓▓▓▓▓▓▓▓▓│ │Bir bağlantı   │ │    │ ┌────────────────────────────┐ │
│ Bildirimler      3 │ │yapıştır… Payl.│ │    │ │ Bir bağlantı yapıştır…     │ │
│                    │ └───────────────┘ │    │ └────────────────────────────┘ │
│ BÖLÜMLER           │ Bugün ─────────── │    │ Bugün ───────────────────────  │
│ Yapay Zeka         │ EK Elif · 14:32 ⋯ │    │ EK Elif Kaya · 14:32       ⋯   │
│ Arayüz Tasarımı    │ Not metni…        │    │ Not metni…                     │
│ Tüm bölümler       │ ┌ ek ──────┬────┐ │    │ ┌ görsel ────────────────────┐ │
│                    │ │ başlık   │grsl│ │    │ │ başlık                     │ │
│ [ Paylaş ]         │ └──────────┴────┘ │    │ └────────────────────────────┘ │
│ Yönetim            │ ♡ 3  ◯ 2  ⧉  ↗    │    │ ♡ 3  ◯ 2  ⧉  ↗                 │
│                    │ ───────────────── │    ├────────────────────────────────┤
│ EK Elif Kaya     ⋯ │                   │    │ Akış Bölümler Paylaş Ara Profil│
└────────────────────┴───────────────────┘    └────────────────────────────────┘
(▓ = limon dolgu + mürekkep metin)
```

#### Ray (`≥ 768px`)

Yukarıdan aşağı: marka ("İzgah" kelime işareti, `800` ağırlık, `/` bağlantısı); site içi arama formu (yalnız `≥ 1024px`; `<search aria-label="Site içi arama">`, görünmez etiketli "İzgah içinde ara" alanı, bölüm sayfasında "Bu Bölüm" onay kutusu, "Ara" düğmesi; `/search` sayfasında ray formu çizilmez, sayfanın kendi formu kullanılır; `768–1023px`'te "Ara" ikon bağlantısı `/search`'e gider); `<nav aria-label="Ana gezinme">` içinde "Akış" ve "Bölümler" listesi (`sort_order`; son öğe "Tüm bölümler" → `/sections`; ikon-rayda liste tek "Bölümler" ikonuna iner); `NotificationBell`; birincil "Paylaş" düğmesi; admin için doğrudan "Yönetim" bağlantısı (menüye gizlenmez, m7 testi); en altta hesap menüsü (`PopoverPanel`: Ayarlar, API anahtarları, Tema seçimi, Çıkış). Aktif öğe `aria-current="page"` + limon dolgu taşır.

#### Mobil Üst Çubuk ve Alt Sekme Çubuğu (`< 768px`)

*   Aynı `<header class="site-header">` yapışkan üst çubuğa dönüşür ve yalnız marka ile `NotificationBell`'i gösterir (aynı DOM düğümü; sabit `#notification-bell-popover` kimliği ve tek yoklayıcı korunur). "Ara" üst çubukta yer almaz, yalnız alt sekme çubuğundadır. Raydaki gezinme listesi, arama formu, "Paylaş" ve hesap menüsü bu genişlikte `display: none` olur.
*   Alt sekme çubuğu ayrı bir `<nav aria-label="Ana gezinme">`'dir ve yalnız `< 768px`'te görünür; raydaki `nav` bu genişlikte erişilebilirlik ağacından çıktığı için her genişlikte tek bir "Ana gezinme" vardır. Öğeler: Akış (`/`), Bölümler (`/sections`), Paylaş, Ara (`/search`), Profil (`/settings`). Her öğe ikon + görünür kısa etikettir.
*   "Paylaş" öğesi `<form method="get" action="/"><input type="hidden" name="compose" value="1"><button aria-label="Link Paylaş">` biçimindedir: JS'siz `/?compose=1` açar (satır içi forma odaklanır), JS'li `ComposerController.open()` çağırır.
*   `/settings` mobilde hesap menüsünün işlevini üstlenir: Görünüm (tema, kısayollar), API anahtarları bağlantısı, admin için "Yönetim" ve "Çıkış".
*   `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`; çubuk `padding-bottom: env(safe-area-inset-bottom)` taşır; içerik alt boşluğu `--tab-bar-h` kadardır.
*   Metin alanı odaktayken sanal klavyenin üstüne binmemesi için `body:has(:is(input, textarea, select, [contenteditable="true"]):focus) .tab-bar { display: none; }`.

#### Yeni `/sections` Dizini

[`src/routes/(app)/sections/+page.svelte`](../../src/routes/(app)/sections/+page.svelte) ve `+page.server.ts`: `h1` "Bölümler", bölümleri `sort_order ASC, name ASC` sırasıyla ad (bağlantı) ve açıklamayla listeler; admin için "Bölümleri yönet" → `/admin/sections`. Paylaşım sayısı veya son paylaşım tarihi gösterilmez; ek sorgu yapılmaz, düzen yükleyicisindeki bölüm listesi yeniden kullanılır. Sayfa JS'siz çalışır. Alt sekme çubuğunda `/sections` ve `/sections/*` için "Bölümler" aktif görünür.

### 7. Gönderi Anatomisi (İnsan Önce)

Kaynak sırası görsel sıradır; CSS `order` kullanılmaz (çekirdek §8.1 kuralı korunur).

```text
<article class="share-card" id="share-{id}" tabindex="-1" aria-labelledby="share-{id}-author share-{id}-title">
├─ header.post-head
│   Avatar(aria-hidden) · strong#share-{id}-author "Elif Kaya"
│   · a[href="/resources/{rid}#share-{id}"] > time[datetime] "14:32"  (mono; görünmez önek "Paylaşım zamanı: 18 Kasım")
│   · bölüm etiketleri (.tag bağlantıları) · [Sessiz] · [Önizleme hazırlanıyor]
│   · .unseen-mark + görünmez "Yeni" (görülmemişse)
│   · PostMenu ⋯ (aria-label "Paylaşım işlemleri")
├─ div.post-note       not; 6 satır sınırı + "Devamını göster" (yalnız taşarsa, aria-expanded)
├─ div.link-attachment (container-type: inline-size)
│   h3#share-{id}-title > a[href=raw_url][target=_blank][rel="noopener noreferrer"]  ← genişletilmiş bağlantı (::after inset 0)
│   p.meta (mono): alan adı · tür · sağlayıcı meta (★ yıldız, dil, yazar)
│   p.desc: açıklama, 2 satır sınırı
│   img.card-thumbnail (1200/630, loading/fetchpriority sıra sınıfına göre)
├─ p.first-share       "İlk paylaşan: Ayşe · 3 gün önce" → /resources/{rid}#share-{ilk} | "Orijinal gönderi silindi"
└─ footer.post-actions  Beğen (aria-pressed, mono sayaç) · Yorumlar (sayaç) → /resources/{rid}#comments
                        · Bağlantıyı kopyala · Aç ↗ (yeni sekme)
```

*   **Bağlantı eki:** Kutunun tamamı tek dış bağlantıdır; ancak bağlantının erişilebilir adı yalnız başlıktır (genişletilmiş bağlantı deseni: `h3 > a::after { position: absolute; inset: 0 }`), açıklama ve meta ekran okuyucuda ayrı paragraf olarak okunur. Başlık yoksa alan adı başlık olarak kullanılır. Kapsayıcı `≥ 440px` ise görsel sağda `176px` genişlikte, daha darsa ekin üstünde tam genişlikte durur; oran her durumda `1200 / 630`'dur. Görselsiz ekte görsel sütunu ayrılmaz (`:has()` + `@supports not selector(:has(*))` yedeği, çekirdek kuralı ek kutusuna taşınır).
*   **Not:** Notsuz gönderide başlıktan doğrudan eke geçilir. Not `-webkit-line-clamp: 6` ile kısaltılır; "Devamını göster" düğmesi yalnız taşma varsa (JS ölçümü) gösterilir; JS'siz tam not görünür.
*   **Avatar:** Diğer üyeler için `surface` zemin + `1px` `line` + mürekkep monogram; kendi gönderin limon dolgu + `on-signal` monogram. Kullanıcı başına renk üretilmez (tek vurgu kuralı).
*   **Odak ve hover:** `:hover` ve `:focus-within` gönderiye `surface` zemin tonu verir; `j`/`k` ile odaklanan `<article>` §3 odak halkasını alır.
*   **İçerik görünürlüğü:** İlk 5 gönderi dışındakiler `.is-deferred` sınıfıyla `content-visibility: auto; contain-intrinsic-size: auto none auto 240px` alır. Gün grupları `nth-child` sayacını her grupta sıfırladığı için sınıf `feed-state` içindeki genel sıradan atanır; ilk görselli gönderi `fetchpriority="high"`, diğerleri `loading="lazy"` alır.
*   **Başlık hiyerarşisi:** Sayfa `h1` → gün `h2` → ek başlığı `h3`.

### 8. Etkileşimler

#### 8.1 Satır İçi Paylaşım, Yapıştırarak ve Sürükle-Bırakla Paylaş

*   **Satır içi form:** `/` ve `/sections/[slug]` başında `FeedView` içinde `InlineComposer` (`<form method="post" action="?/createShare">`). Kapalı durumda tek satırdır: avatar, URL alanı (yer tutucu `"Bir bağlantı yapıştır…"`) ve "Paylaş" gönder düğmesi. Form `:focus-within` veya `:has(input[name="url"]:not(:placeholder-shown))` olduğunda CSS ile genişler (JS'siz de çalışır): erken çift kontrol paneli (`.conflict-box`), not alanı (`field-sizing: content` aşamalı, en fazla 8 satır), bölüm onay kutuları, içerik türü seçimi ve yalnız admin için sessiz seçenek. Bölüm sayfasında o bölüm ön seçilidir ve başarılı gönderimden sonra yeniden uygulanır. `/?compose=1` satır içi URL alanını odaklar; düzendeki eski JS'siz composer yedeği silinir (aksi halde iki form oluşur).
*   **Sessiz seçenek etiketi (normatif):** `"Ana akışta yayınlama (yalnızca seçili bölümlere sessiz ekle)"` — çekirdek CUJ 4 metni; web kodundaki sapma (F17) B4'te bu metne hizalanır.
*   **Gönderim:** Not alanında `Ctrl/⌘ + Enter` formu gönderir (değiştirici tuşlu, WCAG 2.1.4 kapsamı dışında). `ShareForm` başarı ve hata durumunda `applyAction` çağırmayan özel bir `SubmitFunction` kullanır (aksi halde `page.form` düzendeki dialoga sızar); başarıda dönen yeni gönderi `feed-state`'e eklenir, form sıfırlanır, odak URL alanında kalır ve `Toaster` `"Paylaşıldı"` + "Göster" bağlantısı (`#share-{id}`) duyurur.
*   **Diğer sayfalar:** `/resources/[id]`, `/search`, `/settings` ve `/admin/*` üzerinde aynı `ShareForm` çekirdeği mevcut `#share-composer-dialog` içinde açılır.
*   **`ComposerController` hedef kuralı (Karar 1):** Ray "Paylaş", alt sekme çubuğu "Paylaş", `n`, yapıştırma ve sürükle-bırak aynı kuralı izler. Tetikleme anında kayıtlı bir satır içi form varsa ve formun kenar kutusu (`getBoundingClientRect()`) **tamamen** görünür bölgenin içindeyse hedef satır içi formdur; aksi halde (form yok, kısmen görünür veya görünmez) `<dialog>` açılır. Görünür bölge, `visualViewport` (yoksa `innerHeight`) yüksekliğinden yapışkan üst çubuk (`--sticky-top`) ve alt sekme çubuğu (`--tab-bar-h`) çıkarılarak hesaplanır. Yarım görünen alana `focus()` verilmesi sayfayı kaydıracağı için eşik "tamamen görünür"dür; satır içi forma odak ayrıca `focus({ preventScroll: true })` ile verilir. Durum eşzamansız `IntersectionObserver` girdisinden değil, tetikleme anında eşzamanlı ölçümden okunur (bir kare gecikmeli eski durum riskini önler).
*   **Yapıştırarak paylaş (aşamalı geliştirme):** `document` üzerindeki `paste` dinleyicisi hedef düzenlenebilir bir öğe değilse (`input`, `textarea`, `select`, `isContentEditable`) `clipboardData.getData('text/plain')` metninden [`src/lib/links/parse-url.ts`](../../src/lib/links/parse-url.ts) `extractFirstUrlFromText` ile ilk `http(s)` adresini çıkarır. Adres bulunursa `preventDefault()`, form doldurulur (kalan metin not önerisi olur), çift kontrol çalışır, odak not alanına geçer ve canlı bölge `"Bağlantı forma eklendi: <alan adı>"` duyurur; adres yoksa hiçbir şey yapılmaz. Bir dialog veya popover açıkken çalışmaz. Safari `paste` olayını yalnız düzenlenebilir bağlamda tetiklediğinden bu davranış Chrome ve Firefox'a özgüdür; satır içi URL alanı her tarayıcıda çalışır.
*   **Sürükle-bırak:** Yalnız `dataTransfer.types` içinde `text/uri-list` olup `Files` olmayan sürüklemelerde içerik sütununda `2px` kesikli mürekkep çerçeveli bırakma alanı gösterilir (blur yok); bırakıldığında `text/uri-list`'in yorum (`#`) olmayan ilk satırı aynı akıştan geçer. Dosya sürüklemelerine dokunulmaz.

#### 8.2 Klavye Kısayolları

Kısayollar düzendeki tek `<svelte:window onkeydown>` dinleyicisi ve sayfa başına bağlam kaydıyla çalışır. Tuşlar fiziksel tuş koduyla (`event.code`) değil `event.key` ile eşlenir; böylece Türkçe Q ve Türkçe F düzenlerinde harfler yerleşimden bağımsız çalışır.

| Tuş | Eylem | Bağlam | Not |
| :--- | :--- | :--- | :--- |
| `j` / `k` | Sonraki / önceki gönderiye odaklan | Akış, bölüm, arama sonuçları | Gönderiler `tabindex="-1"`; Tab sırası değişmez; son gönderide `j` "Daha fazla yükle" düğmesine odaklanır, otomatik yüklemez |
| `o` / `Enter` | Bağlantıyı yeni sekmede aç | Odak gönderi `<article>`'ının kendisindeyken | `window.open(url, '_blank', 'noopener,noreferrer')`; odak içteki bir düğmedeyse `Enter` yerel davranışını korur |
| `l` | Beğen / beğeniyi geri al | Odaklı gönderi | `event.repeat` yok sayılır; sonuç duyurulur |
| `c` | Yorumlara git | Odaklı gönderi | `/resources/{id}#comments` |
| `/` | Aramaya git | Tüm uygulama sayfaları | Ray formu görünürse ona odaklanır, değilse `/search`'e gidip alanı odaklar; `preventDefault()`. Türkçe Q'da `Shift + 7` |
| `n` | Paylaş | Tüm uygulama sayfaları | `ComposerController.open()`; `preventDefault()` |
| `?` | Kısayol yardımı | Tüm uygulama sayfaları | `#keyboard-help-dialog`; yalnız o sayfada geçerli kısayolları listeler. Türkçe Q'da `Shift + *` |
| `Ctrl/⌘ + Enter` | Formu gönder | Paylaşım not alanı | Değiştiricili; kapatma anahtarından etkilenmez |

*   **Çalışmadığı durumlar:** Hedef düzenlenebilir bir öğe (`input`, `textarea`, `select`, `contenteditable`, `[role="textbox"]`) ise; `event.isComposing` veya `keyCode === 229` (IME bileşimi) ise; `event.defaultPrevented` ise; `Ctrl`, `Meta` veya `Alt` basılıysa (Windows AltGr = `Ctrl + Alt` dahil); bir `dialog:modal` veya `:popover-open` öğe varsa; kısayollar kapalıysa.
*   **Shift:** `Shift` engellenmez (Türkçe Q'da `/` ve `?` Shift gerektirir). Harf kısayolları `Shift` ile basıldığında yok sayılır; Caps Lock açıkken gelen büyük harf (`Shift` basılı değil) küçük harfe indirgenir.
*   **Kapatma anahtarı (WCAG 2.1.4):** "Tek tuşlu kısayollar" anahtarı hem `?` penceresinde hem `/settings` "Görünüm" bölümündedir; tercih `localStorage` `izgah:shortcuts` (`on` | `off`, varsayılan `on`) içinde cihaz başına tutulur; sunucuya yazılmaz (Karar 5). Kapalıyken raydaki `kbd` ipuçları da gizlenir (`html[data-shortcuts="off"]`); ipuçları hidrasyondan önce varsayılan olarak gizlidir.
*   **Ekran okuyucu:** Tarama (browse) kipindeki ekran okuyucular tuşları sayfaya iletmez; odak kipinde çakışma olursa kapatma anahtarı çözümdür.

#### 8.3 Gün Grupları

*   Gruplama `feed-state`'in birleştirilmiş listesinden yapılır ("Daha fazla yükle" sonrasında da sürekli). `dayKey`, `Intl.DateTimeFormat` `formatToParts` ile `timeZone: 'Europe/Istanbul'`, `hourCycle: 'h23'` kullanılarak `YYYY-MM-DD` biçiminde üretilir; `todayKey` sunucuda `load` içinde hesaplanıp sayfaya verilir; böylece SSR ve hidrasyon (istemcinin saat dilimi farklı olsa bile) aynı sonucu verir.
*   Etiketler sabit Türkçe dizilerle üretilir (ICU farklarından bağımsız): fark `0` → "Bugün", `1` → "Dün", `2–6` → gün adı ("Salı"), daha eski → "18 Kasım", farklı yıl → "18 Kasım 2025". Gönderi zamanı yalnız saat ve dakikadır (`14:32`), tam tarih `time[datetime]` ve görünmez önekte bulunur.
*   Her grup `<section aria-labelledby>` + yapışkan `h2.day-heading` + `<ol class="feed-list">` biçimindedir. Yapışkan başlık mobilde üst çubuğun altına (`top: var(--header-h)`), masaüstünde `top: 0` konumlanır.

#### 8.4 Son Ziyaret Ayırıcısı

*   **Saklama:** `localStorage` anahtarı `izgah:lastSeen:<scope>` (`feed` veya `section:<id>`); değer görülen en yeni gönderinin sunucu `createdAt` ISO dizgisidir. Değer yalnız `$effect` içinde okunur (SSR'da yoktur); `localStorage` erişilemezse (gizli kip, kota) özellik sessizce kapanır.
*   **Gösterim:** Yalnız imleçsiz ilk sayfa görünümünde ve listede hem görülmemiş hem görülmüş en az bir gönderi varsa çalışır. `createdAt > lastSeen` olan ve **kendi gönderin olmayan** gönderiler `.unseen-mark` + görünmez "Yeni" alır. Görülmüş ilk gönderi `.is-first-seen` sınıfı alır: üst saç çizgisi `2px` mürekkep çizgiye dönüşür ve üzerine mutlak konumlu mono "SON ZİYARETİN · 18:40" etiketi (ekran okuyucu için görünmez "Son ziyaretinden önceki gönderiler buradan başlar" metniyle) çizilir. Ayırıcı yeni satır eklemediği için hidrasyon sonrası düzen kayması yoktur.
*   **Güncelleme:** `visibilitychange` (`hidden`) ve `pagehide` olaylarında değer listedeki en yeni gönderinin `createdAt`'ine ilerletilir (asla geriye alınmaz). İlk ziyarette ayırıcı gösterilmez, yalnız değer yazılır. Sunucuya okundu bilgisi yazılmaz.

#### 8.5 Yeni Paylaşım Balonu

*   **Koşullar:** Yalnız `FeedView` içinde, imleçsiz (`?cursor=` olmayan) ilk sayfa görünümünde, `document.visibilityState === 'visible'` iken `visibility-poller` ile 60 saniyede bir (görünür olunca son sorgudan en az 15 saniye geçmişse hemen) `GET /api/internal/feed/updates` çağrılır (§10). `afterId` listedeki en yeni gönderinin kimliğidir; `section` ve `type` mevcut görünümün süzgecidir.
*   **Gösterim:** `newCount > 0` ise içerik sütununun üstünde yapışkan, mürekkep dolgulu, `4px` köşeli `<button class="new-posts-pill">` belirir: limon kare + `"3 yeni paylaşım"` (`newCount ≥ 100` ise `"99+ yeni paylaşım"`). Balon görünür hale geldiğinde (`0 → n`) paylaşılan canlı bölge bir kez duyurur; sonraki artışlar metni sessizce günceller.
*   **Tıklama:** `invalidate('app:feed')` → `merge` kuralları (25'ten fazla yeni öğe geldiyse liste sıfırlanır) → sayfa başına kaydırma → odak ilk yeni gönderinin `<article>`'ına → `"3 yeni paylaşım yüklendi"` duyurusu → balon gizlenir.
*   **Durma ve geri çekilme:** `401` veya `403` yanıtında yoklama sayfa değişene kadar durur; `404` (bölüm veya `afterId` bulunamadı) yoklamayı durdurur; ağ hatası ve `5xx` aralığı ikiye katlayarak en fazla 5 dakikaya çıkarır. Kendi paylaşımın sayılmaz.

#### 8.6 Akış Durumu, Beğeni ve Önizleme Yenilemesi

*   `feed-state` her `FeedView` örneğinde oluşturulur ve bağlamla paylaşılır; modül düzeyinde örnek yoktur (SSR'da kullanıcılar arası sızıntıyı önler). `$state.raw` + değişmez yamalar kullanılır; kurucuda senkron tohumlanır; sonraki `data` değişimleri tek `$effect.pre` içinde sorgu anahtarına (`pathname + type`) göre sıfırlanır veya `merge` ile birleştirilir; Geri gezinmesi için `export const snapshot`.
*   `merge` kuralları: yenilenen ilk sayfada bulunmayan eski öğe yalnız o sayfanın zaman penceresindeyse düşer (silinmiş sayılır), daha eskiler kalır; son eklenen sayfanın `nextCursor` değeri korunur. Böylece beğeni, düzenleme ve 3 saniyelik önizleme yenilemesi "Daha fazla yükle" sayfalarını silmez (F1).
*   Beğeni iyimser ve idempotenttir (`liked=true|false` gönderilir, dönen `liked/likeCount` uygulanır, hata `Toaster` ile bildirilir, `invalidate` yapılmaz). Kaynak başına beğeni katmanı düzen düzeyinde küçük bir bağlamdadır; arama ve kaynak sayfası da aynı katmanı kullanır.
*   Silmeden sonra odak sonraki gönderiye (yoksa sayfa `h1`'ine), son sayfa yüklemesinden sonra ilk yeni gönderiye taşınır (F13). Gezinmede `h1` odaklaması `preventScroll: true` ile yapılır; URL'de hash varsa hedef odaklanır; `popstate` gezinmelerinde başlık odaklaması atlanır (F2).

### 9. Tema Çerezi (`izgah_theme`)

*   **Değerler:** `light` | `dark` | `system`; çerez yoksa veya değer geçersizse `system`.
*   **Çerez:** `izgah_theme=<değer>; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly; Secure` (`Secure` bayrağı [`better-auth.ts`](../../src/lib/server/auth/better-auth.ts) `useSecureCookies` ile aynı koşula bağlıdır). İstemcinin çerezi okuması gerekmez.
*   **Sunucu:** [`src/hooks.server.ts`](../../src/hooks.server.ts) mevcut `handle`'ın en başında `resolve`'u bir kez sarmalar (`sequence()` kullanılmaz; entegrasyon testleri `handle`'ı doğrudan çağırır). Sarmalayıcı `transformPageChunk` ile [`src/app.html`](../../src/app.html) içindeki `<html lang="tr" data-theme="%izgah.theme%">` yer tutucusunun ilk eşleşmesini değiştirir ve aynı yerde §2 yazı tipi ön yüklemesini (`preload`) ekler.
*   **CSS:** Semantik token'lar `light-dark(var(--light-*), var(--dark-*))` ile tanımlanır; mod yalnız `color-scheme`'i çevirir: `system` → `light dark`, `light` → `light`, `dark` → `dark`.
*   **Ek temalar:** Açık/koyu palet ve vurgu rengi `data-light-theme`, `data-dark-theme`, `data-accent` öznitelikleri ve `izgah_theme_light`, `izgah_theme_dark`, `izgah_accent` çerezleriyle aynı yoldan uygulanır; ayrıntılar [izgah-themes.md](./izgah-themes.md) §3–§4.
*   **Eylem:** `/settings?/setTheme` (`theme`, `returnTo`). Değer doğrulanır; `returnTo` ortak `sanitizeInternalPath` (Faz 1, S1) ile temizlenip `303` yönlendirilir. JS'li geçişte `use:enhance` sayfayı yeniden yüklemez, `document.documentElement.dataset.theme` istemcide güncellenir. Seçici hesap menüsünde ve `/settings` "Görünüm"de üç seçenekli radyo grubudur ("Sistem", "Açık", "Koyu").
*   **Neden çerez:** `localStorage` + satır içi betik yaklaşımı hem JS'siz çalışmaz hem de CSP'de satır içi betik istisnası gerektirir (bkz. Alternative D).

### 10. `GET /api/internal/feed/updates` Sözleşmesi

| Alan | Değer |
| :--- | :--- |
| Dosya | [`src/routes/api/internal/feed/updates/+server.ts`](../../src/routes/api/internal/feed/updates/+server.ts) + ortak [`src/lib/server/feed/query.ts`](../../src/lib/server/feed/query.ts) (`feedScopeConditions({ sectionId, type })`, `_loadFeedPage` ile paylaşılır) |
| Kimlik doğrulama | Çerez oturumu; mevcut iç uç koruması (`Origin` veya `Sec-Fetch-Site: same-origin`); oturumsuz `401`, köken uyuşmazlığı `403` |
| Sorgu parametreleri | `afterId` (isteğe bağlı paylaşım kimliği), `section` (isteğe bağlı bölüm kimliği), `type` (isteğe bağlı `video` \| `repo` \| `social` \| `article` \| `web`) |
| Başarılı yanıt | `200 OK` — `{ "newCount": number }` (`0–100`); `Cache-Control: no-store` |
| Hatalar | `400 VALIDATION_ERROR` (geçersiz `type` veya biçimsiz kimlik), `401`, `403`, `404 NOT_FOUND` (bölüm veya `afterId` paylaşımı yok); gövde iç API JSON hata zarfıdır (`requestId` dahil) |

*   **Anlam:** `afterId` paylaşımının `(created_at, id)` değeri sunucuda okunur (yumuşak silinmiş olsa da satır mevcuttur) ve `(created_at, id) > (anchor.created_at, anchor.id)` olan, `deleted_at IS NULL`, `author_id <> me` ve kapsam koşullarını sağlayan paylaşımlar sayılır. Ana akış kapsamı `is_feed_visible = true`, bölüm kapsamı o bölüme bağlı tüm aktif paylaşımlar (sessizler dahil, bölüm sayfasıyla aynı), `type` kaynağın `content_type` değeridir. `afterId` yoksa (boş akış) kapsamdaki tüm paylaşımlar sayılır.
*   **Neden `afterId`:** ISO zaman damgası kullanılmaz; `created_at` mikro saniye hassasiyetindedir, `toISOString()` milisaniyeye düşürür ve sınırdaki satırlar kaçabilir (D6 ile aynı kök neden).
*   **Maliyet:** Sayım `SELECT count(*) FROM (… LIMIT 100) s` biçimindedir; mevcut `(is_feed_visible, created_at DESC, id DESC)` kısmi indeksi ve `(section_id, share_id)` indeksi yeterlidir, yeni indeks eklenmez (A2'de bir kez `EXPLAIN` ile doğrulanır). 15 üye × görünür sekme × dakikada 1 istek ihmal edilebilir yüktür; ek hız sınırı tanımlanmaz.

### 11. Güvenlik Başlıkları ve İçerik Güvenliği Politikası (CSP)

*   **Faz 1 (S3) — yalnız sabit başlıklar:** Hook tüm HTML yanıtlarına `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` ve `Referrer-Policy: strict-origin-when-cross-origin` ekler (`?token=` sayfalarındaki `no-referrer` korunur). Faz 1'de `kit.csp` **yapılandırılmaz**; rapor modu (`reportOnly`) kullanılmaz (Karar 2).
*   **Rapor modu neden yok:** SvelteKit `2.70.4` rapor modundaki politikayı `report-uri` veya `report-to` olmadan reddeder (`csp.js:341-348`); bu da oturumsuz, açık bir rapor alıcı ucu gerektirirdi. Bunun yerine doğrulama üretim imajına karşı koşan duman testine bırakılır ve `POST /csp-report` ucu eklenmez.
*   **Faz 8 — doğrudan zorunlu mod:** [`svelte.config.js`](../../svelte.config.js) `kit.csp` `mode: 'auto'` (SSR sayfalarında nonce, ön derlenmiş sayfalarda hash) ve aşağıdaki `directives`:

```text
default-src 'self';
script-src 'self';                 # Kit hidrasyon betiğine nonce ekler; 'strict-dynamic' yok
style-src 'self' 'unsafe-inline';  # Svelte style:/geçiş satır içi stilleri ve app.html display:contents
img-src 'self' data:;
font-src 'self';
connect-src 'self';
object-src 'none';
base-uri 'none';
form-action 'self';
frame-ancestors 'none';
```

*   `upgrade-insecure-requests`, `report-uri` ve `report-to` eklenmez (TLS Dokploy vekilinde sonlanır; rapor alıcısı yoktur). `X-Frame-Options: DENY`, `frame-ancestors` desteklemeyen eski istemciler için kalır.

#### CSP Duman Testi: Nerede ve Ne Zaman Koşar

Normal E2E paketi (`pnpm test:e2e`) `vite dev` üzerinde koşar; geliştirme sunucusu betik ve stilleri üretimden farklı enjekte ettiği için CSP ihlallerini güvenilir biçimde göstermez. CI iş akışı yalnız `lint`, `check` ve `test` çalıştırır, E2E koşmaz. Bu nedenle CSP doğrulaması şöyle yapılır:

*   **Nerede:** Mevcut üretim imajı testi [`tests/e2e/m8-docker-smoke.spec.ts`](../../tests/e2e/m8-docker-smoke.spec.ts) içine eklenen bir CSP senaryosu. `pnpm test:docker` önce `docker build` ile üretim imajını derler, sonra senaryoyu `PLAYWRIGHT_DOCKER_SMOKE=1` ile çalışan konteynere karşı koşar.
*   **Ne denetler:** `context.addInitScript` ile `securitypolicyviolation` olaylarını `window` üzerinde bir diziye toplar; oturumsuz (`/login`, geçersiz jetonla `/auth/accept-invite` ve `/auth/reset-password`, hata sayfası) ve admin oturumuyla (`/`, `/sections`, bir `/sections/[slug]`, bir `/resources/[id]`, `/search?q=…`, `/settings`, `/settings/api-keys`, her `/admin/*` sayfası) ana rotaları gezer; bu sırada paylaşım dialogunu, bir popover'ı, tema değişimini ve kart → kaynak detay View Transition'ını tetikler. Her yanıtta `Content-Security-Policy` başlığının bulunduğunu ve toplanan ihlal sayısının **sıfır** olduğunu doğrular.
*   **Ne zaman:** (1) Faz 8'de `kit.csp.directives`'i açan commit, aynı commit'teki bu senaryo yerelde `pnpm test:docker` ile geçmeden `main`'e gönderilmez (Dokploy `main`'i doğrudan yayınlar). (2) Sonrasında `svelte.config.js`, `src/app.html`, `src/hooks.server.ts`, genel stiller veya yazı tipleri değiştiğinde ya da yeni satır içi betik/stil veya dış kaynak eklendiğinde `main`'e göndermeden önce. (3) Mevcut kurala göre her yayın öncesi `pnpm test:docker` adımında.
*   **Kapsam dışı:** Docker duman testini CI'a ayrı bir iş olarak eklemek bu dokümanın kapsamında değildir; ileride eklenirse yukarıdaki (2) ve (3) maddeleri otomatikleşir.

### 12. Sabit E2E Kancaları ve Erişilebilir Adlar

E2E seçici güncellemeleri markup değişikliğiyle **aynı commit'te** yapılır; sona bırakılmaz.

**Değişmeyecek CSS/DOM kancaları:**

| Kanca | Taşıyan öğe |
| :--- | :--- |
| `article.share-card` (+ `id="share-{id}"`) | `PostCard` kökü |
| `#share-composer-dialog` | `ShareComposerDialog` |
| `#main-content h1` | Her sayfanın `h1`'i (`tabindex="-1"`) |
| `#notification-bell-popover` | Tek `NotificationBell` paneli |
| `.notification-badge` | Okunmamış bildirim sayacı |

**Değişmeyecek erişilebilir adlar:**

| Rol | Ad | Not |
| :--- | :--- | :--- |
| `button` | "Link Paylaş" | Görünür metin "Paylaş" ise `aria-label="Link Paylaş"` (WCAG 2.5.3: görünür etiket adın içinde) |
| `navigation` | "Ana gezinme" | Her genişlikte tek örnek erişilebilirlik ağacında (§6) |
| `button` | "Paylaşım işlemleri" | `PostMenu` tetikleyicisi |
| `button` | "Daha fazla yükle" | Akış sayfalaması |
| `navigation` | "İçerik türü süzgeci" | `FeedFilterBar` |
| `search` | "Site içi arama" | Ray arama formu (`≥ 1024px`) |
| `textbox` (etiket) | "İzgah içinde ara" | Ray arama alanı |
| `button` | "Bildirimler" (sayaçlı ad desenle eşleşir) | `NotificationBell` tetikleyicisi |
| `link` | "Yönetim" | Admin için rayda doğrudan görünür |
| `heading` | "Ana Akış" | `/` sayfa `h1`'i |

"Paylaş" (satır içi gönder düğmesi) ve "Link Paylaş" aynı sayfada bulunduğundan testler `exact: true` kullanır.

**Bilinçli olarak değişen ve ilgili commit'te güncellenecek kancalar:** `article.share-card > img.card-thumbnail` → `article.share-card .link-attachment img.card-thumbnail` (sınıf adı korunur, görsel ekin içine taşınır; m5, m8); `.site-header.is-wide` sınıf kontrolü kaldırılır (ölçüm mantığı yok; m6); m5 "Link Paylaş" → `#share-composer-dialog` akışları Karar 1'e göre aşağıdaki gibi yeniden düzenlenir. `.inline-card-panel`, `.conflict-box`, `.comment-list`, `#delete-comment-dialog`, `.search-summary`, `#new-api-key-value` korunur.

**Paylaşım senaryolarının taşınması (Karar 1):**

*   `/` ve `/sections/[slug]` üzerindeki paylaşım senaryoları (CUJ 2 web paylaşımı, erken çift kayıt uyarısı, önizleme güncellemesi, CUJ 4 admin sessiz ekleme ve üye terfisi) satır içi formu kullanır: sayfa başındayken "Link Paylaş"a tıklanır veya doğrudan satır içi URL alanı doldurulur; form alanları satır içi formun kapsamında (`main form[action="?/createShare"]` veya erişilebilir adlarla) seçilir.
*   Dialoga özgü senaryolar — `Esc` ile kapanış, kirli formda kapatma uyarısı ve odağın "Düzenlemeye devam et" düğmesinde kalması, `returnValue` sıfırlaması — dialogun hâlâ açıldığı `/resources/[id]` (tercihen) veya `/search` sayfasına taşınır ve `#share-composer-dialog` kancasını kullanmaya devam eder.
*   **Yeni senaryo:** Akışta satır içi form görünür alandan tamamen çıkacak kadar aşağı kaydırıldıktan sonra "Link Paylaş"a tıklamak ve `n` tuşuna basmak `#share-composer-dialog`'u açar ve kaydırma konumu değişmez; form kısmen görünürken de dialog açılır.

### 13. Diğer Ekranlar (Faz 6 İlkeleri)

*   **`/resources/[id]`:** `≥ 1024px` iki sütun: sol büyük önizleme + yorum dizisi, sağ paylaşım geçmişi zaman çizelgesi + bölümler; mobilde yorum formu yapışkan alt kenarda. Dosya bileşenlere bölünür.
*   **`/search`:** Kapsam ve tür süzgeçleri segment kontrolü görünümünde (`name` öznitelikleri hidrasyondan sonra korunur, F15); eşleşen terimler güvenli metin bölme ile `<mark>` (limon zemin + mürekkep) içinde vurgulanır (`{@html}` yok); 25 sonuç sınırının ötesine sayfalama; yönlendirici boş durum metni.
*   **`/settings`:** "Görünüm" (mod, açık/koyu tema ve vurgu rengi — [izgah-themes.md](./izgah-themes.md) §5 —, tek tuşlu kısayollar), parola; mobilde hesap menüsü işlevleri (§6). `/settings/api-keys` yeniden stillenir.
*   **`/admin/*`:** Ortak tablo ve durum çipi stilleri, admin alt gezinmesi, pasifleştirme ve bölüm düzenle/sil için JS'siz onay yedekleri (F8); başka davranış değişmez.
*   **`/login`, `/auth/accept-invite`, `/auth/reset-password`:** Bölünmüş düzen: mürekkep zeminli marka paneli (limon kelime işareti) + form; mobilde panel üst şeride iner. `main#main-content` ve `(app)/+error.svelte` + kök hata sayfası `<title>` ve eve dönüş bağlantısıyla (F14).

### 14. Eklenti Token Hizalaması (Faz 7)

[`extensions/src/styles/tokens.css`](../../extensions/src/styles/tokens.css) B1 token'ları dondurulduktan sonra Sinyal değerlerine geçer; popup/options davranışı ve [izgah-extensions.md](./izgah-extensions.md) içindeki tek katmanlı `prefers-color-scheme` tema kararı değişmez (eklenti farklı kökende çalıştığı için `izgah_theme` çerezini okuyamaz; sistem temasını izler).

| Eklenti token'ı | Mevcut (açık) | Sinyal karşılığı |
| :--- | :--- | :--- |
| `--color-bg` / `--color-surface` | `#f8fafc` / `#ffffff` | `--color-bg` `#FFFFFF` / `--color-surface` `#F5F5F5` |
| `--color-text` / `--color-text-muted` | `#0f172a` / `#475569` | `#0A0A0A` / `#5C5C5C` |
| `--color-link`, `--color-accent` | `#1d4ed8` | Bağlantı mürekkep + alt çizgi; vurgu `--color-signal` |
| `--color-focus` | `#1d4ed8` | `--color-focus-inner` + `--color-focus-outer` (§3 halkası) |
| `--color-primary` / `--color-primary-contrast` | `#0f172a` / `#ffffff` | `--color-signal` / `--color-on-signal` |
| `--color-border` / `--color-border-strong` | `#cbd5e1` / `#64748b` | `--color-line` / `--color-line-strong` |
| `--color-danger*` | `#b91c1c`, `#991b1b` | `--color-danger`, `--color-on-danger` |
| `--color-*-warn`, `--color-*-success` | Amber / yeşil tonlar | Kaldırılır: `surface` + `line-strong` + mürekkep metin + ikon |
| `--radius-sm/md/lg` | `0.375 / 0.5 / 0.75rem` | `2px / 4px / 4px` |
| `--font-sans` / `--font-mono` | `system-ui` / `ui-monospace` | Schibsted Grotesk (yalnız `latin` + `latin-ext` `wght-normal` paketlenir) / sistem mono yığını |

Eklenti paketine `OFL.txt` eklenir; `@fontsource-variable/schibsted-grotesk@5.3.0` `extensions/package.json` geliştirme bağımlılığı olur ve Firefox kaynak arşivi için lockfile güncel tutulur. Doğrulama: `pnpm verify:manifests` + eklenti `lint`, `check`, `test`, `test:e2e`.

### 15. `izgah-core.md` ile İlişki: Değişen ve Korunan Kurallar

Bu doküman onaylandığı için (2026-11-20) aşağıdaki **değişen** satırlar `izgah-core.md` içindeki karşılıklarının yerini alır; **korunan** satırlar çekirdek dokümanda geçerli kalır ve UI v2 uygulaması bunlara uymak zorundadır.

| # | Çekirdek kural (yer) | Durum | UI v2 kararı |
| :--- | :--- | :--- | :--- |
| 1 | Üst gezinme çubuğu + `< 960px` `ResizeObserver` kontrollü `popover="auto"` mobil çekmece (§8.3, M5 #27) | **Değişir** | Ray / ikon-ray / üst çubuk + alt sekme çubuğu; yalnız CSS kırılımları (`768`, `1024`); ölçüm kodu silinir (§6) |
| 2 | Renk/tipografi değişkenleri belirtilmemiş; uygulama yalnız açık tema (M5 #25) | **Değişir** | Sinyal açık/koyu token'ları, Schibsted + JetBrains Mono, `izgah_theme` çerezi (§1, §2, §9) |
| 3 | Görselli kartta yan görsel sütunu açan `.share-card:has(> .card-thumbnail)` ızgarası; bağlantı-merkezli kart (§8.1, M5 #25–#26) | **Değişir** | İnsan-önce gönderi; görsel `.link-attachment` içinde; `:has()` + `@container` kuralı ek kutusuna taşınır (§7) |
| 4 | Paylaşım yalnız `<dialog>` penceresinden; CUJ 2 "paylaşım penceresini açıp" (§8.2, CUJ 2) | **Değişir** | Akış sayfalarında satır içi form + yapıştır/bırak aşamalı geliştirmesi; diğer sayfalarda aynı dialog (§8.1) |
| 5 | Yalnız bildirim yoklaması (60 sn) ve önizleme yenilemesi (3 sn × 5) (§6, NFR) | **Genişler** | Akış görünümünde ek 60 sn `GET /api/internal/feed/updates` yoklaması, aynı görünür sekme kuralları; sekme başına en fazla 2 istek/dk (§8.5, §10) |
| 6 | `.feed-list > li:nth-child(n + 6)` ile `content-visibility` (M5 #25) | **Değişir (kural korunur)** | İlk 5 gönderi hariç tutulur; gün grupları nedeniyle genel sıra sınıfı `.is-deferred` (§7) |
| 7 | Her `pathname` değişiminde `h1`'e odak (§8.4, M5 #27) | **Değişir** | `preventScroll: true`, hash hedefi önceliği, `popstate`'te atlama (§8.6, F2) |
| 8 | Arka plan kaydırma kilidi yalnız containment/`overscroll-behavior` (§8.2) | **Genişler** | `html:has(dialog:modal) { overflow: hidden }` + aşamalı `scrollbar-gutter` (§3, F11) |
| 9 | Kart taşma eylemleri, filtre seçicileri ve bildirim özeti `popover="auto"`, `role="menu"` yok (§8.3) | **Korunur** | Mobil çekmece dışındaki tüm popover kullanımları ve anchor positioning yedeği aynen |
| 10 | Yerel `<dialog>`, `cancel` koruması, `closedby="any"` yedeği, Invoker Commands kopyalama (§8.2) | **Korunur** | `Dialog`/`PopoverPanel` API'si değişmez |
| 11 | Kart ↔ kaynak detay View Transitions, `prefers-reduced-motion` (§8.4) | **Korunur** | `active-resource-card` eşleşmesi `PostCard` ↔ `/resources/[id]` arasında |
| 12 | JS'siz yedekler `?compose=1`, `?edit=`, `?delete=`, `?editComment=`, `?deleteComment=` (§8.1) | **Korunur** | `?compose=1` satır içi formu odaklar; diğerleri `ShareNoJsFallbacks` |
| 13 | Kapak görseli `1200 / 630`; CSS `order` yok, doğal kaynak sırası (§8.1) | **Korunur** | §7 |
| 14 | Bildirim yoklaması: görünür sekme, 60 sn, `visibilitychange`'te en az 15 sn (§6) | **Korunur** | Ortak `visibility-poller` aynı kuralları uygular |
| 15 | CUJ 4 sessiz seçenek etiketi (CUJ 4) | **Korunur (normatif)** | Web kodundaki sapma (F17) B4'te doküman metnine hizalanır |
| 16 | Dokunma hedefi boyutu (çekirdekte açıkça yazılı değil) | **Yeni** | En az `24px`, kaba işaretçide `44px` (§3) |
| 17 | Güvenlik başlıkları ve CSP (çekirdekte yok) | **Yeni** | §11 |

#### Doküman ve Rapor Sapmalarının Düzeltilmesi

Önceki otomatik inceleme raporundaki ("No drift detected") bazı iddialar kodla örtüşmemektedir; bu doküman aşağıdaki gerçek durumu esas alır:

| İddia | Gerçek durum | Bu dokümandaki karşılık |
| :--- | :--- | :--- |
| CSP tüm yanıtlarda var | HTML yanıtlarında CSP, `frame-ancestors` ve `nosniff` yok (yalnız küçük görsel rotasında başlıklar var) | Faz 1 sabit güvenlik başlıkları; Faz 8 doğrudan zorunlu CSP (§11) |
| Küçük görseller `max-age=31536000` | Kod ve çekirdek doküman `86400` | Değişiklik yok |
| Giriş "IP başına" sınırlı | Kod `IP + e-posta`; çekirdek NFR `IP + hesap` | Giderildi: Faz 1 (S2) `IP + hesap` `10`, `IP` `30`, hesap `50` / 15 dk kovalarını uygular; çekirdek NFR ve plan satırları buna göre güncellendi |
| Mobil gezinme `< 960px` kırılımı | Kod ölçüm (`ResizeObserver`) tabanlı | Satır 1: CSS kırılımlarıyla değişir |
| Sessiz seçenek etiketi doküman metniyle aynı | `ShareComposerDialog.svelte`, `ShareCard.svelte` metni sapmış; eklenti doğru | Satır 15 |

Bundan sonra doküman veya rapor iddiaları kodla doğrulanmadan "gerçek" sayılmaz.

## Alternatives Considered

### Alternative A: "Pafta" Görsel Yönü

Harita/ölçüm paftası estetiği ("iz + gâh = izlerin yeri"): yeşim yeşili vurgu (`#0B7A5C`), dar Archivo başlıklar + IBM Plex Mono, lejant sembollü bölümler, keskin köşeler ve köşe işaretleri. Kavramsal olarak isme en bağlı yöndü; ancak lejant sembolleri ve pafta metaforu yeni üyeye öğrenme yükü getirir, yeşil vurgu "başarı" anlamıyla çakışır ve dar başlık yazı tipi uzun Türkçe notlarda okunurluğu düşürür. Kullanıcı tarafından seçilmedi.

### Alternative B: "Kobalt" Görsel Yönü

Doygun kobalt mavisi sol ray (`#1F2BD1`) + açık içerik zemini, Figtree, yuvarlak avatarlar, hap düğmeler ve büyük görselli kartlar. En sosyal ve sıcak yöndü; ancak en tanıdık olanıydı (genel sosyal/SaaS görünümüne en yakın), büyük görselli kartlar yoğunluğu ve "arşivde saniyede bul" hedefini zayıflatır, doygun ray içerikle rekabet eder. Kullanıcı tarafından seçilmedi.

### Alternative C: v1 Kabuğunu Koruyup Yalnız Renkleri Değiştirmek

Üst çubuk + "Menü" popover korunup token'lar Sinyal'e çevrilebilirdi. Bölümlerin gizlenmesi, mobilde başparmak erişimi olmaması ve `ResizeObserver` kaynaklı düzen kayması çözülmeyeceği için reddedildi.

### Alternative D: Temayı `localStorage` + Satır İçi Betikle Uygulamak

Yaygın "parlamasız tema" deseni `<head>` içinde satır içi betik gerektirir; bu, CSP'de hash/nonce istisnası ve JS'siz kullanıcıda çalışmayan bir tercih demektir. Sunucunun `transformPageChunk` ile yazdığı çerez tabanlı `data-theme` her iki sorunu da çözer.

### Alternative E: Yeni Paylaşımlar için SSE veya WebSocket

Gerçek zamanlı itme anlık sayaç sağlardı; ancak tek konteynerde uzun ömürlü bağlantı yönetimi, Dokploy vekilinde zaman aşımı ayarı ve yeniden bağlanma mantığı gerektirir. 10–15 kişilik ekipte 60 saniyelik görünür sekme yoklaması aynı faydayı ihmal edilebilir maliyetle sağlar.

### Alternative F: CSS Çerçevesi, Bileşen Kütüphanesi veya `light-dark()`

Tailwind veya hazır bileşen kütüphanesi tasarım dilini varsayılanlara geri çeker ve bağımlılık sınırını genişletir. `light-dark()` iki temalı token'ları kısaltırdı; ancak açık `data-theme` seçimini sistem tercihinden ayırmak için yine seçici gerekir ve özellik henüz "widely available" değildir. Medya sorgusu + `[data-theme]` seçicileri seçildi.

*Güncelleme (2026-11-22):* `light-dark()` 2026-11-13 itibarıyla Baseline "widely available" oldu; ek temalarla birlikte koyu paletlerin iki kez yazılmasını önlemek için token'lar `light-dark()`'a taşındı ([izgah-themes.md](./izgah-themes.md), Alternative B). Tailwind ve bileşen kütüphanesi reddi geçerlidir.

### Alternative G: CSP'yi Önce Rapor Modunda Yayınlamak

Rapor modu üretimde gerçek kullanıcı trafiğinden ihlal toplardı; ancak SvelteKit bu modda `report-uri`/`report-to` zorunlu tuttuğu için oturumsuz, açık bir rapor alıcı ucu (`POST /csp-report`) ve onun hız sınırı, boyut sınırı ve log gizliliği kurallarını gerektirir. 10–15 kişilik kapalı ekipte rotaların tamamı duman testiyle gezilebildiğinden bu ek saldırı yüzeyi reddedildi (Karar 2).

## Risks & Mitigations

| Risk | Etki | Önlem / Azaltma |
| :--- | :--- | :--- |
| Safari `paste` olayını düzenlenebilir olmayan bağlamda tetiklemez | "Her yerde yapıştır" Safari'de çalışmaz | Aşamalı geliştirme; satır içi URL alanı her tarayıcıda tek dokunuş; yardım penceresi bunu belirtir |
| CSP zorunlu modda Svelte satır içi stillerini, yazı tiplerini veya Kit betiklerini engeller | Üretimde bozuk görünüm veya çalışmayan hidrasyon | `style-src 'unsafe-inline'`; `.woff2` satır içine alınmaz; rapor modu olmadığından zorunlu mod yalnız m8 Docker CSP senaryosu üretim imajında sıfır ihlalle geçince `main`'e gider; sorun çıkarsa Dokploy'da `N-1` imajına dönülür |
| `localStorage` erişilemez (gizli kip, kota) | Son ziyaret ayırıcısı ve kısayol tercihi kaybolur | Tüm erişimler `try/catch`; özellik sessizce kapanır, akış etkilenmez |
| Tek tuşlu kısayollar yardımcı teknolojilerle çakışır | Klavye kullanıcısı istemeden eylem tetikler | Düzenlenebilir hedef, IME ve değiştirici kontrolleri; WCAG 2.1.4 kapatma anahtarı |
| E2E seçicilerinin geniş çaplı değişmesi | Regresyonların fark edilmemesi | Sabit kanca/ad listesi (§12); seçici güncellemeleri markup değişikliğiyle aynı commit'te |
| Eklenti Faz 7'ye kadar v1 renklerinde kalır | Kısa süreli görsel tutarsızlık | Token eşleme tablosu (§14) hazır; davranış değişmediği için risk yalnız görsel |
| Ek yoklama ucu | Sunucu yükü | `LIMIT 100` alt sorgu, mevcut indeksler, yalnız görünür sekme ve ilk sayfa; hata durumunda geri çekilme |

## Non-Functional Requirements

*   **Erişilebilirlik:** WCAG 2.2 AA; tüm metin çiftleri `≥ 4.5:1`, kontrol sınırları ve odak göstergesi `≥ 3:1` (§1 tablosu); yalnız klavyeyle tüm akışlar; `prefers-reduced-motion` ve Windows `forced-colors` desteği; canlı bölge duyuruları tek paylaşılan duyurucudan.
*   **Başarım:** Kabukta JS ölçümü yok; hidrasyon sonrası düzen kayması kaynağı yok (ayırıcı ve `kbd` ipuçları yer ayırmaz); yalnız iki `.woff2` ön yüklenir; uzun akışta `content-visibility`.
*   **JS'siz Çalışma:** Satır içi paylaşım, tema seçimi, `/sections`, gezinme ve tüm mevcut JS'siz yedekler çalışır; kısayollar, yapıştırma, son ziyaret ayırıcısı ve yeni paylaşım balonu yalnız aşamalı geliştirmedir.
*   **Gizlilik:** `localStorage` yalnız zaman damgası ve tercih tutar (kişisel veri yok); tema çerezi `HttpOnly`.
*   **Tarayıcı Desteği:** Chrome, Firefox ve Safari'nin son iki ana sürümü. Baseline "widely available" olmayan özellikler (View Transitions, anchor positioning, `content-visibility`, `field-sizing`, `scrollbar-gutter`, `text-wrap: balance/pretty`) yalnız aşamalı geliştirmedir.

--------------------------------------------------------------------------------

### Additional Resources

*   [izgah-core.md](./izgah-core.md) — Çekirdek platform; §6 ve §8'in değişen kuralları için §15'e bakın.
*   [izgah-extensions.md](./izgah-extensions.md) — Eklenti mimarisi; token hizalaması için §14.
*   [AGENTS.md](../../AGENTS.md) — Dil, tasarım dokümanı, `modern-web-guidance` ve tamamlanma kuralları.
*   [SITEMAP.md](./SITEMAP.md) — Doküman dizini ve planlanan rotalar.

## Detailed Implementation Plan

Doküman 2026-11-20'de onaylanmıştır; aşağıdaki adımlar bu dokümana göre uygulanır. Her adım kendi commit(ler)iyle biter ve AGENTS.md tamamlanma ölçütünden geçer: `pnpm lint`, `pnpm check`, `pnpm test` ve ilgili `pnpm test:e2e`; eklenti değiştiyse `extensions/` içinde `pnpm lint && pnpm check && pnpm test`. Ön yüz adımlarına başlamadan AGENTS.md gereği `npx modern-web-guidance@latest search "<ihtiyaç>"` + `retrieve` çalıştırılır (tema/renk şeması, self-host yazı tipi, roving focus + kısayollar, paste/drag-drop, yapışkan başlık, alt gezinme, container queries, view transitions).

**Sabit Bağımlılık Sınırına Eklenenler ([`package.json`](../../package.json) `devDependencies`):** `@fontsource-variable/schibsted-grotesk@^5.3.0`, `@fontsource-variable/jetbrains-mono@^5.3.0` (her ikisi `OFL-1.1`; kilit dosyası `5.3.0`'a sabitler). Yazı tipleri derleme sırasında `build/client` altına yayıldığından çalışma zamanı bağımlılığı değildir. Başka paket eklenmez; Lucide ikon yolları paketsiz kopyalanır (ISC).

| Adım | İz | Kapsam | Ana dosyalar | Bağımlılık |
| :--- | :--- | :--- | :--- | :--- |
| A1 | Sunucu | Tema çerezi, `setTheme` eylemi, yazı tipi ön yüklemesi | `src/hooks.server.ts`, `src/app.html`, `src/routes/(app)/settings/+page.server.ts`, `vite.config.ts` | Faz 1 `sanitizeInternalPath` |
| A2 | Sunucu | Ortak kapsam sorgusu ve yeni güncellemeler ucu | `src/lib/server/feed/query.ts`, `src/routes/api/internal/feed/updates/+server.ts`, `src/routes/(app)/+page.server.ts` | — |
| A3 | Sunucu/istemci | Ortak görünür sekme yoklayıcısı; bildirim zili taşınır (F16) | `src/lib/client/visibility-poller.ts`, `NotificationBell.svelte` | — |
| A4 | Saf modüller | `date` (`dayKey`, `dayLabel`, `todayKey`), `merge`, `group-by-day`, `paste`, `keyboard-filter` + vitest | `src/lib/format/date.ts`, `src/lib/feed/*.ts`, `src/lib/share/paste.ts`, `src/lib/client/keyboard-filter.ts` | Faz 1 `date.ts` |
| B1 | Arayüz | Tasarım sistemi: katmanlar, token'lar, sınıflar, `Icon`/`Avatar`/`Toaster`, yazı tipleri (F9, F11, F12) | `src/lib/styles/*.css`, `src/lib/components/ui/*` | A1 |
| B2 | Arayüz | Kabuk: ray, ikon-ray, üst çubuk, alt sekme çubuğu, `/sections` (F10) | `src/routes/(app)/+layout.svelte`, `src/lib/components/shell/*`, `src/routes/(app)/sections/+page.*` | B1 |
| B3 | Arayüz | Akış çekirdeği: `FeedView`, `feed-state`, `PostCard` ailesi (F13, F15, F17) | `src/lib/components/feed/*`, `src/lib/feed/feed-state.svelte.ts`, `/` ve `/sections/[slug]` sayfaları | B2, A4 |
| B4 | Arayüz | `ShareForm`, `InlineComposer`, `ComposerController`, yapıştır/bırak | `src/lib/components/share/*`, `src/lib/share/*` | B3 |
| B5 | Arayüz | Kısayollar, gün grupları, son ziyaret ayırıcısı, `NewPostsPill` | `src/lib/components/shell/KeyboardHelpDialog.svelte`, `FeedView.svelte`, `NewPostsPill.svelte` | B4, A2, A3 |
| Faz 6 | Arayüz | Diğer ekranlar (§13) | İlgili rotalar | B2 |
| Faz 7 | Eklenti | Token hizalaması (§14) | `extensions/src/styles/tokens.css`, `extensions/package.json` | B1 token'ları donmuş |
| Faz 8 | Kapanış | Doğrudan zorunlu CSP + m8 Docker CSP senaryosu, görsel/erişilebilirlik turu, temizlik | `svelte.config.js`, `tests/e2e/m8-docker-smoke.spec.ts` | Tümü |

A ve B izleri farklı dosyalara dokunur ve paralel yürüyebilir; B adımları düzen ve akış dosyalarını paylaştığı için sıralıdır.

### Verification Plan

*   **Birim testleri (`vitest`):**
    *   `date.ts`: UTC ortamında İstanbul saatiyle `dayKey`/`dayLabel` (`20:59Z` ve `21:00Z` gece yarısı sınırı, yıl değişimi, "Bugün/Dün/gün adı/tarih" etiketleri).
    *   `merge.ts`: yeni öğe geldiğinde ek sayfaların korunması, pencere içindeki silinmiş öğenin düşmesi, `> 25` yeni öğede sıfırlama, `nextCursor` korunumu.
    *   `group-by-day.ts`, `paste.ts` (WhatsApp metni, `text/uri-list` yorum satırları, URL'siz metin), `keyboard-filter.ts` (Türkçe Q `/` ve `?` Shift ile, Caps Lock `J`, `isComposing`, düzenlenebilir hedefler, `Ctrl/Meta/Alt`, açık dialog).
    *   `tokens-contrast.test.ts`: `src/lib/styles/tokens.css` ayrıştırılarak §1 tablosundaki her çiftin eşiği (`4.5:1` metin, `3:1` kontrol/odak) iki tema için yeniden hesaplanır.
*   **Entegrasyon testleri (`vitest` + PostgreSQL):** `GET /api/internal/feed/updates` — `401`, `403`, `400`, `404`; `afterId` sınırı (aynı mikro saniyede iki satır); ana akışın sessizleri hariç tutması, bölümün dahil etmesi; kendi ve silinmiş paylaşımların hariç tutulması; `type` süzgeci; `100` tavanı. `setTheme` eylemi — geçerli değerde çerez, geçersiz değerde ret, `returnTo` temizliği; `handle` çıktısında `data-theme` değişimi ve ön yükleme bağlantıları. HTML yanıtlarında `X-Frame-Options`, `X-Content-Type-Options` ve `Referrer-Policy` başlıkları (Faz 1); Faz 8'den önce `Content-Security-Policy` ve `Content-Security-Policy-Report-Only` başlıklarının bulunmadığı.
*   **Uçtan uca (`Playwright`, Chromium/Firefox/WebKit + `375 × 812` mobil projesi):** JS'siz satır içi paylaşım (`javaScriptEnabled: false`); tema çerezi ile ilk boyamada doğru `data-theme`; `j`/`k`/`l`/`?` ve kapatma anahtarı; yapıştırarak paylaş (yalnız Chromium; sentetik `ClipboardEvent`); son ziyaret ayırıcısı (`addInitScript` ile tohumlanmış `localStorage`); yeni paylaşım balonu (`page.clock` ile 60 sn, ikinci kullanıcı API ile paylaşır); mobilde alt sekme çubuğu, tek "Ana gezinme", görünür bildirim zili ve metin alanı odağında gizlenen çubuk; JS'siz `/sections`; "daha fazla yükle → beğen → öğeler korunur"; Karar 1 senaryoları: akış başında satır içi forma odak, aşağı kaydırılmış akışta ve kısmen görünür formda dialog, dialoga özgü senaryolar `/resources/[id]` üzerinde (§12).
*   **CSP duman testi (Faz 8):** `tests/e2e/m8-docker-smoke.spec.ts` içindeki CSP senaryosu `pnpm test:docker` ile üretim imajına karşı koşar; tüm ana rotalarda sıfır `securitypolicyviolation` ve her yanıtta `Content-Security-Policy` başlığı. Zorunlu modu açan commit'in ve CSP'yi etkileyen sonraki değişikliklerin `main`'e gönderilme ön koşuludur (§11).
*   **Görsel ve erişilebilirlik turu (Faz 8):** Tarayıcı panelinde `375 / 768 / 1280px` × açık/koyu × üç motor ekran görüntüleri; yalnız klavye turu; `prefers-reduced-motion`; Windows `forced-colors` öykünmesinde odak halkası görünürlüğü.
*   **Eklenti:** `cd extensions && pnpm lint && pnpm check && pnpm test && pnpm test:e2e && pnpm verify:manifests`.
