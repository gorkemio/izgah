# İzgah Temaları — Loş, Yüksek Kontrast ve Vurgu Rengi

*   **Author:** Gorkem Inanc Ozdemir
*   **Status:** Mechanism Active — Vurgu renkleri ve Dim paleti [izgah-ui-v4.md](./izgah-ui-v4.md) §8 ile kaldırıldı
*   **Date:** 2026-11-22

> **UI v4 Notu (2026-11-26):** Künye ile vurgu renkleri ve Dim paleti kaldırıldı ([izgah-ui-v4.md](./izgah-ui-v4.md) §8); eski `izgah_accent` ve `dim` çerez değerleri beyaz liste üzerinden varsayılana düşer. Kalan dört paletin (açık ve koyu × standart ve yüksek kontrast) renkleri `tokens/kunye.json` dosyasından `pnpm tokens` ile üretilir (v4 §11). Aşağıdaki §1 ve §2 tarihsel kayıttır.

> **UI v3 Geçiş Notu (2026-11-24):** Bu dokümandaki **mod + gündüz/gece paleti + vurgu** mimarisi, çerez/SSR sözleşmesi (§3), `light-dark()` + `.theme-preview` CSS katmanı (§4) ve `/settings` önizlemeli ayar akışı (§5) aynen korunur. **§1 (Paletler)** ve **§2 (Vurgu Renkleri — `lime`/`cyan`/`pink`/`blue` → `teal`/`cobalt`/`terracotta`/`plum`)** değerleri [izgah-ui-v3.md](./izgah-ui-v3.md#1-token-sistemi-primitive--semantic--component) ile güncellenmiştir.

--------------------------------------------------------------------------------

## Overview

Bu doküman [izgah-ui-v2.md](./izgah-ui-v2.md) "Sinyal" görsel dilinin üzerine adlandırılmış ek temalar getirir. Mevcut Sistem / Açık / Koyu **mod** seçimi aynen korunur; kullanıcı buna ek olarak `/settings` "Görünüm" bölümünde bir **açık tema**, bir **koyu tema** ve bir **vurgu rengi** seçer (GitHub'ın "gündüz teması / gece teması" modeli). Sistem modunda işletim sistemi açıksa seçilen açık tema, koyuysa seçilen koyu tema uygulanır.

Bu doküman `izgah-ui-v2.md` içindeki "Özel Tema ve Renk Seçimi" kapsam dışı maddesini ve Alternative F'deki "`light-dark()` kullanılmaz" kararını değiştirir; ilgili bölümler bu dokümana bağlanır. Veri modeli, eklenti davranışı ve CSP değişmez.

#### Temel Kavramlar

*   **Mod (`data-theme`):** `system` | `light` | `dark`. Hangi renk şemasının (açık/koyu) etkin olduğunu belirler; değerleri ve çerezi `izgah-ui-v2.md` §9'daki gibidir.
*   **Açık Tema (`data-light-theme`):** Açık şema etkinken kullanılan palet: `default` (Varsayılan) | `contrast` (Yüksek kontrast).
*   **Koyu Tema (`data-dark-theme`):** Koyu şema etkinken kullanılan palet: `default` (Varsayılan) | `dim` (Loş) | `contrast` (Yüksek kontrast).
*   **Vurgu Rengi (`data-accent`):** `--color-signal` ve `--color-focus-outer` değeri: `lime` (Kireç, varsayılan) | `cyan` (Camgöbeği) | `pink` (Pembe) | `blue` (Mavi).

## The Problem

*   Koyu tema tek ve neredeyse siyahtır (`#0A0A0A`); uzun okumada daha yumuşak bir koyu zemin isteyen üyeler için seçenek yoktur (X'in "Loş" temasına benzer ihtiyaç).
*   Az gören veya parlak ortamda çalışan üyeler için AAA düzeyinde metin kontrastı ve belirgin kontrol sınırları sunan bir tema yoktur.
*   Ekipte limon vurguyu yorucu bulan üyeler, marka dilini bozmayan bir alternatif seçemez.

## Goals

*   Her açık × koyu × vurgu kombinasyonunda WCAG 2.2 AA (metin `4.5:1`, kontrol sınırı ve odak `3:1`); yüksek kontrast paletlerinde metin ve ikincil metin `7:1` (AAA).
*   İlk boyamada tema parlaması olmaması ve JS'siz çalışma (`izgah-ui-v2.md` §9 ile aynı garanti).
*   Yeni bağımlılık, satır içi betik, CSP istisnası veya veritabanı sütunu olmaması.

## Non-Goals

*   **Cihazlar Arası Eşitleme:** Tercihler çerezde kalır, cihaz başınadır.
*   **Eklenti:** Eklenti sistem temasını, varsayılan paletleri ve limon vurguyu izlemeye devam eder (`izgah-ui-v2.md` §14).
*   **Serbest Renk Seçimi ve Yoğunluk:** Yalnız aşağıdaki hazır paletler vardır; renk seçici, yoğunluk veya yazı boyutu ayarı yoktur.
*   **Animasyonlu Geçiş, `prefers-contrast` ile Otomatik Seçim, `theme-color`:** Bu sürümde yoktur.

## Technical Plan (Architecture)

### 1. Paletler

Değerler [`src/lib/styles/tokens.css`](../../src/lib/styles/tokens.css) içindedir; oranlar WCAG 2.x göreli parlaklık formülüyle hesaplanmış ve [`tests/unit/tokens-contrast.test.ts`](../../tests/unit/tokens-contrast.test.ts) tarafından token dosyasından yeniden doğrulanır. Varsayılan açık ve koyu paletler `izgah-ui-v2.md` §1 tablosundaki değerlerdir.

| Token | Açık YK (`contrast`) | Loş (`dim`) | Koyu YK (`contrast`) |
| :--- | :--- | :--- | :--- |
| `bg` / `surface` | `#FFFFFF` / `#F0F0F0` | `#1C1C1C` / `#262626` | `#000000` / `#121212` |
| `text` | `#000000` (`bg` 21 · `surface` 18.43) | `#EDEDED` (14.56 · 12.93) | `#FFFFFF` (21 · 18.73) |
| `text-muted` | `#3D3D3D` (10.86 · 9.53) | `#A8A8A8` (7.17 · 6.36) | `#D0D0D0` (13.62 · 12.15) |
| `line` | `#767676` (4.54) | `#3A3A3A` (dekoratif) | `#7A7A7A` (4.89) |
| `line-strong` | `#1F1F1F` (16.48) | `#7F7F7F` (4.26) | `#C4C4C4` (12.04) |
| `danger` / `on-danger` | `#A3150B` (7.87) / `#FFFFFF` (7.87) | `#FF8A80` (7.47) / `#0A0A0A` (8.67) | `#FFA3A3` (11.02) / `#000000` (11.02) |
| `focus-inner` | `#000000` | `#EDEDED` | `#FFFFFF` |
| `backdrop` | `rgb(0 0 0 / 0.6)` | `rgb(0 0 0 / 0.6)` | `rgb(0 0 0 / 0.8)` |

Yüksek kontrast paletlerinde `line` de `3:1`'i geçer; bu yüzden ayraçlar ve ek kutusu kenarları da algılanabilir sınır olur. Gri skala nötr kalır; krem/sepya zemin, turuncu, mor ve gradyan yasağı (`izgah-ui-v2.md` §4) geçerlidir.

### 2. Vurgu Renkleri

`--color-on-signal` her vurguda `#0A0A0A`'dır.

| Vurgu | Değer | `on-signal` üzerinde | Koyu zemin (`#0A0A0A` / Loş `#1C1C1C`) | Beyaz üzerinde |
| :--- | :--- | :--- | :--- | :--- |
| Kireç (`lime`) | `#C8F542` | 15.65 | 15.65 / 13.47 | 1.27 |
| Camgöbeği (`cyan`) | `#4FDDE6` | 12.08 | 12.08 / 10.40 | 1.64 |
| Pembe (`pink`) | `#FF8FD0` | 9.51 | 9.51 / 8.19 | 2.08 |
| Mavi (`blue`) | `#8FC4FF` | 10.85 | 10.85 / 9.34 | 1.82 |

Hiçbir vurgu beyaz üzerinde `3:1`'i geçmez; bu nedenle `izgah-ui-v2.md` §1 "Limonun İzinli Kullanımları" tablosu her vurgu için aynen geçerlidir (açık temada yalnız dolgu + mürekkep metin, koyu temada metin olarak da kullanılabilir).

### 3. Çerezler, Sunucu ve Eylem

*   **Çerezler:** `izgah_theme` (mod, değişmez), `izgah_theme_light`, `izgah_theme_dark`, `izgah_accent`. Bayraklar `izgah_theme` ile aynıdır: `Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly; Secure` (koşullu). Değer yoksa veya geçersizse varsayılan (`default`, `default`, `lime`) kullanılır; HTML'e yalnız beyaz listedeki değerler yazılır.
*   **Sunucu:** [`src/app.html`](../../src/app.html) kök öğesi `<html lang="tr" data-theme="%izgah.theme%" data-light-theme="%izgah.lightTheme%" data-dark-theme="%izgah.darkTheme%" data-accent="%izgah.accent%">` olur; [`src/hooks.server.ts`](../../src/hooks.server.ts) mevcut `transformPageChunk` sarmalayıcısında dört yer tutucuyu doldurur. `<head>` içindeki `<meta name="color-scheme" content="%izgah.colorScheme%">` moda göre `light dark` / `light` / `dark` olur; tarayıcı tuvali CSS yüklenmeden doğru renkte boyar ve JS'li geçişte istemci aynı değeri günceller.
*   **Eylem:** `/settings?/setPalette` (`lightTheme`, `darkTheme`, `accent`, `returnTo`). Doğrulama, `303` yönlendirmesi, `x-sveltekit-action` dalı ve `sanitizeInternalPath` `?/setTheme` ile aynıdır.

### 4. CSS Mimarisi

*   **Palet yuvaları:** `--light-*` ve `--dark-*` özellikleri her paletin ham değerlerini, `--accent` vurgu değerini taşır.
*   **Semantik token'lar:** `--color-bg: light-dark(var(--light-bg), var(--dark-bg))` biçiminde tanımlanır; bileşenler yalnız `--color-*` adlarını kullanır.
*   **Mod:** `:root { color-scheme: light dark }`, `:root[data-theme='light'] { color-scheme: light }`, `:root[data-theme='dark'] { color-scheme: dark }`. Koyu değerleri tekrar eden `@media (prefers-color-scheme: dark)` bloğu kalkar.
*   **Palet seçicileri:** `:root` öneki olmadan (`[data-dark-theme='dim']` vb.) yazılır; yuvalar ve semantik eşleme `:root, .theme-preview` üzerinde tanımlandığından ayarlar sayfasındaki önizleme kartları kendi paletini gösterir.
*   `light-dark()` 2026-11-13 itibarıyla Baseline "widely available"dır (Chrome 123, Firefox 120, Safari 17.5); hedef tarayıcıların tamamı destekler.

### 5. Ayarlar Arayüzü

*   `/settings` "Görünüm": mevcut mod seçicisinin altında üç `<fieldset>` ("Açık tema", "Koyu tema", "Vurgu rengi"). Her seçenek görünür native radio + önizleme kartıdır; seçim değişince form gönderilir (`use:enhance`, sayfa yeniden yüklenmez), JS'siz kullanıcıda "Uygula" düğmesi görünür.
*   Seçili seçenek renkten bağımsız olarak kalın çerçeve ve onay işaretiyle belirtilir; `forced-colors` altında sistem renkleri kullanılır.
*   Hesap menüsündeki seçici yalnız modu değiştirir.

## Alternatives Considered

### Alternative A: Tek Düz Tema Listesi

X modeli (Sistem / Açık / Loş / Koyu / …) daha basittir; ancak "Sistem" seçeneği her zaman varsayılan paletleri kullanmak zorunda kalır ve Loş veya yüksek kontrast isteyen üye işletim sistemi eşitlemesinden vazgeçer. Kullanıcı tarafından seçilmedi.

### Alternative B: `light-dark()` Olmadan Seçicilerle

Her koyu palet `[data-theme='dark']` ve `@media (prefers-color-scheme: dark)` altında iki kez yazılırdı (üç koyu palet için altı blok). `light-dark()` artık widely available olduğundan reddedildi.

### Alternative C: Tercihleri Kullanıcı Profilinde Saklamak

Cihazlar arası eşitleme sağlardı; ancak yeni sütun ve göç gerektirir ve ilk boyama için yine çereze yansıtılması gerekirdi. 10–15 kişilik ekipte cihaz başına tercih yeterli görüldü.

## Verification Plan

*   `tests/unit/tokens-contrast.test.ts`: tüm palet ve vurgu kombinasyonları için §1–§2 eşikleri.
*   `tests/integration/m10-ui-v2.test.ts`: çerez → `<html>` öznitelikleri, geçersiz değer, `?/setPalette` doğrulama, `303` ve enhanced dallar.
*   `tests/e2e/m12-ui-v2-shell.spec.ts` ve `tests/e2e/m15-a11y-tour.spec.ts`: ayarlarda seçim ve kalıcılık; Loş ve yüksek kontrast paletlerinde axe taraması.
*   `pnpm test:docker`: `app.html`, hook ve global stil değişikliği sonrası sıfır CSP ihlali.
