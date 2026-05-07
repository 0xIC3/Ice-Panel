# Ice-Panel Roadmap

> Этот документ — план развития проекта и справочник по используемым технологиям.
> Обновляется по мере прохождения срезов. Если в коде ушло вперёд — значит документ устарел, обнови его.
>
> **Версия:** 3.3 (2026-05-07) — VPS-тест #2 частично пройден: Xray ✅ (тот же ISP), Hysteria pipeline доказан loopback'ом на VPS, но реальный UDP-трафик от RU мобильного ISP до ice-naive-test не идёт (тротлится/блокируется на пути; Salamander obfs + QUIC-tuning не помогли). Не баг кода — выходит за рамки Phase 1 acceptance. Доимплементили обфускацию Salamander в подписочный pipeline (URI / sing-box / Clash) — для других ISP/VPS-комбо.
> **Версия:** 3.2 (2026-05-06) — slice 24b разбит на 24b1 (interface + Xray real impl, ✅ done) и 24b2/24b3/24b4 (Hysteria / AmneziaWG / Naive real impls — отдельные follow-up commits). Появился `docs/TESTING.md` с per-slice верификационными чек-листами.

> **Companion doc:** [TESTING.md](./TESTING.md) — конкретные чек-листы что и как проверять при закрытии каждого slice'а (local checks / VPS checks / edge cases / done criteria). Обновляется при закрытии slice + при поимке новых багов.

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

### 🎉 Phase 2 closed — multi-node validated, Phase 3 in progress

**Multi-node multi-protocol VPS validation (2026-05-06):** Two real VPS (SE Xray REALITY + DE Hysteria 2) under one panel; one subscription URL emits both endpoints; Hiddify connects to both with auto-balancer (69 ms hysteria / 117 ms xray). Validates the entire CoreAdapter abstraction + bootstrap-token flow + SRR auto-format end-to-end. Total cost of validation: 1 EUR in hourly VPS billing.

### Доп. срезы после Phase 2 (post-VPS-test ops harden + начало Phase 3)

| # | Название | Статус | Что вводим |
|---|---|---|---|
| 23.1 | **Panel-ops hotfix** | ✅ done | node.created → backfillNode job; Refresh-bootstrap UI button (`/api/nodes/:id/bootstrap`); 30s node-status poller; install-node.sh auto-config flags для Hysteria + Xray |
| 24a | **Auto-push inbound config (wire pipeline)** | ✅ done | `inbound.{created,updated,deleted}` events; BullMQ `inbound-sync` queue with coalesced jobId per node; `NodeTransport.applyInbounds()`; node-agent `/applyInbounds` endpoint with atomic persist to `/etc/ice-panel-node/inbounds.json` |
| 24b1 | **Per-adapter ApplyInbound — interface + Xray real impl** | ✅ done | `CoreAdapter.ApplyInbound(json.RawMessage)` в interface; **Xray: реальная реализация** (parse XrayInboundCfg → diff → regenerate config.json + restart subprocess; idempotent); Hysteria/AWG/Naive: stubs логируют + полагаются на inbounds.json persistence; dispatcher в `handleApplyInbounds` фан-аут по protocol name |
| 24b2 | **Hysteria ApplyInbound real impl** | ✅ done (code) | Rewrite `/etc/hysteria/config.yaml` + `systemctl restart hysteria-server.service` через injectable `RunCmd`. New `InboundConfig` (obfsPassword/masqueradeUrl/brutalUp/Down). Deterministic YAML render, atomic tmp+rename write, idempotent diff. Hostname/ACMEEmail из env (`HYSTERIA_HOSTNAME`/`HYSTERIA_ACME_EMAIL`). VPS-checks отложены до следующего cycle. |
| 24b3 | **AmneziaWG ApplyInbound real impl** | ✅ done (code) | Smart-diff classifier: `diffNone/diffSyncconf/diffRestart/diffSubnet`. S1-S4/Jc/Jmin/Jmax → `awg syncconf` (existing path). H1-H4/PrivateKey/ListenPort → `awg-quick down/up`. Subnet change c allocated peers → reject; без peers → restart. Wire JSON mirrors `AmneziawgConfigSchema`. VPS-checks отложены до cycle. |
| 24b4 | **NaiveProxy ApplyInbound real impl** | ⏭️ | Regenerate Caddyfile + `caddy reload` через injectable runCmd; no session drops |
| 24c | **Xray defaults uplift + transports/subprotocols** | ⏭️ | Per-user stats (StatsService gRPC + poller → user_traffic); HTTPUpgrade + KCP transports; Trojan + Shadowsocks subprotocols; sniffing + sockopt-BBR + DNS-OUT + BLOCK rules |
| 25 | **publicHost / publicPort на Inbound** | ✅ done | Two nullable columns; subscription generator prefers them over hostFromAddress(node.address); UI form fields; closes the cert-SAN gotcha at the architectural level |
| 26 | **Squad ACL (group_inbounds wiring)** | ✅ done (code) | Migration seeds default "All" squad with stable UUID + backfills group_inbounds and group_members. CRUD `/api/squads`. Subscription resolver filters inbounds by squad membership (UNION). User-create defaults to All. Inbound-created event auto-attaches to All. "All" is system-protected (403 on rename/delete). Squad-delete backstops orphan users into All. Frontend: `SquadsPage` CRUD, `UserFormModal` MultiSelect (All shown disabled-checked). VPS-checks отложены до cycle. |

**Carried over from slice 23 (lift to indicated slice):**
- Group ↔ inbound assignment UI (`group_inbounds` schema exists since slice 3 but is dormant). Lift to slice 26.
- ✅ HTTPUpgrade + KCP transports for Xray. Lifted to slice 24c.
- ✅ Trojan + Shadowsocks subprotocols. Lifted to slice 24c.

**Carried over from VPS test 2026-05-06 (all addressed):**
- ✅ Per-user Xray traffic stats — slice 24c
- ✅ Auto-push inbound config from panel → node — slice 24a (wire) + 24b (live reconfig)
- ✅ `publicHost` separation — slice 25
- ✅ AmneziaWG / NaiveProxy auto-config flags in `install-node.sh` — slice 24b will surface them once adapters can read `inbounds.json`

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

#### Срез 23.1: Panel-ops hotfix (post-VPS-test 2026-05-06)

**Цель:** закрыть три ортогональных пробела, найденных за один день multi-node-теста, прежде чем уходить в большой Phase 3 slice 24. Все три — операционные, не привязаны к конкретному протоколу.

**Что вводим:**

1. **`node.created` event handler + `backfillNode` BullMQ job.** При регистрации ноды панель шлёт `addUser` для каждого активного юзера на свежеподнятую ноду. Без этого новая нода стояла пустая до тех пор, пока админ не пересоздавал юзеров вручную (поймали live: Hysteria auth rejected pre-existing `hepp` user). Coalesced jobId `apply:<nodeId>` чтобы серия мутаций сжалась в один push. Idempotency on the node side keeps retries safe.

2. **Refresh-bootstrap UI button.** Иконка-ключ в строке ноды → `POST /api/nodes/:id/bootstrap` → модалка с новой install-командой. До этого admin делал curl с JWT-токеном из localStorage — workable но не нормальный flow. NodePayloadModal научился рендериться с `payload=''` (refresh не возвращает cert payload).

