"""Фоновый цикл чекинов: напоминание в 10:00 и простановка пропусков.

Правила окна — в services/checkins.py (там же тесты). Здесь обход сотрудников,
уведомления и запись `missed` после закрытия окна.

Идемпотентность: уникальный индекс (user_id, checkin_date) не даёт продублировать
отметку, а `has_unread` — прислать напоминание дважды за день. Выходные цикл
пропускает: копить в статистике пропуски за субботу бессмысленно.
"""
import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.user import User
from app.models.user_checkin import CheckinStatus, UserCheckin
from app.services.checkins import (
    CHECKIN_ROLES,
    is_workday,
    local_now,
    window_is_closed,
    window_open_at,
)
from app.services.notify import has_unread, notify, push_notification

logger = logging.getLogger(__name__)


async def check_daily_checkins() -> None:
    db = AsyncSessionLocal()
    try:
        now_local = local_now(settings.COMPANY_TIMEZONE)
        today = now_local.date()
        if not is_workday(today):
            return

        opens_at = window_open_at(
            today,
            hour=settings.CHECKIN_HOUR,
            minute=settings.CHECKIN_MINUTE,
            tz_name=settings.COMPANY_TIMEZONE,
        )
        if now_local < opens_at:
            return  # окно ещё не открылось — ни напоминать, ни закрывать нечего

        staff = (
            await db.execute(
                select(User).where(
                    User.role.in_(tuple(CHECKIN_ROLES)),
                    User.is_active == True,  # noqa: E712
                )
            )
        ).scalars().all()
        if not staff:
            return

        marked = (
            await db.execute(
                select(UserCheckin.user_id).where(UserCheckin.checkin_date == today)
            )
        ).scalars().all()
        already = set(marked)

        closed = window_is_closed(
            local_now_dt=now_local,
            hour=settings.CHECKIN_HOUR,
            minute=settings.CHECKIN_MINUTE,
            window_minutes=settings.CHECKIN_WINDOW_MINUTES,
        )

        fresh_notes = []
        missed = 0
        day_key = f"[checkin:{today.isoformat()}]"
        for user in staff:
            if user.id in already:
                continue

            if closed:
                db.add(UserCheckin(
                    user_id=user.id,
                    checkin_date=today,
                    status=CheckinStatus.missed,
                    checked_in_at=None,
                ))
                missed += 1
                continue

            if await has_unread(db, user.id, kind="checkin_due", body_contains=day_key):
                continue
            fresh_notes.append(notify(
                db, user.id,
                kind="checkin_due",
                title="Отметьтесь на сегодня",
                body=f"Нажмите «Я на месте» в кабинете {day_key}",
                link="/workspace",
                priority="normal",
            ))

        if not fresh_notes and not missed:
            return
        try:
            await db.commit()
        except IntegrityError:
            # Гонка с ручным чекином ровно в момент закрытия окна: человек
            # успел нажать кнопку, пока цикл собирался поставить ему missed.
            # Побеждает живая отметка.
            await db.rollback()
            logger.info("Checkin race with a manual check-in, skipping this pass")
            return
        for note in fresh_notes:
            await db.refresh(note)
            await push_notification(note)
        logger.info(f"Checkins: {missed} marked missed, {len(fresh_notes)} reminders")
    except Exception:
        await db.rollback()
        raise
    finally:
        await db.close()


async def checkin_loop() -> None:
    interval_seconds = settings.CHECKIN_CHECK_INTERVAL_SECONDS
    logger.info(f"Checkin loop starting (interval: {interval_seconds}s)")

    while True:
        try:
            await check_daily_checkins()
        except Exception as e:
            logger.error(f"Checkin job failed: {e}", exc_info=True)

        await asyncio.sleep(interval_seconds)
