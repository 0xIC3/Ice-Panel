# Production tuning for low-resource VPS (2 cores / 4 GiB / 60 GB)

This is the host-level config that pairs with the in-app optimizations
(connection keep-alive, dashboard cache, hour-index, JSON compression).
Apply these to the VPS hosting `panel-backend` + Postgres + Redis. Per-VPS,
not per-deploy.

## Postgres

Edit `/etc/postgresql/<version>/main/postgresql.conf`:

```ini
# Memory — defaults are tuned for a tiny dev box, not a 4 GiB host.
shared_buffers = 512MB              # default 128MB; ~12% of RAM
effective_cache_size = 2GB          # tells planner roughly how much OS-level
                                    #   page cache exists; biases toward
                                    #   index scans on cold rows.
work_mem = 16MB                     # per sort/hash; 4MB default starves
                                    #   our `groupBy hour` aggregates.
maintenance_work_mem = 256MB        # one-shot ops (VACUUM, CREATE INDEX)

# Connection cap — nothing ever opens more than ~10. 100 is wasteful.
max_connections = 50

# Background writer / checkpoint — defaults are fine; revisit only if
# you see "checkpoints are occurring too frequently" warnings in logs.
```

Reload (no restart needed for most of these):
```bash
sudo systemctl reload postgresql
```

`shared_buffers` change requires a real restart.

## journald (logs)

Without a cap, panel logs at `info` will eat 60 GB in ~6 months.
Edit `/etc/systemd/journald.conf`:

```ini
[Journal]
SystemMaxUse=500M
SystemMaxFileSize=50M
MaxRetentionSec=2week
```

```bash
sudo systemctl restart systemd-journald
```

Plus, run the panel itself with `LOG_LEVEL=warn` in production
(`/etc/ice-panel/.env` or whatever holds env vars). Pino's `info` writes
every incoming HTTP request — at 1 req/s that's 86k log lines/day.

## Redis

Defaults are fine for our load. Two knobs worth setting in
`/etc/redis/redis.conf`:

```ini
maxmemory 256mb
maxmemory-policy allkeys-lru
```

Caps memory at 256 MiB so a runaway BullMQ queue can't push the host into
swap, and evicts oldest keys when full (we use Redis as cache + queue;
LRU is correct for both).

## Swap

If the VPS image came without swap (some providers strip it), add 2 GiB:

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
sudo sysctl vm.swappiness=10   # prefer RAM heavily
```

Two GiB is enough to absorb a Postgres `VACUUM FULL` peak without the OOM
killer reaching for `node`. With swappiness=10 the OS won't paginate
unless RAM is genuinely full.

## File handles

Each panel→node mTLS connection holds an FD; with our keep-alive pool
that's 2 FDs per node. Plus Postgres ~30, Redis ~20, Fastify per-request
~50. Total realistic: ~200 FDs. Default 1024 is fine — **no change
needed** unless you see EMFILE in logs.

## TCP

For a panel host that polls many nodes, increase ephemeral port range
(default starts at 32768, runs out faster than you'd think under heavy
fan-out):

```bash
sudo sysctl net.ipv4.ip_local_port_range="10000 65535"
```

Make permanent in `/etc/sysctl.d/99-ice-panel.conf`:

```ini
net.ipv4.ip_local_port_range = 10000 65535
net.ipv4.tcp_tw_reuse = 1
```

## Verify

After applying, watch for a tick or two:

```bash
# Postgres effective config
sudo -u postgres psql -c "SHOW shared_buffers; SHOW work_mem;"

# journald usage
journalctl --disk-usage

# Redis memory
redis-cli INFO memory | grep used_memory_human

# Panel resource baseline
systemctl status ice-panel --no-pager
```

Expected baseline at idle (no traffic, ~5 nodes connected):

| Component  | RSS         | CPU avg |
|------------|-------------|---------|
| Postgres   | 200-400 MB  | <1%     |
| Redis      | 30-60 MB    | <1%     |
| Panel API  | 250-400 MB  | 2-5%    |
| **Total**  | **~700 MB** | ~5%     |

Cron tick spike (every 15s — node metrics poll):

| Metric     | Without keep-alive | With keep-alive |
|------------|--------------------|-----------------|
| CPU peak   | 25-45%             | 8-15%           |
| TLS handshakes/min | ~40        | ~0 (steady-state) |

The `with keep-alive` column is what current `main` ships — these numbers
fall out of `nodes.transport.ts` reusing one undici Agent across calls.