3. **Node-status poller.** BullMQ repeatable cron `node-healthcheck-poll` каждые 30 секунд: `NodeTransport.healthcheck()` per active node, маппит результат → `online`/`unreachable`, апдейтит `nodes.status` + `lastStatusChange` + `lastStatusMessage` **только при изменении** (нет churn записей в DB на каждый тик). Заменяет permanent `UNKNOWN` status в UI.

4. **install-node.sh auto-config flags.** Чтобы при первой установке протокол сразу запускался без SSH-редактирования env-файла:
   - Hysteria: `--hysteria-domain <fqdn>` + `--hysteria-email <addr>` (+ опционально `--hysteria-masquerade-url` / `--hysteria-obfs-password`) → пишет полный `/etc/hysteria/config.yaml` с ACME + masquerade + auth callback + drops `hysteria.service` systemd unit.
   - Xray: `--xray-reality-private-key` + `--xray-reality-short-ids` + `--xray-reality-server-names` + `--xray-reality-dest` + `--xray-port` → префиллит `/etc/ice-panel-node/env` так что REALITY-listener поднимается на старте без правок.
   - AWG / Naive — manual config до slice 24b.

**Файлы:**
- NEW: `apps/panel-backend/src/modules/nodes/nodes.events.ts` (registerNodeEventHandlers)
- NEW: `apps/panel-backend/src/modules/nodes/nodes.cron.ts` (pollNodeStatuses)
- EDIT: `apps/panel-backend/src/lib/event-bus.ts` (+ `node.created` event)
- EDIT: `apps/panel-backend/src/modules/nodes/nodes.service.ts` (emit node.created)
- EDIT: `apps/panel-backend/src/modules/users/users.queue.ts` (+ syncBackfillNode + BackfillNodeJobData)
- EDIT: `apps/panel-backend/src/modules/scheduler/scheduler.queue.ts` (+ node-healthcheck-poll job)
- EDIT: `apps/panel-backend/src/index.ts` (register handlers, start workers)
- EDIT: `apps/panel-frontend/src/pages/NodesPage.tsx` (Refresh-bootstrap button)
- EDIT: `apps/panel-frontend/src/components/NodePayloadModal.tsx` (handle empty payload)
- EDIT: `scripts/install-node.sh` (10 new CLI flags for Hysteria + Xray)

**Коммиты (1):**
1. `feat(slice-23.1)`: node-status poller + node.created backfill + refresh-bootstrap UI

**Gotchas:**
- node.created emit fires unconditionally; if no handler is registered (tests), the emit is a noop. No test changes needed.
- Coalesced jobId means the second mutation within retry-window will not enqueue a SECOND backfill — the first one will pick up the latest state when it runs. This is intentional but admins should not expect each Inbound CRUD to produce its own log line.
- Re-bootstrap doesn't trigger backfill — only initial node.created does. If admin re-bootstraps after several users were created, the new mTLS cert is fine but adapter map is empty until next user mutation. Slice 24b's `inbounds.json` persistence partially mitigates this (config survives restarts); for users themselves a `node.bootstrap-issued` event would fix it, listed for slice 27 (multi-node mgmt UI).

#### Срез 24a: Auto-push inbound config — wire pipeline (panel→node mTLS)

**Цель:** при создании/изменении/удалении inbound в UI или регистрации новой ноды панель собирает полный enabled-набор inbound'ов этой ноды и пушит через mTLS на node-agent. Node-agent атомарно persists в `/etc/ice-panel-node/inbounds.json` для следующего рестарта. Адаптеры в этом slice'е ещё НЕ умеют live-reconfig (это slice 24b) — но wire format готов.

**Что вводим:**

- **Wire DTO** (`packages/shared/src/transport.ts`): `ApplyInboundsRequest { inbounds: InboundDto[] }` + `ApplyInboundsResponse { ok, applied, skipped }`. `InboundDto` несёт `id`, `name`, `protocol`, `port`, и `config` как union `XrayInboundCfg | HysteriaInboundCfg | AmneziawgInboundCfg | NaiveInboundCfg` — каждый по форме идентичен Zod-схемам в `inbounds.schemas.ts`.

- **Panel-backend events:**
  - `event-bus.ts` → новые события `inbound.{created,updated,deleted}` с payload `{ inboundId, nodeId }`.
  - `inbounds.service.ts` эмитит на каждом CRUD после успешного DB-write. `deleteInbound` теперь делает `findUnique` ПЕРЕД delete чтобы достать `nodeId` для event payload (после delete row already gone).

- **Panel-backend queue** (`inbounds.queue.ts`): `inboundSyncQueue` BullMQ + `syncInboundsForNode(nodeId)`. Читает все enabled inbounds для ноды → пушит через `NodeTransport.applyInbounds()`. 30s timeout (xray restart needs slack). attempts=3, exponential backoff. **Coalesced jobId `apply:<nodeId>`**: серия inbound CRUD на одной ноде даёт один push, не N штук.

