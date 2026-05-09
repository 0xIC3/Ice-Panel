# Backup & restore

Two scripts ship with the panel for backing up and restoring the entire
control-plane state in one move. Run them from the panel project root
where `docker-compose.prod.yml` and `.env.production` live.

```bash
./scripts/ice-panel-backup.sh   [--out DIR] [--password PASS]
./scripts/ice-panel-restore.sh  ARCHIVE [--password PASS] [--yes]
```

## What gets backed up

| Component                     | Source                             | Why it matters |
|-------------------------------|------------------------------------|----------------|
| `postgres.sql`                | `pg_dump` of the panel DB          | Users, profiles, bindings, hosts, squads, audit log, mTLS-CA |
| `redis.rdb`                   | `BGSAVE` then container `dump.rdb` | BullMQ queue state, cron schedules, rate-limit counters |
| `env`                         | host `.env.production`             | `JWT_SECRET`, `POSTGRES_PASSWORD`, `PUBLIC_URL`, brand keys |
| `manifest.json`               | generated                          | Timestamp + component list — restore reads it for sanity-check |

The CA private key (`KeygenCa.privateKeyPem`) lives inside the postgres
dump. **Re-issuing the CA invalidates every node's mTLS cert.** Treat the
backup as if it contains every secret of the panel — because it does.

## Encryption

Pass `--password <pw>` to AES-256-CBC encrypt the tarball before it lands
on disk:

```bash
./scripts/ice-panel-backup.sh --password "$BACKUP_PASS"
# → ice-panel-backup-...tar.gz.enc
```

`openssl enc -aes-256-cbc -salt -pbkdf2 -iter 200000` — modern parameters,
fine for off-host storage (S3, rsync, etc). Without `--password` the
script prints a stderr warning reminding you not to ship the unencrypted
form anywhere.

## Cron example

```cron
# nightly at 02:30, encrypted, with 14-day retention
30 2 * * * cd /opt/ice-panel && ./scripts/ice-panel-backup.sh \
    --out /var/backups/ice-panel \
    --password "$(cat /etc/ice-panel/backup.pass)" && \
    find /var/backups/ice-panel -name 'ice-panel-backup-*.tar.gz.enc' \
        -mtime +14 -delete
```

## Restore

The restore script is **destructive** — it drops the live database and
overwrites the redis RDB file. It prompts for confirmation unless you
pass `--yes`.

```bash
./scripts/ice-panel-restore.sh ./backups/ice-panel-backup-20260510T013000Z.tar.gz.enc \
    --password "$BACKUP_PASS"
```

Steps the script performs:

1. Decrypts (if `.enc`) and unpacks into a temp dir.
2. Reads `manifest.json`, prints a summary, asks for `yes` confirmation.
3. Stops `panel-backend` + `panel-frontend` (DB/Redis stay up for the
   restore work itself).
4. `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` then loads the
   `pg_dump` SQL.
5. Stops `redis`, replaces `/data/dump.rdb`, flushes any leftover
   `appendonlydir/*.aof` (AOF would override the RDB otherwise),
   restarts `redis`.
6. Starts the panel back up.

`.env.production` is **not** overwritten — if `JWT_SECRET` or
`POSTGRES_PASSWORD` changed between hosts the restore would break the
freshly imported DB. The script tells you where to find the archive's
copy if you do want to merge values manually.

## Recovery scenarios

**Lost the panel host entirely.** Boot a fresh VPS, `./install-panel.sh`
the same panel image, then `./scripts/ice-panel-restore.sh ARCHIVE` —
your DB, queues, and brand settings come back. **Node mTLS certs
survive** because the CA they were issued from is in the backup. Existing
nodes reconnect with no reinstall.

**Corrupted DB after a bad migration.** `./scripts/ice-panel-restore.sh`
the most recent pre-deploy backup. Then `pnpm prisma migrate deploy` to
re-apply the corrected schema.

**Recovering a single user.** Out of scope for this slice — restore would
overwrite everything since the backup. Per-row recovery means
`pg_restore --data-only --table=users` on a side-channel DB and `INSERT
... ON CONFLICT` on the live one. Document if needed.
