from contextlib import asynccontextmanager
import logging
import uuid

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

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

    # Переопределения прав из конструктора. Загружаются в каждом воркере: реестр
    # спрашивают на каждом запросе, поэтому он держится в памяти процесса, а не
    # читается из базы. Ошибка здесь не должна ронять запуск — без
    # переопределений система работает по значениям из кода, то есть строго не
    # шире задуманного.
    try:
        from app.core.database import AsyncSessionLocal
        from app.services.permission_overrides import reload_overrides

        async with AsyncSessionLocal() as db:
            applied = await reload_overrides(db)
        if applied:
            logger.info("Загружено переопределений прав: %s", applied)
    except Exception:
        logger.exception("Не удалось загрузить переопределения прав — работаем по коду")

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


# Обработка ошибок.
#
# Раньше здесь висели два хендлера, зарегистрированных по КОДУ статуса (403 и
# 404). В Starlette такой хендлер имеет приоритет над всеми остальными и
# подменяет ответ целиком — вместе с `detail` и заголовками. Из-за этого весь
# домен ошибок приложения до фронта не доходил: X-Error-Code стирался, а текст
# заменялся на «Access denied». Пользователь с временным паролем видел «Access
# denied» вместо «Сначала смените временный пароль», а обработчик смены роли в
# client.ts не срабатывал ни разу, потому что ждал заголовок, которого уже нет.
# Пострадавших кодов около десятка: PASSWORD_CHANGE_REQUIRED,
# AGREEMENT_SIGNATURE_REQUIRED, PERMISSION_REQUIRED, TASK_ACCEPTANCE_FORBIDDEN,
# ASSIGNEE_AGREEMENT_REQUIRED и другие.
#
# Теперь один хендлер на HTTPException: detail и headers проходят как есть.

_DEFAULT_ERROR_CODE = {
    401: "UNAUTHORIZED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
}


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    headers = dict(exc.headers or {})
    content: dict = {"detail": exc.detail}
    # `code` в теле — для мест, где читать заголовок неудобно. Источник правды
    # остаётся заголовком X-Error-Code, поэтому сначала берём его.
    code = headers.get("X-Error-Code") or _DEFAULT_ERROR_CODE.get(exc.status_code)
    if code:
        content["code"] = code
    return JSONResponse(status_code=exc.status_code, content=content, headers=headers or None)


def _cors_headers_for(request: Request) -> dict[str, str]:
    """CORS-заголовки для ответа, который не пройдёт через CORSMiddleware.

    ServerErrorMiddleware (он и вызывает хендлер Exception) стоит СНАРУЖИ
    CORSMiddleware, поэтому ответ 500 уходит без CORS-заголовков. В проде фронт
    и API на одном origin, и это незаметно, а вот локально (5173 → 8001) браузер
    блокирует такой ответ, axios видит «Network Error» — и error_id, ради
    которого всё затевалось, до разработчика не доезжает.
    """
    origin = request.headers.get("origin")
    if not origin or origin not in settings.cors_origins:
        return {}
    return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
    }


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """Единая точка для необработанных исключений.

    До этого их не логировал никто: хендлера на Exception не было, ответ уходил
    дефолтный из Starlette, и разбор каждой 500-ки начинался с археологии по
    логам докера. Теперь у ошибки есть короткий id — он и в логе, и в теле
    ответа, и тегом в Sentry. «У меня 500 при сохранении студента» превращается
    в один grep по id.

    ServerErrorMiddleware после хендлера всё равно пробрасывает исключение
    дальше, так что Sentry и логи uvicorn своё получают.
    """
    error_id = uuid.uuid4().hex[:12]
    logger.exception(
        "Необработанная ошибка [%s] %s %s", error_id, request.method, request.url.path
    )
    try:
        import sentry_sdk

        sentry_sdk.set_tag("error_id", error_id)
    except Exception:  # noqa: BLE001 — падение телеметрии не должно менять ответ
        pass
    return JSONResponse(
        status_code=500,
        content={
            "detail": "Внутренняя ошибка сервера. Передайте код ошибки в поддержку.",
            "code": "INTERNAL_ERROR",
            "error_id": error_id,
        },
        headers=_cors_headers_for(request) or None,
    )


@app.get("/health")
async def health():
    return {"status": "ok", "service": "teenteched-crm"}