- **Panel-backend handler** (`inbounds.events.ts`): подписка на 4 события (`inbound.{created,updated,deleted}` + `node.created`) → enqueue `applyNodeInbounds`. `node.created` тут пушит **пустой** массив (нода ещё не имеет inbound'ов) — подготавливает node-agent в known good state.

- **NodeTransport** (`apps/panel-backend/src/modules/nodes/nodes.transport.ts`): метод `applyInbounds(req)` отправляет POST `/applyInbounds` через mTLS, 30s timeout.

- **Node-agent endpoint** (`apps/node/internal/server/server.go`): `POST /applyInbounds` декодирует `ApplyInboundsRequest`, атомарно пишет `/etc/ice-panel-node/inbounds.json` (mode 0600, через tmp+rename), логирует факт получения, отвечает `{ok: true, applied: N, skipped: 0}`.

- **Atomic write helper** в server.go: `writeInboundsAtomically(path, inbounds)` — `os.CreateTemp` в той же директории → `Write` → `Chmod 0600` → `os.Rename` → defer `os.Remove(tmpName)`. Crash mid-write не оставляет corrupt JSON.

- **Persist path** `/etc/ice-panel-node/inbounds.json` через env `NODE_INBOUNDS_STORE`. ReadWritePaths systemd-юнита расширены: `+/etc/ice-panel-node`. Иначе ProtectSystem=strict не пускает запись.

**Файлы:**
- NEW: `apps/panel-backend/src/modules/inbounds/inbounds.queue.ts`
- NEW: `apps/panel-backend/src/modules/inbounds/inbounds.events.ts`
- EDIT: `packages/shared/src/transport.ts` (ApplyInboundsRequest + InboundDto + per-protocol cfg shapes)
- EDIT: `apps/panel-backend/src/lib/event-bus.ts` (+ inbound.{created,updated,deleted})
- EDIT: `apps/panel-backend/src/modules/nodes/nodes.transport.ts` (+ applyInbounds method)
- EDIT: `apps/panel-backend/src/modules/inbounds/inbounds.service.ts` (emit events on CRUD)
- EDIT: `apps/panel-backend/src/index.ts` (register handlers, start worker, shutdown)
- EDIT: `apps/node/internal/dto/dto.go` (+ InboundDto + ApplyInboundsRequest/Response)
- EDIT: `apps/node/internal/server/server.go` (+ /applyInbounds handler + atomic write helper)
- EDIT: `apps/node/main.go` (+ NODE_INBOUNDS_STORE env wiring)
- EDIT: `scripts/install-node.sh` (ReadWritePaths += /etc/ice-panel-node)

**Коммиты (1):**
1. `feat(slice-24a)`: auto-push inbound config — panel→node mTLS pipeline

**Gotchas:**
- `applyInbounds` пушит **только enabled** inbounds (`where: { enabled: true }`). Disabled inbound на стороне ноды трактуется как удалённый — следующий push без него снимет listener.
- `port` в DTO — это actual listen port (что слушает xray/hysteria). `publicPort` (slice 25) живёт только на panel-side и через wire не идёт.
- При отсутствии `NODE_PAYLOAD` env (re-deploy сценарий) node-agent не стартует, но wire endpoint должен быть достижим — поэтому панель делает retry job. Coalesced jobId не блокирует retry если первый завершился rejected.
- `ApplyInboundsRequest.inbounds` может быть пустым — это валидно (нода без inbound'ов). Слайс 24b будет тиерить down listener'ы при empty array.

#### Срез 24b1: Per-adapter ApplyInbound — interface + Xray real impl ✅

**Status:** done 2026-05-06. Закрыл foundation для slice 24b — interface, dispatcher, и реальная Xray реализация. Hysteria/AmneziaWG/Naive остались stubs до 24b2-4.

**Что сделано:**

- **`CoreAdapter` интерфейс расширен** (`apps/node/internal/core/adapter.go`):
  ```go
  // ApplyInbound takes the protocol-specific config as raw JSON (the same
  // shape the panel pushes via /applyInbounds). Adapter parses what it needs,
  // regenerates its config file, and reloads/restarts the underlying server.
  // Idempotent — re-applying the same config is a no-op.
  ApplyInbound(cfg json.RawMessage) error
  ```
  Контракт: goroutine-safe, idempotent, defensive no-op для wrong protocol.

- **Xray real implementation** (`apps/node/internal/core/xray/adapter.go`):
  - `xrayInboundCfgWire` локальная struct mirrors `XrayInboundCfg` из `packages/shared/src/transport.ts`.
  - `ApplyInbound(rawCfg)`: parse JSON → build new `InboundConfig` (сохраняя Tag/ListenHost/ListenPort которые установлены при старте) → diff vs current через `inboundEqual`/`stringSliceEqual` → если идентично, return nil (no restart noise) → иначе swap `a.cfg.Inbound` + вызов `regenerateAndRestartLocked(context.Background())`.
  - **Idempotency** на уровне field-by-field сравнения, не byte-marshalling — быстрее.
  - **Background context** для restart — caller's request timeout не убивает xray в процессе bring-up.

- **Stubs для Hysteria/AmneziaWG/Naive:** логируют receipt + возвращают nil. Cfg уже persisted в `inbounds.json` через server.go (slice 24a), так что admin может SSH'ом перезагрузить вручную если очень надо. Real impls — в slice 24b2/24b3/24b4.

- **`handleApplyInbounds` dispatcher** (`apps/node/internal/server/server.go`):
  ```go
  for _, ib := range req.Inbounds {
    var matched core.CoreAdapter
    for _, adapter := range s.cfg.Adapters {
      if adapter.Name() == string(ib.Protocol) { matched = adapter; break }
    }
    if matched == nil {
      // log warn, persisted but skipped
      continue
    }
    if err := matched.ApplyInbound(ib.Config); err != nil {
      // log error, count failed
      failed++
      continue
    }
    applied++
  }
  ```
  Response carries `applied` / `skipped` (no matching adapter) / fails-with-500 если хоть один адаптер вернул error.

- **`fakeAdapter`** в `dispatch_test.go` обновлён — добавлен stub `ApplyInbound`. Все node-tests зелёные на WSL (Windows AppControl блокирует server.test.exe но WSL чисто).

**Файлы (commit 1):**
- EDIT: `apps/node/internal/core/adapter.go` (+ ApplyInbound в интерфейс)
- EDIT: `apps/node/internal/core/xray/adapter.go` (+ real ApplyInbound + helpers)
- EDIT: `apps/node/internal/core/hysteria/adapter.go` (stub)
- EDIT: `apps/node/internal/core/amneziawg/adapter.go` (stub)
- EDIT: `apps/node/internal/core/naive/adapter.go` (stub)
- EDIT: `apps/node/internal/server/server.go` (dispatcher)
- EDIT: `apps/node/internal/server/dispatch_test.go` (fakeAdapter ApplyInbound stub)

**Коммит:** `feat(slice-24b)`: per-adapter ApplyInbound — Xray live reconfig, others stubbed.

**Gotchas (caught):**
- Изначально хотел байт-сравнение через JSON marshal — но это медленно при идентичных конфигах (frequently re-pushed). Field-by-field equal быстрее, и stringSliceEqual для slice'ов.
- Background context для restart — иначе `req.Context()` через 30s timeout мог бы убить xray subprocess в момент bring-up. Нет, не должен — но безопаснее иметь dedicated background.
- Wire DTO field names (`realityShortIds` lowercase) vs Go convention (`RealityShortIDs`) — JSON tags решают.

**Что НЕ в 24b1** (отложено в 24b2-4):
- Hysteria/AWG/Naive real impls.
- Adapter startup-time чтение `inbounds.json` (сейчас env vars fallback). Будет добавлено вместе с real impls — иначе stub'ы будут читать json и ничего не делать.

#### Срез 24b2: Hysteria ApplyInbound real impl ⏭️

**Цель:** убрать последний manual-edit step для Hysteria-нод. Сейчас admin задаёт `--hysteria-domain`/`--hysteria-email` при `install-node.sh`; после первого запуска panel не может изменить domain / masquerade / obfs без SSH.

**Что вводим:**

- В Hysteria adapter:
  - Хранить `Config.HysteriaConfigPath` (default `/etc/hysteria/config.yaml`).
  - Хранить `Config.HysteriaServiceName` (default `hysteria.service`).
  - `ApplyInbound`: parse `HysteriaInboundCfg` → rewrite `/etc/hysteria/config.yaml` с новыми obfs/masquerade/brutal полями (preserving ACME domain/email — эти НЕ в inbound DTO, они install-time константы) → `runCmd("systemctl", "restart", "hysteria.service")`.
- **Injectable `runCmd`** для тестов: тип `func(ctx context.Context, name string, args ...string) ([]byte, error)`. Default — `exec.Command`. Tests подсовывают mock.
- **Idempotency**: diff vs последнего применённого `HysteriaInboundCfg` (хранится в adapter в-памяти). Идентично → no-op.

**Gotchas:**
- node-agent runs as root → systemctl restart работает. Но это **cross-systemd-unit зависимость** — node-agent тушит другой unit. Документировать в `docs/deploy/install.md`.
- Если admin не задал `--hysteria-domain`/`--hysteria-email` (callback-only mode) — `/etc/hysteria/config.yaml` отсутствует. ApplyInbound пишет файл с placeholder ACME settings, но без них Hysteria не запустится. Решение: ApplyInbound для Hysteria требует чтобы установка прошла с domain — иначе error «hysteria.service not configured for ACME».
- Restart вызывает session drops у уже подключённых юзеров (UDP-сессия не survives). Для obfs change это inevitable. Документировать в UI: «Saving will reset Hysteria sessions».

**Коммит:** `feat(node-hysteria)`: ApplyInbound — rewrite config.yaml + systemctl restart.

#### Срез 24b3: AmneziaWG ApplyInbound real impl ⏭️

**Цель:** live reconfig AWG inbound через `awg syncconf` (no-drop) когда возможно, fallback на full restart для interface-level changes.

**Что вводим:**

- `ApplyInbound` parse `AmneziawgInboundCfg`:
  - **H1-H4 changed** → full `systemctl restart awg-quick@<iface>` (interface-level, requires reload).
  - **Только peers / S1-S4 / Jc/Jmin/Jmax / postUp/postDown changed** → regenerate config + `awg syncconf <iface> <(awg-quick strip <conf>)`.
  - **subnet changed** → full restart + IP allocator validation (нельзя менять subnet когда уже выданы IP юзерам — backend отбивает заранее в Zod).
- Adapter уже имеет `regenerateAndSyncLocked` — переиспользуем + добавляем classifier diff.
- Idempotency через diff с предыдущим cfg.

**Gotchas:**
- `subnet` change ломает существующих peers (их IP теперь invalid). UI должен warn. Backend Zod должен отбивать subnet-change на уровне UpdateInbound если есть allocated peers (не должно происходить нормально).
- `awg syncconf` под root — node-agent уже root.
- DKMS-fallback (userspace `amneziawg-go`) работает но slower — для него full restart требуется чаще.

**Коммит:** `feat(node-amneziawg)`: ApplyInbound — smart syncconf vs restart по diff.

#### Срез 24b4: Naive ApplyInbound real impl ⏭️

**Цель:** live reconfig NaiveProxy через `caddy reload`.

**Что вводим:**

- `ApplyInbound` parse `NaiveInboundCfg`:
  - Update `cfg.Inbound.Hostname` / `TLSEmail` / `MasqueradeRoot`.
  - Call `writeCurrentCaddyfileLocked()` (метод уже есть для users).
  - `runCmd("caddy", "reload", "--config", a.cfg.ConfigPath, "--adapter", "caddyfile")`.
- Idempotency через cfg diff.

**Gotchas:**
- TLS hostname change → Caddy запросит новый LE-cert → может попасть в LE rate limiter (5 certs / 7 days per FQDN). UI warn admin.
- `caddy reload` graceful — existing connections live until idle/tunnel timeout (~10 min).
- masqueradeRoot — directory which Caddy serves to non-authenticated probers. Проверка что dir exists в Apply (иначе reload fail).

**Коммит:** `feat(node-naive)`: ApplyInbound — regen Caddyfile + caddy reload.

#### Срез 25: publicHost / publicPort separation на Inbound

**Цель:** разорвать перегрузку `node.address` — сейчас он одновременно (а) control-plane endpoint для panel→node mTLS и (б) public host в client-URL. Любая попытка поменять `node.address` post-create ломает cert SAN (поймали live на VPS-тесте: addUser fail → fetch failed → весь pipeline стоит). Slice 25 v1: две nullable колонки на Inbound. Slice 30 (cascade) расширит до полноценной Hosts abstraction (один inbound → много host'ов).

**Что вводим:**

- **Schema migration** (`20260506200000_add_inbound_public_host`):
  ```sql
  ALTER TABLE "inbounds"
    ADD COLUMN "public_host" VARCHAR(253),
    ADD COLUMN "public_port" INTEGER;
  ```

- **Backend Zod** (`inbounds.schemas.ts`):
  - `PublicHostSchema` — RFC-1123 hostname regex, max 253 chars.
  - `BaseFields.publicHost: optional` — empty string transforms to `undefined` (form clear).
  - `UpdateInboundSchema.publicHost: nullable` — `null` clears, `undefined` keeps current.
  - Аналогично для `publicPort`.

- **Backend service** (`inbounds.service.ts`): `createInbound` пишет `publicHost ?? null` / `publicPort ?? null`. `updateInbound` использует Prisma's `undefined` semantics: `publicHost === undefined ? undefined : input.publicHost` — так null проходит как «explicit clear».

- **Subscription generator** (`subscription.service.ts`):
  ```ts
  const host = ib.publicHost ?? hostFromAddress(ib.node.address);
  const port = ib.publicPort ?? ib.port;
  ```
  Все 4 protocol-эмиттеров используют local `host`/`port`. Меняет sed: `port: ib.port` → `port:` (shorthand с local `port`).

- **Inbound queue → node** (`inbounds.queue.ts`): `fetchEnabledInbounds` НЕ шлёт `publicHost`/`publicPort` через wire — это panel-only концепты для emit URL. Через mTLS уходит только actual listen `port`.

- **Frontend types** (`api.ts`): Inbound получает `publicHost: string | null` + `publicPort: number | null`. Create/Update inputs принимают опциональные значения.

- **Frontend form** (`InboundFormModal.tsx`): два новых TextInput / NumberInput в общей секции под Port. Help text объясняет когда заполнять. Empty string трактуется как clear.

**Что **НЕ** в этом слайсе** (и ждёт slice 30 cascade):
- One inbound → multiple hosts (`inbound_hosts` отдельной таблицей).
- Per-host SNI / path / Host header overrides.
- Cascade-aware host selection.

Текущий slice 25 v1 решает 95% реальных кейсов одним полем. Полная Hosts abstraction (slice 30) — when cascade routing actually arrives.

**Файлы:**
- NEW: `apps/panel-backend/prisma/migrations/20260506200000_add_inbound_public_host/migration.sql`
- EDIT: `apps/panel-backend/prisma/schema.prisma` (+ publicHost, publicPort)
- EDIT: `apps/panel-backend/src/modules/inbounds/inbounds.schemas.ts`
- EDIT: `apps/panel-backend/src/modules/inbounds/inbounds.service.ts`
- EDIT: `apps/panel-backend/src/modules/inbounds/inbounds.queue.ts` (no wire propagation)
- EDIT: `apps/panel-backend/src/modules/subscription/subscription.service.ts` (use override)
- EDIT: `apps/panel-frontend/src/lib/api.ts`
- EDIT: `apps/panel-frontend/src/components/InboundFormModal.tsx`

**Коммиты (1):**
1. `feat(slice-25)`: publicHost / publicPort separation on Inbound

**Tests:** 193/193 passing после миграции test-DB.

**Gotchas:**
- Migration nullable — existing rows получают NULL, продолжают работать через fallback на `node.address`. Zero-downtime.
- Empty string в форме vs explicit null в API — UI решает: кладём `null` если empty, иначе trimmed value. Бэкенд treats both equivalently.
- При import/clone inbound — копируется publicHost/publicPort вместе с config. Может быть нежелательно если новый inbound на другой ноде → admin должен править вручную. Future ergonomics: clear publicHost on clone.

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

### Срезы Phase 3 (renumbered after Remnawave gap-analysis 2026-05-05; updated after VPS test 2026-05-06)

Status as of 2026-05-06:
- Slice 23.1, 24a, 24b1, 25 — ✅ done.
- Slice 24b2/24b3/24b4 — ⏭️ next (Hysteria / AmneziaWG / Naive ApplyInbound real impls).
- Slice 24c (Xray defaults uplift + per-user stats), 26+ — planned.

| # | Название | Status | Что вводим |
|---|---|---|---|
| 23.1 | Panel-ops hotfix (poller / backfill / refresh-button) | ✅ done | см. подробности выше |
| 24a | Auto-push wire pipeline panel→node | ✅ done | см. подробности выше |
| 24b1 | Per-adapter ApplyInbound interface + Xray real impl | ✅ done | `CoreAdapter.ApplyInbound`; Xray idempotent regen+restart; Hys/AWG/Naive stubs; dispatcher по protocol name |
| 24b2 | Hysteria ApplyInbound real impl | ⏭️ next | rewrite config.yaml + systemctl restart hysteria.service |
| 24b3 | AmneziaWG ApplyInbound real impl | ⏭️ | smart awg syncconf vs full restart по diff |
| 24b4 | Naive ApplyInbound real impl | ⏭️ | regen Caddyfile + caddy reload |
| 24c | **Xray defaults uplift + transports/subprotocols** | ⏭️ | per-user stats (`statsUserUplink`/`Downlink` + StatsService gRPC), HTTPUpgrade + KCP transports, Trojan + Shadowsocks subprotocols, sniffing, sockopt-BBR, DNS-OUT, BLOCK rules |
| 25 | publicHost / publicPort на Inbound | ✅ done | см. подробности выше |
| 26 | **Squad ACL** — wire up dormant `group_inbounds` | ⏭️ | groups CRUD UI + group↔inbound assignment + subscription filter |
| 27 | **Multi-node management UI** | ⏭️ | Регионы, capacity per node, health dashboard, sticky user→node |
| 28 | **Server-side smart node selection** | ⏭️ | GeoIP (MaxMind GeoLite2) + load-aware subscription gen |
| 29 | **Subscription `url-test` groups** | ⏭️ | Mihomo/Singbox `url-test`, Xray `burstObservatory + balancer`, client-side failover |
| 30 | **Hosts abstraction (full)** + **Cascade routing** | ⏭️ | `inbound_hosts` table (one inbound → many hosts) + `cascade_config` JSONB + multi-hop через keygen-issued inter-node secrets (NOT fake-user trick) |
| 31 | **Cross-protocol cascade** | ⏭️ | Hysteria→Xray, Xray→Hysteria через socks5/http outbound |
| 32 | **Telegram bot + Webhook notifications** | ⏭️ | grammy + HMAC-SHA256 webhook framework |
| 33 | **Prometheus metrics + Grafana dashboards** | ⏭️ | per-user / per-node / queue / latency exporters + готовые JSON-дашборды |
| 34 | **Backup / restore CLI** | ⏭️ | `ice-panel-backup` dump BB + Redis AOF + .env шифр., S3-compatible cron |
| 35 | **Security hardening** | ⏭️ | npm audit в CI, per-route rate-limits, CSP refinement, fuzzing |
| 36 | **CI/CD via GitHub Actions** | ⏭️ | Auto Docker build на push, ghcr.io publish, deploy docs |
| 37 | **Bull-board + observability admin** | ⏭️ | `/admin/queues` UI |
| 38 | (опц.) AmneziaWG cascade via iptables | deferred | Multi-hop WG через MASQUERADE rules |
| 39 | (опц.) External squads — presentation overrides | deferred | Per-user-bucket branding |

### Подробности по срезам Phase 3

#### Срез 24c: Xray defaults uplift + transports + subprotocols

**Цель:** превратить наш Xray из «работает, но minimal» в полноценный prod-grade core. Главные пункты — **per-user traffic stats** (без них биллинг не работает) и расширение transport/protocol матрицы.

**Что вводим:**

1. **Per-user stats:**
   - В Xray config добавляем глобальный `stats: {}` блок + `api: { tag: "api", services: ["StatsService"] }` + inbound на 127.0.0.1:8080 с тегом api.
   - В `policy.levels.0` устанавливаем `statsUserUplink: true`, `statsUserDownlink: true` — счётчики per-user.
   - Каждому VLESS клиенту в config добавляем `email: <userId>` — пусть Xray использует его как ключ статистики.
   - Node-side: `xray-grpc-client` package (vendoring proto definitions из `XTLS/Xray-core` repo), Go-методы `QueryStats` (паттерн `user>>>email>>>traffic>>>uplink`/`downlink`).
   - Polling cron в node-agent (~60s): собирает дельты, отдаёт через расширенный `GET /stats` panel-у. Сейчас он возвращает заглушки; теперь возвращает реальные `UserStats[]`.
   - Panel-side: уже есть `getStats` worker и `user_traffic` таблица. Расширяем worker писать дельты через UPSERT, использовать `consumptionMultiplier` ноды.

2. **HTTPUpgrade transport** (`network: 'httpupgrade'` в Xray config):
   - Расширить `XrayInboundCfg`: `network: 'raw'|'xhttp'|'ws'|'grpc'|'httpupgrade'|'kcp'`.
   - URI-builder обновить: `type=httpupgrade&path=/path&host=cdn.example.com`.
   - Use case: WebSocket-like, но без overhead'а WS-handshake. Хорош под CDN.

3. **KCP transport** (UDP-based, для lossy networks):
   - `network: 'kcp'`, дополнительные fields: `mtu`, `tti`, `uplinkCapacity`, `downlinkCapacity`, `congestion`, `seed`.
   - URI: `type=kcp&seed=<>&headerType=<>`.

4. **Trojan subprotocol:**
   - Trojan = подобие VLESS, password-based, выглядит как нормальный TLS-сайт. Использует общий transport stack.
   - Новый Zod schema `TrojanConfigSchema` (password, certs или REALITY).
   - URI builder `buildTrojanUri`: `trojan://<password>@host:port?security=tls&sni=...#name`.
   - Singbox + Clash format support.

5. **Shadowsocks subprotocol:**
   - Cipher selector: `chacha20-ietf-poly1305`, `aes-256-gcm`, `2022-blake3-aes-256-gcm` (SS2022 — современный).
   - Server password vs per-user password (panel выдаёт per-user).
   - URI: `ss://<base64(method:password)>@host:port#name`.

6. **Smart routing defaults в Xray config:**
   - `sniffing: { enabled: true, destOverride: ["http", "tls", "quic"] }` — для routing по протоколам.
   - `sockopt: { tcpFastOpen: true, tcpCongestion: "bbr", noDelay: true }` — заметный буст throughput.
   - `outbounds`: `freedom`, `blackhole`, **новый `dns-out`** (`type: dns`).
   - `routing.rules`: `domain:geosite:private → blackhole`, `port:25 → blackhole`, `protocol:bittorrent → blackhole` (anti-leak), DNS queries → dns-out (anti-DNS-leak).

**Файлы:**
- EDIT: `apps/panel-backend/src/modules/inbounds/inbounds.schemas.ts` (network enum + httpupgrade/kcp params + Trojan/SS schemas)
- EDIT: `apps/panel-backend/src/core-adapters/xray/uri.ts` (URI builders for new transports + Trojan + SS)
- NEW: `apps/panel-backend/src/core-adapters/xray/grpc.ts` или `apps/panel-backend/src/modules/stats/` (panel-side stats ingest)
- EDIT: `apps/node/internal/core/xray/{config,adapter}.go` (stats config + transports + subprotocols)
- NEW: `apps/node/internal/core/xray/grpc/` (vendored proto + client)
- EDIT: `apps/node/internal/core/xray/adapter.go` (`GetStats` calls grpc, returns real bytes)
- EDIT: `packages/shared/src/transport.ts` (XrayInboundCfg gets new fields; Trojan/SS DTOs)
- EDIT: `apps/panel-frontend/src/components/InboundFormModal.tsx` (transport-specific forms)
- + tests (URI builders, grpc client mock)

**Коммиты (~10):**
1. `feat(xray)`: vendored proto + grpc StatsService client
2. `feat(node-xray)`: write per-user stats config + email-as-userId
3. `feat(node-xray)`: GetStats returns real bytes
4. `feat(panel)`: stats poller + user_traffic UPSERT integration
5. `feat(xray)`: HTTPUpgrade transport
6. `feat(xray)`: KCP transport
7. `feat(xray)`: Trojan subprotocol
8. `feat(xray)`: Shadowsocks subprotocol (incl. SS2022)
9. `feat(xray)`: routing defaults — sniffing + sockopt-BBR + DNS-OUT + BLOCK rules
10. `docs`: mark slice 24c done

**Gotchas:**
- xray-core gRPC требует matching proto-definitions версии. Vendor — фикс снапшот, обновлять руками раз в quarter (или при крупном breaking change в Xray).
- `email` field в Xray inbound user — **не тот email юзера в нашей БД**. Это просто строка-идентификатор. Используем `userId` (UUID) тут, не настоящий email.
- KCP UDP конфликтует с Hysteria если оба на одной ноде (один UDP-port). Validation на уровне Inbound creation: error если UDP-port collision.
- SS2022 cipher требует Xray ≥ v1.8. Нужно прокинуть version-check в Inbound form.
- BBR требует `net.core.default_qdisc=fq` + `net.ipv4.tcp_congestion_control=bbr` в sysctl. install-node.sh должен это поставить (slice 24b/24c добавит этот шаг).

#### Срез 26: Squad ACL — wire up dormant `group_inbounds`

**Цель:** оживить уже существующую (со slice 3) таблицу `group_inbounds`. Сейчас все юзеры видят все inbounds в подписке. После slice 26 admin может разделить «trial»-юзеров на их подмножество inbound'ов, «paid» на другое, etc.

**Что вводим:**

- **Backend:** `subscription.service.ts` фильтрует inbounds по `user.groups → group_inbounds`. Если у юзера нет групп — видит все (legacy compat).
- **Migration:** seed-row «All» group, `INSERT INTO group_inbounds SELECT 'all-group-id', id FROM inbounds` чтобы существующие deploy не сломались. Existing users автоматически join'аются в эту группу через триггер или при first sub fetch.
- **Frontend** `/groups` page: list / create / edit / delete. На странице группы — drag-and-drop assignments (slot inbounds в группу).
- **User form:** MultiSelect groups (default `[All]`).
- **Inbound form:** read-only summary "Visible to N groups" с link на групп-страницу.

**Файлы:**
- EDIT: `apps/panel-backend/src/modules/subscription/subscription.service.ts` (filter)
- EDIT: `apps/panel-backend/src/modules/users/users.service.ts` (assign default group on create)
- NEW: `apps/panel-backend/src/modules/groups/{groups.service,routes,schemas,mapper}.ts`
- NEW: `apps/panel-backend/prisma/migrations/.../add_default_all_group_seed.sql`
- NEW: `apps/panel-frontend/src/pages/GroupsPage.tsx` + GroupFormModal + DnDAssignments
- EDIT: `apps/panel-frontend/src/components/UserFormModal.tsx` (groups MultiSelect)

**Коммиты (~5):**
1. `feat(panel)`: groups CRUD endpoints + service
2. `feat(panel)`: subscription filter by groups
3. `feat(frontend)`: GroupsPage + drag-and-drop group↔inbound
4. `feat(frontend)`: UserFormModal groups MultiSelect
5. `docs`: mark slice 26 done

**Gotchas:**
- Default-«All»-group не должна показываться в form'е как чек-бокс — она implicit. Хранить flag `groups.isDefault` чтобы UI её скрывал.
- DnD reordering важен на UI для prioritization когда юзер в multiple groups (intersection vs union — берём union по умолчанию).
- При delete group → юзеры в ней должны fall-through в All, не остаться без подписки. Backend service handles cascade cleanup.

#### Срез 27: Multi-node management UI

**Цель:** scale UI чтобы 10+ нод не превратились в bulk текста. Регионы как concept, capacity warning'и, health-dashboard на одной странице.

**Что вводим:**

- **Schema:** new `regions` table (`id`, `name`, `code`), FK на `nodes.regionId` (nullable, NULL = unspecified).
- **Schema:** `nodes.maxUsers: int?` (capacity hint для balancer'а в slice 28).
- **Frontend `/nodes`:**
  - Filters: region, protocol, status.
  - Cards (вместо таблицы) для widescreen view: utilization bar `currentUsers / maxUsers`, throughput last 24h sparkline, error rate %, last status message.
  - Group by region collapse / expand.
- **Health dashboard at top of page:** `online: 12 / 14 nodes`, `unreachable: 2`, `traffic last 24h: 480 GB`.
- **Sticky user-to-node assignment:** при create user — backend выбирает best node в региона юзера (если задан), записывает в `users.preferredNodeId`. Subscription generator берёт preferred первой, остальные fallback. Это NOT mandatory routing — просто affinity hint.

**Зависимости:** требует slice 24c (нужны реальные `currentUsers` через stats) для accurate utilization. До 24c — показываем `?` в utilization bar.

#### Срез 28: Server-side smart node selection

**Цель:** при `GET /sub/:token` отдавать клиенту топ-N нод подобранных по latency + load, а не все его доступные. Нужно для real-world deployment'ов с 10+ регионами.

**Что вводим:**

- **GeoIP integration:** MaxMind GeoLite2 City DB (free tier, 500k requests/month). Хранится локально в backend контейнере, обновляется monthly через cron.
- **Selection algo:**
  ```ts
  function selectNodes(user, ip): NodeRow[] {
    const userGeo = geoip.lookup(ip);
    const eligible = nodesAccessibleTo(user); // group_inbounds filter
    const ranked = eligible
      .map(n => ({ n, score: scoreFor(n, userGeo) }))
      .sort((a, b) => b.score - a.score);
    return ranked.slice(0, 3).map(r => r.n);
  }

  function scoreFor(node, userGeo): number {
    const sameRegion = node.region.code === userGeo.region ? 100 : 0;
    const utilization = 1 - (node.currentUsers / node.maxUsers);  // 0..1
    return sameRegion + utilization * 50;
  }
  ```
- **Cache 60s** — avoid pounding GeoIP DB на каждом sub request. `redis.set(`geoip:${ip}`, region, 60)`.
- **Frontend:** опционально admin отключает — `user.preferAllNodes: boolean` для кейсов когда юзер хочет видеть все ноды (manual switch).

**Зависимости:** slice 27 (regions), slice 24c (currentUsers).

#### Срез 29: Subscription `url-test` groups

**Цель:** клиент-side auto-failover поверх server-side selection (slice 28). Юзер может перемещаться между странами — и его клиент сам перепрыгнет на ноду с самым низким ping без обновления подписки.

**Что вводим:**

- **Mihomo/Singbox `url-test` proxy group:**
  ```yaml
  proxy-groups:
    - name: Auto
      type: url-test
      proxies: [se-xray-01, de-hys2-02, nl-naive-03]
      url: https://www.gstatic.com/generate_204
      interval: 300
      tolerance: 50
  ```
- **Xray `burstObservatory` + `balancer`:**
  ```json
  "observatory": { "subjectSelector": ["proxy-"], "probeURL": "https://gstatic..." },
  "routing": { "balancers": [{ "tag": "auto", "selector": ["proxy-"] }] }
  ```
- **Generic Clash + Sing-box + xrayjson formatter изменения:** добавить url-test/balancer wrapper.

**Зависимости:** slice 21 multi-format (есть).

#### Срез 30: Hosts abstraction (full) + Cascade routing

**Цель:** разорвать «один inbound → один host» (slice 25 v1) и ввести cascade routing. Это два связанных изменения, делать вместе для целостности.

**Hosts abstraction (полная):**
- New table `inbound_hosts (id, inbound_id, host, port_override?, sni?, path?, host_header?, name)`.
- One inbound → many client-facing hosts. Subscription emits one URI per host, не per inbound. Use case: same Xray REALITY inbound, два host'а (один direct IP, второй через CDN-proxy с разным SNI).
- Frontend: tab inside Inbound editor for hosts. Default first host carries the "primary" flag.
- Migration: создать row в `inbound_hosts` для каждого existing inbound, копируя `publicHost`/`publicPort`/`port` → host record. Дальше publicHost/publicPort на самом Inbound становятся deprecated (keep for compat, prefer hosts).

**Cascade routing:**
- New table `node_peer_secrets (id, fromNodeId, toNodeId, sharedSecret)` — keygen-issued credentials для inter-node tunnel.
- New column `inbound.cascadeConfig JSONB`:
  ```json
  {
    "viaNodeId": "uuid-of-NL-node",
    "rules": [
      { "match": "geoip:ru", "action": "direct" },
      { "match": "geosite:bittorrent", "action": "block" },
      { "match": "*", "action": "via" }
    ]
  }
  ```
- При applyInbounds (slice 24a/b) panel включает в payload `cascade_config` + matching `node_peer_secrets`. Node-agent адаптер генерит outbound config с inter-node tunnel:
  - Hysteria: `outbounds` block with tunnel ref
  - Xray: `outbounds: [vless://internal-tunnel...]`
  - NaiveProxy: `route { forward_proxy { upstream } }` Caddy directive
- Multi-hop: A→B→C. На A в config указан `via: B-secret`. На B inbound с `B-secret` accept, outbound с `via: C-secret`. Каждая нода видит только свой следующий hop, никто не имеет full chain awareness.

**Файлы:** много, см. подробности при подходе к слайсу.

**Сложность:** **высоко**. Это один из самых архитектурно опасных слайсов — keygen-flow для inter-node, secrets distribution через mTLS, propagation на rebuild. Не браться пока stats + transports (24c) и UI (27-28) не закроют user-facing must-haves.

#### Срез 31: Cross-protocol cascade

**Цель:** Hysteria-RU → Xray-DE → интернет (или любая комбинация). Отличие от slice 30 — там same-protocol multi-hop, тут разные ядра. Use case: пользователь в Hysteria-friendly регионе, exit-нода в Xray-friendly.

**Архитектура:**
- HysteriaAdapter получает в config `outbound: { type: "socks5", addr: "10.x.x.x:1080", user/pass }` — Hysteria шлёт all traffic в socks5 локально.
- На inter-node tunnel — XrayAdapter на DE-ноде слушает socks5 inbound на 10.x.x.x:1080 с теми же credentials, делает freedom outbound → internet.
- Credentials через `node_peer_secrets` (slice 30).
- В UI admin выбирает в Inbound editor: «Cascade via: <NL-Xray inbound>» (dropdown списка eligible).

**Сложность:** средне (после slice 30 keygen-flow готов).

#### Срез 32: Telegram bot + Webhook notifications

**Цель:** events panel shouts to admin без ручного логина в UI. Готовый паттерн в Remnawave docs — копируем без особой инновации.

**Что вводим:**

- **Bot framework:** `grammy` (TypeScript, реактивный). Регистрация через `@BotFather`.
- **Events для notifications:**
  - `user.created` (опционально, мб шумно)
  - `user.expired` (юзер закончился — может попросить продлить)
  - `user.limited` (превысил traffic)
  - `subscription.requested` (sub URL hit — debug only, default off)
  - `node.unreachable` (нода ушла — admin должен знать сразу)
  - `node.online` (вернулась — recovery)
  - `traffic.threshold_reached` (любой юзер проехал 80% quota — early warning)
- **Per-event chat_id config:**
  ```env
  TELEGRAM_NOTIFY_USERS=-100123...   # юзерские события
  TELEGRAM_NOTIFY_NODES=-100456...   # node events (отдельный chat для on-call)
  TELEGRAM_NOTIFY_TRAFFIC=-100789... # traffic warnings
  ```
- **Webhook framework:** generic. Admin задаёт URL + secret в settings UI; backend шлёт POST с `Authorization: HMAC-SHA256 hex` header. Body — JSON с event name + payload.
- **Settings UI:** `/settings/notifications` — лист каналов, test button.

**Файлы:**
- NEW: `apps/panel-backend/src/modules/notifications/{telegram,webhook,service}.ts`
- NEW: `apps/panel-backend/prisma/migrations/.../add_notification_channels.sql`
- EDIT: `event-bus.ts` (notification handlers subscribe to all relevant events)
- NEW: `apps/panel-frontend/src/pages/SettingsNotificationsPage.tsx`

**Зависимости:** event-bus (есть), нет жёстких deps.

#### Срез 33: Prometheus metrics + Grafana dashboards

**Цель:** observability без отдельного APM. `/metrics` endpoint в OpenMetrics-формате, готовые JSON Grafana dashboards в `docs/observability/`.

**Метрики:**
- `ice_panel_users_total{status}` (active/disabled/expired/limited)
- `ice_panel_node_status{node,status}` (gauge: 1=online, 0=unreachable)
- `ice_panel_node_users{node}` (current users per node)
- `ice_panel_node_traffic_bytes_total{node,direction}` (counter)
- `ice_panel_user_traffic_bytes_total{user,direction}` (counter, high-cardinality! cap N=top-100)
- `ice_panel_bullmq_queue_size{queue,state}` (waiting/active/failed)
- `ice_panel_request_duration_seconds{route,status}` (histogram)

**Dashboards:**
- "Overview": users / nodes / traffic / queue health
- "Per-node": throughput, errors, status timeline
- "Top users": top-20 traffic consumers (anti-abuse view)

**Файлы:**
- EDIT: `apps/panel-backend/src/app.ts` (add `/metrics` route via `prom-client` lib)
- NEW: `docs/observability/grafana-dashboards/{overview,per-node,top-users}.json`
- NEW: `docs/observability/prometheus.yml.example`

**Сложность:** низко (prom-client стандартный, dashboards — экспорт из реального Grafana).

#### Срез 34: Backup / restore CLI

**Цель:** `ice-panel-backup` бинарник делает encrypted dump БД + Redis + .env. Restore one-shot. Optional cron upload to S3-compatible.

**Команды:**
```
ice-panel-backup dump --output /backup/ice-2026-05-06.tar.gz.enc --key <passphrase>
ice-panel-backup restore --input /backup/ice-2026-05-06.tar.gz.enc --key <passphrase>
ice-panel-backup verify --input <file>  # Decrypt + check structure без полного restore
```

**Что внутри tarball:**
- `postgres-dump.sql.gz` (`pg_dump` через docker exec)
- `redis-aof.rdb.gz` (`redis-cli SAVE`)
- `env.production.enc` (.env.production)
- `manifest.json` (timestamp, git SHA panel'a, version)

**Encryption:** `age` (modern, simple). Один passphrase, file output.

**Cron-mode** в panel: `BACKUP_S3_BUCKET=...` `BACKUP_S3_KEY=...` env → BullMQ daily cron job делает backup и uploads через `aws-sdk`/`@aws-sdk/client-s3`.

**Файлы:**
- NEW: `tools/ice-panel-backup/` (Go или Node CLI; склоняюсь к Go для standalone бинаря)
- NEW: scripts/backup-restore.md docs

**Сложность:** низко (механика стандартная).

#### Срез 35: Security hardening

**Цель:** проактивная санация перед public release.

**Что делаем:**
- `npm audit` в CI на каждый PR.
- Per-route rate-limits на чувствительных endpoint'ах: `/api/auth/login` (5/min уже есть), `/api/auth/register` (3/5min уже есть), `/sub/:token` (60/min anti-abuse), `/api/nodes/:id/bootstrap` (10/min).
- Content-Security-Policy refinement: текущая дефолтная nginx. Добавить strict CSP без unsafe-inline.
- Input fuzzing tests: `fast-check` или `vitest`-property-based для critical Zod schemas (Inbound configs, User creation).
- OWASP Top-10 checklist прохождение: SQL injection (Prisma защищает), XSS (React escape default), CSRF (JWT — stateless, но `SameSite=Lax` cookie если ввести), broken auth (JWT expiry), security misconfig (Caddy + ufw уже tight), components-with-known-vulnerabilities (`npm audit`).
- Secret rotation flow: `ice-panel-rotate-secrets` CLI команда — re-genrate JWT_SECRET, invalidates all sessions, regen Postgres pwd через `ALTER USER`.

**Сложность:** средне (распределено по нескольким PR).

#### Срез 36: CI/CD via GitHub Actions

**Цель:** push в main → tests → build images → publish ghcr.io. Deploy docs обновляются.

**Workflows:**
- `.github/workflows/test.yml`:
  - on: pull_request, push to main
  - jobs: panel-backend test (postgres-test container), frontend tsc, node go test
- `.github/workflows/build.yml`:
  - on: push tag `v*`
  - jobs: build & push `ghcr.io/0xic3/ice-panel-backend:vX.Y.Z`, ditto frontend & node-agent
- `.github/workflows/release.yml`:
  - on: tag
  - generate changelog, GitHub release with binary artifacts (node-agent for amd64/arm64)

**install-panel.sh** обновится: вместо локального docker build — `docker pull ghcr.io/.../ice-panel-backend:latest`. ~10 мин → ~30 сек deploy.

**Сложность:** низко.

#### Срез 37: Bull-board + admin observability

**Цель:** UI на `/admin/queues` для просмотра BullMQ jobs (active/waiting/failed), плюс system stats dashboard.

**Что вводим:**
- `@bull-board/fastify` plugin → mounts at `/api/admin/queues`. Защищено `requireAuth`.
- Frontend `/admin/queues` page: iframe в bull-board UI или native re-implementation на Mantine.
- Admin overview dashboard: latest 10 audit log entries, system uptime, версия panel'a, версия node-agent (latest known per node).

**Сложность:** низко (bull-board готовый).

#### Срез 38 (deferred): AmneziaWG cascade via iptables

Multi-hop через AWG требует прямой iptables MASQUERADE на промежуточных нодах + careful routing rules. Не нужен пока no-one asks for it. Откладываем до явного request'а.

#### Срез 39 (deferred): External squads — presentation overrides

Per-user-bucket branding (custom Profile-Title, host-overrides for VIPs, sub-page theming). Solves narrow VIP-tier UX. Откладываем — нет реальных VIP-юзеров для тестирования.

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
10. **Автоматизируй боль, а не возможность боли** (lesson from 2026-05-06 VPS test). Если делал руками 3+ раза и заболело — автоматизируй (slice 23.1 родился из этого правила: backfill, refresh-bootstrap, status poller — все три вычислены за один день multi-node-теста). Если ещё не болело — не трогай. Pre-commit hooks, dependabot, observability tooling — всё это не имеет ROI на solo-MVP-фазе.

## Уроки из VPS-теста (2026-05-06)

Записываем баги что поймали за один день multi-node-теста — чтобы не наступать снова.

| # | Bug | Root cause | Fix commit |
|---|---|---|---|
| 1 | Hiddify «Unknown parse outbound» на hysteria2 URI | `?#name` (empty query + fragment) ломает sing-box parser | `ffdfc31` drop empty `?` |
| 2 | sing-box «TLS required» на hysteria2 outbound | Singbox JSON formatter не писал `tls.enabled: true` | `0f59036` add tls.enabled |
| 3 | install-node.sh fail `mkdir /etc/xray: read-only` | ProtectSystem=strict + ReadWritePaths permits writes only into existing dirs | `9372d7c` pre-create dirs |
| 4 | Xray REALITY rejects `+/=` в private key | x25519 generator выдавал base64-standard, REALITY parser требует base64url | `9372d7c` `generateRealityKeyPair()` |
| 5 | Bootstrap-redeem 401 несмотря на public route | `app.addHook` в Fastify плагине scope-leak'ит и применяется к routes ДО хука | `325f85b` per-route `{ onRequest }` |
| 6 | Hysteria auth rejected for pre-existing user | Ноды добавленные позднее юзеров не получают backfill — only future user.created fans out | slice 23.1 `node.created` event |
| 7 | mTLS panel→node fetch failed после смены node.address | Cert SAN заморожен на момент create node, новый address != cert host | slice 25 publicHost (architectural fix) + slice 23.1 Refresh-bootstrap (operational workaround) |
| 8 | Status в UI всегда `UNKNOWN` | Никакой poller не пишет в `nodes.status` | slice 23.1 30s healthcheck cron |
| 9 | Hiddify VPN sometimes blocks UDP-443 outbound в test environment | Не наш баг, но симптом легко спутать с серверной проблемой | doc'd in install.md troubleshooting |
| 10 | Linux TTY truncates 4096-byte paste | NODE_PAYLOAD ~6-7 KB обрезался при copy-paste в SSH | `b1a31dc` `--payload-file` flag + Download button + bootstrap-token flow (`fa0d4ea`) |

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
