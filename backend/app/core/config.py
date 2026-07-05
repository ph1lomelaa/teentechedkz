from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # App
    ENVIRONMENT: str = "development"
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

    # Telegram — single bot handles mentor commands (private chats only)
    # plus client group ingestion (my_chat_member / group messages)
    TELEGRAM_BOT_TOKEN: str = ""
    TELEGRAM_BOT_USERNAME: str = ""
    TELEGRAM_WEBHOOK_URL: str = ""
    TELEGRAM_WEBHOOK_SECRET: str = ""

    # Notion
    NOTION_API_KEY: str = ""
    NOTION_DATABASE_ID: str = ""

    # Google Sheets — автосинк анкет: либо JSON одной строкой, либо путь к файлу ключа
    GOOGLE_SERVICE_ACCOUNT_JSON: str = ""
    GOOGLE_SERVICE_ACCOUNT_FILE: str = ""
    SHEETS_SYNC_INTERVAL_SECONDS: int = 300

    # AI / transcription
    DEEPGRAM_API_KEY: str = ""
    OPENAI_API_KEY: str = ""
    OPENAI_MODEL: str = "gpt-4o-mini"
    ANTHROPIC_API_KEY: str = ""

    # First admin seed
    FIRST_ADMIN_EMAIL: str = "admin@teenteched.kz"
    FIRST_ADMIN_PASSWORD: str = "Admin1234!"

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.ALLOWED_ORIGINS.split(",")]


settings = Settings()
