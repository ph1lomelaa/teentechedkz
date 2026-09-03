"""Самозапись: подсказать карточку, привязать аккаунт, одобрить заявку.

Одно место на три входа
-----------------------
Привязать аккаунт к карточке нужно из трёх мест: автоматически на /join, из
очереди заявок и руками из карточки студента. Логика у всех одна и цена ошибки
одна — привязали к чужой карточке, и человек видит чужие документы. Поэтому она
живёт здесь, а эндпоинты только решают, кто имеет право её позвать.

Почему авто-привязка настолько узкая
------------------------------------
`fuzzy_match` умеет и транслит, и Левенштейна, но автоматом мы принимаем только
точное совпадение телефона. Разница в цене ошибки: неавтоматическое совпадение
уходит админу подсказкой и стоит один клик, а ошибочная авто-привязка отдаёт
чужой кабинет молча и обнаруживается уже жалобой.

Третье условие — уникальность телефона в базе. Две карточки с одним номером
(брат и сестра, семейный телефон) дают `phone_exact` на обе, и `fuzzy_match`
вернёт ту, что попалась первой. Это ровно тот случай, где «привязали к чужой»
происходит без единого признака ошибки.
"""
from __future__ import annotations

import sys
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, Request, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.access_request import (
    STATUS_APPROVED,
    STATUS_AUTO_APPROVED,
    STATUS_NEW,
    AccessRequest,
)
from app.models.audit_log import AuditAction
from app.models.student import Student
from app.models.student_invite import StudentInvite
from app.models.user import User, UserRole
from app.services.audit import record_audit
from app.services.sheets_sync import _load_students_index

# Матчинг живёт в пакете `migration`, который лежит рядом с приложением, а не
# внутри него. Тот же приём, что в endpoints/students.py:_compute_duplicate_pairs.
if "/app" not in sys.path:
    sys.path.insert(0, "/app")


def normalize_phone(phone: str) -> str:
    from migration.transformers.normalize import normalize_phone as _impl

    return _impl(phone or "")


async def backfill_pending_without_request(db: AsyncSession) -> int:
    """Показать в очереди всех, кто ждёт одобрения, кем бы их ни завели.

    Ради чего
    ---------
    Очередь читает только `access_requests`. Аккаунт можно завести и мимо неё —
    так делал старый вход через Google: незнакомая почта создавала
    `User(role=mentor, is_active=False)` без строки заявки. Такой человек ждал
    вечно: в очереди его нет, а в списке пользователей он неотличим от
    отключённого. Именно так «заявки учеников просто не показывались».

    Разовая миграция (088) вычистила накопленное, но не защищает от нового:
    любой будущий путь создания снова родит невидимку. Поэтому проверка
    ленивая — на каждом открытии очереди, — и её стоимость нулевая, когда
    вставлять нечего.

    Кого НЕ берём
    ------------
    Приглашённых сотрудников с живой ссылкой: они ждут не решения админа, а
    собственного перехода по приглашению, и в очереди были бы шумом.

    Роль в заявке — `student` или `mentor`: только их допускает CHECK таблицы.
    Ждущий аккаунт носит роль-заглушку, настоящая роль выбирается при
    одобрении, поэтому здесь она лишь подсказка админу.
    """
    now = datetime.now(timezone.utc)
    live_invite = (
        select(StudentInvite.user_id)
        .where(StudentInvite.used_at.is_(None), StudentInvite.expires_at > now)
        .scalar_subquery()
    )
    users = (
        (
            await db.execute(
                select(User)
                .outerjoin(AccessRequest, AccessRequest.user_id == User.id)
                .where(
                    User.is_active == False,  # noqa: E712
                    AccessRequest.id.is_(None),
                    User.id.not_in(live_invite),
                )
            )
        )
        .scalars()
        .all()
    )
    for user in users:
        db.add(
            AccessRequest(
                user_id=user.id,
                requested_role=(
                    UserRole.student.value
                    if user.role == UserRole.student
                    else UserRole.mentor.value
                ),
                full_name=user.name or user.email,
                phone_raw=user.phone or "",
                phone_normalized=normalize_phone(user.phone or ""),
                status=STATUS_NEW,
            )
        )
    if users:
        await db.flush()
    return len(users)


