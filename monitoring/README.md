# Мониторинг TeenTechEd

Всё, чтобы визуально наблюдать сервер: логи, нагрузку, метрики, алерты.

Три уровня, от «ничего не ставить» до полноценных дашбордов:

| Что | Инструмент | Где смотришь | Хостишь сам? |
|-----|-----------|--------------|--------------|
| Ошибки кода + алерты | **Sentry** | sentry.io | нет (облако) |
| «Сайт жив?» + алерт о падении | **UptimeRobot** | uptimerobot.com | нет (облако) |
| Нагрузка, метрики, графики, алерты | **Grafana + Prometheus** | своя Grafana | да, этот стек |
| Быстрый взгляд на контейнеры | `docker compose ps` / `docker stats` | терминал | — |

---

## 1. Grafana + Prometheus + cAdvisor + node_exporter (этот стек)

Поднимает сервисы: метрики хоста (node_exporter), контейнеров (cAdvisor),
приложения (`/metrics` FastAPI), PostgreSQL (postgres_exporter), Redis
(redis_exporter), логи (Loki + Promtail), хранилище (Prometheus) и визуализацию
(Grafana).

### Сеть до приложения

Часть сервисов подключается к docker-сети приложения (external), чтобы дотянуться
до `backend`/`postgres`/`redis`. По умолчанию имя сети — `teenteched_default`
(прод). В деве это `teentechedkz_default` — тогда добавляй `APP_NETWORK=...`:

```bash
APP_NETWORK=teentechedkz_default docker compose -f monitoring/docker-compose.monitoring.yml up -d
```

### Запуск (на сервере)

```bash
# 1. Скачать готовые дашборды (Node Exporter Full + cAdvisor)
./monitoring/fetch-dashboards.sh

# 2. Задать пароль админа Grafana (не оставляй дефолтный!)
export GF_ADMIN_PASSWORD='придумай-надёжный'

# 3. Поднять стек (на проде имя сети дефолтное — teenteched_default)
docker compose -f monitoring/docker-compose.monitoring.yml up -d
```

### Как открыть Grafana

Всё слушает только `127.0.0.1` (наружу не торчит). Со своего ноутбука:

```bash
ssh -L 3001:localhost:3001 user@65.21.188.181
```
затем открой **http://localhost:3001** → логин `admin` / твой `GF_ADMIN_PASSWORD`.

Внутри: слева **Dashboards → TeenTechEd** → «Node Exporter Full» (CPU/RAM/диск/сеть
сервера) и «Cadvisor» (метрики по каждому контейнеру). Источники данных Prometheus
и Loki уже подключены автоматически.

**Логи с поиском:** слева **Explore → Loki**. Пример запроса:
`{container="tte_backend_prod"} |= "error"` — все ошибки бэкенда, без SSH и grep.
Фильтровать можно по `container` и `compose_service`.

**Метрики приложения/БД/Redis:** в Explore → Prometheus доступны `http_requests_total`
(RPS/коды по эндпоинтам), `http_request_duration_seconds` (латентность), `pg_*`
(соединения, размер БД), `redis_*` (память, ключи). Готовые дашборды для Postgres
(ID 9628) и Redis (ID 763) можно доимпортировать через **Dashboards → Import**.

> Альтернатива SSH-туннелю — отдать Grafana наружу через ваш общий Caddy с
> basic-auth или его встроенной авторизацией. Тогда поставь `GF_ROOT_URL` в
> `https://grafana.твойдомен` и проксируй на `grafana:3000`. Без авторизации
> наружу Grafana не выставляй.

### Проверить, что метрики идут

- Prometheus targets: через туннель `-L 9090:localhost:9090` → http://localhost:9090/targets — все должны быть `UP`.
- Активные алерты: http://localhost:9090/alerts

---

## 2. Алерты (Telegram/почта)

Правила уже описаны в [prometheus/alerts.yml](prometheus/alerts.yml): сервер лёг,
CPU/RAM > 90%, диск < 15%, контейнер падает, приближение к лимиту памяти.

Чтобы они **уходили** тебе, настрой канал доставки в Grafana:

1. Grafana → **Alerting → Contact points → Add contact point**.
2. Тип: **Telegram** (нужны `Bot Token` и `Chat ID`) или **Email**.
3. **Alerting → Notification policies** — привязать этот contact point к алертам.
4. (Prometheus-правила видны в Grafana в **Alerting → Alert rules** как внешние.)

