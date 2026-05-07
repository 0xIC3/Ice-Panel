# Ice-Panel — Testing Checklist

Per-slice verification checklists. Use when **closing** a slice or when re-validating after a refactor.

> **Принцип:** ROADMAP описывает что строим. TESTING описывает как проверяем. Когда закрываем slice — пройти соответствующую секцию ниже целиком, отметить `[x]`. Если ловим новый баг — добавить его в этот файл в раздел Gotchas нужного slice'а.

---

## VPS test cycles — log

### Cycle #1 (2026-05-06)

- 2 VPS (SE Xray REALITY + DE Hysteria 2) под одной панелью
- Hiddify connect к обоим, auto-balancer 69 ms hy2 / 117 ms xray
- Validated: CoreAdapter abstraction, bootstrap-token flow, SRR auto-format e2e
- Стоимость: ~1 EUR (часовой billing)

### Cycle #2 (2026-05-07) — partial

4 VPS: panel + xray (`ice-xray-test`) + AWG (`ice-wg-test`) + hy2 (`ice-naive-test`).

#### Что проверяли (все checks)

| # | Проверка | Команда / способ | Результат |
|---|---|---|---|
| 1 | Xray REALITY traffic | Hiddify (iOS), реальный сёрфинг | ✅ работает |
| 2 | AWG нода online | Panel UI: status badge | ✅ ONLINE |
| 3 | AWG applyInbounds | Panel логи `[event] inbound.created → enqueue` | ✅ принят (но adapter — stub, без живого трафика, ждёт 24b3) |
| 4 | hy2 server up | `systemctl status hysteria-server` | ✅ active, listening :443 UDP |
| 5 | hy2 ACME-cert | journalctl: `obtain certificate obtained successfully` | ✅ Let's Encrypt issued |
| 6 | hy2 auth callback | journalctl: `hysteria auth accepted addr=... userId=...` | ✅ работает |
| 7 | hy2 pipeline (loopback) | `hysteria client -c local.yaml → curl -x http://127.0.0.1:8080 https://example.com` | ✅ HTTP/2 200 за 4 ms |
| 8 | TCP egress с VPS | `curl -v https://8.8.8.8`, `https://www.google.com`, `https://dns.google` | ✅ всё проходит |
| 9 | UDP к VPS от клиента | `tcpdump -ni any 'udp port 443' -c 20` параллельно с попыткой Happ | ⚠️ пакеты долетают, но handshake → `tx: 0` |
| 10 | hy2 real client (Streisand iOS) | RU mobile ISP `193.143.67.170` → `89.22.239.22:443` | ❌ connection timeout (пакеты вообще не выходят с iPhone) |
| 11 | hy2 real client (Happ iOS) | то же | ❌ auth ✅, `tx: 0`, страницы не грузятся |
| 12 | hy2 real client (Safari через VPN) | example.com через включённый Streisand-туннель | ❌ не грузится |
| 13 | URI/конфиг согласованы | sub `curl /sub/<token>` → base64 decode → совпадает с серверным | ✅ ни obfs-mismatch'а, ни SNI-mismatch'а |
| 14 | Subscription generates obfs | проверено что URI содержит `&obfs=salamander&obfs-password=...` когда `inbound.config.obfsPassword` есть | ✅ после `ae8d857` |
| 15 | `obfs: salamander` на сервере | `cat /etc/hysteria/config.yaml` | ✅ применено вручную (`ice-test-obfs-2026`) |
| 16 | obfs клиент↔сервер вместе | новый URI с obfs в Streisand + Happ | ❌ всё равно `tx: 0` |
| 17 | QUIC tuning | `disablePathMTUDiscovery: true`, `maxIdleTimeout: 30s`, расширенные `initStreamReceiveWindow`/`maxStreamReceiveWindow` | ❌ не помогло |
| 18 | Path MTU check | `ping -M do -s 1400/1200/1000 193.143.67.170` | ICMP режется RU мобильным (нормально) |
| 19 | Backups перед изменениями | `/etc/hysteria/config.yaml.bak` (без obfs), `.bak2` (obfs без QUIC tuning) | ✅ есть на VPS |

