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

    # Per-process: with `uvicorn --workers N` this runs once per worker, which
    # is correct — each worker holds its own local WebSocket connections and
    # needs its own Redis subscriber to fan out to them (see app.services.ws_hub).
    from app.services.ws_hub import manager as ws_manager
    await ws_manager.start()

    # Singleton background loops (Telegram webhook registration/health,
    # Sheets/Notion sync, payment notifier) deliberately do NOT run here.
    # With multiple uvicorn workers, a per-worker lifespan would start each
    # loop N times — N duplicate Notion syncs, N duplicate payment-due
    # notifications sent to admins, etc. They run exactly once instead, in
    # the single `worker` (arq) process — see app/worker.py's on_startup.

    yield
    await ws_manager.stop()
    logger.info("TeenTechEd CRM shutting down...")


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
