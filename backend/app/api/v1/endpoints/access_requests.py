"""Очередь самозаписи: кто пришёл через /join и ждёт привязки к карточке.

Почему это отдельный раздел, а не фильтр в списке пользователей
--------------------------------------------------------------
В `/settings/users` уже есть фильтр «Ожидают активации», и он отвечает на
вопрос «кого забыли впустить». Здесь другой вопрос — «к какой карточке этот
человек относится», и ответ на него требует того, чего в списке пользователей
нет: данных формы, подсказки матчинга и решения одним действием на десяток
строк. Одобрение ученика — это не переключатель `is_active`, а привязка к
карточке, и разводить их по разным экранам безопаснее, чем смешивать.
"""
from __future__ import annotations

import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.core.audit import log_change
from app.core.database import get_db
from app.core.deps import CurrentUser
from app.core.permissions import Action, require_access
from app.core.security import hash_password, is_google_only
from app.models.access_request import (
    ACCESS_REQUEST_STATUSES,
    STATUS_APPROVED,
    STATUS_NEW,
    STATUS_REJECTED,
    AccessRequest,
)
from app.models.audit_log import AuditAction
from app.models.student import Student
from app.models.user import User, UserRole
from app.services.access_requests import (
    BLOCKED_REASON_TEXT,
    backfill_pending_without_request,
    backfill_unlinked_student_requests,
    CANDIDATE_REASON_TEXT,
    decide,
    find_student_candidates,
    link_user_to_student,
    load_students_index,
    prepare_candidate_index,
    suggest_student,
)
from app.services.audit import record_audit
from app.services.default_services import ensure_default_services
from app.services.passwords import gen_password

router = APIRouter(prefix="/access-requests", tags=["access-requests"])

#: Сколько подсказок пересчитывать на лету. База карточек грузится в память
#: один раз на запрос, поэтому дорого не само сравнение, а размер списка.
_METHOD_LABEL = {
    "phone_exact": "совпадение по телефону",
    "name_exact": "совпадение по ФИО",
    "name_translit": "совпадение по ФИО (транслит)",
    "name_fuzzy": "похожее ФИО",
    "name_partial": "частичное совпадение ФИО",
    "word_partial": "частичное совпадение ФИО",
    "none": "совпадений нет",
}


def _portal_owner(card: dict, owners: dict | None) -> dict | None:
    """Чей кабинет у занятой карточки — чтобы админ видел, кого заменяет."""
    user_id = card.get("user_id")
    if user_id is None or not owners:
        return None
    return owners.get(user_id)


def _candidate_to_dict(card: dict, reason: str, owners: dict | None = None) -> dict:
    return {
        "id": str(card["id"]),
        "full_name": card["full_name"],
        "phone": card["phone"],
        "intake_year": card["intake_year"],
        "is_free": card.get("user_id") is None,
        "portal_owner": _portal_owner(card, owners),
        "reason": reason,
        "reason_label": CANDIDATE_REASON_TEXT[reason],
    }


async def _load_portal_owners(db: AsyncSession, user_ids: set) -> dict:
    if not user_ids:
        return {}
    rows = await db.execute(
        select(User.id, User.email, User.last_login_at, User.is_active).where(User.id.in_(user_ids))
    )
    return {
        uid: {
            "email": email,
            "last_login_at": last_login.isoformat() if last_login else None,
            "is_active": is_active,
        }
        for uid, email, last_login, is_active in rows.all()
    }


def _request_to_dict(
    req: AccessRequest,
    *,
    index_by_id: dict,
    candidates: list[tuple[dict, str]] | None = None,
    owners: dict | None = None,
) -> dict:
    card = index_by_id.get(req.suggested_student_id) if req.suggested_student_id else None
    suggested = None
    if card is not None:
        suggested = {
            "id": str(card["id"]),
            "full_name": card["full_name"],
            "phone": card["phone"],
            "intake_year": card["intake_year"],
            # Карточка, у которой уже есть кабинет, — не кандидат. Показываем
            # это прямо в строке, чтобы админ не жал «Привязать» вслепую.
            "is_free": card.get("user_id") is None,
            "portal_owner": _portal_owner(card, owners),
        }
    return {
        "id": str(req.id),
        "user": {
            "id": str(req.user.id),
            "email": req.user.email,
            "name": req.user.name,
            "is_active": req.user.is_active,
        },
        "requested_role": req.requested_role,
        "full_name": req.full_name,
        "phone": req.phone_raw,
        "city": req.city,
        "direction": req.direction,
        "candidates": [
            _candidate_to_dict(card, reason, owners) for card, reason in (candidates or [])
        ],
        "suggested_student": suggested,
        "confidence": float(req.suggested_confidence) if req.suggested_confidence else None,
        "method": req.suggested_method,
        "method_label": _METHOD_LABEL.get(req.suggested_method or "none", req.suggested_method),
        "status": req.status,
        "created_at": req.created_at.isoformat(),
    }


