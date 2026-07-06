from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import settings
from app.api.v1.router import api_router

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def _check_production_secrets() -> None:
    """Громко ругаемся на дефолтные секреты в проде. Не роняем приложение,
    чтобы не положить работающий сайт, — но это надо чинить сразу."""
    if settings.ENVIRONMENT != "production":
        return
    problems = []
    if "change-me" in settings.JWT_SECRET_KEY:
        problems.append("JWT_SECRET_KEY — дефолтный: любой может подделать токен админа")
    if "change-me" in settings.PGCRYPTO_KEY:
        problems.append("PGCRYPTO_KEY — дефолтный: шифрование ИИН формальное")
    if settings.FIRST_ADMIN_PASSWORD == "Admin1234!":
        problems.append("FIRST_ADMIN_PASSWORD — дефолтный: смени пароль админа")
    if settings.MINIO_SECRET_KEY == "minioadmin":
        problems.append("MINIO_SECRET_KEY — дефолтный (minioadmin)")
    for p in problems:
        logger.critical(f"PRODUCTION SECURITY: {p}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("TeenTechEd CRM starting up...")
    _check_production_secrets()
    # Register Telegram webhook if token is configured
    webhook_health_task = None
    if settings.TELEGRAM_BOT_TOKEN and settings.TELEGRAM_WEBHOOK_URL:
        try:
            from app.services.telegram_bot import get_bot, webhook_health_loop
            bot = get_bot()
            webhook_url = f"{settings.TELEGRAM_WEBHOOK_URL}"
            await bot.set_webhook(
                webhook_url,
                secret_token=settings.TELEGRAM_WEBHOOK_SECRET or None,
                allowed_updates=["message", "my_chat_member"],
            )
            logger.info(f"Telegram webhook set: {webhook_url}")
            import asyncio
            webhook_health_task = asyncio.create_task(webhook_health_loop())
        except Exception as e:
            logger.warning(f"Failed to set Telegram webhook: {e}")

    # Автосинк анкет из Google Sheets (если настроен service account)
    sheets_task = None
    from app.services.sheets_sync import is_configured, sync_loop
    if is_configured():
        import asyncio
        sheets_task = asyncio.create_task(sync_loop())
    else:
        logger.info("Sheets sync disabled: service account key is not configured")

    # Автосинк Notion-зеркала (если задан NOTION_API_KEY)
    notion_task = None
    from app.services import notion_sync
    if notion_sync.is_configured():
        import asyncio
        notion_task = asyncio.create_task(notion_sync.sync_loop())
    else:
        logger.info("Notion sync disabled: NOTION_API_KEY / NOTION_DATABASE_ID not configured")

    yield
    if sheets_task:
        sheets_task.cancel()
    if notion_task:
        notion_task.cancel()
    if webhook_health_task:
        webhook_health_task.cancel()
    logger.info("TeenTechEd CRM shutting down...")
    if settings.TELEGRAM_BOT_TOKEN:
        try:
            from app.services.telegram_bot import get_bot
            bot = get_bot()
            await bot.session.close()
        except Exception:
            pass


# В проде Swagger/OpenAPI не светим наружу: схема API — подарок для перебора эндпоинтов
_is_production = settings.ENVIRONMENT == "production"

app = FastAPI(
    title="TeenTechEd CRM",
    description="CRM для образовательного консалтинга TeenTechEd",
    version="1.0.0",
    lifespan=lifespan,
    docs_url=None if _is_production else "/api/docs",
    redoc_url=None if _is_production else "/api/redoc",
    openapi_url=None if _is_production else "/api/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)


@app.exception_handler(404)
async def not_found_handler(request: Request, exc):
    return JSONResponse(
        status_code=404,
        content={"detail": "Not found", "code": "NOT_FOUND"},
    )


@app.exception_handler(403)
async def forbidden_handler(request: Request, exc):
    return JSONResponse(
        status_code=403,
        content={"detail": "Access denied", "code": "FORBIDDEN"},
    )


@app.get("/health")
async def health():
    return {"status": "ok", "service": "teenteched-crm"}