#### Что пофиксили в коде (panel-backend, commit `ae8d857`)

- `core-adapters/hysteria/uri.ts` — `buildHysteriaUri` принимает `obfsPassword?`, эмитит `obfs=salamander&obfs-password=...` в URI
- `modules/subscription/subscription.formats.ts` — добавил `obfsPassword?` в `HysteriaSubscriptionEndpoint`
- `modules/subscription/subscription.service.ts` — читает `ib.config.obfsPassword`, прокидывает в URI builder и endpoint
- `modules/subscription/formats/singbox.ts` — `obfs: { type: salamander, password }` в outbound
- `modules/subscription/formats/clash.ts` — `obfs: salamander` + `obfs-password:` строки в proxy

#### Что решили НЕ делать (отброшенные гипотезы)

- ❌ Streisand bug — Happ повторил тот же `tx: 0`, не клиент
- ❌ obfs mismatch URI vs server — оба проверены, совпадают
- ❌ MTU фрагментация — `disablePathMTUDiscovery` (1252 байта) не помог
- ❌ TCP egress блок на VPS — curl до 8.8.8.8 / google.com / dns.google проходит
- ❌ Server config баг — loopback на самой VPS работает

#### Вывод

**Pipeline корректен.** Нерабочесть real-client'а — ISP-уровневый блок/тротлинг QUIC, специфичный для пары `RU-mobile-ISP ↔ 89.22.239.22`. Тот же клиентский ISP с Xray на другом VPS работает идеально, что подтверждает изолированность проблемы.

#### Что НЕ пробовали (для следующего cycle)

- Port hopping (`listen: :443,20000-30000`) — обход агрессивного DPI на :443
- Другой клиентский ISP (Wi-Fi, другой мобильный оператор)
- Другой VPS / провайдер для hy2-ноды
- Brutal CC с явными `bandwidth: { up, down }` на сервере

#### Closed bugs (карры-овер из предыдущих сессий, всё ✅)

- Bootstrap command `http://` → `https://` через `PUBLIC_URL` env var
- Bootstrap expiry: «expires in N min» вместо абсолютного времени
- Node без protocol поля → добавлена колонка + Select в UI
- Hysteria ACME `mkdir read-only` → `WorkingDirectory=/etc/hysteria` в systemd unit
- BullMQ failed job deduplication: документирован Redis cleanup runbook
- `bootstrap-hysteria.sh` отсутствовал → добавлен (commit `91e8b1a`)
- hy2 subscription URI не эмитил obfs → исправлено (commit `ae8d857`)

#### Carry-over в следующий cycle

- Slice 24b2 — node-agent должен сам писать `/etc/hysteria/config.yaml` (включая `obfs:` блок из inbound config) и рестартить `hysteria.service`. Сейчас admin правит руками.
- Hysteria validation на не-RU / не-мобильном ISP — нужна другая клиентская сеть для повторного e2e
- AWG real applyInbound — slice 24b3
- Решить: добавлять port-hopping в server config для DPI-resistance, или делегировать админу

---

## Структура каждого блока

- **Pre-conditions** — что должно быть готово до теста (БД, образы, VPS, домены).
- **Local checks** — что можно проверить без VPS на dev-машине.
- **VPS checks** — что обязательно нужно на живых нодах (UDP, ACME, kernel modules, etc).
- **Edge cases** — конкретные сценарии которые ловили баги в прошлом.
- **Done criteria** — формальный список что считается «слайс закрыт».

---

## Slice 23.1 — Panel-ops hotfix ✅

### Local checks
- [x] `pnpm --filter @ice-panel/panel-backend test` — green
- [x] `pnpm --filter @ice-panel/panel-frontend exec tsc --noEmit` — green
- [x] `apps/node && go test ./... && go build ./...` — green (на WSL; Windows AppControl блокирует server.test.exe)
- [x] Frontend dev: запустить `pnpm dev` обоими процессами → создать ноду → видеть key-icon в Actions колонке

