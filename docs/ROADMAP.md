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
| 6 | Слои + event bus | ⏭️ next | routes/services/repositories, eventemitter2 |
| 7 | **🆕 Redis + BullMQ + scheduler** | | Очереди, фоновые задачи, cron-расписание (4 reset-job'а) |
| 8 | Тесты на Vitest | | Unit + integration, фикстуры, моки |
| 9 | Panel↔Node transport: REST + mTLS + keygen | | `@peculiar/x509`, CA, выпуск нодных сертов, encoded payload |
| 10 | Go node-agent skeleton | | Go basics, mTLS HTTPS-сервер, регистрация |
| 11 | `CoreAdapter` + `HysteriaAdapter` | | Auth-callback (не restart), управление Hysteria2-процессом |
| 12 | **🆕 Subscription generator** | | Endpoint `/sub/{shortUuid}`, Hysteria2 URI, кэширование |
| 13 | Сквозной флоу Hysteria2 (admin → user → реальный клиент) | | Real-world integration |
| 14 | Frontend skeleton (Vite + React + Mantine + TanStack Query + Zustand) | | SPA, серверный vs клиентский state |
| 15 | Docker production build | | Multi-stage Dockerfile, оптимизация образа |

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
- Минимальный вариант: только один формат (Hysteria2 native URI), без UA-detection. Расширения в фазе 2.

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
| 16 | **Refactor `CoreAdapter`** под уроки фазы 1 | Возможно меняется сигнатура методов после реальной работы с Hysteria | средне |
| 17 | **`XrayAdapter`** (legacy VLESS/Reality/VMess/Trojan) | gRPC API через xtls-sdk, добавление user'ов через AddUser API | средне |
| 18 | **Frontend: выбор протокола при создании юзера** | UI с чекбоксами «какие протоколы доступны юзеру» | низко |
| 19 | **`AmneziaWGAdapter`** | `wg` CLI, генерация peer-конфигов, kernel-module setup, `wg syncconf` reload | **высоко** (нужен root, kernel-module, специфика WG) |
| 20 | **`NaiveProxyAdapter`** | Сборка из chromium-форка (или предкомпилированный бинарник), управление через CLI-аргументы | средне |
| 21 | **Multi-format subscription generator** | Все форматы: Clash YAML, Singbox JSON, AmneziaWG `.conf`, Naive URL, Xray JSON | средне |
| 22 | **Subscription Response Rules (SRR)** | Детект формата по User-Agent (паттерн Remnawave) | низко |
| 23 | **UI: graphical protocol selector + per-protocol config** | Inbound editor с UI под каждый протокол | средне |

### Подробности по адаптерам

#### XrayAdapter (срез 17 — первый после Hysteria, потому что самый похожий)
- Управление через **gRPC API** Xray (есть встроенный)
- Используем `@remnawave/xtls-sdk` (готовая TS-обёртка) или пишем свою на Go (`google.golang.org/grpc`)
- Поддерживает **VLESS / Reality / VMess / Trojan / Shadowsocks** через один inbound
- Креды: уже есть `xray_uuid` в users
- Сложность: средне — gRPC API хорошо документирован

#### AmneziaWGAdapter (срез 19 — самый сложный)
- Управление через **`wg` CLI** + конфиг-файл
- Каждый user = peer в `wg0.conf`:
  ```
  [Peer]
  PublicKey = <user's amneziawg_public_key>
  AllowedIPs = 10.0.0.X/32
  ```
- Применение изменений: `wg syncconf wg0 <(wg-quick strip wg0)`
- **Не требует перезапуска** интерфейса — peer'ы добавляются hot
- Сложность **высоко**: нужен kernel-module `amneziawg`, root-доступ, выделение IP-адресов из подсети, генерация `Endpoint` для клиента

#### NaiveProxyAdapter (срез 20)
- Запуск бинарника `naive` от klzgrad
- Управление через CLI-аргументы при запуске:
  ```bash
  naive --listen=https://user:pass@0.0.0.0:443 --proxy=...
  ```
- Креды: `naive_password` уже в users
- Изменение состава пользователей = **перезапуск процесса** (наследуем тот же подход что Remnawave для Xray)
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

1. Multi-node (несколько серверов под одной панелью с группами)
2. Метрики Prometheus + дашборд Grafana
3. Backup/restore БД
4. Уведомления через Telegram (`grammy`) и webhooks
5. Security audit (npm audit, проверка зависимостей)
6. CI/CD через GitHub Actions
7. Документация по деплою
8. Bull-board UI для observability очередей

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