У тебя уже есть Telegram-бот для CRM — можно завести отдельного бота для алертов,
чтобы не смешивать с клиентским трафиком.

---

## 3. Sentry (ошибки приложения) — уже в коде

Бэкенд и фронтенд уже проинструментированы (`sentry-sdk` и `@sentry/react`),
включается при заданном DSN. Осталось:

1. Завести проект на **sentry.io** (бесплатный тариф есть): один проект для
   Python (backend), один для React (frontend).
2. Скопировать DSN каждого и вписать в `.env` прода:
   ```
   SENTRY_DSN=https://...@...ingest.sentry.io/...        # backend
   VITE_SENTRY_DSN=https://...@...ingest.sentry.io/...   # frontend (зашивается в бандл при сборке)
   ```
3. Пересобрать: `docker compose -f docker-compose.prod.yml up -d --build`.
4. В Sentry настроить алерты (Alerts → создать правило → Telegram/почта/Slack).

Дальше все необработанные ошибки бэка и фронта падают в Sentry со стектрейсом.

---

## 4. UptimeRobot (падение сайта) — 5 минут, без кода

1. Регистрация на **uptimerobot.com** (бесплатно до 50 мониторов).
2. Add New Monitor → тип **HTTP(s)** → URL `https://teenteched.kz/health`.
3. Интервал 5 мин, добавить контакт (Telegram/почта/пуш в приложение).

Теперь, если прод недоступен, узнаёшь ты, а не пользователи.

---

## Уже встроено в стек

- **Метрики приложения** — бэкенд отдаёт `/metrics` (`prometheus-fastapi-instrumentator`),
  Prometheus скрейпит job `backend`: RPS, латентность, коды ответов по эндпоинтам.
- **Логи с поиском** — Loki + Promtail: ищешь в Grafana (Explore → Loki), без SSH.
- **Метрики Postgres** — `postgres_exporter`: соединения, размер БД, кэш-хиты.
- **Метрики Redis** — `redis_exporter`: память, хиты/промахи, длина очереди `arq`.
- **Бэкап-мониторинг** — `scripts/backup.sh` пишет метку времени в textfile-коллектор
  node_exporter; алерт `BackupStale` срабатывает, если бэкап не обновлялся >26ч.

## Что ещё можно добавить (по желанию)

- **Alertmanager** — если захочешь маршрутизацию алертов сложнее, чем контакт-поинты
  Grafana (расписания дежурств, группировка, эскалация).
- **Трейсинг** (Grafana Tempo) — сквозные трейсы запросов через сервисы, когда
  появятся узкие места по латентности.
- **Blackbox exporter** — проверять не только `/health`, но и реальные пользовательские
  сценарии (логин, ключевые страницы) изнутри.

---

## Безопасность

- Grafana/Prometheus/cAdvisor/node_exporter слушают **только 127.0.0.1** — доступ
  через SSH-туннель. Не публикуй их порты наружу без авторизации.
- Обязательно смени `GF_ADMIN_PASSWORD` с дефолтного.
- cAdvisor и node_exporter работают привилегированно (читают хост) — это норма для
  метрик, но ещё одна причина не выставлять их в интернет.

---

## Заметки / отладка

- **node_exporter под Linux.** Монтирование `/:/host:ro,rslave` — штатное для прод-Linux.
  Если контейнер падает с `path / ... not a shared or slave mount` — на сервере один раз
  выполни `mount --make-rshared /`. (На macOS Docker Desktop этот маунт не работает —
  метрики хоста проверяй уже на сервере.)
- **Имена контейнеров.** Prometheus и экспортеры настроены на прод-имена
  (`tte_backend_prod`, дефолт `PG_HOST=tte_postgres_prod`, `REDIS_HOST=tte_redis_prod`).
  Для локальной проверки в деве запускай с `PG_HOST=tte_postgres REDIS_HOST=tte_redis`
  и поправь target `backend` в `prometheus/prometheus.yml` на `tte_backend:8000`.
- **Проверка целей:** через туннель открой http://localhost:9090/targets — `cadvisor`,
  `node`, `postgres`, `redis`, `backend` должны быть `UP` (на реальном проде).
