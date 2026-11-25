# Self-hosting on Dokploy

[Dokploy](https://dokploy.com) builds the repository's `Dockerfile` and runs it behind Traefik with automatic HTTPS. Use a Dokploy-managed PostgreSQL 16 database or your own.

## 1. Create the application

1. In your Dokploy project choose **Create Service → Application**.
2. Provider **GitHub**, select your Izgah fork (or this repository) and the `main` branch.
3. **Build Type:** `Dockerfile`, **Build Path** `/`, **Dockerfile Path** `Dockerfile`.

## 2. Environment

In **Environment** add only names and your own values — never commit them:

- Required: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `ORIGIN`
- Recommended: `DEFAULT_LOCALE`, `APP_TIME_ZONE`, `INSTANCE_NAME`
- Optional: `ADMIN_BOOTSTRAP_EMAIL` (first setup only), `GITHUB_TOKEN`, `DATABASE_POOL_MAX`, `MEDIA_MIN_FREE_BYTES`, `MEDIA_MIN_FREE_RATIO`, `UNFURL_CONCURRENCY`, `LOG_LEVEL`

The image already sets `ADDRESS_HEADER=x-forwarded-for`, `XFF_DEPTH=1` and `MEDIA_STORAGE_DIR=/data/thumbnails`. `ORIGIN` must be your full `https://…` address.

## 3. Persistent thumbnails

**Advanced → Volumes / Mounts → Volume Mount**, mount path `/data/thumbnails`, volume name e.g. `izgah_thumbnails`. Note the host path; the backup script needs it.

The image runs as the non-root `node` user (`1000:1000`). If a freshly mounted volume is not writable, run `chown -R 1000:1000 <volume path>` on the host.

## 4. Domain and HTTPS

**Domains → Add Domain**, container port `3000`, HTTPS on, certificate provider Let's Encrypt. Keep `ORIGIN` identical to this domain.

## 5. Deploy

Enable **Auto Deploy** for pushes to `main` if you want it, then press **Deploy**. The container runs migrations before starting. The `Dockerfile` health check polls `/healthz`; afterwards verify:

- `https://<your-domain>/healthz` → `200 {"status":"ok"}`
- `https://<your-domain>/readyz` → `200` with `database`, `migrations` and `storage` all `"ok"`

## 6. First admin

- **With `ADMIN_BOOTSTRAP_EMAIL`:** open **Logs**, find the `Initial admin bootstrap invite created` line and open its one-time `/auth/accept-invite?token=…` link. You can remove the variable afterwards.
- **With the CLI:**

  ```sh
  docker exec -it <app-container> node build/cli.js create-admin --email admin@example.com --name "Admin"
  ```

## Backups

Dokploy's scheduled database backups do not include the thumbnails volume, and single-`Dockerfile` apps have no host-side pre-deploy hook, so two scripts run on the **host**. Install `pg_dump`/`pg_restore` and the `aws` CLI or `rclone`, and keep an env file such as `/etc/izgah/backup.env` (`chmod 600`):

| Variable | Used by | Purpose |
| :--- | :--- | :--- |
| `DATABASE_URL` | both | `pg_dump` connection URI reachable from the host |
| `BACKUP_DIR` | both | Local backup directory |
| `MEDIA_STORAGE_DIR` | `offbox-backup.sh` | Host path of the `/data/thumbnails` volume |
| `BACKUP_S3_URI` | `offbox-backup.sh` | `s3://…` or rclone target |
| `BACKUP_S3_ENDPOINT_URL` | `offbox-backup.sh` | Endpoint for non-AWS S3 providers (with the `aws` CLI) |
| `BACKUP_RETENTION_DAYS` | `offbox-backup.sh` | Days to keep local and remote backups (default `14`) |

Daily off-box backup:

```cron
15 3 * * * /bin/bash -c 'set -a && . /etc/izgah/backup.env && set +a && /opt/izgah/scripts/offbox-backup.sh >> /var/log/izgah-backup.log 2>&1'
```

Before pushing a release that contains a new `drizzle/` migration:

```sh
bash -c 'set -a && . /etc/izgah/backup.env && set +a && /opt/izgah/scripts/pre-deploy-backup.sh'
```

### Restore drill

```sh
sha256sum -c izgah-manifest-<TIMESTAMP>.sha256
pg_restore --clean --if-exists --no-owner --no-acl -d "$TARGET_DATABASE_URL" izgah-db-<TIMESTAMP>.dump
tar -xzf izgah-thumbnails-<TIMESTAMP>.tar.gz -C <VOLUME_PARENT_DIR>
chown -R 1000:1000 <VOLUME_PARENT_DIR>/thumbnails
```

Restart the app and check that `/readyz` returns `200` and thumbnails load.

## Rolling back (N → N-1)

Migrations follow expand-and-contract: release N never drops or renames columns that N-1 uses. Redeploy the previous successful deployment from **Deployments**; the entrypoint's `node build/migrate.js` is a no-op when the database is already at N. If something schema-related still goes wrong, restore the dump taken by `pre-deploy-backup.sh`.
