# TeenTechEd CRM

Full-stack CRM для образовательного консалтинга: FastAPI (async) + React 18 + PostgreSQL, с фоновым воркером на `arq`, Redis и MinIO.

Если интересует, как всё это устроено внутри (веб-процесс vs воркер, очереди, Notion/Telegram/Deepgram интеграции) — смотри [ARCHITECTURE.md](ARCHITECTURE.md). Этот файл — только про то, как поднять проект локально.

## 📋 Требования

- **Docker** (версия 20.10+)
- **Docker Compose** (версия 2.0+)
- **Git**

Никаких других требований не нужно — всё остальное (Python, Node, Postgres) работает в контейнерах.

## 🚀 Быстрый старт

### 1. Клонируй репозиторий и перейди в папку

```bash
git clone <repository-url>
cd teentechedkz
```

### 2. Создай файл `.env` из примера

```bash
cp .env.example .env
```

Для локальной разработки значения по умолчанию уже настроены и работают. Внешние интеграции (Telegram, Notion, Deepgram, OpenAI/Anthropic) — опциональны: без них приложение полностью работает, просто соответствующие функции (Telegram-инбокс, синк Notion, транскрипция, AI-инсайты) будут неактивны. Добавь ключи в `.env`, когда понадобятся.

### 3. Запусти проект

```bash
docker compose up --build
```

Поднимаются 6 сервисов: `postgres`, `redis`, `minio`, `backend`, **`worker`**, `frontend`. При первом запуске Docker соберёт образы и применит миграции — подожди, пока вывод стабилизируется (примерно 30-60 секунд).

> **Важно:** `worker` — не опциональный сервис для фоновых задач "на будущее". Он обязателен уже сейчас: там крутятся Notion/Sheets-синк, payment notifier, Telegram-вебхук health-check, и туда же уезжает вся тяжёлая обработка (транскрипция аудио, вложения из Telegram, AI-извлечение инсайтов) — без него эти функции просто не будут работать, хотя сам сайт и API останутся доступны. Подробнее — в ARCHITECTURE.md.

### 4. Готово! Открой приложение

| Сервис | URL | Описание |
|--------|-----|---------|
| **Frontend** | http://localhost:3000 | React-приложение |
| **API** | http://localhost:8001 | FastAPI (Swagger: http://localhost:8001/docs) |
| **PostgreSQL** | localhost:5432 | База данных (пользователь: `tte`, пароль: `tte`) |
| **Redis** | localhost:6379 | Rate-limit, очередь `arq`, WebSocket pub/sub |
| **MinIO** | http://localhost:9001 | S3-совместимое хранилище (консоль) |

## 🔐 Вход в приложение

При первом запуске сидируется тестовый администратор:

- **Email**: `admin@teenteched.kz`
- **Пароль**: `Admin1234!`

Смени пароль сразу после первого входа (Настройки → аккаунт) — значение по умолчанию совпадает с тем, что лежит в `.env.example`, и держать его в проде нельзя.

## 📁 Структура проекта

```
teentechedkz/
├── backend/
│   ├── app/
│   │   ├── api/v1/endpoints/   # ~40 роутеров: students, roadmaps, chat, telegram_webhook, notion...
│   │   ├── models/             # SQLAlchemy-модели (~40 таблиц)
│   │   ├── schemas/            # Pydantic-схемы запросов/ответов
│   │   ├── services/           # Бизнес-логика: notion_sync, telegram_bot, deepgram_rest, queue...
│   │   ├── core/                # config, database, security, deps
│   │   ├── main.py              # FastAPI-приложение (веб-тир, uvicorn)
│   │   └── worker.py            # arq-воркер (фоновый тир) — см. ARCHITECTURE.md
│   ├── alembic/versions/        # миграции БД
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/
│   └── src/
│       ├── api/                 # HTTP-клиенты по доменам
│       ├── components/
│       │   ├── portal/          # компоненты студенческого кабинета
│       │   ├── workspace/       # компоненты тёмной workspace-темы для менторов
│       │   └── shared/          # общие для классического CRM и workspace
│       ├── pages/
│       │   ├── portal/          # /portal/* — кабинет студента
│       │   ├── workspace/       # /workspace/* — альтернативный UI для менторов
│       │   └── *.tsx            # классический CRM (/students, /finances, /statistics...)
│       └── App.tsx
├── migration/                    # скрипты миграции данных из Notion/Google Sheets
├── docker-compose.yml            # dev-конфигурация
├── docker-compose.prod.yml       # prod-конфигурация (multi-worker uvicorn, отдельные .env-параметры)
├── .env.example
├── README.md                     # этот файл
└── ARCHITECTURE.md               # как всё устроено внутри
```

## 🛠️ Разработка

### Просмотр логов

