import logging
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from jose import JWTError, jwt
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.deps import CurrentUser
from app.core.permissions import Action, require_access
from app.models.user import User, UserRole
from app.services.meeting_bot import get_provider
from app.services.meeting_bot.base import MeetingBotError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/integrations", tags=["integrations"])

# Live note-session recordings rarely run past an hour; the browser re-fetches
# a token per session anyway (useDeepgramTranscription calls this once at
# start()), so there's no need to push this near Deepgram's actual max.
DEEPGRAM_TOKEN_TTL_SECONDS = 3600


@router.post("/deepgram/token")
async def deepgram_token(current_user: CurrentUser):
    require_access(current_user, "integrations", Action.manage)

    api_key = os.getenv("DEEPGRAM_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="Deepgram не настроен на сервере",
            headers={"X-Error-Code": "DEEPGRAM_NOT_CONFIGURED"},
        )

    # The browser only ever gets a short-lived JWT minted via /v1/auth/grant —
    # never the permanent project key. Minting requires DEEPGRAM_API_KEY to
    # have at least Member scope in the Deepgram console. The old fallback
    # (handing out the permanent key when grant failed) leaked the key to
    # every mentor's browser, so a failed grant is now a hard 503 the UI
    # shows as "распознавание недоступно" instead of a silent leak.
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                "https://api.deepgram.com/v1/auth/grant",
                headers={"Authorization": f"Token {api_key}"},
                json={"ttl_seconds": DEEPGRAM_TOKEN_TTL_SECONDS},
            )
        response.raise_for_status()
        data = response.json()
        return {
            "access_token": data["access_token"],
            "token_type": "jwt",
            "expires_in": data.get("expires_in", DEEPGRAM_TOKEN_TTL_SECONDS),
        }
    except Exception:
        logger.error(
            "Deepgram grant-token call failed "
            "(check that DEEPGRAM_API_KEY has Member scope in the Deepgram console)",
            exc_info=True,
        )
        raise HTTPException(
            status_code=503,
            detail="Распознавание речи временно недоступно",
            headers={"X-Error-Code": "DEEPGRAM_TOKEN_UNAVAILABLE"},
        )


# ---------------------------------------------------------------- Zoom
#
# Ментор один раз подключает свой Zoom: без этого бот не может зайти во
# встречу его аккаунта (правило Zoom с 02.03.2026 — токен OBF). Код
# авторизации мы сразу передаём в Attendee: он сам меняет его на токены,
# хранит их и выпускает OBF при запуске бота. Client Secret Zoom живёт
# только в Attendee.

ZOOM_STATE_TTL = timedelta(minutes=10)
ZOOM_STATE_PURPOSE = "zoom_connect"


def _zoom_redirect_uri() -> str:
    if settings.ZOOM_REDIRECT_URI:
        return settings.ZOOM_REDIRECT_URI
    base = (settings.PUBLIC_API_BASE_URL or settings.FRONTEND_URL).rstrip("/")
    return f"{base}/api/v1/integrations/zoom/callback"


def safe_return_path(path: str | None) -> str:
    """Куда вернуть ментора после Zoom — только наши страницы кабинета."""
    if path and path.startswith(("/workspace/", "/notes/")) and "//" not in path and "\\" not in path:
        return path
    return "/workspace/meetings"


def make_zoom_state(user_id: uuid.UUID, now: datetime | None = None, return_to: str | None = None) -> str:
    now = now or datetime.now(timezone.utc)
    return jwt.encode(
        {
            "sub": str(user_id),
            "purpose": ZOOM_STATE_PURPOSE,
            "exp": now + ZOOM_STATE_TTL,
            "nonce": secrets.token_urlsafe(8),
            "return_to": safe_return_path(return_to),
        },
        settings.JWT_SECRET_KEY,
        algorithm=settings.JWT_ALGORITHM,
    )


def read_zoom_state(state: str) -> uuid.UUID | None:
    return (read_zoom_state_full(state) or (None, None))[0]