@router.get("/mine")
async def my_request(
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Своя заявка — единственное, что видно с экрана ожидания.

    Права здесь не проверяются намеренно: ждущий аккаунт не имеет никаких прав
    по определению, а вернуть ему его собственную анкету надо. Запрос жёстко
    прибит к `current_user.id`, чужую строку этой ручкой не достать. Путь
    добавлен в `_PENDING_APPROVAL_ALLOWED_PATHS` (core/deps.py) — иначе гейт
    отвечает 403 раньше, чем сюда доходит управление.
    """
    req = (
        await db.execute(select(AccessRequest).where(AccessRequest.user_id == current_user.id))
    ).scalar_one_or_none()
    if req is None:
        return None
    return {
        "id": str(req.id),
        "requested_role": req.requested_role,
        "full_name": req.full_name,
        "phone": req.phone_raw,
        "city": req.city,
        "direction": req.direction,
        "status": req.status,
        "created_at": req.created_at.isoformat(),
    }


@router.get("")
async def list_requests(
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    status_filter: str = "new",
):
    require_access(current_user, "access_requests", Action.view)
    if status_filter not in ACCESS_REQUEST_STATUSES and status_filter != "all":
        raise HTTPException(status_code=422, detail="Неизвестный статус")

    # Два разных пропуска в очередь, и оба надо закрыть перед показом:
    # аккаунт вообще без заявки (так делал старый вход через Google) и
    # ученик с ролью, но без карточки. Иначе человек ждёт, а его не видно.
    created = await backfill_pending_without_request(db)
    created += await backfill_unlinked_student_requests(db)
    if created:
        await db.commit()
    query = select(AccessRequest).options(joinedload(AccessRequest.user))
    if status_filter != "all":
        query = query.where(AccessRequest.status == status_filter)
    query = query.order_by(AccessRequest.created_at.asc())
    requests = (await db.execute(query)).unique().scalars().all()

    index = await load_students_index(db)
    index_by_id = {s["id"]: s for s in index}
    # Кандидатов считаем заново при каждом открытии, а не берём сохранённую
    # на /join подсказку: карточка могла появиться, освободиться или уйти
    # в архив уже после заявки — и тогда кнопки «Привязать» не было.
    prepared = prepare_candidate_index(index)

    total_new = (
        await db.execute(
            select(func.count(AccessRequest.id)).where(AccessRequest.status == STATUS_NEW)
        )
    ).scalar_one()

    candidates_by_request = {
        r.id: find_student_candidates(r.full_name, r.phone_raw, prepared)
        for r in requests
        if r.status == STATUS_NEW and r.requested_role == "student"
    }
    # Владельцев занятых карточек — одним запросом на всю очередь.
    owner_ids = {
        card["user_id"]
        for found in candidates_by_request.values()
        for card, _ in found
        if card.get("user_id") is not None
    }
    for r in requests:
        card = index_by_id.get(r.suggested_student_id) if r.suggested_student_id else None
        if card is not None and card.get("user_id") is not None:
            owner_ids.add(card["user_id"])
    owners = await _load_portal_owners(db, owner_ids)

    items = [
        _request_to_dict(
            r,
            index_by_id=index_by_id,
            candidates=candidates_by_request.get(r.id),
            owners=owners,
        )
        for r in requests
    ]

    return {"items": items, "total_new": total_new}


@router.get("/count")
async def pending_count(
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Счётчик для бейджа в шапке. Отдельно от списка: шапка опрашивает его
    регулярно, а тянуть ради числа всю очередь с подсказками — расточительно."""
    require_access(current_user, "access_requests", Action.view)
    # Два разных пропуска в очередь, и оба надо закрыть перед показом:
    # аккаунт вообще без заявки (так делал старый вход через Google) и
    # ученик с ролью, но без карточки. Иначе человек ждёт, а его не видно.
    created = await backfill_pending_without_request(db)
    created += await backfill_unlinked_student_requests(db)
    if created:
        await db.commit()
    total = (
        await db.execute(
            select(func.count(AccessRequest.id)).where(AccessRequest.status == STATUS_NEW)
        )
    ).scalar_one()
    return {"total": total}


async def _load_open(db: AsyncSession, request_id: uuid.UUID) -> AccessRequest:
    req = (
        await db.execute(
            select(AccessRequest)
            .options(joinedload(AccessRequest.user))
            .where(AccessRequest.id == request_id)
        )
    ).unique().scalar_one_or_none()
    if req is None:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    if req.status != STATUS_NEW:
        raise HTTPException(status_code=409, detail="Заявка уже обработана")
    return req


class ApproveRequest(BaseModel):
    role: Literal["student", "mentor", "mzk_manager"]
    student_id: uuid.UUID | None = None
    #: Карточка уже с кабинетом: перепривязать к этому аккаунту, старый
    #: отключить. Только явным решением админа из очереди.
    replace_existing: bool = False


def _grant_staff_role(
    db: AsyncSession,
    *,
    user: User,
    role: str,
    actor: User,
    request: Request,
    via: str,
) -> str | None:
    """Выдать сотруднику роль и, если пароля не было, временный пароль.

    Общая часть одиночного и массового одобрения: если бы каждая ручка делала
    это сама, они бы разошлись — например, массовая забыла бы выдать пароль,
    и половина одобренных снова осталась бы без входа.

    Возвращает временный пароль или None, если у человека пароль уже есть.
    """
    user.role = UserRole(role)
    user.is_active = True

    # Сотрудник, пришедший через /join, заведён с заглушкой вместо хеша:
    # пароля у него нет вовсе, войти он может только кнопкой Google. Раньше
    # одобрение об этом молчало — человек шёл «вспоминать» несуществующий
    # пароль, и очередь «менторы забыли пароли» набиралась сама собой.
    # Выдаём временный пароль, чтобы у него было два рабочих пути входа.
    temp_password: str | None = None
    if is_google_only(user.hashed_password):
        temp_password = gen_password()
        user.hashed_password = hash_password(temp_password)
        user.must_change_password = True

    record_audit(
        db,
        action=AuditAction.access_granted,
        actor=actor,
        target_user_id=user.id,
        request=request,
        meta={
            "via": via,
            "role": role,
            "email": user.email,
            "temp_password_issued": temp_password is not None,
        },
    )
    return temp_password


@router.post("/{request_id}/approve")
async def approve_request(
    request_id: uuid.UUID,
    body: ApproveRequest,
    request: Request,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Одобрить заявку. Ученику — только вместе с карточкой."""
    require_access(current_user, "access_requests", Action.manage)
    req = await _load_open(db, request_id)
    user = req.user

    temp_password: str | None = None

    if body.role == "student":
        if body.student_id is None:
            raise HTTPException(
                status_code=422,
                detail="Выберите карточку студента — без неё кабинет не откроется",
            )
        student = await db.get(Student, body.student_id)
        if student is None:
            raise HTTPException(status_code=404, detail="Карточка не найдена")
        await link_user_to_student(
            db,
            student=student,
            user=user,
            actor=current_user,
            request=request,
            via="queue_replace" if body.replace_existing else "queue",
            replace_existing=body.replace_existing,
        )
    else:
        temp_password = _grant_staff_role(
            db, user=user, role=body.role, actor=current_user, request=request, via="queue"
        )

    await decide(db, req=req, actor=current_user, status_value=STATUS_APPROVED)
    await db.commit()
    # Пароль возвращается ровно один раз — в ответе на само одобрение. Нигде
    # больше он не хранится в открытом виде; забыли передать — только сброс.
    return {"ok": True, "status": STATUS_APPROVED, "temp_password": temp_password}


@router.post("/{request_id}/reject")
async def reject_request(
    request_id: uuid.UUID,
    request: Request,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Отклонить заявку. Аккаунт остаётся неактивным, но не удаляется:
    повторный вход тем же Google обязан упереться в тот же экран ожидания,
    а не завести второй аккаунт и вторую заявку."""
    require_access(current_user, "access_requests", Action.manage)
    req = await _load_open(db, request_id)
    record_audit(
        db,
        action=AuditAction.access_toggled,
        actor=current_user,
        target_user_id=req.user_id,
        request=request,
        meta={"via": "queue", "decision": "rejected", "email": req.user.email},
    )
    await decide(db, req=req, actor=current_user, status_value=STATUS_REJECTED)
    await db.commit()
    return {"ok": True, "status": STATUS_REJECTED}


class CreateStudentRequest(BaseModel):
    #: Админ видел похожие карточки и всё равно создаёт новую.
    force: bool = False


@router.post("/{request_id}/create-student")
async def create_student_for_request(
    request_id: uuid.UUID,
    request: Request,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    body: CreateStudentRequest | None = None,
):
    """Завести карточку из данных заявки и сразу привязать к ней аккаунт.

    Для тех, кого в базе не было вовсе. Заполняем только то, что человек сам
    указал в форме; остальное — как у карточки, заведённой из анкеты: год
    набора по умолчанию следующий, услуги по умолчанию проставляются.

    Если в базе есть похожие карточки, отвечаем 409 со списком: так появился
    дубль, который потом соединяли в «Рисках». Создать всё равно можно —
    с `force`, осознанно.
    """
    require_access(current_user, "access_requests", Action.manage)
    req = await _load_open(db, request_id)

    if not (body and body.force):
        prepared = prepare_candidate_index(await load_students_index(db))
        candidates = find_student_candidates(req.full_name, req.phone_raw, prepared)
        if candidates:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "possible_duplicate",
                    "message": "В базе уже есть похожие карточки — проверьте, не этот ли студент",
                    "candidates": [_candidate_to_dict(card, reason) for card, reason in candidates],
                },
            )

    from datetime import datetime, timezone

    from migration.transformers.normalize import parse_degree

    student = Student(
        full_name=req.full_name[:500],
        phone=req.phone_raw[:100],
        city=req.city,
        specialty=req.direction,
        degree_level=parse_degree(""),
        intake_year=datetime.now(timezone.utc).year + 1,
    )
    db.add(student)
    await db.flush()
    await ensure_default_services(db, student.id)
    await log_change(
        db, "student", student.id, "created_from_access_request",
        None, str(req.id), str(current_user.id), "access_requests",
    )

    await link_user_to_student(
        db,
        student=student,
        user=req.user,
        actor=current_user,
        request=request,
        via="queue_new_card",
    )
    await decide(db, req=req, actor=current_user, status_value=STATUS_APPROVED)
    await db.commit()
    return {"ok": True, "student_id": str(student.id), "status": STATUS_APPROVED}