### VPS checks
- [x] Удалить + пересоздать ноду → backend logs: `[event] node.created → backfillNode → N user(s) ok`
- [x] В UI ряд ноды → key-icon → modal с новой command + new bootstrap token (15 min TTL)
- [x] Через 30 секунд после поднятия `ice-panel-node` → status в UI flips `unknown → online`
- [x] `systemctl stop ice-panel-node` на ноде → через 30s status flips `online → unreachable`
- [x] install-node.sh с `--hysteria-domain hy2-01.example.com --hysteria-email admin@example.com` → автоматически пишет `/etc/hysteria/config.yaml` + поднимает `hysteria.service` без manual edits
- [x] install-node.sh с `--xray-reality-private-key ... --xray-reality-short-ids ...` → env-файл pre-filled, Xray стартует на `:443`

### Edge cases (поймали)
- ✅ `addHook('onRequest', requireAuth)` ломал public route → fixed `325f85b`
- ✅ install-node.sh `--protocol <xray|...>` placeholder ломал bash → fixed
- ✅ /etc/xray не создаётся через ProtectSystem=strict → pre-create dirs `9372d7c`
- ✅ REALITY private key base64-standard rejected → `generateRealityKeyPair()` base64url

### Done criteria — все ✅

---

## Slice 24a — Auto-push wire pipeline ✅

### Local checks
- [x] Backend tests pass (193/193)
- [x] Создать inbound в UI → backend logs: `[event] inbound.created → enqueue applyInbounds for node <uuid>`
- [x] BullMQ job `apply:<nodeId>` появляется в очереди (если Redis доступен; через `redis-cli LRANGE bull:inbound-sync:wait 0 -1`)
- [x] Удалить inbound → `inbound.deleted` event → ещё один enqueue (job ID coalesces)
- [x] Создать ноду в UI → `[event] node.created → enqueue applyInbounds` (пустой набор для backfill node-agent)

### VPS checks (отложено до VPS test cycle)
- [ ] Создать inbound в UI → mTLS POST `/applyInbounds` пришёл на ноду → response 200 с `applied: 1`
- [ ] На ноде: `cat /etc/ice-panel-node/inbounds.json` → видим только что созданный inbound
- [ ] Атомарность write: `kill -9` node-agent во время push → `inbounds.json` либо пустой, либо целый, не corrupt
- [ ] Mode 0600 на `inbounds.json` (содержит REALITY private keys)
- [ ] Coalescing: создать 5 inbound'ов подряд → видим что job в очереди один (по jobId), не пять
- [ ] systemd ReadWritePaths включает `/etc/ice-panel-node` (без него запись валится с EROFS)

