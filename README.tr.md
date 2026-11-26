# İzgah

**Ekibinizin ortak bağlantı arşivi.** İzgah; bir ekibin internette bulduğu yararlı bağlantıları — videolar, kod depoları, sosyal medya gönderileri, makaleler ve web sayfaları — sohbet grubunda kaybetmek yerine tek yerde topladığı, tartıştığı ve sonradan aradığı, kendi sunucunuzda çalışan küçük bir platformdur.

[izgah.com](https://izgah.com) · [Kendi sunucunuza kurulum](#kendi-sunucunuza-kurulum) · [Tarayıcı eklentileri](#tarayıcı-eklentileri) · [English README](./README.md)

> izgah.com yalnızca proje sitesidir; orada bir İzgah örneği **çalışmaz**. Her ekip İzgah'ı kendi sunucusunda ve alan adında çalıştırır.

## Özellikler

- **Akış** — içerik türüne duyarlı kartlar (video, repo, sosyal, makale, web), beğeniler, yorumlar ve "yeni paylaşım" bildirimleriyle ters kronolojik bağlantı akışı.
- **Bölümler** — yöneticilerin yönettiği konular. Bir bağlantı birden fazla bölümde olabilir; yöneticiler akışa düşürmeden "sessiz" kaynak ekleyebilir.
- **Arama** — başlık, açıklama, not ve URL parçalarında Türkçe ve İngilizce tam metin arama ve `⌘K` / `Ctrl+K` komut paleti.
- **Akıllı ekleme** — Notta `#bölüm` yazmak linki o bölüme koyar; bölümler ekibin geçmişine göre önerilir; yöneticiler isteğe bağlı olarak OpenRouter, Anthropic, OpenAI, Gemini ya da yerel OpenAI uyumlu bir modeli bağlayıp kısa özet, arama anahtar kelimesi ve bölüm önerisi alabilir. Yapılandırılana kadar kapalıdır; sayfa metni de aranabilir.
- **Bağlantı önizlemeleri** — SSRF korumalı süreç içi işçi başlık, açıklama ve kapak görsellerini çeker; küçültülmüş WebP görselleri yerelde saklar.
- **Tarayıcı eklentileri** — Chrome, Firefox ve Safari eklentileri açık sekmeyi kişisel API anahtarıyla paylaşır.
- **JavaScript olmadan çalışır** — paylaşım, gezinme, arama, detay, tema ve yönetim önce düz form ve bağlantıdır; JavaScript yalnızca iyileştirir.
- **Erişilebilir temalar** — açık ve koyu, her biri standart ve yüksek kontrast paletle; hepsi WCAG 2.2 AA (yüksek kontrastta AAA). Açtığınız linkler tarayıcının kendi `:visited` bilgisiyle solar; sunucu hiçbir şey kaydetmez.
- **İngilizce ve Türkçe arayüz** — her üye dilini seçer; her örneğin kendi varsayılan dili vardır.
- **Küçük ayak izi** — tek Node.js konteyneri ve PostgreSQL. Harici e-posta, kuyruk veya önbellek servisi yok.

## Teknoloji

SvelteKit 2 (Svelte 5), Node.js 22 · PostgreSQL 16 (`unaccent`, `pg_trgm`) · Drizzle ORM · Better Auth · eklentiler için WXT.

## Hızlı başlangıç (geliştirme)

Gereksinimler: Node.js ≥ 22, pnpm, Docker (PostgreSQL için).

```sh
pnpm install
cp .env.example .env          # BETTER_AUTH_SECRET değerini en az 32 karakterlik rastgele bir değerle değiştirin
docker compose up -d          # izgah ve izgah_test veritabanlarıyla yerel PostgreSQL
pnpm db:migrate
pnpm cli create-admin --email admin@example.com --name "İlk Yönetici"   # tek kullanımlık davet bağlantısı yazdırır
pnpm dev
```

Yazdırılan bağlantıyı açıp yönetici parolasını belirleyin, ardından ekibinizi **Yönetim → Üyeler** ekranından davet edin.

Kontroller (bir değişiklik bunlar geçmeden bitmiş sayılmaz):

```sh
pnpm lint
pnpm check
pnpm test        # birim + PostgreSQL entegrasyon testleri
pnpm test:e2e    # Playwright (Chromium, Firefox, WebKit, mobil)
```

## Kendi sunucunuza kurulum

İzgah tek bir Docker imajıdır. Üretim kurulumu; uygulama konteyneri, PostgreSQL 16 ve kapak görselleri için kalıcı bir hacimden oluşur ve HTTPS'i sonlandıran bir ters vekilin (reverse proxy) arkasında çalışır.

```sh
export POSTGRES_PASSWORD='…' BETTER_AUTH_SECRET='…' ORIGIN='https://links.example.com'
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml exec app node build/cli.js create-admin --email siz@example.com --name "Yönetici"
```

Uygulama portu yalnızca `127.0.0.1` üzerinde dinler. Önüne mutlaka bir ters vekil (Caddy, Traefik, Nginx) koyun; aksi halde istemciler `X-Forwarded-For` başlığını taklit ederek IP başına hız sınırlarını aşabilir.

Adım adım kılavuzlar (İngilizce):

- [Docker Compose + Caddy](./docs/deploy/docker-compose.md)
- [Dokploy](./docs/deploy/dokploy.md)

### Türkçe bir ekip için örnek ayarlar

```sh
ORIGIN=https://links.example.com
DEFAULT_LOCALE=tr
APP_TIME_ZONE=Europe/Istanbul
INSTANCE_NAME=İzgah
```

### Ortam değişkenleri

| Ad                      | Zorunlu       | Varsayılan         | Açıklama                                                                                                   |
| :---------------------- | :------------ | :----------------- | :--------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`          | evet          | —                  | PostgreSQL bağlantı URI'si.                                                                                |
| `BETTER_AUTH_SECRET`    | evet          | —                  | Oturum imzalama anahtarı (en az 32 karakter).                                                              |
| `ORIGIN`                | üretimde evet | —                  | Örneğinizin herkese açık HTTPS kökü; CSRF ve davet bağlantıları için kullanılır.                           |
| `DEFAULT_LOCALE`        | hayır         | `en`               | Dil seçmemiş üyeler için arayüz dili (`en` veya `tr`).                                                     |
| `APP_TIME_ZONE`         | hayır         | `UTC`              | Tarihler ve "bugün" sınırı için IANA saat dilimi (ör. `Europe/Istanbul`).                                  |
| `INSTANCE_NAME`         | hayır         | `Izgah`            | Kenar çubuğu, giriş ekranı ve sekme başlıklarında görünen ad.                                              |
| `SOURCE_URL`            | hayır         | bu depo            | Ayarlar'daki kaynak kodu bağlantısı (AGPL-3.0 §13). Değiştirdiyseniz kendi fork'unuzu verin.               |
| `ADMIN_BOOTSTRAP_EMAIL` | hayır         | —                  | Aktif yönetici yokken açılışta bu adres için tek kullanımlık kurulum bağlantısı loglanır.                  |
| `GITHUB_TOKEN`          | hayır         | —                  | Repo önizlemelerinde GitHub API sınırını yükselten salt okunur jeton.                                      |
| `DATABASE_POOL_MAX`     | hayır         | `12`               | PostgreSQL bağlantı havuzu boyutu.                                                                         |
| `HOST` / `PORT`         | hayır         | `0.0.0.0` / `3000` | HTTP dinleme adresi.                                                                                       |
| `ADDRESS_HEADER`        | hayır         | `x-forwarded-for`  | Vekil arkasında gerçek istemci IP'sini taşıyan başlık.                                                     |
| `XFF_DEPTH`             | hayır         | `1`                | Uygulamanın önündeki güvenilir vekil sayısı.                                                               |
| `MEDIA_STORAGE_DIR`     | hayır         | `/data/thumbnails` | WebP kapak görselleri için kalıcı dizin.                                                                   |
| `MEDIA_MIN_FREE_BYTES`  | hayır         | `536870912`        | Bu kadar boş alanın altında görsel yazımı durur.                                                           |
| `MEDIA_MIN_FREE_RATIO`  | hayır         | `0.15`             | Bu boş alan oranının altında görsel yazımı durur.                                                          |
| `UNFURL_CONCURRENCY`    | hayır         | `3`                | Eşzamanlı önizleme işi sayısı.                                                                             |
| `LOG_LEVEL`             | hayır         | `info`             | JSON log düzeyi (`debug`, `info`, `warn`, `error`).                                                        |
| `AI_FEATURES`           | hayır         | `on`               | `off`, isteğe bağlı yapay zekâ ayarlarını (Yönetim → Akıllı ekleme) gizler ve tüm YZ çağrılarını durdurur. |
| `AI_CONCURRENCY`        | hayır         | `1`                | Paralel zenginleştirme işi sayısı (1–4).                                                                   |

### Yönetici kurtarma

```sh
# Yeni yönetici (tek kullanımlık davet bağlantısı yazdırır):
docker exec -it <uygulama-konteyneri> node build/cli.js create-admin --email admin@example.com --name "Yönetici"
# Mevcut yönetici için 24 saat geçerli parola sıfırlama bağlantısı:
docker exec -it <uygulama-konteyneri> node build/cli.js reset-admin --email admin@example.com
```

Her iki komut denetim kaydına yazılır ve hesabın oturumlarını ve API anahtarlarını iptal eder.

### Yedekleme

`scripts/offbox-backup.sh` (günlük `pg_dump` + kapak görselleri, S3 uyumlu depolamaya) ve `scripts/pre-deploy-backup.sh` (göç içeren sürümler öncesi elle döküm) sunucu üzerinde çalışır. Cron örnekleri ve geri yükleme denemesi için [docs/deploy/dokploy.md](./docs/deploy/dokploy.md#backups).

## Tarayıcı eklentileri

Eklentiler [`extensions/`](./extensions) altındadır. Üyeler eklentiyi kurar, ayarlarını açar, **kendi örneklerinin adresini** ve web uygulamasındaki **Ayarlar → API anahtarları** ekranından aldıkları kişisel anahtarı girer. Mağaza sürümünde gömülü bir adres veya ek site izni yoktur; tek eklenti her İzgah örneğiyle çalışır. Ekipler dilerlerse kendi adresleri gömülü özel bir kopya da derleyebilir. Ayrıntılar: [extensions/README.md](./extensions/README.md).

## Belgeler

- [ARCHITECTURE.md](./ARCHITECTURE.md) — parçaların nasıl birleştiği.
- [docs/designs/](./docs/designs) — onaylı tasarım dokümanları (Türkçe).
- [CONTRIBUTING.md](./CONTRIBUTING.md) — geliştirme akışı, çeviriler ve pull request'ler.
- [SECURITY.md](./SECURITY.md) — güvenlik açığı bildirimi.

## Lisans

İzgah, [GNU Affero Genel Kamu Lisansı v3.0](./LICENSE) ile lisanslanmış özgür bir yazılımdır. Değiştirilmiş bir sürümü ağ üzerinden başkalarına sunarsanız kaynak kodunu da sunmanız gerekir. Paketlenen yazı tipi (Atkinson Hyperlegible Next) SIL Open Font License, ikonlar Lucide (ISC) lisanslıdır. Bkz. [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