class BulkApproveRequest(BaseModel):
    ids: list[uuid.UUID]


@router.post("/bulk-approve")
async def bulk_approve(
    body: BulkApproveRequest,
    request: Request,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Одобрить пачку — но только тех, за кого ручается матчинг.

    Массовая кнопка принимает решение за админа, поэтому планка та же, что у
    авто-привязки на /join: точный телефон, свободная карточка, номер не
    задублирован. Всё остальное возвращается в `skipped` с причиной —
    пропустить молча значит создать у админа ложное чувство, что очередь
    разобрана.
    """
    require_access(current_user, "access_requests", Action.manage)
    if not body.ids:
        return {"approved": [], "skipped": []}

    requests = (
        (
            await db.execute(
                select(AccessRequest)
                .options(joinedload(AccessRequest.user))
                .where(AccessRequest.id.in_(body.ids), AccessRequest.status == STATUS_NEW)
            )
        )
        .unique()
        .scalars()
        .all()
    )
    found = {r.id for r in requests}

    index = await load_students_index(db)
    approved: list[dict] = []
    skipped: list[dict] = []

    for missing in [i for i in body.ids if i not in found]:
        skipped.append({"id": str(missing), "reason": "Заявка не найдена или уже обработана"})

    for req in requests:
        if req.requested_role != "student":
            # Формулировка важна: прежняя («роль назначает админ») читалась
            # как «у вас не хватает прав», хотя кнопку жмёт как раз админ.
            # Причина другая — массовой проверки для ментора не существует:
            # у ученика сверяется телефон с карточкой, а у ментора сверять
            # нечего, и роль (ментор/МЗК-менеджер) в заявке не указана.
            skipped.append(
                {
                    "id": str(req.id),
                    "name": req.full_name,
                    "reason": "Заявку ментора одобряют по одной — кнопкой «Одобрить как ментора» в строке",
                }
            )
            continue

        # Пересчитываем подсказку здесь, а не берём сохранённую: между /join и
        # этой кнопкой карточку мог занять менеджер, и сохранённый вердикт
        # «свободна» устарел бы молча.
        suggestion = suggest_student(req.full_name, req.phone_raw, index)
        if not suggestion.auto_linkable:
            skipped.append(
                {
                    "id": str(req.id),
                    "name": req.full_name,
                    "reason": BLOCKED_REASON_TEXT.get(
                        suggestion.blocked_reason or "", "Нужна ручная проверка"
                    ),
                }
            )
            continue

        student = await db.get(Student, suggestion.student_id)
        if student is None or student.user_id is not None:
            skipped.append(
                {
                    "id": str(req.id),
                    "name": req.full_name,
                    "reason": BLOCKED_REASON_TEXT["card_taken"],
                }
            )
            continue

        await link_user_to_student(
            db,
            student=student,
            user=req.user,
            actor=current_user,
            request=request,
            via="queue_bulk",
        )
        await decide(db, req=req, actor=current_user, status_value=STATUS_APPROVED)
        # Индекс держим в актуальном состоянии внутри одного прогона: две
        # заявки на одну карточку не должны обе пройти.
        for row in index:
            if row["id"] == student.id:
                row["user_id"] = req.user_id
                break
        approved.append({"id": str(req.id), "name": req.full_name, "student_id": str(student.id)})

    await db.commit()
    return {"approved": approved, "skipped": skipped}


class BulkApproveStaffRequest(BaseModel):
    ids: list[uuid.UUID]
    role: Literal["mentor", "mzk_manager"] = "mentor"


@router.post("/bulk-approve-staff")
async def bulk_approve_staff(
    body: BulkApproveStaffRequest,
    request: Request,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Одобрить пачку заявок сотрудников (менторы, МЗК-менеджеры).

    Почему отдельной ручкой, а не в `/bulk-approve`
    -----------------------------------------------
    У ученика массовое одобрение опирается на объективную проверку — точное
    совпадение телефона со свободной карточкой; заявку без такой проверки та
    кнопка не берёт. У сотрудника сверять нечего: заявку может подать кто
    угодно, кто открыл ссылку /join, а одобрение сразу даёт доступ к данным
    студентов. Поэтому решение остаётся полностью человеческим — и должно
    выглядеть как отдельное осознанное действие, а не как «одобрить выбранные».
    Роль тоже задаётся явно: из заявки её не вывести, там только «не ученик».

    Ученики сюда не попадают: им нужна карточка, а её выбирают по одной.
    """
    require_access(current_user, "access_requests", Action.manage)
    if not body.ids:
        return {"approved": [], "skipped": []}

    requests = (
        (
            await db.execute(
                select(AccessRequest)
                .options(joinedload(AccessRequest.user))
                .where(AccessRequest.id.in_(body.ids), AccessRequest.status == STATUS_NEW)
            )
        )
        .unique()
        .scalars()
        .all()
    )
    found = {r.id for r in requests}

    approved: list[dict] = []
    skipped: list[dict] = []

    for missing in [i for i in body.ids if i not in found]:
        skipped.append({"id": str(missing), "reason": "Заявка не найдена или уже обработана"})

    for req in requests:
        if req.requested_role == "student":
            skipped.append(
                {
                    "id": str(req.id),
                    "name": req.full_name,
                    "reason": "Это заявка ученика — её одобряют вместе с карточкой",
                }
            )
            continue

        temp_password = _grant_staff_role(
            db,
            user=req.user,
            role=body.role,
            actor=current_user,
            request=request,
            via="queue_bulk_staff",
        )
        await decide(db, req=req, actor=current_user, status_value=STATUS_APPROVED)
        approved.append(
            {
                "id": str(req.id),
                "name": req.full_name,
                "email": req.user.email,
                # Единственный момент, когда пароль виден. Отдаём вместе с
                # именем и почтой: без них список из шестнадцати паролей
                # невозможно раздать по адресатам.
                "temp_password": temp_password,
            }
        )

    await db.commit()
    return {"approved": approved, "skipped": skipped}
