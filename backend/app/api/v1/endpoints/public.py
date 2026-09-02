from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.deps import mark_logged_in
from app.core.security import hash_password
from app.models.access_request import STATUS_AUTO_APPROVED, STATUS_NEW, AccessRequest
from app.models.audit_log import AuditAction
from app.models.intake_submission import IntakeSource, IntakeStatus, IntakeSubmission
from app.models.notification import Notification
from app.models.student import Student
from app.models.user import User, UserRole
from app.services import access_requests as ar
from app.services import rate_limit
from app.services.audit import record_audit
from app.services.google_auth import (
    GoogleAuthError,
    GoogleAuthNotConfigured,
    verify_id_token as verify_google_id_token,
)
from app.services.sessions import issue_session
from app.services.user_emails import resolve_user_by_email

router = APIRouter(prefix="/public", tags=["public"])
PUBLIC_APPLICATION_DEDUPE_SECONDS = 300


async def _notify_admins(db: AsyncSession, *, kind: str, title: str, body: str, link: str) -> None:
    admins = await db.execute(select(User).where(User.role.in_([UserRole.admin, UserRole.mzk_manager])))
    for admin in admins.scalars():
        db.add(Notification(
            user_id=admin.id,
            kind=kind,
            title=title,
            body=body,
            link=link,
            priority="high",
        ))


class PublicApplicationCreate(BaseModel):
    full_name: str
    phone: str
    email: EmailStr | None = None
    city: str | None = None
    degree_level: str | None = None
    intake_year: int | None = None
    target_country: str | None = None
    program_interest: str | None = None
    message: str | None = None


