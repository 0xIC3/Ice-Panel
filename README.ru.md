# Ice-Panel

🌍 [English](./README.md) · **Русский**

Self-hosted панель управления прокси с **нативной мультиядерной архитектурой**.

В отличие от конкурентов (Marzban, Remnawave, x-ui), которые оборачивают всё через Xray-core, Ice-Panel запускает **настоящий апстрим-бинарник** для каждого протокола — Hysteria2 server, Xray-core, AmneziaWG kernel module, NaiveProxy fork of Caddy — под единой абстракцией `CoreAdapter`.

## 🚀 Установка одной командой

> Скрипты рассчитаны на Ubuntu 22.04+ / Debian 12+. Требуют root. Идемпотентны (можно перезапускать). Валидировано end-to-end на реальных VPS для Xray (REALITY+Vision) и Hysteria 2 — 2026-05-06.

### 1. Панель — установка на VPS администратора

**Production с auto-TLS** (рекомендуется) — заведи DNS A-запись типа `panel.example.com` → IP VPS (Cloudflare → **DNS only / серое облако**), дождись пропагации и:

```bash
sudo -i
PANEL_DOMAIN=panel.example.com \
  bash <(curl -fsSL https://raw.githubusercontent.com/0xIC3/Ice-Panel/main/scripts/install-panel.sh)
```

Скрипт ставит Docker, билдит образы, поднимает Postgres + Redis + backend + frontend, **ставит Caddy и настраивает auto-TLS** для домена, лочит `ufw` на 22/80/443 и печатает URL где создаётся первый администратор. ~5–10 минут.

**Тестовый запуск без TLS** (HTTP, для быстрых локальных проверок):

```bash
sudo -i
bash <(curl -fsSL https://raw.githubusercontent.com/0xIC3/Ice-Panel/main/scripts/install-panel.sh)
```

SPA поднимается на `http://<vps-ip>:8080`. Не запускай ничего серьёзного так — JWT админа летят в открытом виде.

Для Cloudflare Proxied (жёлтое облако) с Origin Certificate — см. [docs/deploy/reverse-proxy.md](./docs/deploy/reverse-proxy.md). **Cloudflare proxy подходит только для панели** — proxy-ноды должны быть DNS only: CF Free не пропускает UDP для Hysteria / AmneziaWG и ломает Xray REALITY.

### 2. Нода — одна команда на каждый протокол

В админке: **Nodes → Create node** → имя + адрес → submit. Модалка покажет команду с одноразовым 15-минутным токеном. Вставь её на VPS-ноду + флаги протокола ниже.

#### Xray (VLESS + REALITY + Vision)

