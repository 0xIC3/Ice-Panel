# Ice-Panel Roadmap

> Этот документ — план развития проекта и справочник по используемым технологиям.
> Обновляется по мере прохождения срезов. Если в коде ушло вперёд — значит документ устарел, обнови его.
>
> **Версия:** 2 (2026-05-03) — обновлено после глубокого изучения Remnawave.

---

## Видение

**Ice-Panel** — самохостинг-панель управления прокси-серверами с **нативной мультиядерной архитектурой**.

В отличие от конкурентов (Marzban, Remnawave, x-ui), которые оборачивают всё через Xray-core, Ice-Panel запускает **реальные апстрим-бинарники** для каждого протокола:

- **Hysteria2** — настоящий Hysteria2-сервер от apernet
- **AmneziaWG** — DPI-устойчивая ветка WireGuard
- **NaiveProxy** — HTTP/2 поверх Chromium-стека
- **Xray-core** — для VLESS/Reality/VMess/Trojan (legacy-поддержка)

**Главная архитектурная ставка:** интерфейс `CoreAdapter`. Если он спроектирован хорошо — добавить 4-е, 5-е, 10-е ядро становится тривиально.

---

## Технологический стек — чем мы работаем

### Backend (панель управления)

| Инструмент | Что это | Зачем нам | C++ аналог |
|---|---|---|---|
| **Node.js 22** | Движок для исполнения JavaScript на сервере | Async-I/O без потоков, огромная экосистема пакетов | Скомпилированный бинарник + libuv |
| **TypeScript** | Типизированная надстройка над JS | Ловит ошибки на этапе сборки, autocomplete в IDE | Тот же JS, но со «строгим режимом» как C++ |
| **pnpm** | Менеджер пакетов | Быстрый, экономит место, нативно работает с monorepo | apt / vcpkg |
| **Fastify** | HTTP-фреймворк | Быстрый, schema-first, отличная типизация | Crow / Drogon |
| **Pino** | Структурированный логгер | JSON-логи с минимальным оверхедом | spdlog |
| **PostgreSQL 16** | Реляционная БД | Зрелая, JSONB, надёжная | Та же роль |
| **Prisma** | ORM (Object-Relational Mapper) | Type-safe запросы к БД, автомиграции | sqlpp11 / SOCI |
| **Zod** | Валидация данных в runtime | Проверяет JSON-вход API против TS-типа | Кастомные validators |
| **JWT (jose)** | Stateless токены аутентификации | Не нужны сессии в БД | — |
| **bcrypt** | Хеширование паролей | Безопасное хранение паролей | bcrypt в C++ существует |
| **@fastify/rate-limit** | Защита от брутфорса и DoS | Лимит попыток login + global throttling | Кастомный middleware |
| **Redis** | Кэш + брокер для очередей | Хранение сессий BullMQ, кэш конфигов | memcached / своё |
| **BullMQ** | Очереди фоновых задач | Cron + node-sync через очереди (паттерн Remnawave) | Custom thread pool |
| **eventemitter2** | In-process event bus | Decoupling: service → event → node-sync handler | Observer pattern |
| **@peculiar/x509** | Генерация и парсинг X.509 сертификатов | Bootstrap mTLS между панелью и нодами | OpenSSL |
| **axios + https.Agent** | HTTP-клиент с mTLS | Панель → нода через REST + взаимный TLS | libcurl |
| **Vitest** | Тестовый фреймворк | Быстрый, ESM-нативный, совместим с Jest API | Catch2 / GoogleTest |

### Frontend (админка) — срез 14

| Инструмент | Что это |
|---|---|
| **React 19** | UI-библиотека, компоненты + state |
| **Vite 7** | Dev-сервер + бандлер (быстрая замена Webpack) |
| **Mantine 8** | UI-кит компонентов (формы, таблицы, модалки) — валидирован Remnawave |
| **TanStack Query 5** | Серверный state, кэширование API-ответов |
| **Zustand 5** | Клиентский state (то что не от сервера) |
| **Axios** | HTTP-клиент |
| **React Router DOM 6** | Роутинг |
| **TypeScript** | Тот же что в бэкенде |

### Node Agent (агент на серверах)

| Инструмент | Что это |
|---|---|
| **Go 1.22+** | Компилируемый язык, удобен для системных тулов |
| **net/http + crypto/tls** | HTTP-сервер с mTLS (без сторонних зависимостей) |
| **Cobra** | CLI-фреймворк (флаги, команды) |
| **systemd** или **supervisord** | Управление дочерними прокси-процессами |

**Почему Go, а не TS:** агент должен запускать другие бинарники как дочерние процессы, общаться с ядром Linux через iptables/nftables, работать без рантайма Node. Один статический бинарник, который ставится на любой VPS — это Go, не Node.

**Транспорт между панелью и нодой:** REST поверх HTTPS с mutual TLS (взаимный TLS). Не gRPC. Это решение принято после изучения Remnawave — REST проще для TS↔Go, дебажится `curl`, и mTLS даёт ту же безопасность что gRPC+TLS.

### Инфраструктура

| Инструмент | Что это |
|---|---|
| **Docker** | Контейнеры (изоляция процессов и зависимостей) |
| **Docker Compose** | Запуск нескольких контейнеров одной командой (БД + панель + Redis + …) |
| **Nginx** | Reverse-proxy перед панелью — **ставит пользователь сам при деплое** (не часть репо) |
| **GitHub Actions** | CI/CD — тесты и билды при пуше (добавим в фазе 3) |

---

## Фазы развития

| Фаза | Что делаем | Цель |
|---|---|---|
| **1. MVP Hysteria2** ⏳ сейчас | Полный сквозной флоу: панель → нода → один пользователь подключается через реальный Hysteria2-клиент | Доказать что архитектура работает на одном протоколе |
| **2. Multi-core** | AmneziaWG, NaiveProxy через `CoreAdapter`, потом Xray для legacy | Доказать что абстракция ядер действительно тривиализует добавление |
| **3. Production-readiness** | Multi-node, метрики, бэкапы, rate-limiting, security hardening, уведомления (Telegram/webhook) | Сделать готовым к реальным пользователям |
| **4. Public release & repo split** | Разделение монорепо на отдельные репозитории, документация, лендинг | Открыть проект миру |
| **5. Native client (Ice-Client)** | Tauri (Rust + React + Mantine) Windows-приложение с поддержкой всех 4 протоколов и системным TUN через WinTun. Дальше macOS / Linux / Android / iOS | Полный end-to-end стек: панель → нода → ОВН клиент. Личный продукт целиком, не зависит от сторонних клиентов |

## Модель деплоя — рекомендуемая практика

**Single-protocol-per-node** — рекомендуем размещать **один прокси-протокол на одну ноду VPS**:

- Ресурсная изоляция: Hysteria2-трафик не конкурирует с Xray
- Падение одного протокола (например, Xray crash) не валит остальные
- Обновление бинарника одного ядра не трогает другие ноды
- Конфликты портов исключены (две ноды могут обе слушать `:443` на разных IP)
- Минимальная конфигурация ноды: `1 vCPU / 1 GB RAM / 20 GB SSD` ($3-5/мес VPS) даже для production
- Каждая нода предсказуема по cost/profiling — «Xray-нода ест 200 MB» без гадания

**Архитектура поддерживает и multi-protocol-per-node** через `CoreAdapter` (можно зарегистрировать несколько адаптеров на одном `node-agent`). Это валидно для домашних/dev-стендов, но в production single-protocol предпочтителен.

