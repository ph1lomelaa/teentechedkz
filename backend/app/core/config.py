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