def read_zoom_state_full(state: str) -> tuple[uuid.UUID, str] | None:
    try:
        payload = jwt.decode(state, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    except JWTError:
        return None
    if payload.get("purpose") != ZOOM_STATE_PURPOSE:
        return None
    try:
        return uuid.UUID(str(payload.get("sub"))), safe_return_path(payload.get("return_to"))
    except ValueError:
        return None


def _zoom_status(user: User) -> dict:
    connected = bool(user.zoom_user_id) and user.zoom_connection_state != "disconnected"
    return {
        # Включена ли запись ботом вообще (Meet и Teams работают и без Zoom).
        "bot_enabled": bool(settings.MEETING_BOT_ENABLED),
        # Пускаем ли бота в Zoom и как: off | company (только корпоративный
        # аккаунт, подключение не нужно) | obf (любые встречи после проверки Zoom).
        "zoom_bot_enabled": bool(settings.MEETING_BOT_ENABLED and settings.ZOOM_BOT_MODE != "off"),
        "zoom_mode": settings.ZOOM_BOT_MODE if settings.MEETING_BOT_ENABLED else "off",
        # Подключать свой Zoom нужно только в режиме obf.
        "available": bool(settings.MEETING_BOT_ENABLED and settings.ZOOM_BOT_MODE == "obf" and settings.ZOOM_CLIENT_ID),
        "connected": connected,
        "state": user.zoom_connection_state,
        "connected_at": user.zoom_connected_at.isoformat() if user.zoom_connected_at else None,
    }


@router.get("/zoom/status")
async def zoom_status(current_user: CurrentUser):
    require_access(current_user, "integrations", Action.manage)
    return _zoom_status(current_user)


class ZoomConnectRequest(BaseModel):
    return_to: str | None = None


@router.post("/zoom/connect")
async def zoom_connect(current_user: CurrentUser, body: ZoomConnectRequest | None = None):
    """Ссылка на страницу Zoom «Разрешить доступ». Фронт открывает её сам."""
    require_access(current_user, "integrations", Action.manage)
    if not settings.MEETING_BOT_ENABLED or not settings.ZOOM_CLIENT_ID:
        raise HTTPException(
            status_code=503,
            detail="Подключение Zoom пока недоступно",
            headers={"X-Error-Code": "ZOOM_NOT_CONFIGURED"},
        )
    params = urlencode(
        {
            "response_type": "code",
            "client_id": settings.ZOOM_CLIENT_ID,
            "redirect_uri": _zoom_redirect_uri(),
            "state": make_zoom_state(current_user.id, return_to=body.return_to if body else None),
        }
    )
    return {"authorize_url": f"https://zoom.us/oauth/authorize?{params}"}


@router.get("/zoom/callback", include_in_schema=False)
async def zoom_callback(
    db: Annotated[AsyncSession, Depends(get_db)],
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
):
    """Сюда Zoom возвращает ментора после «Разрешить». Пользователь
    определяется по подписанному state, а не по сессии браузера."""
    decoded = read_zoom_state_full(state) if state else None
    user_id, return_to = decoded if decoded else (None, "/workspace/meetings")
    back = settings.FRONTEND_URL.rstrip("/") + return_to
    sep = "&" if "?" in return_to else "?"
    if error or not code or not user_id:
        return RedirectResponse(f"{back}{sep}zoom=error", status_code=302)
    user = await db.get(User, user_id)
    if not user or not user.is_active:
        return RedirectResponse(f"{back}{sep}zoom=error", status_code=302)
    try:
        connection = await get_provider().create_zoom_connection(
            code=code,
            redirect_uri=_zoom_redirect_uri(),
            metadata={"teenteched_user_id": str(user.id)},
        )
    except MeetingBotError:
        logger.warning("Zoom connection for user %s failed", user.id, exc_info=True)
        return RedirectResponse(f"{back}{sep}zoom=error", status_code=302)
    user.zoom_connection_id = connection.id
    user.zoom_user_id = connection.user_id
    user.zoom_connection_state = connection.state or "connected"
    user.zoom_connected_at = datetime.now(timezone.utc)
    await db.commit()
    return RedirectResponse(f"{back}{sep}zoom=connected", status_code=302)


@router.delete("/zoom")
async def zoom_disconnect(
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    require_access(current_user, "integrations", Action.manage)
    user = await db.get(User, current_user.id)
    if user and user.zoom_connection_id:
        try:
            await get_provider().delete_zoom_connection(user.zoom_connection_id)
        except MeetingBotError:
            logger.warning("Zoom disconnect in provider failed for user %s", user.id, exc_info=True)
        user.zoom_connection_id = None
        user.zoom_user_id = None
        user.zoom_connection_state = None
        user.zoom_connected_at = None
        await db.commit()
    return _zoom_status(user or current_user)
