# TeenTechEd CRM

Full-stack CRM приложение для образовательного консалтинга, построенное на FastAPI + React 18 с PostgreSQL.

## 📋 Требования

- **Docker** (версия 20.10+)
- **Docker Compose** (версия 2.0+)
- **Git**

Никаких других требований не нужно — всё остальное работает в контейнерах.

## 🚀 Быстрый старт

### 1. Клонируй репозиторий и перейди в папку

```bash
git clone <repository-url>
cd teenteched
```

### 2. Создай файл `.env` из примера

```bash
cp .env.example .env
```

Для локальной разработки значения по умолчанию уже настроены и работают. Если нужны специфические ключи (например, для Telegram или OpenAI), добавь их в `.env`.

### 3. Запусти проект

```bash
docker compose up --build
```

При первом запуске Docker соберёт образы и создаст все необходимые сервисы. Дождись, пока вывод стабилизируется (примерно 30-60 секунд).

### 4. Готово! Открой приложение

| Сервис | URL | Описание |
|--------|-----|---------|
| **Frontend** | http://localhost:3000 | React приложение |
| **API** | http://localhost:8001 | FastAPI (Swagger: http://localhost:8001/docs) |
| **PostgreSQL** | localhost:5432 | База данных (пользователь: `tte`, пароль: `tte`) |
| **Redis** | localhost:6379 | Кэш и очереди |
| **MinIO** | http://localhost:9001 | S3-совместимое хранилище (консоль) |

## 🔐 Вход в приложение

При первом запуске создаётся тестовый администратор:

- **Email**: admin@teenteched.kz
- **Пароль**: Admin1234!

Также создаются тестовые менторы и студенты для локальной разработки. После входа получишь доступ ко всем функциям в зависимости от роли.

## 📁 Структура проекта

```
teenteched/
├── backend/
│   ├── app/
│   │   ├── api/v1/endpoints/         # API маршруты
│   │   ├── models/                   # SQLAlchemy модели
│   │   ├── schemas/                  # Pydantic схемы
│   │   ├── services/                 # Бизнес-логика
│   │   ├── core/                     # Конфигурация, зависимости
│   │   └── main.py                   # FastAPI приложение
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── api/                      # HTTP клиент
│   │   ├── components/               # React компоненты
│   │   ├── pages/                    # Страницы
│   │   └── App.tsx
│   ├── Dockerfile
│   └── package.json
├── docker-compose.yml                # Docker Compose конфигурация
├── .env.example                      # Шаблон переменных окружения
└── README.md                         # Этот файл
```

## 🛠️ Разработка

### Просмотр логов

Для просмотра логов всех сервисов:

```bash
docker compose logs -f
```

Для конкретного сервиса:

```bash
docker compose logs -f backend
docker compose logs -f frontend
```

### Остановка и перезагрузка

Остановить все сервисы:

```bash
docker compose down
```

Полная очистка (удалит все данные из БД):

```bash
docker compose down -v
```

Перезагрузить после изменения кода:

```bash
docker compose restart backend
docker compose restart frontend
```

### Запуск команд в контейнере

Если нужно запустить команду внутри контейнера (например, миграцию БД):

```bash
docker compose exec backend python -m app.core.create_tables
```

## 📝 Переменные окружения

### Backend (`.env`)

Скопируй `.env.example` и отредактируй при необходимости. Для локальной разработки все основные значения уже настроены:

```
# БД (default значения подходят для локалки)
POSTGRES_USER=tte
POSTGRES_PASSWORD=tte
POSTGRES_DB=tte_db

# Storage (S3-совместимое)
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin

# Auth (сгенерируются при первом запуске)
JWT_SECRET_KEY=change-me-in-production-min-32-chars-long-random
PGCRYPTO_KEY=change-me-in-production-min-32-chars-long-random

# Опционально — для интеграций
TELEGRAM_BOT_TOKEN=<если_нужен>
OPENAI_API_KEY=<если_нужен>
DEEPGRAM_API_KEY=<если_нужен>
NOTION_API_KEY=<если_нужен>
```

Полный список со всеми вариантами смотри в `.env.example`. Для локальной разработки обычно не требуется менять ничего кроме секретных ключей для внешних API.

### Frontend

Фронтенд использует VITE_API_URL из `.env`, по умолчанию уже указан `http://localhost:8001`.

## 🐛 Решение проблем

### "Port 3000/8001 уже занят"

Если порты заняты другими приложениями:

1. Найди процесс: `lsof -i :3000`
2. Или измени порты в `docker-compose.yml`:
   ```yaml
   ports:
     - "3001:3000"  # frontend
     - "8002:8000"  # backend
   ```

### "PostgreSQL не готов"

Иногда БД медленно запускается. Просто дождись или перезагрузи:

```bash
docker compose restart backend
```

### "Изменения в коде не применяются"

- **Backend**: Должен перезагружаться автоматически (uvicorn --reload). Если нет — перезагрузи контейнер.
- **Frontend**: Должен обновляться автоматически (Vite HMR). Если нет — проверь консоль браузера.

```bash
docker compose restart backend frontend
```

### "Нет доступа к MinIO консоли"

Обычно это проблема с браузером. Попробуй:
- Обновить страницу (Ctrl+Shift+R / Cmd+Shift+R)
- Очистить кэш браузера
- Использовать другой браузер

### "Docker не находит образы"

```bash
docker compose pull
docker compose up --build
```

## 🔍 Отладка

### Проверить здоровье сервисов

```bash
docker compose ps
```

Все сервисы должны иметь статус `Up`. Если какой-то упал — посмотри логи.

### Подключиться к PostgreSQL

```bash
docker compose exec postgres psql -U tte -d tte_db
```

### Проверить Redis

```bash
docker compose exec redis redis-cli ping
```

## 📚 Документация API

Swagger документация доступна по адресу: **http://localhost:8001/docs**

Туда же можно отправлять тестовые запросы прямо из браузера.

## 📊 Загрузка данных (студентов, анкет и т.д.)

### При первом запуске создаются только:
- Администратор (admin@teenteched.kz)
- Справочник стран

### Варианты загрузки данных:

#### 1️⃣ Синхронизация из Google Sheets (рекомендуется для локалки)

Если в prod данные синхронизируются из Google Sheets:

```bash
# Добавь в .env
GOOGLE_SERVICE_ACCOUNT_JSON=<JSON-ключ сервисного аккаунта>
SHEETS_SYNC_INTERVAL_SECONDS=300
```

Потом вручную запусти синхронизацию через Swagger:
1. Открой http://localhost:8001/docs
2. Найди `POST /api/v1/sync/run`
3. Нажми "Try it out" → "Execute"

#### 2️⃣ Синхронизация из Notion (если используется)

```bash
# Добавь в .env
NOTION_API_KEY=<твой-ключ>
NOTION_DATABASE_ID=<ID базы>
```

Запусти через Swagger как выше.

#### 3️⃣ Создать тестовые данные вручную

Логинься как администратор и создавай студентов, менторов и прочее через интерфейс.

#### 4️⃣ Восстановить БД из backup'а (если нужна полная копия prod)

Попроси у ведущего разработчика dump'а prod базы:

```bash
# Очисти локальную БД
docker compose down -v

# Загрузи dump (если есть backup.sql)
docker compose up -d postgres
docker compose exec -T postgres psql -U tte -d tte_db < backup.sql

# Перезагрузи бэкенд
docker compose restart backend
```

---

## 🚀 Отправка в production

Для production используется отдельная конфигурация. Подробно смотри в документации (если нужно).

---

**Вопросы?** Напиши в канал разработки или создай issue в репозитории.
