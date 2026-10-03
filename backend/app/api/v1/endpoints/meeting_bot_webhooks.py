"""Вебхуки провайдера бота. Без авторизации пользователя — подлинность
проверяется подписью (Attendee: HMAC-SHA256 в X-Webhook-Signature)."""
from __future__ import annotations

import json
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.services.meeting_bot import get_provider
from app.services.meeting_bot.service import handle_provider_event

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/webhooks/meeting-bot", tags=["meeting-bot-webhooks"])


@router.post("/{provider_name}")
async def meeting_bot_webhook(
    provider_name: str,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    if not settings.MEETING_BOT_ENABLED or provider_name != settings.MEETING_BOT_PROVIDER:
        raise HTTPException(status_code=404, detail="Not found")
    try:
        payload = json.loads(await request.body())
    except (ValueError, UnicodeDecodeError):
        raise HTTPException(status_code=400, detail="Invalid JSON")
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid payload")

    provider = get_provider(provider_name)
    if not provider.verify_webhook(payload, request.headers.get("X-Webhook-Signature")):
        logger.warning("Meeting bot webhook with bad signature (trigger=%s)", payload.get("trigger"))
        raise HTTPException(status_code=401, detail="Bad signature")

    outcome = await handle_provider_event(db, provider_name, payload)
    return {"ok": True, "duplicate": outcome.duplicate}
