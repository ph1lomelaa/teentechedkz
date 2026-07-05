from fastapi import APIRouter, Header, HTTPException, Request
from aiogram.types import Update
import logging

from app.core.config import settings

router = APIRouter(prefix="/telegram", tags=["telegram"])
logger = logging.getLogger(__name__)


@router.post("/webhook")
async def telegram_webhook(
    request: Request,
    x_telegram_bot_api_secret_token: str | None = Header(default=None),
):
    from app.services.telegram_bot import get_bot, get_dispatcher

    if not settings.TELEGRAM_BOT_TOKEN:
        raise HTTPException(status_code=503, detail="Telegram bot not configured")

    if settings.TELEGRAM_WEBHOOK_SECRET:
        if x_telegram_bot_api_secret_token != settings.TELEGRAM_WEBHOOK_SECRET:
            raise HTTPException(status_code=401, detail="Invalid secret token")

    try:
        data = await request.json()
        bot = get_bot()
        dp = get_dispatcher()
        update = Update.model_validate(data)
        await dp.feed_update(bot=bot, update=update, update_id=update.update_id)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Telegram webhook error")
        raise HTTPException(status_code=500, detail="Telegram update processing failed") from e

    return {"ok": True}
