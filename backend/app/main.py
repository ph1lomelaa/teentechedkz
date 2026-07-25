from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import settings
from app.api.v1.router import api_router

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def _init_sentry() -> None:
    """Error-tracking. Включается только если задан SENTRY_DSN — без него
    (dev, локалка) полностью no-op. Интеграции FastAPI/Starlette подхватываются
    автоматически."""
    if not settings.SENTRY_DSN:
        return
    try:
        import sentry_sdk

        sentry_sdk.init(
            dsn=settings.SENTRY_DSN,
            environment=settings.ENVIRONMENT,
            traces_sample_rate=settings.SENTRY_TRACES_SAMPLE_RATE,
            send_default_pii=False,  # не шлём тела запросов/куки/IP с ПДн студентов
        )
        logger.info("Sentry initialised (env=%s)", settings.ENVIRONMENT)
    except Exception:
        logger.exception("Не удалось инициализировать Sentry — продолжаем без него")


_init_sentry()


def _check_production_secrets() -> None:
    """В проде проверяем секреты. Дефолтные JWT/PGCRYPTO — это не «предупреждение»,
    а дыра: с дефолтным JWT_SECRET_KEY кто угодно подделывает токен админа, с
    дефолтным PGCRYPTO_KEY шифрование ИИН формальное. Поэтому по ним — отказ
    старта (fail-fast): упавший прод безопаснее молча дырявого. Менее критичные
    дефолты (пароль сидового админа, ключ MinIO) — только громкий лог, чтобы не
    ронять уже работающий сайт из-за того, что можно поправить в UI."""
    if settings.ENVIRONMENT != "production":
        return

    # Фатальные: с ними прод стартовать не должен.
    fatal = []
    if "change-me" in settings.JWT_SECRET_KEY:
        fatal.append("JWT_SECRET_KEY — дефолтный: любой может подделать токен админа")
    if "change-me" in settings.PGCRYPTO_KEY:
        fatal.append("PGCRYPTO_KEY — дефолтный: шифрование ИИН формальное")

    # Некритичные: логируем, но не роняем.
    warnings = []
    if settings.FIRST_ADMIN_PASSWORD == "Admin1234!":
        warnings.append("FIRST_ADMIN_PASSWORD — дефолтный: смени пароль админа")
    if settings.MINIO_SECRET_KEY == "minioadmin":
        warnings.append("MINIO_SECRET_KEY — дефолтный (minioadmin)")
    for w in warnings:
        logger.critical(f"PRODUCTION SECURITY: {w}")

    if fatal:
        for p in fatal:
            logger.critical(f"PRODUCTION SECURITY (FATAL): {p}")
        raise RuntimeError(
            "Отказ старта: в проде остались дефолтные секреты — "
            + "; ".join(fatal)
            + ". Задай случайные значения (32+ символов) в .env и перезапусти."
        )


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


def _init_metrics(app: FastAPI) -> None:
    """Prometheus-метрики приложения на /metrics: RPS, латентность, коды ответов
    по эндпоинтам. Наружу /metrics не торчит — Caddy проксирует только /api/* и
    /health, так что дотянуться до него может лишь Prometheus во внутренней
    docker-сети. Обёрнуто в try, чтобы отсутствие пакета не роняло старт."""
    try:
        from prometheus_fastapi_instrumentator import Instrumentator

        Instrumentator(
            should_group_status_codes=True,
            excluded_handlers=["/metrics", "/health"],
        ).instrument(app).expose(app, endpoint="/metrics", include_in_schema=False)
        logger.info("Prometheus metrics exposed at /metrics")
    except Exception:
        logger.exception("Не удалось инициализировать /metrics — продолжаем без них")


_init_metrics(app)

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