```bash
docker compose logs -f
docker compose logs -f backend
docker compose logs -f worker      # Notion/Sheets синк, транскрипция, Telegram-обработка — здесь
docker compose logs -f frontend
```

### Остановка и перезагрузка

```bash
docker compose down          # остановить все сервисы
docker compose down -v       # + удалить данные из БД/MinIO (полная очистка)
docker compose restart backend worker   # применить изменения без пересборки образа
```

### Пересборка после изменения зависимостей

Если менял `requirements.txt` или `package.json` — просто `restart` не подхватит новые пакеты:

```bash
docker compose up -d --build backend worker
```

### Миграции БД

```bash
docker compose exec backend alembic upgrade head            # применить миграции
docker compose exec backend alembic revision -m "название"  # создать новую
```

Если добавляешь модель/поле — создавай миграцию сразу и не забудь применить её (`alembic upgrade head`) при следующем деплое или локальном обновлении: без этого прод/локалка упадут с `UndefinedColumnError` при первом же запросе к новой колонке.

## 📝 Переменные окружения

Полный список — в `.env.example`, там же комментарии по каждой группе. Коротко:

```
# БД (значения по умолчанию подходят для локалки)
POSTGRES_USER=tte
POSTGRES_PASSWORD=tte
POSTGRES_DB=tte_db

# Storage (S3-совместимое, MinIO)
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin

# Auth — смени в проде на случайную строку 32+ символов
JWT_SECRET_KEY=change-me-in-production-min-32-chars-long-random
PGCRYPTO_KEY=change-me-in-production-min-32-chars-long-random

# Масштабирование веб-тира (используется только в docker-compose.prod.yml)
UVICORN_WORKERS=2
DB_POOL_SIZE=10
DB_MAX_OVERFLOW=5

# Опционально — интеграции, без них приложение работает, но без этих функций
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_URL=
NOTION_API_KEY=
NOTION_DATABASE_ID=
DEEPGRAM_API_KEY=
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GOOGLE_SERVICE_ACCOUNT_JSON=
```

Frontend использует `VITE_API_URL` (по умолчанию `http://localhost:8001` в dev-конфиге).

## 🐛 Решение проблем

### "Port 3000/8001/5432 уже занят"

```bash
lsof -i :3000
```
Либо смени порты в `docker-compose.yml` (левая часть `ports:` — порт на хосте).

### "Логин не проходит / 500 ошибка на /auth/login"

Почти всегда значит, что миграции не применены после обновления кода:
```bash
docker compose exec backend alembic upgrade head
```

### "Изменения в коде не применяются"

- **Backend**: перезагружается автоматически (`uvicorn --reload`). Если код в `worker.py` или сервисах, которые импортирует воркер, — воркер `--reload` не поддерживает, перезапусти вручную: `docker compose restart worker`.
- **Frontend**: обновляется автоматически (Vite HMR). Если нет — смотри консоль браузера.

### "Telegram-сообщения не приходят"

Проверь `docker compose logs worker` — регистрация вебхука и health-check живут там, не в `backend`. Также нужен публично доступный `TELEGRAM_WEBHOOK_URL` (Telegram не может достучаться до `localhost`) — для локальной разработки обычно используют туннель (ngrok и т.п.).

### "Docker не находит образы / странно себя ведёт после обновления кода"

```bash
docker compose up -d --build
```

## 🔍 Отладка

```bash
docker compose ps                                    # статус всех сервисов, все должны быть Up
docker compose exec postgres psql -U tte -d tte_db   # подключиться к БД
docker compose exec redis redis-cli ping             # проверить Redis
```

## 📚 Документация API

Swagger — **http://localhost:8001/docs** (отключён в проде). Можно отправлять тестовые запросы прямо из браузера.

## 📊 Загрузка данных при первом запуске

При первом старте создаются только администратор и справочник стран. Дальше — на выбор:

1. **Notion-синк** (если используется как источник данных) — задай `NOTION_API_KEY`/`NOTION_DATABASE_ID` в `.env`, запусти вручную через Swagger (`POST /api/v1/notion/run`) или дождись автосинка (раз в час, крутится в `worker`).
2. **Google Sheets-синк** — аналогично, `GOOGLE_SERVICE_ACCOUNT_JSON` + `POST /api/v1/sync/run`.
3. **Вручную через интерфейс** — залогинься админом и создавай студентов/менторов через UI.

## 🚀 Продакшн

Отдельная конфигурация — `docker-compose.prod.yml`. Ключевые отличия от dev: без `--reload`, несколько uvicorn-воркеров (`UVICORN_WORKERS`), явные лимиты пула соединений к БД. Подробности — в разделе «Масштабирование» [ARCHITECTURE.md](ARCHITECTURE.md).

---

**Вопросы?** Смотри ARCHITECTURE.md или пиши в канал разработки.