Single-protocol модель также упрощает:
- `nginx` для фронтинга нужен **только** на Xray-нодах (VLESS+TLS с decoy-сайтом). Hysteria/AmneziaWG/Naive обходятся без nginx.
- `node-agent` управляет одним адаптером, проще debug.

---

## Фаза 1: MVP Hysteria2 (детально)

**Финальный результат фазы:** ты сидишь в админке, добавляешь пользователя «vasya», получаешь подписочную ссылку, открываешь её в реальном Hysteria2-клиенте на телефоне — и трафик идёт через твой VPS. Никаких заглушек.

### Срезы (15 шагов)

| # | Название | Статус | Что вводим нового |
|---|---|---|---|
| 1 | Fastify + `GET /health` | ✅ done | TS, ESM, async/await, monorepo, Fastify, Pino |
| 2 | Postgres + `.env` + Zod config validation | ✅ done | Docker, env-vars, конфигурация через Zod |
| 3 | Prisma + полная схема БД | ✅ done | Prisma schema, миграции, все таблицы из data model |
| 4 | CRUD users + Zod + auto-gen creds | ✅ done | REST-эндпоинты, валидация, генерация кредов под все протоколы |
| 5 | JWT auth + rate-limiting + bcrypt | ✅ done | Passport-альтернатива на Fastify, защита от брутфорса |
| 6 | Слои + event bus | ✅ done | routes/services/repositories, node:events |
| 7 | 🆕 Redis + BullMQ + scheduler | ✅ done | Очереди, фоновые задачи, cron-расписание (4 reset-job'а + 2 review-job'а) |
| 8 | Тесты на Vitest | ✅ done | Unit + integration, отдельный test-postgres, fastify.inject() |
| 9 | Panel↔Node transport: REST + mTLS + keygen | ✅ done | `@peculiar/x509`, CA, выпуск нодных сертов, encoded payload, undici mTLS-клиент |
| 10 | Go node-agent skeleton | ✅ done | Go module, mTLS HTTPS-сервер, payload-decode, stub-хендлеры |
| 11 | `CoreAdapter` + `HysteriaAdapter` | ✅ done | Auth-callback HTTP, in-memory user state, subprocess skeleton (real spawn в Срезе 13) |
| 12 | 🆕 Subscription generator | ✅ done | `/sub/:token`, Hysteria2 URI, base64 plain + JSON формат |
| 13 | Сквозной флоу Hysteria2 (admin → user → реальный клиент) | ✅ done | Real-world integration; deploy runbook в `docs/deploy/hysteria-node.md` |
| 14 | Frontend skeleton (Vite + React + Mantine + TanStack Query + Zustand) | ✅ done | SPA, AppShell + login + Users/Nodes CRUD, one-time payload modal |
| 15 | Docker production build | ✅ done | Multi-stage Dockerfiles (panel-backend ~770 MB, frontend ~75 MB nginx, node ~14 MB distroless) + `docker-compose.prod.yml` |

### Подробности по срезам

#### Срез 2: Postgres + `.env` + Zod config

- Поднимаем Postgres через `docker-compose up -d postgres`
- Создаём `.env` с `DATABASE_URL=postgres://icepanel:icepanel_dev@localhost:5432/icepanel`
- Через node `--env-file` (нативный с Node 22) подгружаем переменные
- Создаём `src/config.ts` с Zod-схемой для всех переменных окружения, валидируем при старте
- В `index.ts` подключаемся к БД через `postgres`-драйвер, делаем `SELECT 1` при старте
- `/health` теперь проверяет ещё и БД: `{status:'ok', db:'ok'}`

#### Срез 3: Prisma + полная схема

- `pnpm add -D prisma`, `pnpm add @prisma/client`
- `pnpm prisma init` создаёт `prisma/schema.prisma`
- Описываем **всю схему сразу** (не только User):
  - `admin_users`, `api_tokens`
  - `nodes`, `inbounds`
  - `groups`, `group_members`, `group_inbounds`
  - `users`, `user_traffic` (split таблица)
  - `subscription_events` (audit log)
  - `subscription_request_history`
  - `node_user_usage_history`, `node_usage_history`
- `pnpm prisma migrate dev --name init` создаёт миграцию
- В `index.ts` создаём `PrismaClient`, делаем `await prisma.user.count()` в `/health`

#### Срез 4: CRUD users + Zod + auto-gen creds

- Создаём `src/routes/users.ts`
- Через Zod валидируем тело: `{ username, traffic_limit_bytes, traffic_limit_strategy, expire_at, ... }`
- При создании юзера **автогенерируем креды для всех протоколов**:
  - `hysteria_password` — random URL-safe 32 байта
  - `amneziawg_private_key` + `amneziawg_public_key` — `wgctrl` или `crypto.randomBytes`
  - `naive_password` — random
  - `xray_uuid` — `crypto.randomUUID()`
  - `subscription_token` — random 32 байта
  - `short_id` — nanoid
- bcrypt-хеш пароля админа (когда дойдём до admin_users)
- Возвращаем созданного user'а **без секретных полей** (через специальный mapper)
- Реализуем все эндпоинты: GET, GET by uuid, PUT, DELETE (soft), bulk-операции

#### Срез 5: JWT auth + rate-limiting + bcrypt

- `pnpm add @fastify/jwt @fastify/rate-limit bcrypt @types/bcrypt`
- `POST /auth/login` принимает `{username, password}`, проверяет bcrypt-хеш, возвращает JWT
- JWT payload минимальный: `{ sub: admin_uuid, role: 'admin' }`, exp = 24h
- Создаём Fastify-hook `requireAuth` — проверяет `Authorization: Bearer <token>`
- Защищённый эндпоинт `GET /auth/me` возвращает текущего админа
- Rate-limit:
  - На `/auth/login`: 5 попыток в минуту с IP
  - Глобально: 100 req/sec на `/api/*`
- Базовые тесты для критичных путей auth (срез 8 расширит)

#### Срез 6: Слои + event bus

- Refactor: разделить логику на:
  - `routes/` — только HTTP (запрос → вызов сервиса → ответ)
  - `services/` — бизнес-логика
  - `repositories/` — доступ к БД (запросы Prisma)
  - `events/` — обработчики событий (новое!)
- Создаём `src/container.ts` — простой DI контейнер
- Подключаем `eventemitter2`
- Декларируем доменные события: `UserCreatedEvent`, `UserStatusChangedEvent`, `UserTrafficResetEvent`
- Service публикует событие → handler в `events/` слое реагирует
- Пока обработчики ничего не делают (нет нод) — но архитектура готова

#### Срез 7: 🆕 Redis + BullMQ + scheduler

- Добавляем Redis в `docker-compose.yml`
- `pnpm add bullmq ioredis @fastify/redis`
- Создаём очереди: `node-users-queue`, `reset-traffic-queue`, `update-usage-queue`, `node-health-queue`
- Подключаем `@nestjs/schedule`-эквивалент или нативный `node-cron`
- Реализуем cron-расписание (4 reset-job'а, 3 review-job'а — рецепт от Remnawave):
  - `RESET_USER_TRAFFIC.DAILY` (00:05) — для strategy=`day`
  - `RESET_USER_TRAFFIC.WEEKLY` (Пн 00:15) — strategy=`week`
  - `RESET_USER_TRAFFIC.MONTHLY` (1-е число 00:20) — strategy=`month`
  - `RESET_USER_TRAFFIC.MONTHLY_ROLLING` (00:10) — rolling 30 days
  - `REVIEW_USERS.FIND_EXPIRED` (каждые 30s)
  - `REVIEW_USERS.FIND_EXCEEDED_TRAFFIC` (каждые 45s)
