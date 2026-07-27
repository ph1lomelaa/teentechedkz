"""Общий хелпер нотификаций: строка в БД + best-effort WS-пуш.

Порядок вызова копирует chat.py: мутация домена и Notification-строки едут в одной
транзакции вызывающего (db.add без commit), после commit вызывающий шлёт WS-события
через push_notification / push_ws — доставка best-effort, потерянный кадр догоняется
поллингом колокольчика и 30s staleTime react-query.
"""
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification import Notification
from app.services.ws_hub import manager


def notify(
    db: AsyncSession,
    user_id: uuid.UUID,
    *,
    kind: str,
    title: str,
    body: str = "",
    link: str = "",
    priority: str = "normal",
) -> Notification:
    """Добавить строку нотификации в текущую транзакцию (без commit)."""
    note = Notification(
        user_id=user_id, kind=kind, title=title, body=body, link=link, priority=priority
    )
    db.add(note)
    return note


async def dismiss_unread(
    db: AsyncSession, user_id: uuid.UUID, *, kind: str, body_contains: str
) -> None:
    """Снять непрочитанные нотификации по (получатель, kind, идентичность в body).

    Идентичность задачи кодируется в body (см. task_review_requested: body содержит
    "[task:{id}]"), а не в link — link одинаков для всех задач студента, и матч по
    нему снёс бы уведомления о чужих задачах.
    """
    res = await db.execute(
        select(Notification).where(
            Notification.user_id == user_id,
            Notification.kind == kind,
            Notification.is_read == False,  # noqa: E712
            Notification.body.contains(body_contains),
        )
    )
    for note in res.scalars().all():
        await db.delete(note)


async def has_unread(
    db: AsyncSession, user_id: uuid.UUID, *, kind: str, body_contains: str
) -> bool:
    """Есть ли непрочитанная нотификация с той же идентичностью (дедуп повторных заявок)."""
    res = await db.execute(
        select(Notification.id).where(
            Notification.user_id == user_id,
            Notification.kind == kind,
            Notification.is_read == False,  # noqa: E712
            Notification.body.contains(body_contains),
        ).limit(1)
    )
    return res.scalar_one_or_none() is not None


async def push_notification(note: Notification) -> None:
    """WS-пуш свежезакоммиченной нотификации (форма как в chat.py)."""
    await manager.send_to_users(
        [str(note.user_id)],
        "notification.new",
        {
            "id": str(note.id),
            "kind": note.kind,
            "title": note.title,
            "body": note.body,
            "link": note.link,
            "is_read": False,
            "priority": note.priority,
            "created_at": note.created_at.isoformat(),
        },
    )


async def push_ws(user_ids: list[uuid.UUID | str], event: str, data: dict) -> None:
    await manager.send_to_users([str(u) for u in user_ids], event, data)
