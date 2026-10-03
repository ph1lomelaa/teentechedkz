"""Фоновый цикл чекинов: напоминания и простановка пропусков.

Правила окна — в services/checkins.py (там же тесты). Здесь обход сотрудников,
уведомления и запись `missed` после закрытия окна.

Всё считается в поясе каждого сотрудника (регламент п.2.1: ментор в Европе
отмечается в 10:00 по своему времени), поэтому «сегодня», «окно открылось» и
«окно закрылось» у разных людей разные — общих значений на проход нет.

Напоминаний два: за CHECKIN_REMINDER_LEAD_MINUTES до открытия (`checkin_soon`)
и в момент открытия (`checkin_due`). Оба идут колокольчиком и WS-пушем; фронт
показывает их ещё и системным уведомлением браузера.

Идемпотентность: уникальный индекс (user_id, checkin_date) не даёт продублировать
отметку, а `was_sent` — прислать напоминание дважды за день, даже если первое
уже прочитано (цикл крутится раз в минуту). Выходные
пропускаются: копить в статистике пропуски за субботу бессмысленно.
"""
import asyncio
import logging
from datetime import datetime

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
    reminder_is_due,
    user_tz,
    window_is_closed,
    window_open_at,
)
from app.services.notify import notify, push_notification, was_sent

logger = logging.getLogger(__name__)


def _hhmm() -> str:
    return f"{settings.CHECKIN_HOUR:02d}:{settings.CHECKIN_MINUTE:02d}"


def plan_for_user(now_local: datetime) -> str | None:
    """Что сделать с сотрудником, который сегодня ещё не отметился:
    'soon' | 'due' | 'missed' | None. Чистая функция — для тестов."""
    today = now_local.date()
    if not is_workday(today):
        return None
    kw = {"hour": settings.CHECKIN_HOUR, "minute": settings.CHECKIN_MINUTE}
    if reminder_is_due(local_now_dt=now_local, lead_minutes=settings.CHECKIN_REMINDER_LEAD_MINUTES, **kw):
        return "soon"
    opens_at = window_open_at(today, tz_name=str(now_local.tzinfo), **kw)
    if now_local < opens_at:
        return None
    if window_is_closed(local_now_dt=now_local, window_minutes=settings.CHECKIN_WINDOW_MINUTES, **kw):
        return "missed"
    return "due"


async def check_daily_checkins() -> None:
    db = AsyncSessionLocal()
    try:
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

        # Отметки за все даты, которые сейчас «сегодня» хоть у кого-то.
        local_by_user = {u.id: local_now(user_tz(u, settings.COMPANY_TIMEZONE)) for u in staff}
        dates = {dt.date() for dt in local_by_user.values()}
        marked = (
            await db.execute(
                select(UserCheckin.user_id, UserCheckin.checkin_date).where(UserCheckin.checkin_date.in_(dates))
            )
        ).all()
        already = {(uid, d) for uid, d in marked}

        fresh_notes = []
        missed = 0
        for user in staff:
            now_local = local_by_user[user.id]
            today = now_local.date()
            if (user.id, today) in already:
                continue

            action = plan_for_user(now_local)
            if action is None:
                continue

            if action == "missed":
                db.add(UserCheckin(
                    user_id=user.id,
                    checkin_date=today,
                    status=CheckinStatus.missed,
                    checked_in_at=None,
                ))
                missed += 1
                continue

            kind = "checkin_soon" if action == "soon" else "checkin_due"
            # Метка дня общая для обоих видов — различает их kind. Формат
            # [слово:значение] фронт вырезает из текста системного уведомления.
            day_key = f"[checkin:{today.isoformat()}]"
            if await was_sent(db, user.id, kind=kind, body_contains=day_key):
                continue
            if action == "soon":
                title = f"Через {settings.CHECKIN_REMINDER_LEAD_MINUTES} минут отметка"
                body = f"В {_hhmm()} нужно нажать «Я на месте» в кабинете {day_key}"
            else:
                title = "Отметьтесь на сегодня"
                body = f"Нажмите «Я на месте» в кабинете {day_key}"
            fresh_notes.append(notify(
                db, user.id,
                kind=kind,
                title=title,
                body=body,
                # Кнопка «Я на месте» живёт на «Моём дне», а не на главной.
                link="/workspace/my-day",
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