- Cron-задача → enqueue job → processor (пока mock, без нод)
- Event bus → handler → enqueue job (когда понадобится синк к ноде)

#### Срез 8: Тесты на Vitest

- `pnpm add -D vitest supertest @types/supertest`
- Unit-тесты для сервисов с замоканными repositories
- Integration-тесты для роутов (поднимают реальный Fastify + тестовая БД)
- Особое внимание: auth-флоу, rate-limit, валидация Zod
- `pnpm test` запускает всё

#### Срез 9: Panel↔Node transport — REST + mTLS + keygen

- Создаём `src/modules/keygen/`:
  - При первом старте панели — генерируем CA (cert + key) через `@peculiar/x509`
  - Сохраняем в БД (таблица `keygen_ca`)
  - Реализуем `generateNodeCert(ca, caKey)` для выпуска cert per node
  - `encodeNodePayload({ nodeCertPem, nodeKeyPem, caCertPem })` — base64-блоб для передачи на ноду
- Создаём `packages/shared/types.ts`:
  - Описываем все DTO для panel↔node API (`AddUserDto`, `RemoveUserDto`, `GetStatsResponse`, и т.д.)
  - Эти же типы используются и в Go-агенте (через json-теги одинакового формата)
- Создаём `src/modules/nodes/transport.ts`:
  - HTTPS-клиент с `https.Agent({ ca, cert, key, rejectUnauthorized: true })`
  - Методы: `addUser(node, user)`, `removeUser(node, userId)`, `getStats(node)`, `healthcheck(node)`
- BullMQ-processor для `node-users-queue` использует этот клиент

#### Срез 10: Go node-agent skeleton

- Создаём `apps/node/` с `go.mod`
- Реализуем HTTPS-сервер на Go с mTLS:
  - Принимает `payload` через env (base64-blob от панели)
  - Декодирует cert/key/CA
  - Слушает на `NODE_PORT` с `tls.Config{ClientAuth: RequireAndVerifyClientCert, ClientCAs: caPool}`
- Регистрирует эндпоинты-заглушки: `/healthz`, `/addUser`, `/removeUser`, `/getStats`
- При старте — POST на панель `/api/nodes/register` со своими данными
- Пока внутри ничего не делает — заглушки

#### Срез 11: CoreAdapter + HysteriaAdapter

- В `apps/node/internal/core/` определяем интерфейс `CoreAdapter`:
  ```go
  type CoreAdapter interface {
      Start(ctx context.Context) error
      Stop(ctx context.Context) error
      AddUser(user User) error
      RemoveUser(userID string) error
      GetStats() (*Stats, error)
      AuthCallback(secret string) (*AuthResult, error)
  }
  ```
- `HysteriaAdapter`:
  - Запускает реальный бинарник `hysteria server` через `os/exec`
  - Конфиг указывает `auth: type: http, http: { url: "http://localhost:9000/auth" }`
  - Реализуем HTTP-callback на `:9000/auth` — node-agent проверяет credential в локальном state
  - **Не перезапускает** Hysteria при добавлении user'а — просто обновляет локальный state
- Управление пользователями — мгновенное

#### Срез 12: 🆕 Subscription generator

- Endpoint `GET /sub/{shortUuid}` (на отдельном домене для prod, например `sub.example.com`)
- Логика:
  1. Проверить токен (subscriptionToken из users)
  2. Проверить status (DISABLED/EXPIRED → 403)
  3. Проверить hwid_device_limit (если установлен)
  4. Логировать в `subscription_request_history`
  5. Найти доступные inbound'ы юзера (через `groups`)
  6. Сгенерировать Hysteria2 URI: `hy2://password@server:port/?obfs=salamander&sni=example.com#NodeName`
  7. Вернуть как `text/plain` (массив URI по строке)
- Кэширование: Redis с TTL 60s (Remnawave: 3600s — для нас 60s достаточно в MVP)

**📌 Уточнение после изучения индустрии (2026-05-04):** в MVP делаем **2 формата**, не один:
- **Base64-URI list** (`Accept: text/plain` или дефолт) — universal-формат, работает с Hiddify, NekoRay, v2rayN и любыми сторонними клиентами
- **JSON структурированный** (`Accept: application/json`) — для нашего IcePath-VPN Mini-App (Go) и Ice-Client (Rust). Включает метаданные (квота, expiry, статус), парсится одной строкой через `json.Unmarshal` / `serde_json`

Mihomo / Singbox / XrayJSON шаблоны — Phase 2 (Срез 21). Subscription Response Rules (UA-matching) — Срез 22.

#### Срез 13: Сквозной флоу Hysteria2

- Admin создаёт user через `POST /users` в панели
- Панель публикует `UserCreatedEvent`
- Handler ставит job `addUser` в `node-users-queue`
- Processor вызывает `transport.addUser(node, user)` — REST POST с mTLS
- Нода добавляет user'а в HysteriaAdapter state
- Админ копирует subscription URL для user'а
- Реальный Hysteria2-клиент (например, hiddify-app) подключается → 🎉

#### Срез 14: Frontend skeleton

- `pnpm create vite apps/panel-frontend -- --template react-ts`
- Установка: Mantine 8, TanStack Query 5, Zustand 5, Axios, React Router DOM 6
- Backend: добавить **публичный** `GET /api/auth/status` (discovery — какие auth-методы и registration enabled). Без hook'а. Ответ: `{ authentication: { password: { enabled }, passkey: { enabled }, oauth2: { providers } }, registration: { enabled } }`. Фронт дёргает первым делом, чтобы понять — показывать «Create first admin» или «Login form»
- Страницы:
  - `/login` — форма логина админа
  - `/users` — таблица + создание/редактирование
  - `/nodes` — список нод
- API-клиент: общие типы из `packages/shared`

#### Срез 15: Docker production build

- `Dockerfile` для panel-backend (multi-stage: build с TS → run без dev-deps)
- `Dockerfile` для panel-frontend (build → nginx static serve)
- `Dockerfile` для node-agent (Go static binary)
- Обновляем `docker-compose.yml` чтобы запустить всё одной командой
- `.env.example` с подробными комментариями

---

## Фаза 2: Multi-core — добавляем 3 оставшихся ядра

**Цель:** валидировать абстракцию `CoreAdapter` на других протоколах. Доказать что добавить ядро = реализовать один интерфейс, остальное «бесплатно».

**Финальный результат фазы:** в админке можно создать юзера, выбрать любой из 4 протоколов (Hysteria2 / AmneziaWG / NaiveProxy / Xray), нода поднимает соответствующее ядро, юзер подключается.

### Срезы фазы 2 (примерный план)