async def backfill_unlinked_student_requests(db: AsyncSession) -> int:
    """Вернуть в очередь старые кабинеты ученика без карточки.

    До появления /join администратор мог выдать пользователю роль student
    отдельно от students.user_id. Такой человек активен в списке пользователей,
    но не может открыть кабинет и не имеет строки для ручной привязки. Создаём
    заявку лениво при открытии очереди. Если старая заявка была помечена
    одобренной, но карточка всё же не получила user_id, возвращаем её в `new`:
    «одобрено без привязки» — противоречивое состояние, в котором ученику
    нельзя открыть кабинет. Отклонённые заявки не переоткрываем.
    """
    rows = (
        await db.execute(
            select(User, AccessRequest)
            .outerjoin(Student, Student.user_id == User.id)
            .outerjoin(AccessRequest, AccessRequest.user_id == User.id)
            .where(
                User.role == UserRole.student,
                Student.id.is_(None),
                or_(
                    AccessRequest.id.is_(None),
                    AccessRequest.status.in_((STATUS_APPROVED, STATUS_AUTO_APPROVED)),
                ),
            )
        )
    ).all()
    for user, request in rows:
        if request is None:
            db.add(
                AccessRequest(
                    user_id=user.id,
                    requested_role=UserRole.student.value,
                    full_name=user.name,
                    phone_raw=user.phone or "",
                    phone_normalized=normalize_phone(user.phone or ""),
                    status=STATUS_NEW,
                )
            )
        else:
            request.status = STATUS_NEW
            request.decided_by = None
            request.decided_at = None
    if rows:
        await db.flush()
    return len(rows)


async def load_students_index(db: AsyncSession) -> list[dict]:
    return await _load_students_index(db)


class Suggestion:
    """Что матчинг думает про заявку — и можно ли этому доверять без человека."""

    __slots__ = ("student_id", "confidence", "method", "auto_linkable", "blocked_reason")

    def __init__(
        self,
        student_id: uuid.UUID | None,
        confidence: float,
        method: str,
        auto_linkable: bool,
        blocked_reason: str | None = None,
    ) -> None:
        self.student_id = student_id
        self.confidence = confidence
        self.method = method
        self.auto_linkable = auto_linkable
        self.blocked_reason = blocked_reason


def suggest_student(full_name: str, phone: str, index: list[dict]) -> Suggestion:
    """Подсказка по карточке + вердикт, годится ли она для авто-привязки."""
    from migration.transformers.match import fuzzy_match

    match = fuzzy_match(full_name or "", phone or "", index)
    if not match.student_id:
        return Suggestion(None, 0.0, "none", False, "no_match")

    if match.method != "phone_exact":
        # Совпадение по имени — подсказка админу, но не основание пускать.
        return Suggestion(
            match.student_id, match.confidence, match.method, False, "not_phone_exact"
        )

    card = next((s for s in index if s["id"] == match.student_id), None)
    if card is None:
        return Suggestion(match.student_id, match.confidence, match.method, False, "no_match")
    if card.get("user_id") is not None:
        return Suggestion(
            match.student_id, match.confidence, match.method, False, "card_taken"
        )

    normalized = normalize_phone(phone)
    if normalized:
        same_phone = sum(1 for s in index if normalize_phone(s.get("phone", "")) == normalized)
        if same_phone > 1:
            # Телефон на несколько карточек: угадывать нельзя, решает человек.
            return Suggestion(
                match.student_id, match.confidence, match.method, False, "duplicate_phone"
            )

    return Suggestion(match.student_id, match.confidence, match.method, True)


#: Человеческие причины отказа — уходят админу в ответе на массовое одобрение.
BLOCKED_REASON_TEXT = {
    "no_match": "Совпадений в базе нет — нужна новая карточка",
    "not_phone_exact": "Совпадение только по ФИО — проверьте вручную",
    "card_taken": "У найденной карточки уже есть кабинет",
    "duplicate_phone": "Этот телефон стоит у нескольких карточек",
}


async def link_user_to_student(
    db: AsyncSession,
    *,
    student: Student,
    user: User,
    actor: User | None,
    request: Request | None = None,
    via: str,
) -> None:
    """Выдать существующему аккаунту кабинет этой карточки.

    Роль и привязка ставятся вместе и только здесь: `role=student` без
    `students.user_id` — это аккаунт, который получает 404 на каждом экране
    портала (`get_current_student` в core/deps.py).
    """
    if student.user_id is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="У этой карточки уже есть кабинет",
        )
    existing = (
        await db.execute(select(Student.id).where(Student.user_id == user.id))
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Этот аккаунт уже привязан к другой карточке",
        )

    student.user_id = user.id
    user.role = UserRole.student
    user.is_active = True
    record_audit(
        db,
        action=AuditAction.access_granted,
        actor=actor,
        target_user_id=user.id,
        target_type="student",
        target_id=str(student.id),
        request=request,
        meta={"via": via, "email": user.email},
    )


async def decide(
    db: AsyncSession,
    *,
    req: AccessRequest,
    actor: User | None,
    status_value: str,
) -> None:
    """Проставить решение по заявке. Отдельной функцией — чтобы след решения
    (кто, когда) нельзя было забыть в одной из трёх веток одобрения."""
    req.status = status_value
    req.decided_by = actor.id if actor else None
    req.decided_at = datetime.now(timezone.utc)


__all__ = [
    "BLOCKED_REASON_TEXT",
    "STATUS_APPROVED",
    "STATUS_AUTO_APPROVED",
    "Suggestion",
    "backfill_unlinked_student_requests",
    "decide",
    "link_user_to_student",
    "load_students_index",
    "normalize_phone",
    "suggest_student",
]
