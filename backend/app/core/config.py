from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Read the repo-root .env regardless of the process CWD. This file lives at
# backend/app/core/config.py, so parents[3] is the repo root for a local run
# (e.g. `uvicorn` launched from backend/). In Docker the repo root is
# bind-mounted to /data (`- .:/data` in docker-compose), so /data/.env is the
# in-container copy. Reading the FILE — not only os.environ — means a code
# reload (uvicorn --reload) re-reads it, so a freshly added key is picked up
# without a full container recreate. os.environ still wins over all of these.
_REPO_ROOT_ENV = Path(__file__).resolve().parents[3] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", str(_REPO_ROOT_ENV), "/data/.env"),
        extra="ignore",
    )

    # App
    ENVIRONMENT: str = "development"
    # Доверять заголовку X-Forwarded-For при определении IP клиента (rate-limit).
    # True — когда бэкенд стоит ЗА доверенным прокси (Caddy) и НЕ опубликован в
    # хост напрямую (как в docker-compose.prod.yml — у backend нет ports:). Тогда
    # XFF может выставить только Caddy. Если бэкенд доступен напрямую — ставь
    # False, иначе XFF легко подделать и обойти throttle по IP.
    TRUST_PROXY_HEADERS: bool = True
    FRONTEND_URL: str = "http://localhost:3000"
    ALLOWED_ORIGINS: str = "http://localhost:3000,http://localhost:5173"

    # Database
    DATABASE_URL: str = "postgresql+asyncpg://tte:tte@localhost:5432/tte_db"

    # Auth
    JWT_SECRET_KEY: str = "change-me-in-production-min-32-chars"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30

    # Encryption
    PGCRYPTO_KEY: str = "change-me-in-production-min-32-chars"

    # MinIO
    MINIO_ENDPOINT: str = "minio:9000"
    MINIO_ACCESS_KEY: str = "minioadmin"
    MINIO_SECRET_KEY: str = "minioadmin"
    MINIO_BUCKET_NAME: str = "teenteched-docs"
    MINIO_USE_SSL: bool = False

    # Redis
    REDIS_URL: str = "redis://redis:6379/0"

    # DB connection pool — sized per web-tier process. With N uvicorn workers,
    # total connections to Postgres ≈ N × (DB_POOL_SIZE + DB_MAX_OVERFLOW),
    # plus the arq worker's own pool — keep the sum comfortably under
    # Postgres's max_connections (default 100).
    DB_POOL_SIZE: int = 10
    DB_MAX_OVERFLOW: int = 5

    # Telegram — single bot handles mentor commands (private chats only)
    # plus client group ingestion (my_chat_member / group messages)
    TELEGRAM_BOT_TOKEN: str = ""
    TELEGRAM_BOT_USERNAME: str = ""
    TELEGRAM_WEBHOOK_URL: str = ""
    TELEGRAM_WEBHOOK_SECRET: str = ""

    # Notion
    NOTION_API_KEY: str = ""
    NOTION_DATABASE_ID: str = ""
    NOTION_SYNC_INTERVAL_SECONDS: int = 3600

    # Google Sheets — автосинк анкет: либо JSON одной строкой, либо путь к файлу ключа
    GOOGLE_SERVICE_ACCOUNT_JSON: str = ""
    GOOGLE_SERVICE_ACCOUNT_FILE: str = ""
    SHEETS_SYNC_INTERVAL_SECONDS: int = 300

    # AI / transcription
    DEEPGRAM_API_KEY: str = ""
    OPENAI_API_KEY: str = ""
    OPENAI_MODEL: str = "gpt-4o-mini"
    ANTHROPIC_API_KEY: str = ""

    # Observability — Sentry. Пусто => выключено (в dev обычно и не нужно).
    SENTRY_DSN: str = ""
    SENTRY_TRACES_SAMPLE_RATE: float = 0.0

    # Payment notifications
    ENABLE_PAYMENT_NOTIFICATIONS: bool = True
    PAYMENT_NOTIFICATION_INTERVAL_SECONDS: int = 3600 * 6  # 6 hours
    PAYMENT_DUE_LOOK_AHEAD_DAYS: int = 14

    # Task urgency notifications (ОС 30/07, Блок B): >72ч просрочки — существенное
    # нарушение (Прил. № 3, п. 3.4), уходит Академ Хэду и МЗК, не тихой плашкой ментору.
    ENABLE_TASK_URGENCY_NOTIFICATIONS: bool = True
    TASK_URGENCY_NOTIFICATION_INTERVAL_SECONDS: int = 3600 * 3  # 3 hours

    # Agreement signature gate (ОС 30/07, Блок C): без подписи regламента ментор
    # не может начать работу. Самое рискованное место плана — ошибка в условии
    # блокирует вход всем менторам. Флаг позволяет выключить без деплоя.
    ENABLE_AGREEMENT_GATE: bool = False

    # Complaint SLA notifications (ОС 30/07, Блок D)
    ENABLE_COMPLAINT_SLA_NOTIFICATIONS: bool = True
    COMPLAINT_SLA_CHECK_INTERVAL_SECONDS: int = 3600  # 1 hour — SLA окно всего 24ч
    ENABLE_MZK_QUALITY_SCORE: bool = True

    # Часовой пояс компании: и SLA задач, и чекины считают «сутки» и «10 утра»
    # по нему, а не по UTC сервера — иначе рабочий день разъезжается со сменой
    # календарной даты.
    COMPANY_TIMEZONE: str = "Asia/Almaty"

    # SLA задач менторов (регламент менторов, раздел 6). Просрочка фиксируется
    # санкцией по ступеням, суммы берутся из reward_rules.
    ENABLE_TASK_SLA: bool = True
    TASK_SLA_DEFAULT_HOURS: int = 24
    TASK_SLA_CHECK_INTERVAL_SECONDS: int = 900  # 15 минут
    TASK_SLA_REMINDER_HOURS_BEFORE: int = 4
    # Ступени санкций за просрочку: 1-е нарушение за календарный месяц —
    # жёлтый, 2-е — оранжевый, 3-е и далее — красный.
    TASK_SLA_PENALTY_LADDER: str = "yellow,orange,red"

    # Ежедневный чекин сотрудников (менторы и МЗК).
    ENABLE_DAILY_CHECKIN: bool = True
    CHECKIN_HOUR: int = 10          # локальное время COMPANY_TIMEZONE
    CHECKIN_MINUTE: int = 0
    CHECKIN_GRACE_MINUTES: int = 30  # позже — late, после закрытия окна — missed
    CHECKIN_WINDOW_MINUTES: int = 240  # окно, после которого ставится missed
    CHECKIN_CHECK_INTERVAL_SECONDS: int = 600  # 10 минут

    # First admin seed
    FIRST_ADMIN_EMAIL: str = "admin@teenteched.kz"
    FIRST_ADMIN_PASSWORD: str = "Admin1234!"

    @property
    def cors_origins(self) -> list[str]:
        origins = {o.strip() for o in self.ALLOWED_ORIGINS.split(",") if o.strip()}
        if self.ENVIRONMENT != "production":
            origins.update(
                {
                    "http://localhost:3000",
                    "http://127.0.0.1:3000",
                    "http://localhost:5173",
                    "http://127.0.0.1:5173",
                    "http://localhost:5174",
                    "http://127.0.0.1:5174",
                }
            )
        return sorted(origins)


settings = Settings()