| # | Название | Что вводим | Сложность |
|---|---|---|---|
| 16 | Refactor `CoreAdapter` под уроки фазы 1 | ✅ done | `Healthy()` метод, общий `subprocess` пакет, panel-side `core-adapters/` структура |
| 17 | `XrayAdapter` (VLESS+REALITY+Vision) | ✅ done | Config-restart pattern (gRPC AlterInbound оптимизация → Phase 3) |
| 18 | **Frontend: выбор протокола при создании юзера** | ✅ done | `users.enabledProtocols` JSON-колонка, subscription fan-out, Mantine MultiSelect + Badge-чипы |
| 19 | **`AmneziaWGAdapter`** | ✅ done | `amneziawg_peers` table + IP allocator, bootstrap script, config gen + obfuscation params, peer add/remove via `awg syncconf` with systemctl fallback, client wg-quick builder, mocked-CLI tests |
| 20 | **`NaiveProxyAdapter`** | ✅ done | bootstrap (xcaddy+forwardproxy@naive), Caddyfile generator, `caddy reload` pipeline with timeout, panel-side URI builder, mocked-CLI tests |
| 21 | **Multi-format subscription generator** | ✅ done | Clash YAML / Sing-box JSON / wg-quick conf / Xray JSON formatters + `?format=` query routing on `/sub/:token`; structured per-protocol endpoint shapes |
| 22 | **Subscription Response Rules (SRR)** | ✅ done | DB table + 7 seed rules, UA matcher with `(?i)` inline-flag support, CRUD endpoints, `/api/srr/test` preview, frontend `/srr` page with rule table + UA tester |
| 23 | **UI: graphical inbound editor** | ✅ done | inbounds CRUD with discriminated config schemas, subscription emission driven from inbounds (replaces env-driven Xray), per-protocol form Modal (Hysteria/Xray/AmneziaWG/Naive), Xray network selector (raw/xhttp/ws/grpc), x25519 keypair generator endpoint + Generate-button UX, CORS DELETE/PUT fix |

### 🎉 Phase 2 closed — `Phase 3` next

**Carried over from slice 23 (deferred to Phase 3 slices below):**
- Group ↔ inbound assignment UI (`group_inbounds` schema exists since slice 3 but is dormant — subscription fan-out doesn't filter by user's groups). Lift to slice 26.
- HTTPUpgrade + KCP transports for Xray. Lift to slice 24.
- Trojan + Shadowsocks subprotocols. Lift to slice 24.

### Подробности по срезам

#### Срез 16: Refactor `CoreAdapter` под уроки фазы 1

**Цель:** до того как добавлять три новых адаптера, отшлифовать интерфейс. Hysteria выявил пробелы — например `GenerateClientConfig(user)` нужен на стороне адаптера (каждый протокол строит свой URI/conf по-своему), а subprocess-management повторится в Xray/AmneziaWG/Naive.

**Что вводим:**
- Расширение `CoreAdapter` интерфейса:
  - `Healthy() bool` — для healthcheck-фан-аута. Срез 30 (Prometheus) полит status nodes.
  - `GenerateClientConfig(user core.User) (string, error)` — каждый адаптер сам строит URI/конфиг для клиента. Логика Hysteria URI builder переезжает из `panel-backend/subscription/formats.ts` в `node/internal/core/hysteria/adapter.go`. Subscription endpoint становится тонким — фан-аут на адаптеры через transport `GET /clientConfig?userId=X&protocol=Y`.
- Извлечь общий subprocess-management в `internal/core/subprocess.go`: `Run(ctx, binary, args...)`, log-streaming, graceful stop с SIGTERM+5s+SIGKILL, capture exit code. Hysteria/Xray/Naive все спавнят бинари — DRY.
- `LifecycleEvent` event-channel в адаптере (`onCrash`, `onReload`) — Phase 3 для auto-restart на crash.

**Коммиты (4):**
1. `feat(node)`: extend CoreAdapter with Healthy + GenerateClientConfig
2. `refactor(node)`: extract common subprocess management
3. `refactor(node)`: HysteriaAdapter generates own URI + reports health
4. `docs`: mark slice 16 done

**Gotchas:**
- Не переусложнять интерфейс. Если что-то нужно ОДНОМУ адаптеру (Hysteria-specific auth callback) — оставлять как private, не светить в `CoreAdapter`. Принцип: ISP.
- При перетаскивании URI builder'а `panel-backend → node` — не сломать существующий `/sub/:token` endpoint. Сделать через переходный период: backend сначала спрашивает ноду, потом fallback на свой builder.

#### Срез 17: XrayAdapter — gRPC API без рестарта

**Цель:** добавить поддержку Xray-core (VLESS/Reality/VMess/Trojan/Shadowsocks). Проверить что `CoreAdapter` интерфейс работает на чужом протоколе.

**Что вводим:**
- `apps/node/internal/core/xray/{adapter, grpc, config}.go`
- Спавн `xray run -c /etc/xray/config.json` через общий subprocess-runner
- Подключение к Xray gRPC API на `127.0.0.1:8080` (Xray слушает gRPC по умолчанию когда `api: { tag: "api", services: ["HandlerService", "StatsService"] }` в config)
- AddUser/RemoveUser через `proxy.HandlerService.AlterInbound` с `AddUserOperation` / `RemoveUserOperation`
- GetStats через `stats.StatsService.QueryStats` с `pattern: "user>>>email>>>"` per-user
- `GenerateClientConfig`: VLESS+REALITY URI с `pbk` (pubkey), `sid` (shortId), `fp` (fingerprint), `flow=xtls-rprx-vision`, `type=raw`, `sni`, `host`

**Ключевые решения** (из `reference_remnawave_modules.md` и `reference_xray.md`):
- v24.9.30 naming: `network: raw` (не `tcp`), `network: xhttp` (не `splithttp`). Старые имена deprecated.
- REALITY shortIds — **inbound-level** (общий пул на inbound), идентификация юзеров через `email` поле клиента (`email = userId`).
- Per-user stats требуют: `email` set + `policy.levels.0.statsUserUplink/Downlink: true` + блок `stats: {}`.
- Vision несовместим с mux, работает только над `network: raw`. Validate at config-build time.

**Коммиты (5-6):**
1. `chore(node)`: vendor xray gRPC proto definitions
2. `feat(node)`: XrayAdapter subprocess + initial config generation
3. `feat(node)`: XrayAdapter user mgmt via gRPC AlterInbound
4. `feat(node)`: XrayAdapter stats query + GenerateClientConfig (VLESS+REALITY URI)
5. `test(node)`: XrayAdapter tests with mock gRPC server
6. `docs`: mark slice 17 done

**Gotchas:**
- gRPC отвечает только после полной инициализации Xray. Если AddUser приходит до этого — refused. Решение: `Healthy()` возвращает `false` пока gRPC не отвечает на ping → BullMQ-воркер ретраит job.
- `email` уникальность в inbound — Xray дедуплицирует. Использовать `userId.toString()` как email.
- REALITY `target` (поддельный сайт) валидируется через `xray tls ping <target>:443` — добавить эту проверку в admin UI Среза 23.

#### Срез 18: Frontend protocol selector

**Цель:** дать админу выбирать какие протоколы доступны user'у при создании. Без этого все юзеры получают все 4 протокола = бессмысленно.

**Что вводим:**
- **Schema change**: `users.enabled_protocols` колонка `Json @default("[\"hysteria\"]")` — массив имён протоколов. Минимальная миграция, без отдельной таблицы (нативный multi-select).
- Backend: `subscription/service.ts` фильтрует endpoints по `user.enabledProtocols`
- Backend: `users.schemas.ts` — добавить `enabledProtocols: z.array(ProtocolName).default(['hysteria'])` в Create/Update
- Frontend: в `UserFormModal` — `MultiSelect` с 4 опциями (Hysteria/Xray/AmneziaWG/Naive)
- Frontend: в users-таблице новая колонка "Protocols" с `Badge`-чипами

