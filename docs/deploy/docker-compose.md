# Self-hosting with Docker Compose and Caddy

This guide runs Izgah on a single Linux server for your team at your own domain, for example `links.example.com`.

## 1. Prerequisites

- A server with Docker and the Compose plugin.
- A DNS `A`/`AAAA` record for your domain pointing at the server.
- Ports 80 and 443 open (for Caddy and Let's Encrypt).

## 2. Get the code

```sh
git clone https://github.com/gorkemio/izgah.git /opt/izgah
cd /opt/izgah
```

## 3. Configure

Create `/opt/izgah/.env.production` (keep it out of Git, `chmod 600`):

```sh
POSTGRES_PASSWORD=<long random password>
BETTER_AUTH_SECRET=<openssl rand -hex 32>
ORIGIN=https://links.example.com

# Optional
DEFAULT_LOCALE=en                 # or tr
APP_TIME_ZONE=UTC              # e.g. Europe/Istanbul
INSTANCE_NAME=Izgah        # shown in the UI
ADMIN_BOOTSTRAP_EMAIL=you@example.com
```

`ORIGIN` must exactly match the public HTTPS address your members open.

## 4. Start the app

```sh
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

The container runs database migrations on start and listens on `127.0.0.1:3000` only.

> **Keep port 3000 private.** Izgah trusts the last `X-Forwarded-For` hop (`XFF_DEPTH=1`) for rate limiting, which is only safe behind exactly one reverse proxy. If the app port is reachable directly, clients can spoof that header and spread login attempts across fake addresses. Add a rate limit at the proxy as well if your instance is exposed to the open internet.

## 5. Put Caddy in front

Install Caddy on the host and use [`docs/deploy/Caddyfile`](./Caddyfile):

```caddyfile
links.example.com {
	encode zstd gzip
	reverse_proxy 127.0.0.1:3000
}
```

Caddy obtains the certificate automatically and sends one `X-Forwarded-For` hop, which matches the defaults `ADDRESS_HEADER=x-forwarded-for` and `XFF_DEPTH=1`. If you add another proxy or CDN in front, raise `XFF_DEPTH` accordingly.

## 6. Create the first admin

If you set `ADMIN_BOOTSTRAP_EMAIL`, look for `Initial admin bootstrap invite created` in the logs:

```sh
docker compose -f docker-compose.prod.yml logs app | grep bootstrap
```

Otherwise create one explicitly:

```sh
docker compose -f docker-compose.prod.yml exec app node build/cli.js create-admin --email you@example.com --name "Admin"
```

Open the printed one-time link, set a password, then invite members from **Admin → Members**. Izgah does not send e-mail: invite and reset links are copied and shared by an admin.

## 7. Check health

```sh
curl -fsS https://links.example.com/healthz   # {"status":"ok"}
curl -fsS https://links.example.com/readyz    # database, migrations and storage all "ok"
```

## 8. Updating

```sh
cd /opt/izgah && git pull
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

Run `scripts/pre-deploy-backup.sh` first when the release contains database migrations. Migrations are expand-and-contract, so rolling back to the previous image is safe.

## 9. Browser extension

Members install the Izgah extension, open its options, enter `https://links.example.com` as the server address and paste a personal API key from **Settings → API keys**.
