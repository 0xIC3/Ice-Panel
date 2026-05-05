# Ice-Panel

🌍 [English](./README.md) · **Русский**

Self-hosted панель управления прокси с **нативной мультиядерной архитектурой**.

В отличие от конкурентов (Marzban, Remnawave, x-ui), которые оборачивают всё через Xray-core, Ice-Panel запускает **настоящий апстрим-бинарник** для каждого протокола — Hysteria2 server, Xray-core, AmneziaWG kernel module, NaiveProxy fork of Caddy — под единой абстракцией `CoreAdapter`.

## 🚀 Установка одной командой

> Скрипты рассчитаны на Ubuntu 22.04+ / Debian 12+. Требуют root. Идемпотентны (можно перезапускать).

### Панель — устанавливается на VPS администратора

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/0xIC3/Ice-Panel/main/scripts/install-panel.sh)
```

Билдит Docker-образы локально, генерирует случайные секреты, поднимает стек Postgres + Redis + backend + frontend и печатает URL где создаётся первый администратор. Первый запуск ~5–10 минут.

**Для production**: фронти панель Cloudflare proxied субдоменом + Caddy на
VPS — прячет реальный IP и даёт бесплатный TLS. Полная настройка с
Origin-Certificate, ufw-локом до CF-IP и anti-probing правилами в
[docs/deploy/reverse-proxy.md](./docs/deploy/reverse-proxy.md). **Внимание**:
Cloudflare proxy подходит **только для панели** — proxy-ноды должны быть
**DNS only (gray cloud)**: CF Free не пропускает UDP (убивает Hysteria /
AmneziaWG) и ломает REALITY anti-fingerprint у Xray.

### Нода — устанавливается на каждой proxy-VPS

1. **В админке**: Nodes → Create node → в модалке нажми **Download**. Получишь файл `<node-name>-payload.b64` (~6-7 KB).
2. **scp файл на VPS**:
   ```bash
   scp <node-name>-payload.b64 root@<vps-ip>:/tmp/payload.b64
   ```
3. **На VPS** — запусти установщик с флагом на файл:
   ```bash
   bash <(curl -fsSL https://raw.githubusercontent.com/0xIC3/Ice-Panel/main/scripts/install-node.sh) \
     --protocol xray \
     --payload-file /tmp/payload.b64
   ```

Замени `--protocol` на `xray`, `hysteria`, `amneziawg` или `naive`.

> ⚠️ **Почему `--payload-file`, а не `--payload "..."`?** Linux TTY canonical mode режет вставку на 4096 байт — реальные payload'ы 6-7 KB, и при вставке через терминал тихо теряется хвост, нода падает с `json unmarshal: unexpected end of JSON input`. Кнопка **Download** + scp + `--payload-file` — единственный надёжный путь. Интерактивный prompt также принимает `@/tmp/payload.b64` для того же.

Скрипт цепочкой запускает официальные установщики
(`get.hy2.sh`, XTLS install-script, AmneziaWG PPA + проверка kernel module,
xcaddy build для Naive), кладёт `systemd`-юнит, открывает порты в `ufw` и
ждёт пока ответит `/healthz`.

Полный гайд по деплою (troubleshooting / TLS-фронтинг / обновление / почему
single-protocol-per-node): **[docs/deploy/install.md](./docs/deploy/install.md)**.

---

## Статус

🎉 **Phase 2 завершена** (2026-05-05). MVP готов к тестированию на самохостинговой VPS. Все четыре адаптера протоколов работают end-to-end через админку; генератор подписок поддерживает шесть форматов с авто-выбором по User-Agent; полный редактор inbound'ов и SRR.

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