**Коммиты (4):**
1. `feat(panel-backend)`: users.enabledProtocols column + schema validation
2. `feat(panel-backend)`: filter subscription endpoints by user's enabled protocols
3. `feat(panel-frontend)`: MultiSelect in UserFormModal + protocol badges in table
4. `docs`: mark slice 18 done

**Gotchas:**
- Default `['hysteria']` для существующих юзеров (миграция должна это прописать), иначе старые юзеры останутся без подписки.
- Срез 18 даёт user-level фильтрацию. Inbound-level (per-node, кастомные настройки конкретного inbound'а) — это уже Срез 23.

#### Срез 19: AmneziaWGAdapter — самый сложный

**Цель:** поддержка DPI-устойчивого WireGuard через AmneziaWG kernel module. DPI-стойкость отличает нас от обычного WG в Marzban-ах.

**Что вводим:**
- **Bootstrap скрипт** в `apps/node` (отдельный systemd-юнит или manual): установка `amneziawg-tools` через PPA (Ubuntu/Debian) или COPR (RHEL/Fedora). Проверка `amneziawg` kernel module загружен (`lsmod | grep amneziawg`). Fallback path для DKMS-failure → userspace `amneziawg-go`.
- `apps/node/internal/core/amneziawg/{adapter, config, ipallocator, syncconf}.go`
- **IP allocator**: subnet `10.0.0.0/24` per inbound (configurable), 254 пира на inbound. Mapping `userId → IP` персистится в БД — новая таблица `amneziawg_peers (id, user_id, inbound_id, ip, created_at)` с `UNIQUE(inbound_id, ip)`. Allocator берёт первый свободный IP из range.
- `[Interface]` config: PrivateKey + ListenPort + S1-S4/H1-H4 obfuscation (interface-immutable). Параметры из admin UI Среза 23.
- `[Peer]` block per user: PublicKey (`user.amneziawgPublicKey`) + AllowedIPs (`<allocated-ip>/32`).
- **Hot-reload**: `awg syncconf <iface> <(awg-quick strip <iface>)` обёрнут в `timeout 10s`. Если падает — fallback на `systemctl restart awg-quick@<iface>`.
- `GenerateClientConfig(user)`: возвращает client-side `[Interface]` + `[Peer]` config (`Endpoint = <node-public-ip>:<port>`, `AllowedIPs = 0.0.0.0/0`, AmneziaWG obfuscation params).

**Ключевые решения** (из `reference_amneziawg.md`):
- Kernel module — единственный production-путь. Замеры: 92 Mbps (kernel) vs 33 Mbps (Go userspace).
- S1-S4, H1-H4 — interface-immutable. Их ротация = bounce ВСЕХ клиентов.
- Recommended params для **Russian TSPU**: `Jc=3..6, Jmin=40..89, S1=72, S2=56, S3=32, S4=16, H1-H4` ranged. Для **mobile operators**: `Jc=3, Jmax narrower (70 vs 250)`. Phase 2 — два пресета "TSPU" / "Mobile" + "Custom".

**Коммиты (6-7):**
1. `feat(panel-backend)`: `amneziawg_peers` table + IP allocator service
2. `chore(node)`: bootstrap script for amneziawg-tools install + kernel-module check
3. `feat(node)`: AmneziaWGAdapter — config generation
4. `feat(node)`: AmneziaWGAdapter — peer add/remove via syncconf
5. `feat(node)`: AmneziaWGAdapter — GenerateClientConfig (client wg-quick conf)
6. `test(node)`: tests with mocked awg CLI
7. `docs`: mark slice 19 done

**Gotchas:**
- ARM-контейнеры / DKMS failures → kernel module не собирается. Fallback на userspace `amneziawg-go` (заметная просадка throughput, но работает). Адаптер должен это детектить.
- IP exhaustion (>254 user'ов на inbound) — Срез 23 поддержит multiple inbounds на одной ноде с разными subnet'ами.
- `awg syncconf` иногда висит на ядерном баге (видели несколько раз) — обязательный `timeout 10s` с fallback restart.

#### Срез 20: NaiveProxyAdapter — Caddy fork

**Цель:** поддержка NaiveProxy. Самый "хитрый" адаптер из-за специфики Naive (single-tenant standalone, multi-tenant только через Caddy fork).

**Что вводим:**
- **Bootstrap**: `xcaddy build --with github.com/caddyserver/forwardproxy=github.com/klzgrad/forwardproxy@naive` — при provisioning'е ноды собирает Caddy с naive plugin'ом. Скрипт устанавливает `xcaddy` и Go (если нет), потом билдит. Результат — `/usr/local/bin/caddy-naive`.
- `apps/node/internal/core/naive/{adapter, caddyfile, reload}.go`
- **Caddyfile templating**: один inbound = один блок:
  ```
  :443 example.com {
    tls me@example.com
    forward_proxy {
      basic_auth user1 password1
      basic_auth user2 password2
      hide_ip
      hide_via
      probe_resistance
    }
    file_server { root /var/www/html }
  }
  ```
- AddUser/RemoveUser → regenerate Caddyfile из state map → `caddy reload --config /etc/caddy/Caddyfile` (graceful, без дропа сессий)
- `GenerateClientConfig`: `naive+https://user:password@host:port?padding=true#name`

**Коммиты (5-6):**
1. `chore(node)`: xcaddy bootstrap script with naive plugin
2. `feat(node)`: NaiveProxyAdapter — Caddyfile generator (template + write)
3. `feat(node)`: NaiveProxyAdapter — caddy reload pipeline
4. `feat(node)`: NaiveProxyAdapter — GenerateClientConfig
5. `test(node)`: adapter tests with mocked caddy CLI
6. `docs`: mark slice 20 done

**Gotchas** (из `reference_naiveproxy.md`):
- **Per-user stats нет.** MVP: `GetStats` возвращает empty counters. В Phase 3 — два пути: парсить access-logs (хрупко) или форк `forwardproxy@naive` с per-user counters (постоянная rebase-нагрузка). Решение позже.
- **Force-kick невозможен.** После `caddy reload` старые сессии живут до idle/tunnel timeout (~10 минут). Disable user = не сможет создать НОВУЮ сессию. Документировать в admin UI.
- **Нет UDP, нет квот, нет expiry.** Всё на panel-уровне через "disable user".
- **Chromium-coupled релизы.** Каждые ~30 дней обновлять бинарник Naive чтобы TLS-fingerprint оставался свежим. Phase 3 — CI hook (Срез 33).

#### Срез 21: Multi-format subscription generator

**Цель:** клиенты разные — каждый ест свой формат. У нас уже есть base64-plain + JSON; добавляем 4 главных.

**Что вводим:**
- `apps/panel-backend/src/modules/subscription/formats/`:
  - `clash.ts` — Clash YAML (для Clash, ClashX, FlClash, NekoBox-iOS)
  - `singbox.ts` — Sing-box JSON (для Sing-box, Hiddify v2+)
  - `wgconf.ts` — wg-quick `.conf` (для AmneziaWG-app, любого WG-клиента)
  - `xrayjson.ts` — Xray JSON config (для v2rayN, NekoRay в Xray-режиме)
- `subscription.routes.ts` принимает `?format=clash|singbox|wgconf|xrayjson|json|plain` (default plain)
- Каждый builder получает `User + Endpoints[]` и возвращает строку нужного формата

**Коммиты (5-6):**
1. `feat(panel-backend)`: Clash YAML formatter + tests
2. `feat(panel-backend)`: Sing-box JSON formatter + tests
3. `feat(panel-backend)`: wg-quick conf formatter (AmneziaWG-only) + tests
4. `feat(panel-backend)`: Xray JSON formatter + tests
5. `feat(panel-backend)`: ?format= query param routing
6. `docs`: mark slice 21 done

**Gotchas:**
- Clash YAML очень большой schema — покрываем основное (proxies + proxy-groups + rules). Полный feature set не нужен для MVP.
- Sing-box эволюционирует быстро — стараться придерживаться minimal valid schema (1.10+), не использовать experimental fields.
- `wgconf` для AmneziaWG включает obfuscation params (Jc/Jmin/Jmax/S/H/I) — добавить в `[Interface]` секцию client-side.

#### Срез 22: Subscription Response Rules (SRR)

**Цель:** клиент представляется через `User-Agent`. Панель сама определяет нужный формат подписки. Без этого юзеру надо вручную добавлять `?format=clash` к URL — UX разваливается.

**Что вводим:**
- Новая таблица `subscription_response_rules`: `id, name, ua_pattern (regex string), format, priority (int), enabled`
- **Default rules** (seed-миграция):
  - `Hiddify` (UA contains `Hiddify`) → `singbox`
  - `NekoRay/NekoBox` → `singbox`
  - `Clash`, `ClashX`, `FlClash` → `clash`
  - `v2rayN` → `xrayjson`
  - `Sing-box` → `singbox`
  - `wireguard` (lowercase, AmneziaWG-app) → `wgconf`
  - default catch-all → `plain` (base64)
- Backend: при `GET /sub/:token` без `?format=` — матч UA против rules в порядке `priority ASC`, выбираем первый match'нувший
- Frontend: новая страница `/srr` — Mantine `Table` с rules, drag-and-drop порядок, regex preview, "Test against UA" поле для проверки

**Коммиты (5):**
1. `feat(panel-backend)`: subscription_response_rules migration + seed default rules
2. `feat(panel-backend)`: UA matcher in subscription endpoint
3. `feat(panel-backend)`: SRR CRUD endpoints
4. `feat(panel-frontend)`: SRR management page + test-UA-against-rule
5. `docs`: mark slice 22 done

**Gotchas:**
- Regex в UA — defensive: limit UA-string length to 256 chars + timeout regex match (10ms). Иначе ReDoS возможен.
- Rules priority — drag-and-drop в UI меняет `priority` через batch-PUT. Не делать ENUM, integer-priority более гибкий.

#### Срез 23: UI per-protocol inbound editor

**Цель:** админ создаёт inbounds (per-protocol конфиги) через UI, а не через psql + JSON. Закрывает Phase 2: после этого всё multi-core управляется визуально.

**Что вводим:**
- **Backend**: inbounds CRUD `POST/GET/PUT/DELETE /api/inbounds`. Schema уже есть (`Inbound` model в Prisma из Слайса 3) — добавляем routes/service/repository.
- **Frontend**: страница `/inbounds` с таблицей inbounds (group by node), Mantine `Accordion` или табы.
- **Per-protocol create wizard** (Stepper или Tabs внутри modal'а):
  - **Hysteria**: port, obfs (none / salamander+password), masquerade (404 / proxy URL), brutal CC up/down bandwidth (bps)
  - **Xray**: protocol selector (VLESS/VMess/Trojan/Shadowsocks), TLS settings (cert path / REALITY config: target, shortIds, dest, serverNames), Vision flag, network (raw/xhttp/grpc/websocket)
  - **AmneziaWG**: subnet CIDR (validation + collision check), obfuscation params (Jc/Jmin/Jmax/S1-S4/H1-H4) с тремя пресетами:
    - **TSPU** (Russia ISP DPI): Jc=3-6, Jmin=40, Jmax=89, S1=72, S2=56, S3=32, S4=16
    - **Mobile** (cellular operators): Jc=3 fixed, Jmax=70
    - **Custom** — все поля редактируемые
  - **Naive**: port, masquerade root path, fronting domain (TLS SNI)
- **Group → inbound assignment UI** — отдельная вкладка где админ привязывает inbounds к groups (M:N через group_inbounds)

**Коммиты (8-10):**
1. `feat(panel-backend)`: inbounds CRUD endpoints + Zod schemas
2. `feat(panel-frontend)`: inbounds list page + delete
3. `feat(panel-frontend)`: Hysteria inbound editor
4. `feat(panel-frontend)`: Xray inbound editor (REALITY/Vision/network selectors)
5. `feat(panel-frontend)`: AmneziaWG inbound editor (with TSPU/Mobile/Custom presets)
6. `feat(panel-frontend)`: Naive inbound editor
7. `feat(panel-frontend)`: group → inbound assignment UI
8. `test(panel-backend)`: integration tests for inbounds CRUD
9. `docs`: mark slice 23 done — **Phase 2 закрыта**

**Gotchas:**
- Edit на live-ноде иногда ломает существующие сессии (REALITY shortIds, AmneziaWG S/H — interface-immutable). Warning UI: "Saving will reset all client sessions on this inbound. Continue?"
- REALITY `target` валидация: backend делает `xray tls ping <target>:443` через node-agent (новый transport endpoint `POST /tls-ping`) → возвращает success/failure. Frontend показывает чек-марк или ошибку.
- AmneziaWG subnet collision detect (если уже есть inbound с `10.0.0.0/24`, второй не должен использовать пересекающийся) — backend Zod refines.

### Подробности по адаптерам

#### XrayAdapter (срез 17 — первый после Hysteria, потому что самый похожий)
- Управление через **gRPC API** Xray (есть встроенный)
- Используем `@remnawave/xtls-sdk` (готовая TS-обёртка) или пишем свою на Go (`google.golang.org/grpc`)
- Поддерживает **VLESS / Reality / VMess / Trojan / Shadowsocks** через один inbound
- Креды: уже есть `xray_uuid` в users
- Сложность: средне — gRPC API хорошо документирован

**📌 Уточнения после изучения Xray docs (см. [docs/references/xray.md](references/xray.md)):**
- **Naming change v24.9.30:** в новых конфигах используем `network: raw` (не `tcp`), `network: xhttp` (не `splithttp`). Старые имена parse как aliases но deprecated
- **REALITY shortIds — inbound-level, не client-level.** Менять их = `RemoveInbound + AddInbound` rebuild (рвёт все сессии). Поэтому: общий пул shortIds на inbound, идентификация юзеров через `email` поле клиента
- **Per-user stats требуют:** `email` set on client + `policy.levels.0.statsUserUplink/Downlink: true` (по умолчанию false!) + `stats: {}` блок
- **Vision несовместим с mux** и работает только над `network: raw` — валидируем при build-time в адаптере
- **Best combo для VLESS:** REALITY + `xtls-rprx-vision` + uTLS fingerprint. Validate `target` через `xray tls ping`

#### AmneziaWGAdapter (срез 19 — самый сложный)
- Управление через **`awg` CLI** (форк `wg`) + конфиг-файл
- Каждый user = peer в `awg0.conf`:
  ```
  [Peer]
  PublicKey = <user's amneziawg_public_key>
  AllowedIPs = 10.0.0.X/32
  ```
- Применение изменений: `awg syncconf awg0 <(awg-quick strip awg0)`
- **Не требует перезапуска** интерфейса — peer'ы добавляются hot
- Сложность **высоко**: нужен kernel-module `amneziawg`, root-доступ, выделение IP-адресов из подсети, генерация `Endpoint` для клиента

**📌 Уточнения после изучения AmneziaWG docs (см. [docs/references/amneziawg.md](references/amneziawg.md)):**
- **Kernel module — единственный production-путь.** Замеры: 92 Mbps (kernel) vs 33 Mbps (Go userspace). Адаптер обязан уметь установить kernel module через PPA (Ubuntu/Debian) или COPR (RHEL/Fedora) при bootstrap'е ноды
- **Конфиг-параметры обфускации `S1-S4`, `H1-H4` — interface-immutable.** Их ротация = bounce всех клиентов. Treat as constant per inbound lifetime
- **`Jc/Jmin/Jmax/I1-I5` — могут отличаться client↔server.** Для MVP делаем interface-fixed (bivlked-style); per-client дифференциация в Phase 3 если понадобится
- **`awg syncconf` обернуть в `timeout 10s`** + fallback на `systemctl restart awg-quick@awg0` (gotcha от bivlked installer)
- **Recommended params для Russian TSPU:** `Jc=3..6, Jmin=40..89, S1=72, S2=56, S3=32, S4=16, H1-H4` ranged. Mobile operators: `Jc=3 fixed, Jmax narrower (70 vs 250)`
- Опциональный fallback: `amneziawg-go` userspace для ARM-контейнеров и DKMS-failure боксов

#### NaiveProxyAdapter (срез 20)

**📌 Полностью переосмыслен после изучения NaiveProxy docs (см. [docs/references/naiveproxy.md](references/naiveproxy.md)). Адаптер — самый жирный из 4-х.**

**Почему сложно:** standalone бинарник `naive` как сервер — single-tenant. Multi-user **только** через Caddy с форком `klzgrad/forwardproxy@naive`:
```caddyfile
:443 example.com {
  tls me@example.com
  forward_proxy {
    basic_auth user1 password1
    basic_auth user2 password2
    hide_ip
    hide_via
    probe_resistance
  }
  file_server { root /var/www/html }
}
```

**Что делает адаптер:**
1. Билдит Caddy с плагином через `xcaddy build --with github.com/caddyserver/forwardproxy=github.com/klzgrad/forwardproxy@naive` (один раз при provisioning'е ноды)
2. Генерирует Caddyfile из БД с repeated `basic_auth` блоками
3. Add/remove user → regenerate config → `caddy reload --config /etc/caddy/Caddyfile` (graceful, без дропа сессий)

**Подводные камни:**
- **Per-user статистики upstream нет.** Опции: (a) парсить Caddy access-logs (хрупко) или (b) форкать `forwardproxy@naive` с per-user counters (постоянная rebase-нагрузка)
- **Force-kick невозможен** — после `caddy reload` старые сессии живут до idle/tunnel timeout
- **Нет UDP, нет квот, нет expiry** — всё на panel-уровне через `disable user`
- **Chromium-coupled релизы** — обновлять бинарник Naive каждые ~30 дней чтобы TLS-fingerprint оставался свежим. Stale binary = fingerprintable

**Subscription URL формат:** `naive+https://user:password@host:port?padding=true#name`. Креды `naive_password` берутся из `users` (уже генерим в Срезе 4).

**Время:** не «средне», как было — реалистично 4-7 дней соло работы.
- Сложность: средне — но компиляция самого бинарника из Chromium-форка требует особой среды

### Что общего у всех адаптеров (и почему это упростит работу в Phase 2)

После Phase 1 у нас уже будет:
- ✅ REST+mTLS транспорт работает
- ✅ Очереди и event-bus работают
- ✅ Auth, БД, миграции работают
- ✅ CoreAdapter интерфейс отшлифован на Hysteria
- ✅ Subscription generator готов (просто добавляем форматы)
- ✅ Frontend существует (просто добавляем UI для новых протоколов)

**Phase 2 = только "адаптер + UI per protocol"**, инфра уже есть. Поэтому каждый новый адаптер = 2-3 недели, а не месяцы.

---

## Фаза 3: Production-readiness

**Цель:** довести MVP до production-grade — multi-node, advanced routing (cascade, balancer), наблюдаемость, security, авто-деплой.

**Финальный результат:** реальные пользователи могут пользоваться панелью с >1 нодой, есть auto-failover, метрики, бэкапы, Telegram-уведомления.

### Срезы Phase 3 (renumbered after Remnawave gap-analysis 2026-05-05)

| # | Название | Что вводим | Сложность |
|---|---|---|---|
| 24 | **Xray defaults uplift + protocol/transport expansion** | XrayAdapter Go-side: `sniffing` for routing-by-protocol, `sockopt` (BBR/TFO/noDelay), `policy.levels.0.statsUserOnline/Uplink/Downlink` + `stats: {}` for **per-user stats** (currently zero counters!), `DNS-OUT` outbound + DNS-leak rule, BLOCK rules (`geoip:private`, port 25, `protocol: bittorrent` via sniffing). Plus: HTTPUpgrade + KCP transports, Trojan + Shadowsocks subprotocols (cipher selector). Carried from slice 23 deferral. | средне |
| 25 | **Hosts abstraction (inspired by Remnawave split)** | New `inbound_hosts (id, inbound_id, host, port_override?, sni?, path?, host_header?, name)` table. One inbound → many client-facing hosts. Subscription emits one URI per host, not per inbound. Enables cascade (one inbound, multiple node-fronts), CDN-fronting (ws+CDN host vs direct host on same Xray inbound), per-region hostname overrides. Frontend: tab inside Inbound editor for hosts. | средне |
| 26 | **Squad ACL — wire up dormant `group_inbounds`** | Schema exists from slice 3 but unused. `subscription.service.ts` filters inbounds by user's groups → `group_inbounds`. Frontend: groups CRUD page, drag-and-drop group↔inbound assignment, group multi-select on user form. Migration adds default "All" group with all-inbounds membership for existing users (zero-downtime). | низко |
| 27 | **Multi-node management UI** | Регионы, capacity per node, sticky user-to-node assignment, health-status dashboard | средне |
| 28 | **Server-side smart node selection** | GeoIP (MaxMind GeoLite2) + load-aware subscription generation. Панель отдаёт юзеру топ-3 лучших ноды per his geo + текущая нагрузка | средне |
| 29 | **Subscription `url-test` groups** | Generate `url-test` (Mihomo/Singbox), `burstObservatory + balancer` (Xray) во всех форматах. Client-side auto-failover поверх server-side selection | низко |
| 30 | **Cascade routing — first-class feature** | `inbound.config.cascade` поле + поддержка в HysteriaAdapter/XrayAdapter/NaiveProxyAdapter. **Без service-user хаков** как у Remnawave — inter-node secrets через keygen. Builds on Hosts (slice 25). | **высоко** |
| 31 | **Cross-protocol cascade** | Hysteria→Xray, Xray→Hysteria, любая комбинация через socks5/http outbound. Преимущество multi-core архитектуры | средне (после 30) |
| 32 | **Telegram bot + Webhook notifications** | grammy для бота, generic webhook фреймворк. События: user.expired, user.limited, node.unreachable, traffic.threshold | средне |
| 33 | **Prometheus metrics + Grafana dashboards** | Экспортим: per-user traffic, per-node bandwidth, queue stats, request latency. Готовые JSON-дашборды в репо | средне |
| 34 | **Backup/restore + recovery** | CLI-tool `ice-panel-backup`: dump БД + Redis AOF + .env шифрованно. Restore one-shot. Cron автобэкап на S3-compatible (опционально) | низко |
| 35 | **Security hardening** | npm audit в CI, advanced rate-limit (per-route customization), CSP refinement, input fuzzing tests, OWASP проверка | средне |
| 36 | **CI/CD via GitHub Actions** | Auto build Docker images на push в main, auto-publish в ghcr.io, deploy-документация для VPS | низко |
| 37 | **Bull-board + admin observability** | UI на `/admin/queues` для просмотра BullMQ jobs, dashboard со статистикой системы | низко |
| 38 | **(опц.) AmneziaWG cascade via iptables** | Полноценный multi-hop через WG через `MASQUERADE` rules. Сложнее остальных — отдельный slice если будет спрос | **высоко** (deferred) |
| 39 | **(опц.) External squads — presentation overrides** | Per-user-bucket branding (custom `Profile-Title`, host-overrides for VIPs, sub-page theming). Inspired by Remnawave external squads. Solves real but narrow VIP-tier UX. | низко (deferred) |

### Подробности по ключевым срезам

#### Срез 24: Multi-node management UI
- В админке: страница `/nodes` с фильтрами (по region, status, protocol)
- Карточка ноды: utilization (current_users / max_users), throughput last 24h, error rate
- Регионы как отдельная сущность (`regions` таблица): EU, ASIA, US — для группировки
- Sticky assignment: при создании юзера автоматически выбирается best node в его регионе

#### Срез 25: Server-side smart node selection
- При запросе `GET /sub/{token}` — определяем GeoIP юзера по `request.ip` (Cloudflare/X-Forwarded-For aware)
- Из доступных юзеру нод (через group → group_inbounds) берём:
  1. Те что в same region
  2. Сортируем по `currentUsers / maxUsers` ascending
  3. Топ-3
- В подписке отдаём именно их, не все
- Кэш 60s — повторные запросы за минуту получают ту же подборку

#### Срез 27: Cascade routing
- В таблицу `inbounds` поле `cascade_config JSONB` (nullable):
  ```json
  {
    "via_node_id": "uuid-of-NL-node",
    "rules": [
      { "match": "geoip:ru", "action": "direct" },
      { "match": "geosite:bittorrent", "action": "block" },
      { "match": "*", "action": "via" }
    ]
  }
  ```
- При sync ноды (`POST /sync` от панели), node-agent читает `cascade_config` и **сам генерирует**:
  - Outbound config своего ядра (Hysteria YAML / Xray JSON / Caddyfile + naive)
  - Routing rules
- **Inter-node credentials** генерятся keygen-модулем (Срез 9), хранятся в `node_peer_secrets` таблице — НЕ как фейк-юзеры
- Multi-hop поддерживается естественно: A→B→C значит на A в config указан `via: B`, на B указан `via: C`. Каждая нода видит только свой следующий hop

#### Срез 28: Cross-protocol cascade
- Допустим Hysteria-RU → Xray-DE → интернет
- Hysteria's `outbound.type: socks5` поднимает соединение к Xray-DE через локальный adapter в Xray (Xray слушает socks5 inbound на 127.0.0.1)
- Адаптеры договариваются через `node_peer_secrets`:
  - HysteriaAdapter знает: «outbound socks5 → 10.x.x.x:1080 user=service_h2x pass=...»
  - XrayAdapter на DE-ноде имеет inbound socks5 на :1080 с этими credentials, делает freedom outbound → интернет
- Прозрачно для админа — он просто выбирает "via NL-Xray" в UI

#### Срез 29: Telegram + Webhook notifications
- Grammy бот регится через `@BotFather` (как в Remnawave)
- Events list: `user.created`, `user.expired`, `user.limited`, `subscription.requested`, `node.unreachable`, `traffic.threshold_reached`
- Webhook: HMAC-SHA256 signature header (как Remnawave паттерн)
- Per-event subscription: разные chat_id для разных событий (`TELEGRAM_NOTIFY_USERS`, `TELEGRAM_NOTIFY_NODES` — паттерн из их docs)

---

---

## Фаза 4: Public release

1. Разделение монорепо на отдельные репы (`ice-panel-backend`, `ice-panel-frontend`, `ice-panel-node`)
2. Лендинг + документация на сайте
3. Публикация Docker-образов в ghcr.io
4. Объявление в комьюнити

---

## Принципы по которым работаем

1. **Вертикальные срезы.** Не строим всю архитектуру наперёд. Каждый срез — рабочий end-to-end кусок, который можно потрогать `curl`'ом.
2. **Атомарные коммиты.** Один коммит = одно логическое изменение. Conventional Commits с указанием scope.
3. **Не пишем своё то, что есть готовое.** Прокси-ядра, реверс-прокси, VPN-клиенты — всегда апстрим-бинарники.
4. **Интерфейсы важнее реализаций.** `CoreAdapter` спроектируем один раз и хорошо — реализации придут.
5. **Безопасность на этапе кода.** Пароли через bcrypt, JWT с экспирацией, валидация всего ввода через Zod, rate-limit на auth.
6. **Тесты не сразу, но рано.** Базовые тесты для auth идут вместе со срезом 5; полная инфраструктура — срез 8.
7. **Event-driven sync.** Любое изменение пользователя/ноды — через событие, не прямой вызов.
8. **Очереди для всего сетевого.** Cron, REST-вызовы к нодам, рассылки — всё через BullMQ, никаких блокирующих операций в HTTP-хендлерах.
9. **Reference oracle.** Перед каждым срезом смотрим как у Remnawave, берём что подходит, отбрасываем что не подходит. См. memory `reference_remnawave.md`.

---

## Что я (как пользователь панели) узнаю по ходу

К концу фазы 1 ты будешь уверенно владеть:
- TypeScript (типы, generics, интерфейсы, async)
- Node.js экосистемой (npm/pnpm, ESM, dotenv, child_process)
- Fastify (роуты, plugins, hooks, schemas)
- Prisma (schema, migrations, client API)
- PostgreSQL (basic SQL, индексы)
- Docker и Docker Compose (контейнеры, volumes, networks)
- Redis + BullMQ (очереди, cron-задачи, обработчики)
- Event-driven архитектурой (eventemitter, доменные события)
- mTLS (X.509, сертификаты, mutual auth)
- REST API дизайном (granular endpoints, bulk operations)
- Go (на уровне написать HTTPS-сервер с mTLS и управлять процессами)
- Тестированием (Vitest, моки, фикстуры)
- Vite + React + Mantine (SPA-разработка)
- Zustand + TanStack Query (state management)

К концу фазы 2 — добавишь работу с **сетевыми протоколами** (Hysteria2, WireGuard, NaiveProxy конфиги).

К концу фазы 3 — **production-инжиниринг** (метрики, мониторинг, CI/CD, уведомления).

---

## Как мы будем обновлять этот документ

После каждого закрытого среза:
1. Меняем статус с ⏭️ на ✅ в таблице срезов
2. Если по ходу всплыли новые инструменты или решения — добавляем в стек
3. Если что-то отложили — отмечаем явно
4. Коммитим как `docs: update roadmap after slice N`

После каждого major-разворота (как сейчас, после изучения Remnawave) — обновляем версию в шапке и коммитим как `docs: roadmap v{N}`.