Домен не нужен — REALITY использует SNI-spoofing. Сначала создай Xray inbound в панели (**Inbounds → Create**, кнопка **Generate** для keypair'а), потом на ноде:

```bash
sudo -i
bash <(curl -fsSL https://raw.githubusercontent.com/0xIC3/Ice-Panel/main/scripts/install-node.sh) \
  --panel-url https://panel.example.com \
  --bootstrap bs_xxx \
  --protocol xray \
  --xray-reality-private-key sI_p9bg-7cy... \
  --xray-reality-short-ids   abc123 \
  --xray-reality-server-names www.cloudflare.com \
  --xray-reality-dest        www.cloudflare.com:443
```

#### Hysteria 2

DNS A-запись `hy2-01.example.com` → IP VPS (DNS only — UDP/443 через CF Free всё равно не пройдёт). Затем:

```bash
sudo -i
bash <(curl -fsSL https://raw.githubusercontent.com/0xIC3/Ice-Panel/main/scripts/install-node.sh) \
  --panel-url https://panel.example.com \
  --bootstrap bs_xxx \
  --protocol hysteria \
  --hysteria-domain hy2-01.example.com \
  --hysteria-email admin@example.com
```

Скрипт пишет `/etc/hysteria/config.yaml` с ACME / masquerade / auth-callback, кладёт `hysteria.service` systemd-юнит, и Hysteria первым запуском получит LE-сертификат через HTTP-01. Без ручного редактирования.

#### AmneziaWG / NaiveProxy

```bash
bash <(curl -fsSL .../install-node.sh) --panel-url ... --bootstrap ... --protocol amneziawg
bash <(curl -fsSL .../install-node.sh) --panel-url ... --bootstrap ... --protocol naive
```

Оба ставят бинарники (kernel-модуль + tools для AWG; xcaddy fork для Naive — минимум 2 GB RAM), но требуют ручного допиливания конфигов после установки. Авто-конфиг флаги для них появятся в slice 24.

> ⚠️ **`node.address` сейчас одновременно и mTLS-эндпоинт, и публичный host в URI клиента** — до slice 25. Поэтому на этапе создания ноды задай его правильно: домен для Hysteria/Naive (`hy2-01.example.com:8443`), IP для Xray/AmneziaWG (`<ip>:8443`). Менять позже — только через **Refresh bootstrap** (иконка-ключ в строке ноды) для перевыпуска cert с правильным SAN.

Полный гайд по деплою (детали по протоколам, troubleshooting, обновление): **[docs/deploy/install.md](./docs/deploy/install.md)**.

---

## Статус

🎉 **Phase 2 + multi-node multi-protocol валидация на VPS** (2026-05-06). Две реальные VPS (Швеция Xray REALITY + Германия Hysteria 2) под одной панелью, одна subscription URL отдаёт оба endpoint'а, Hiddify коннектится к обоим. Phase 3 в процессе:

- ✅ **Slice 23.1** — panel-ops harden: node-status poller, backfill юзеров на `node.created`, Refresh-bootstrap UI кнопка, install-node.sh per-protocol auto-config флаги.
- ✅ **Slice 24a** — auto-push inbound config wire pipeline (панель→нода через mTLS), атомарная persistence `inbounds.json` на ноде.
- ✅ **Slice 24b1** — `CoreAdapter.ApplyInbound` интерфейс + Xray реальная реализация (idempotent regen + restart). Hysteria/AWG/Naive остались stubs.
- ✅ **Slice 25** — `publicHost` / `publicPort` разделение на Inbound (закрывает cert-SAN-mismatch gotcha на архитектурном уровне).
- ⏭️ **Slice 24b2/3/4** — Hysteria / AmneziaWG / Naive ApplyInbound real impls.
- ⏭️ **Slice 24c** — Xray defaults uplift + транспорты/субпротоколы + per-user traffic stats.

Полный план: [docs/ROADMAP.md](./docs/ROADMAP.md) (v3, 2026-05-06).

Подробный план срезов и приоритеты Phase 3 — [docs/ROADMAP.md](./docs/ROADMAP.md).

## Что работает

### Протоколы

| Протокол | Что запускается на ноде | Native или эмуляция |
|---|---|---|
| Hysteria2 | Реальный `hysteria server` (apernet/hysteria) с auth-callback + Brutal CC | native |
| Xray-core | Реальный `xray run` с VLESS + REALITY + Vision; транспорты raw / xhttp / ws / gRPC | native |
| AmneziaWG | Реальный kernel module `amneziawg` + `awg syncconf` hot-reload (без рестарта при mutation) | native |
| NaiveProxy | Реальный Caddy fork (`klzgrad/forwardproxy@naive` через xcaddy) | native |

### Генератор подписок

- 6 wire-форматов: `plain` (base64 список URI), `json` (структурированный Ice-Panel), `clash` (Clash Meta YAML), `singbox` (Sing-box JSON), `wgconf` (wg-quick `.conf`), `xrayjson` (Xray client JSON)
- `?format=` query-параметр явный выбор; иначе авто-выбор через **Subscription Response Rules** (regex на `User-Agent`) — 7 default-правил покрывают Hiddify / Clash / NekoBox / sing-box / v2rayN / AmneziaVPN / `.*` fallback
- Стабильное per-user распределение IP для AmneziaWG (отдельная таблица `amneziawg_peers`)

### Админка

- **Users** — CRUD, лимиты трафика + стратегии сброса (no_reset / day / week / month / rolling), per-user `enabledProtocols` MultiSelect, soft-delete
- **Nodes** — CRUD + одноразовый mTLS payload в модальном окне при создании
- **Inbounds** — per-protocol форма (Hysteria / Xray REALITY / AmneziaWG с TSPU/Mobile/Custom пресетами обфускации / Naive). Кнопка генерации x25519 keypair — один клик, без SSH на VPS
- **SRR** — менеджер UA-правил + панель «Test against UA»

### Операции

- Установщики одной командой для панели и ноды — см. [docs/deploy/install.md](./docs/deploy/install.md)
- Production-сетап `docker-compose.prod.yml` с Postgres + Redis + backend + frontend
- 193 backend integration-теста, 60+ Go-тестов, всё green

## Архитектура

```
┌─────────────────────────────────────────────────────────────┐
│  Панель (VPS администратора)                                │
│                                                              │
│   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐    │
│   │ panel-backend│   │  panel-      │   │  Postgres +  │    │
│   │  (Fastify TS)│   │  frontend    │   │  Redis       │    │
│   │              │   │  (React/Vite)│   │  (BullMQ)    │    │
│   └──────┬───────┘   └──────────────┘   └──────────────┘    │
└──────────┼──────────────────────────────────────────────────┘
           │ REST через mTLS (панель выпускает per-node certs)
           ▼
┌─────────────────────────────────────────────────────────────┐
│  Нода (proxy VPS) — рекомендуется один протокол на ноду     │
│                                                              │
│   ┌──────────────┐                                          │
│   │ node-agent   │  spawn / signal /                        │
│   │ (Go static)  │ ─ syncconf / reload  ──┐                 │
│   └──────┬───────┘                        │                 │
│          │ HTTP auth-callback             ▼                 │
│          │ (только Hysteria)      ┌───────────────┐         │
│          └───────────────────────►│ hysteria  /   │         │
│                                   │ xray      /   │         │
│                                   │ amneziawg /   │         │
│                                   │ caddy-naive   │         │
│                                   └───────────────┘         │
│                                          │                   │
│                                          ▼ proxy-трафик     │
│                                       Интернет               │
└─────────────────────────────────────────────────────────────┘
```

Транспорт между панелью и нодой — обычный **REST поверх HTTPS с mutual TLS**, не gRPC. Панель сама себе CA, выпускает сертификаты per-node, кодирует их в одноразовый base64 payload, node-agent декодит при первом старте.

### Структура репозитория

```
apps/
├── panel-backend/        Fastify API (TypeScript) — admin DB, бизнес-логика
│   └── src/
│       ├── modules/      по одной папке на домен (auth, users, nodes,
│       │                  inbounds, subscription, srr, amneziawg, ...)
│       └── core-adapters/  panel-side билдеры URI / конфигов per protocol
├── panel-frontend/       Админ-SPA (React 19 + Mantine 8 + TanStack Query)
└── node/                 Node-agent (Go 1.22+, один статический бинарь)
    └── internal/core/
        ├── hysteria/     auth-callback + subprocess
        ├── xray/         config-restart pattern; gRPC AlterInbound отложен
        ├── amneziawg/    awg syncconf с fallback на systemctl restart
        └── naive/        Caddyfile gen + caddy reload

packages/
└── shared/               Wire-format DTO (TS-первоисточник; Go зеркалит)

docs/
├── ROADMAP.md            План срезов и обоснование tech-стека
├── deploy/
│   ├── install.md        Установка одной командой (панель + нода)
│   └── hysteria-node.md  Hysteria-specific deploy runbook (slice 13 era)
└── references/           Per-upstream research notes по протоколам

scripts/
├── install-panel.sh      Docker-based установщик панели
└── install-node.sh       systemd-based установщик ноды (per protocol)
```

## Tech-стек

| Слой | Инструменты |
|---|---|
| Panel API | TypeScript, Fastify 5, Prisma 7, PostgreSQL 16, Zod, Pino |
| Background jobs | Redis 7, BullMQ, `node:events` event-bus |
| Auth | JWT (jose), bcrypt, `@fastify/rate-limit` |
| Inter-service | REST + mutual TLS через `@peculiar/x509`, undici-клиент |
| Frontend | React 19, Vite 8, Mantine 8, TanStack Query 5, Zustand 5 |
| Node-agent | Go 1.22+, нативный `crypto/tls`, `slog`, без gRPC |
| Tests | Vitest (panel), Go testing (node) |
| Infra | Docker, Docker Compose; install-скрипты одной командой |

## Разработка

Требования: Node 22+, pnpm 10+, Go 1.22+, Docker. Тестировалось на Ubuntu (WSL).

```bash
# 1. Установить JS-зависимости
pnpm install

# 2. Поднять Postgres + Redis (dev compose)
docker compose up -d postgres redis postgres-test

# 3. Применить миграции к dev DB
pnpm --filter @ice-panel/panel-backend exec prisma migrate dev

# 4. Стартануть backend (auto-reload на изменениях)
pnpm --filter @ice-panel/panel-backend dev

# 5. Во втором терминале — стартануть SPA
pnpm --filter @ice-panel/panel-frontend dev

# 6. Открыть SPA
open http://localhost:5173
```

Backend слушает `:3000`, SPA — `:5173`, и SPA проксит `/api`+`/sub` на backend. Создай первого администратора через форму «Create first admin» в SPA.

### Тесты

```bash
# Panel-backend integration-тесты (нужен postgres-test на :5433)
pnpm --filter @ice-panel/panel-backend test

# Node-agent Go-тесты (внешних сервисов не требуют)
cd apps/node && go test ./...

# Frontend type-check
pnpm --filter @ice-panel/panel-frontend exec tsc --noEmit
```

## Референсы

Внутренние research-заметки по протоколам, собранные при разработке Ice-Panel — см. [docs/references/](./docs/references/). Operational-референсы по Hysteria2, AmneziaWG, NaiveProxy, Xray-core плюс глубокий разбор Remnawave (architecture / modules / install UX) использованный как design oracle.

## Лицензия

[AGPL-3.0](./LICENSE) — copyleft, network-use included. Если запускаешь модифицированный Ice-Panel как сервис — обязан предоставить исходники своим пользователям.