@router.post("/applications", status_code=status.HTTP_201_CREATED)
async def create_public_application(
    body: PublicApplicationCreate,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await rate_limit.enforce(
        request, bucket="public_application", limit=8, window_seconds=300
    )

    full_name = body.full_name.strip()
    phone = body.phone.strip()
    if len(full_name) < 2:
        raise HTTPException(status_code=422, detail="Укажите имя")
    if len(phone) < 5:
        raise HTTPException(status_code=422, detail="Укажите телефон")

    now = datetime.now(timezone.utc)
    raw_data = {
        "full_name": full_name,
        "phone": phone,
        "email": str(body.email) if body.email else "",
        "city": body.city or "",
        "degree_level": body.degree_level or "",
        "intake_year": body.intake_year or "",
        "target_country": body.target_country or "",
        "program_interest": body.program_interest or "",
        "message": body.message or "",
        "source": "landing_apply",
    }
    # A double click / browser retry within the same five-minute bucket should
    # not create a second lead and a second admin notification.
    bucket = int(now.timestamp()) // PUBLIC_APPLICATION_DEDUPE_SECONDS
    fingerprint_src = (
        f"landing_apply|{bucket}|{full_name.lower()}|{phone}|"
        f"{str(body.email).lower() if body.email else ''}"
    )
    fingerprint = hashlib.sha256(fingerprint_src.encode("utf-8")).hexdigest()
    existing = (
        await db.execute(
            select(IntakeSubmission).where(
                IntakeSubmission.row_fingerprint == fingerprint
            )
        )
    ).scalar_one_or_none()
    if existing:
        return {
            "id": str(existing.id),
            "status": existing.status.value,
            "message": "Заявка уже отправлена. Команда TeenTechEd свяжется с вами.",
        }

    submission = IntakeSubmission(
        source=IntakeSource.cases,
        submitted_at=now,
        row_fingerprint=fingerprint,
        raw_data=raw_data,
        full_name=full_name,
        phone_normalized=phone,
        manager_name=None,
        status=IntakeStatus.new,
    )
    db.add(submission)
    await _notify_admins(
        db,
        kind="intake",
        title="Новая заявка от абитуриента",
        body=f"{full_name} · {phone}",
        link="/students?inbox=1",
    )
    try:
        await db.commit()
    except IntegrityError:
        # Two identical requests can race between the SELECT above and INSERT.
        # The unique fingerprint is the final arbiter; return the winner rather
        # than leaking a 500 to the applicant.
        await db.rollback()
        existing = (
            await db.execute(
                select(IntakeSubmission).where(
                    IntakeSubmission.row_fingerprint == fingerprint
                )
            )
        ).scalar_one_or_none()
        if not existing:
            raise
        return {
            "id": str(existing.id),
            "status": existing.status.value,
            "message": "Заявка уже отправлена. Команда TeenTechEd свяжется с вами.",
        }
    await db.refresh(submission)
    return {
        "id": str(submission.id),
        "status": submission.status.value,
        "message": "Заявка отправлена. Команда TeenTechEd свяжется с вами.",
    }


class MentorSignupCreate(BaseModel):
    name: str
    email: EmailStr
    phone: str | None = None
    password: str


@router.post("/mentor-signup", status_code=status.HTTP_201_CREATED)
async def mentor_signup(
    body: MentorSignupCreate,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Самостоятельная заявка ментора: аккаунт создаётся неактивным,
    доступ открывает администратор в настройках пользователей."""
    await rate_limit.enforce(request, bucket="mentor_signup", limit=10, window_seconds=300)

    name = body.name.strip()
    if len(name) < 2:
        raise HTTPException(status_code=422, detail="Укажите имя")
    if len(body.password) < 8:
        raise HTTPException(status_code=422, detail="Пароль должен быть минимум 8 символов")

    email = str(body.email).strip().lower()
    existing = await db.execute(select(User).where(User.email == email))
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Пользователь с таким email уже существует. Попробуйте войти.",
        )

    user = User(
        name=name,
        email=email,
        phone=body.phone.strip() if body.phone else None,
        hashed_password=hash_password(body.password),
        role=UserRole.mentor,
        is_active=False,
    )
    db.add(user)
    await _notify_admins(
        db,
        kind="mentor_signup",
        title="Новая заявка от ментора",
        body=f"{name} · {email} — ждёт активации и назначения роли",
        link="/settings/users",
    )
    await db.commit()
    return {
        "message": "Заявка отправлена. Администратор проверит её и откроет доступ — после этого можно войти.",
    }


# --- Единая ссылка регистрации /join ----------------------------------------

#: Минимум цифр в номере, после которого он вообще похож на телефон. Ровно то,
#: что проверяет матчинг (`_compute_duplicate_pairs` в students.py).
_MIN_PHONE_DIGITS = 10


class JoinRequest(BaseModel):
    credential: str
    requested_role: Literal["student", "mentor"]
    full_name: str
    phone: str
    city: str | None = None
    direction: str | None = None
    code: str | None = None


def _mentor_code_matches(code: str | None) -> bool:
    """Пустой код в настройках = способ выключен, и никакой ввод его не откроет.

    `compare_digest`, а не `==`: сравнение секрета посимвольно с ранним выходом
    подсказывает подбирающему длину общего префикса.
    """
    expected = settings.JOIN_MENTOR_CODE
    if not expected:
        return False
    return secrets.compare_digest(str(code or ""), expected)


async def _notify_admins_about_request(db: AsyncSession, *, user: User, role: str) -> None:
    role_word = "ученика" if role == "student" else "ментора"
    await _notify_admins(
        db,
        kind="access_request",
        title=f"Заявка на доступ от {role_word}",
        body=f"{user.name} · {user.email} — ждёт привязки к карточке",
        link="/settings/access-requests",
    )


@router.post("/join")
async def join(
    body: JoinRequest,
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Одна публичная ссылка регистрации — и для учеников, и для менторов.

    Что здесь происходит и почему именно так
    ----------------------------------------
    Вход только через Google: почты в системе нет, подтвердить адрес самим
    нечем, а `email_verified` от Google — единственный признак, что человек
    владеет адресом, который называет.

    Дальше развилка. Ученику есть с чем сверяться — карточка с телефоном уже в
    базе, и точное совпадение номера открывает кабинет без админа. Ментору
    сверяться не с чем (карточки-сущности у менторов нет), поэтому его пускает
    секретный код из ссылки. Всё, что не прошло ни тем, ни другим путём, падает
    в очередь заявок с подсказкой — админ решает одним кликом.

    Ответ всегда содержит `status`: `active` — человек уже в системе,
    `pending` — ждёт одобрения. Сессия выдаётся в обоих случаях: ждущий должен
    видеть свою заявку и её статус, а не пустой экран (гейт в core/deps.py
    дальше `/pending` его всё равно не пустит).
    """
    await rate_limit.enforce(request, bucket="join_ip", limit=20, window_seconds=300)

    try:
        identity = verify_google_id_token(body.credential)
    except GoogleAuthNotConfigured as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))
    except GoogleAuthError as exc:
        record_audit(
            db,
            action=AuditAction.login_failed,
            request=request,
            meta={"reason": "google_token_rejected", "method": "join"},
        )
        await db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc))

    if not identity.email_verified:
        record_audit(
            db,
            action=AuditAction.login_failed,
            actor_email=identity.email,
            request=request,
            meta={"reason": "google_email_unverified", "method": "join"},
        )
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Google не подтвердил этот адрес почты. Обратитесь к куратору.",
        )

    await rate_limit.enforce(
        request, bucket="join_email", limit=5, window_seconds=300, subject=identity.email
    )

    full_name = body.full_name.strip()
    if len(full_name) < 2:
        raise HTTPException(status_code=422, detail="Укажите фамилию и имя")

    phone_raw = body.phone.strip()
    phone = ar.normalize_phone(phone_raw)
    if len(phone) < _MIN_PHONE_DIGITS:
        raise HTTPException(
            status_code=422,
            detail="Телефон должен начинаться с +7 и содержать 11 цифр",
        )

    user = await resolve_user_by_email(db, identity.email)

    # Уже работающий аккаунт: повторный проход по ссылке — это просто вход.
    # Второго User и второй заявки быть не должно.
    if user is not None and user.is_active:
        mark_logged_in(user)
        session = await issue_session(db, response, user)
        record_audit(
            db,
            action=AuditAction.login_success,
            actor=user,
            target_user_id=user.id,
            request=request,
            meta={"method": "join", "existing": True},
        )
        await db.commit()
        return {"status": "active", **session}

    created = user is None
    if created:
        # Пароля нет и не будет: вход в такой аккаунт только через Google.
        # Заглушка непустой строкой — та же, что в /auth/google: `verify_password`
        # её не примет ни к какому вводу, поэтому вход по паролю не откроется сам.
        user = User(
            name=full_name,
            email=identity.email,
            phone=phone_raw,
            hashed_password="!google",
            # Роль намеренно не `student`, даже когда человек просит ученика:
            # `role=student` без `students.user_id` отдаёт 404 на каждом экране
            # портала. Настоящая роль ставится вместе с привязкой к карточке.
            role=UserRole.mentor,
            is_active=False,
        )
        db.add(user)
        await db.flush()

    req = (
        await db.execute(select(AccessRequest).where(AccessRequest.user_id == user.id))
    ).scalar_one_or_none()
    if req is None:
        req = AccessRequest(user_id=user.id, status=STATUS_NEW)
        db.add(req)
    # Повторная отправка формы ждущим — это «изменить данные», а не новая заявка.
    req.requested_role = body.requested_role
    req.full_name = full_name
    req.phone_raw = phone_raw
    req.phone_normalized = phone
    req.city = (body.city or "").strip() or None
    req.direction = (body.direction or "").strip() or None
    req.created_ip = rate_limit.client_ip(request)
    user.name = full_name
    user.phone = phone_raw

    if body.requested_role == "student":
        index = await ar.load_students_index(db)
        suggestion = ar.suggest_student(full_name, phone_raw, index)
        req.suggested_student_id = suggestion.student_id
        req.suggested_confidence = round(suggestion.confidence, 3) if suggestion.student_id else None
        req.suggested_method = suggestion.method

        if suggestion.auto_linkable:
            student = await db.get(Student, suggestion.student_id)
            # Карточку перечитываем из базы, а не доверяем индексу: между его
            # загрузкой и этой строкой кабинет мог выдать менеджер руками.
            if student is not None and student.user_id is None:
                await ar.link_user_to_student(
                    db,
                    student=student,
                    user=user,
                    actor=None,
                    request=request,
                    via="join_auto",
                )
                await ar.decide(db, req=req, actor=None, status_value=STATUS_AUTO_APPROVED)
                mark_logged_in(user)
                session = await issue_session(db, response, user)
                await db.commit()
                return {"status": "active", **session}
    else:
        req.suggested_student_id = None
        req.suggested_confidence = None
        req.suggested_method = None

        if _mentor_code_matches(body.code):
            user.role = UserRole.mentor
            user.is_active = True
            await ar.decide(db, req=req, actor=None, status_value=STATUS_AUTO_APPROVED)
            record_audit(
                db,
                action=AuditAction.access_granted,
                target_user_id=user.id,
                request=request,
                meta={"via": "join_code", "role": "mentor", "email": user.email},
            )
            mark_logged_in(user)
            session = await issue_session(db, response, user)
            await db.commit()
            return {"status": "active", **session}

    if created:
        await _notify_admins_about_request(db, user=user, role=body.requested_role)

    session = await issue_session(db, response, user)
    await db.commit()
    return {"status": "pending", **session}