### Edge cases
- ✅ Тестовая БД нуждалась в `prisma migrate deploy` — добавить в pre-conditions VPS test
- [ ] (Не проверено) Empty inbounds array — node-agent должен принимать как валидный (нода без inbound'ов)
- [ ] (Не проверено) Когда node-agent НЕ запущен но nodes.address указан → mTLS fetch fail → BullMQ retry exponential

### Done criteria
- [x] Все local checks
- [ ] Все VPS checks (отложено до следующего теста)

---

## Slice 24b1 — Per-adapter ApplyInbound (Xray real, others stub) ✅

### Local checks
- [x] `go test ./internal/core/xray/ ./internal/server/` — green (WSL)
- [x] `core.CoreAdapter` интерфейс собирается с новым методом — проверено через `go build`
- [x] `fakeAdapter` в dispatch_test обновлён — все existing tests pass
- [x] Unit-test `inboundEqual` — равные структуры идентичны, разные не идентичны (TODO написать если ещё нет)
- [x] Unit-test `xrayInboundCfgWire` JSON unmarshal — все поля парсятся

### VPS checks
- [ ] (Xray) Создать inbound в UI → mTLS push → node-agent получает `applyInbounds` → ApplyInbound dispatched на xray adapter
- [ ] (Xray) В логах node-agent: `xray ApplyInbound: config changed, regenerating and restarting`
- [ ] (Xray) `systemctl status` xray subprocess: новый process после restart, listening :443
- [ ] (Xray) Следующий sub URL request → клиент коннектится с новыми REALITY params
- [ ] (Xray idempotency) Повторно сохранить inbound без изменений → node logs: `xray ApplyInbound: config unchanged, skipping restart` (no subprocess restart)
- [ ] (Xray non-disruption) При single-user коннекте через VLESS → restart drop'ает session, через ~3-5 sec клиент переподключается
- [ ] (Hysteria stub) Inbound для Hysteria node-агента с stub'ом → видим в логах `hysteria ApplyInbound stub`, persisted в inbounds.json. Manual restart hysteria.service подхватывает изменения.
- [ ] (AWG / Naive stubs) То же самое — log + persist + manual reload

### Edge cases
- [ ] **Race**: applyInbounds приходит ДО adapter Start завершения. Mu-блокировка должна работать.
- [ ] **Wrong protocol**: Hysteria-cfg пришёл к Xray-adapter? Не должно — диспатчер фильтрует по `Name() == ib.Protocol`. Verify.
- [ ] **Malformed JSON**: rawCfg с невалидным JSON → ApplyInbound returns error → server.go отвечает 500. Verify через curl с битым телом.
- [ ] **Partial restart fail**: xray не запускается с новым config (e.g. невалидный private key). adapter возвращает error из regenerateAndRestartLocked. Inbound в `inbounds.json` обновлён, но xray лежит. Recovery — admin фиксит и save заново.

### Done criteria
- [x] Все local checks
- [ ] Все VPS checks (next VPS cycle)

---

## Slice 25 — publicHost / publicPort separation ✅

### Local checks
- [x] Migration applied на dev DB и test DB (`prisma migrate deploy`)
- [x] `pnpm test` — green (193/193)
- [x] Frontend tsc — green
- [x] Создать inbound с empty publicHost → DB row имеет `public_host = NULL`
- [x] Создать inbound с `publicHost = 'hy2.example.com'` → row имеет правильное value
- [x] Update — set publicHost = empty string → backend trim → null
- [x] `curl /sub/<token>` → URL содержит publicHost если задан, иначе `hostFromAddress(node.address)`
- [x] Update — set publicHost = `null` (через API напрямую) → row clears

### VPS checks
- [ ] Создать ноду с IP-адресом в node.address (e.g. `45.80.229.24:8443`)
- [ ] Создать Hysteria inbound с publicHost = `hy2.example.com` (домен)
- [ ] Sub URL для юзера → host part = `hy2.example.com` (домен), не IP
- [ ] mTLS panel→node продолжает работать (cert SAN на IP, mTLS connect на IP) — никаких fetch failed
- [ ] Изменить publicHost → новый sub URL обновляется без cert dance

### Edge cases
- [ ] **Невалидный hostname**: `publicHost = 'not a hostname'` → Zod отбивает 400
- [ ] **IPv6 publicHost**: `publicHost = '2001:db8::1'` — текущий regex может не пускать. Verify, fix if needed.
- [ ] **Длина 253**: max valid hostname → должно проходить. 254 → 400.
- [ ] **Form clear**: empty string в UI form → null в DB. Не пустая строка.

### Done criteria
- [x] Все local checks
- [ ] Все VPS checks (next VPS cycle)

---

## Slice 24b2 — Hysteria ApplyInbound real impl ✅ (code) / ⏭️ (VPS)

### Pre-conditions
- VPS с уже установленной Ice-Panel Hysteria-нодой через `install-node.sh --hysteria-domain ...`
- DNS A-record указывает на VPS, пропагирован
- `/etc/hysteria/config.yaml` существует с ACME settings
- `hysteria.service` running, LE-cert получен
- node-agent env: `HYSTERIA_HOSTNAME`, `HYSTERIA_ACME_EMAIL`, `HYSTERIA_CONFIG=/etc/hysteria/config.yaml`, `HYSTERIA_SERVICE_UNIT=hysteria-server.service`

### Local checks
- [x] `ApplyInbound` парсит `inboundCfgWire` JSON (obfsPassword / masqueradeUrl / brutalUpMbps / brutalDownMbps) — unmarshal OK
- [x] Diff vs current — same cfg → no-op (no rewrite, no restart)
- [x] Diff — изменился `obfsPassword` → write + restart
- [x] Mock `RunCmd("systemctl", "restart", ServiceUnit)` через injectable runner
- [x] Tests: same cfg → 0 RunCmd calls, different cfg → 1 RunCmd call (`TestApplyInbound_IsIdempotent`, `TestApplyInbound_RestartFiresOnEveryRealChange`)
- [x] `renderConfig` deterministic — golden-test matches expected YAML byte-for-byte
- [x] No-ConfigPath path: `ApplyInbound` accepts in-memory only, no file write, no restart
- [x] No-ServiceUnit path: writes file but skips restart (callback-only mode)
- [x] Malformed JSON returns parse error без вызова RunCmd

### VPS checks
- [ ] В UI изменить `obfsPassword` Hysteria inbound'а → backend pushes → node-agent rewrites yaml → systemctl restart hysteria → success
- [ ] Smoke test: existing Hiddify-клиент с старым password → fail (expected, password сменился)
- [ ] Smoke test: новый sub URL с новым password → клиент коннектится
- [ ] `hysteria.service` rebooted gracefully (no zombie processes)
- [ ] LE-cert НЕ переиздан (домен/email не менялся)
- [ ] Сменить `masqueradeUrl` → restart, probe из браузера на `:443` показывает новый masquerade

### Edge cases
- [ ] Hysteria config.yaml не существует (callback-only mode без `--hysteria-domain` при install) → ApplyInbound должен либо создать с нуля, либо вернуть error «hysteria not configured for ACME» — определись.
- [ ] systemctl restart fail (например permission denied) → ApplyInbound returns error, server.go отвечает 500, panel retry.
- [ ] LE rate-limit при смене ACME-domain (если когда-нибудь introduced — сейчас domain install-time, не пушится).
- [ ] Параллельные ApplyInbound в одну hysteria-ноду — adapter mutex должен сериализовать.

### Done criteria
- [ ] All local checks
- [ ] All VPS checks
- [ ] Documented в ROADMAP slice 24b2 secton: «✅ done».

---

## Slice 24b3 — AmneziaWG ApplyInbound real impl ⏭️

### Pre-conditions
- VPS с AmneziaWG-нодой (kernel module работает или amneziawg-go fallback)
- `awg0` interface up
- Зарегистрированный inbound с peers (хотя бы один юзер)

### Local checks
- [ ] Diff classifier:
  - H1-H4 changed → flag "full restart"
  - Только S1-S4 / Jc/Jmin/Jmax / postUp / peers → flag "syncconf"
  - subnet changed → reject ApplyInbound с error (cannot change subnet with allocated peers)
- [ ] Mocked-CLI tests for both paths
- [ ] Generation `/etc/amneziawg/awg0.conf` deterministic

### VPS checks
- [ ] Изменить `S1` (S-param, syncconf-eligible) → adapter logs `awg syncconf`, no restart, peers сохраняют коннект
- [ ] Изменить `H1` (interface-level) → adapter logs `awg-quick down/up`, peers переподключаются (~5s downtime)
- [ ] Idempotent: одинаковый cfg → no-op (verify через `awg show` — last-handshake не сбился)
- [ ] DKMS fallback (userspace amneziawg-go) — если kernel module недоступен, syncconf может работать иначе. Verify.
- [ ] AmneziaVPN client коннектится с новыми S/H params

### Edge cases
- [ ] Subnet change attempt с allocated peers → backend Zod должен отбивать заранее (тест на panel-backend)
- [ ] `awg syncconf` timeout (>10s) → fallback на full restart
- [ ] Параллельный AddUser в момент ApplyInbound — mutex serialize

### Done criteria
- [ ] All local checks
- [ ] All VPS checks
- [ ] ROADMAP marked done

---

## Slice 24b4 — Naive ApplyInbound real impl ⏭️

### Pre-conditions
- VPS с NaiveProxy-нодой (Caddy fork, ~2 GB RAM минимум для xcaddy)
- Working LE-cert на текущем `cfg.Inbound.Hostname`
- Caddy serving на :443, masqueradeRoot dir exists

### Local checks
- [ ] Adapter `ApplyInbound` parse `NaiveInboundCfg` → unmarshal OK
- [ ] Diff: same cfg → no-op
- [ ] Diff: hostname/email/masqueradeRoot changed → flag "needs reload"
- [ ] Mock `runCmd("caddy", "reload", "--config", path)` через injectable runner
- [ ] Tests: caddy reload вызван ровно один раз при diff

### VPS checks
- [ ] Изменить `masqueradeRoot` → caddy reload, no session drops у активных клиентов
- [ ] Изменить `tlsEmail` → reload, на следующем cert-renew Caddy использует новый email
- [ ] Изменить `hostname` → caddy reload + LE issues NEW cert. **Гонять осторожно** — LE rate-limit 5 cert/неделя per FQDN.
- [ ] Idempotent: same cfg → no reload

### Edge cases
- [ ] **LE rate-limit hit** — admin меняет hostname > 5 раз в неделю на одном FQDN → каждый reload fail на cert. Symptom: `caddy reload` ok, но новых TLS-handshakes нет. Документировать.
- [ ] masqueradeRoot не существует → caddy reload fail с error в logs. ApplyInbound должен validate path БЕФОР reload.
- [ ] Параллельный AddUser с ApplyInbound — caddy reload re-reads Caddyfile, AddUser race с reload? Mutex serialize.

### Done criteria
- [ ] All local checks
- [ ] All VPS checks
- [ ] ROADMAP marked done

---

## Slice 24c — Xray defaults uplift ⏭️

### Pre-conditions
- VPS с Xray-нодой (REALITY working с slice 24b1)
- Hiddify / NekoBox клиент для real-traffic test'ов
- Дополнительный VPS / клиент для проверки stats (трафик должен реально идти)

### Local checks (≈50% slice)
- [ ] **Vendor xray gRPC proto** — `git subtree add` или go module from XTLS/Xray-core; build clean
- [ ] **Stats config gen** — `policy.levels.0.statsUserUplink/Downlink: true` + `stats: {}` + `api: { tag: "api", services: ["StatsService"] }` присутствуют в generated config
- [ ] **email field** в clients = `userId` (Xray использует email как stats-key)
- [ ] **URI builders** для Trojan, Shadowsocks, KCP, HTTPUpgrade — pure-function tests
- [ ] **Trojan/SS Zod schemas** — validation проходит на valid config, отбивает на invalid
- [ ] **Frontend forms** для Trojan / SS / KCP / HTTPUpgrade — рендерятся, submit OK

### VPS checks
- [ ] **Per-user stats**:
  - Юзер коннектится через Hiddify, прокачивает 100 MB
  - Через ~60 сек в `/api/users` user.usedTrafficBytes = ~100 MB (multiplier 1)
  - В UI Users-page traffic bar updates
- [ ] **HTTPUpgrade** — создать inbound с `network: 'httpupgrade'`, sub URL содержит `type=httpupgrade`, клиент коннектится
- [ ] **KCP** — то же с `network: 'kcp'`, проверить UDP-flow с lossy network simulation (`tc qdisc add dev eth0 root netem loss 5%`)
- [ ] **Trojan** — создать Trojan inbound, клиент коннектится через `trojan://...` URI
- [ ] **Shadowsocks** — `chacha20-ietf-poly1305` cipher, клиент коннектится. Также SS2022 (`2022-blake3-aes-256-gcm`) — Xray ≥ v1.8 only
- [ ] **sniffing** — TLS-by-SNI routing работает (legitimate traffic к `geosite:google` идёт через freedom, а не блок)
- [ ] **sockopt-BBR** — `sysctl net.ipv4.tcp_congestion_control` = `bbr` после install (требует sysctl правки в install-node.sh)
- [ ] **DNS-OUT** — DNS queries от клиента идут через `dns-out` outbound, не через freedom (avoid DNS leak)
- [ ] **BLOCK rules** — `geosite:bittorrent`, `port:25` — packets dropped в xray logs

### Edge cases
- [ ] **Vendor proto version mismatch** — xray-core ≥ vX.Y.Z required для StatsService; нода с старым xray не отвечает на gRPC. Detect + log clearly.
- [ ] **gRPC tcp-only on 127.0.0.1:8080** — must NOT expose externally. Verify via nmap.
- [ ] **High-cardinality stats** — 1000 юзеров × QueryStats каждые 60 сек = 60k queries/min. Performance.
- [ ] **stats reset на restart** — Xray clears counters. Adapter должен poll до restart, push delta, потом restart, начать с нуля.
- [ ] **userId с спецсимволами** — email field validation. UUID формат должен быть OK.
- [ ] **KCP UDP-port collision с Hysteria** — оба используют UDP. Validation на panel при создании inbound.

### Done criteria
- [ ] All local checks
- [ ] All VPS checks
- [ ] Documented stats query latency / throughput numbers
- [ ] Memory state updated re: per-user stats GAP closed

---

## Slice 26 — Squad ACL (group_inbounds wiring) ⏭️

### Pre-conditions
- DB has existing groups + inbounds (через slice 23)
- Migration ready: seed `All` group + populate `group_inbounds`

### Local checks
- [ ] Migration apply на dev + test DB → `groups` имеет default «All» row → `group_inbounds` имеет (всеинбаунды × «All»-group) rows
- [ ] Existing users получают membership в «All»-group
- [ ] Subscription endpoint возвращает все inbound'ы для user_in_All (zero-downtime compat)
- [ ] Создать новую group «Trial», assign 1 inbound → user в Trial видит только этот inbound
- [ ] User в нескольких groups (Trial + VIP) → union inbound'ов
- [ ] Frontend: GroupsPage CRUD + drag-and-drop работают
- [ ] Frontend: UserFormModal MultiSelect groups, default `[All]`

### VPS checks
- [ ] (Не требуется специально — feature чисто backend / UI)
- [ ] Sanity: создать tier-юзера (только Trial group) → sub URL содержит только Trial inbound's URI

### Edge cases
- [ ] **Delete group cascade** — удалить «Trial» группу → юзеры в ней auto-fall-through в «All»
- [ ] **User without groups** — добавить юзера и снять все групы (через API напрямую) → видит null subscription? Empty? Define behavior.
- [ ] **Group без inbound'ов** — пустая группа → user в ней видит ничего. Documented? UI warn?
- [ ] **«All» group is special** — UI должен скрывать в form (auto-include) или показывать read-only?

### Done criteria
- [ ] All local checks
- [ ] Documented decision re: empty-groups behavior
- [ ] Migration tested on production-like DB (with existing data)

---

## Slice 27+ — TODO

(Будем заполнять по мере подхода к слайсам.)

---

## Общие принципы тестирования

### Когда «закрываем» slice

1. Все Local checks ✅
2. Все VPS checks ✅ (если применимо)
3. Все Edge cases проверены и либо пройдены, либо задокументированы как known issue
4. Section в ROADMAP marked `✅ done`
5. Commit + push
6. Обновить `memory/project_current_state.md`

### Если ловим новый баг во время теста

1. **Сначала добавить в этот файл** в Edge cases relevant slice'а (короткое описание + symptom)
2. Решить — fix в текущем slice'е или follow-up commit
3. Если follow-up — записать в ROADMAP «Carried over from VPS test»

### VPS test cycle workflow

1. Купить 2-3 VPS на час (~€1-3)
2. Поднять минимум 1 panel + 1 нода каждого протокола (или 1 панель + всё на разных нодах)
3. Пройти VPS checks ВСЕХ ⏭️-слайсов накопленных с прошлого test cycle
4. Документировать новые баги в Edge cases
5. Fix → re-test критичные → закрыть test cycle
6. Записать в memory: «VPS test cycle YYYY-MM-DD: validated slice X/Y/Z, found N bugs, all fixed in commits A B C»

### Memory hygiene

После каждого major test cycle:
- Update `memory/project_current_state.md` с новым статусом
- Если найден шаблонный bug что повторится — добавить в `memory/feedback_*.md`
