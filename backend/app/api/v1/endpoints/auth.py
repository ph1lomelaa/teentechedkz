from __future__ import annotations
import hashlib
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, Cookie, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.security import hash_password, verify_password, create_access_token, create_refresh_token
from app.core.config import settings
from app.core.deps import get_current_user, CurrentUser
from app.models.user import User, UserRole
from app.models.user import RefreshToken
from app.models.audit_log import AuditAction
from app.services.audit import record_audit
from app.services.sessions import (
    revoke_all_sessions,
    issue_session,
    COOKIE_NAME,
    hash_token as _hash_token,
    set_refresh_cookie as _set_refresh_cookie,
)
from app.services import rate_limit
from app.services.google_auth import (
    GoogleAuthError,
    GoogleAuthNotConfigured,
    is_configured as google_is_configured,
    verify_id_token as verify_google_id_token,
)
from app.services.notify import notify
from app.services.user_emails import resolve_user_by_email
from app.services.user_payload import resolve_user_payload

router = APIRouter(prefix="/auth", tags=["auth"])

# Two tabs/requests racing to refresh around the same time both hold the same
# (about-to-rotate) cookie; the loser must not be logged out just because it
# lost the race. Within this window after rotation, a reused token is treated
# as a benign replay and answered with the token that superseded it.
REFRESH_REUSE_GRACE_SECONDS = 20


@router.post("/login")
async def login(
    body: dict,
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    email = body.get("email", "").strip().lower()
    password = body.get("password", "")

    # Throttle by IP (a single source hammering many accounts) and by email
    # (a distributed attack on one account). Both must pass.
    await rate_limit.enforce(request, bucket="login_ip", limit=30, window_seconds=300)
    if email:
        await rate_limit.enforce(
            request, bucket="login_email", limit=8, window_seconds=300, subject=email
        )

    user = await resolve_user_by_email(db, email)

    if not user or not verify_password(password, user.hashed_password):
        record_audit(
            db,
            action=AuditAction.login_failed,
            actor_email=email,
            target_user_id=user.id if user else None,
            request=request,
            meta={"reason": "bad_credentials"},
        )
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Неверный email или пароль",
        )
    # Неактивный аккаунт больше не отбивается здесь: он входит и попадает на
    # экран ожидания. Дальше /auth/me и выхода его не пускает гейт
    # _PENDING_APPROVAL_ALLOWED_PATHS в core/deps.py.
    user.last_login_at = datetime.now(timezone.utc)

    session = await issue_session(db, response, user)
    record_audit(
        db,
        action=AuditAction.login_success,
        actor=user,
        target_user_id=user.id,
        request=request,
    )
    await db.commit()

    # Successful auth clears the per-email throttle so a legit user who fat-
    # fingered a few times isn't held back on the next login.
    await rate_limit.reset(bucket="login_email", subject=email)

    return session


@router.get("/google/config")
async def google_config():
    """Настроен ли вход через Google. Публично — экран входа спрашивает до входа.

    Отдаём client ID, а не прячем его: он и так уезжает в браузер при любом
    сценарии OAuth и секретом не является. Секрет — client secret, и его здесь
    нет: поток id_token его не использует.
    """
    return {
        "enabled": google_is_configured(),
        "client_id": settings.GOOGLE_OAUTH_CLIENT_ID or None,
    }


@router.post("/google")
async def login_with_google(
    body: dict,
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Вход по Google id_token.

    Адрес известен — входим в существующий аккаунт. Неизвестен — заводим
    неактивный и отправляем на экран ожидания: тот же путь, что у самозаписи
    (`public.mentor_signup`), чтобы у админа не появилось второй очереди заявок.

    Связывание **только при `email_verified`** — см. `services/google_auth`.
    """
    await rate_limit.enforce(request, bucket="login_ip", limit=30, window_seconds=300)

    try:
        identity = verify_google_id_token(body.get("credential") or body.get("id_token") or "")
    except GoogleAuthNotConfigured as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))
    except GoogleAuthError as exc:
        record_audit(
            db,
            action=AuditAction.login_failed,
            request=request,
            meta={"reason": "google_token_rejected", "method": "google"},
        )
        await db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc))

    if not identity.email_verified:
        # Не «не пустили пользователя», а «не поверили адресу». Без этой ветки
        # чужой аккаунт с тем же адресом захватывает нашего пользователя.
        record_audit(
            db,
            action=AuditAction.login_failed,
            actor_email=identity.email,
            request=request,
            meta={"reason": "google_email_unverified", "method": "google"},
        )
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Google не подтвердил этот адрес почты. Войдите по паролю.",
        )

    await rate_limit.enforce(
        request, bucket="login_email", limit=8, window_seconds=300, subject=identity.email
    )

    user = await resolve_user_by_email(db, identity.email)
    created = user is None

    if created:
        # Пароля нет и не будет: вход в такой аккаунт только через Google.
        # `hashed_password` непустой строкой-заглушкой, которую `verify_password`
        # не примет ни к какому вводу, — чтобы вход по паролю не открылся сам.
        user = User(
            name=identity.name or identity.email.split("@")[0],
            email=identity.email,
            hashed_password="!google",
            role=UserRole.mentor,
            is_active=False,
        )
        db.add(user)
        await db.flush()
        admins = await db.execute(
            select(User).where(User.role.in_([UserRole.admin, UserRole.mzk_manager]))
        )
        for admin in admins.scalars():
            notify(
                db,
                admin.id,
                kind="mentor_signup",
                title="Новая заявка через Google",
                body=f"{user.name} · {user.email} — ждёт активации и назначения роли",
                link="/settings/users",
                priority="high",
            )

    user.last_login_at = datetime.now(timezone.utc)
    session = await issue_session(db, response, user)
    record_audit(
        db,
        action=AuditAction.google_linked if created else AuditAction.login_success,
        actor=user,
        target_user_id=user.id,
        request=request,
        meta={"method": "google", "created": created},
    )
    await db.commit()
    await rate_limit.reset(bucket="login_email", subject=identity.email)

    return session


@router.post("/refresh")
async def refresh(
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
    refresh_token: str | None = Cookie(default=None, alias=COOKIE_NAME),
):
    if not refresh_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token missing")

    token_hash = _hash_token(refresh_token)
    result = await db.execute(
        select(RefreshToken).where(
            RefreshToken.token_hash == token_hash,
            RefreshToken.expires_at > datetime.now(timezone.utc),
        )
    )
    rt = result.scalar_one_or_none()

    if rt and rt.revoked:
        # Another near-simultaneous request (typically a second open tab)
        # already rotated this exact token. Within the grace window, follow
        # the chain to the token that superseded it and answer with that one
        # instead of forcing a re-login for the request that lost the race.
        now = datetime.now(timezone.utc)
        if (
            rt.replaced_by_hash
            and rt.revoked_at
            and now - rt.revoked_at <= timedelta(seconds=REFRESH_REUSE_GRACE_SECONDS)
        ):
            current_result = await db.execute(
                select(RefreshToken).where(
                    RefreshToken.token_hash == rt.replaced_by_hash,
                    RefreshToken.revoked == False,  # noqa: E712
                    RefreshToken.expires_at > now,
                )
            )
            rt = current_result.scalar_one_or_none()
        else:
            rt = None

    if not rt:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired refresh token")

    user_result = await db.execute(select(User).where(User.id == rt.user_id))
    user = user_result.scalar_one_or_none()
    # is_active здесь не проверяется намеренно: ждущий одобрения должен досидеть
    # на экране ожидания, а не вылетать на логин каждые 15 минут. Куда его
    # пускать, решает гейт в core/deps.py, а не срок жизни токена.
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    # Rotate refresh token
    rt.revoked = True
    rt.revoked_at = datetime.now(timezone.utc)
    new_refresh_raw = create_refresh_token()
    new_token_hash = _hash_token(new_refresh_raw)
    rt.replaced_by_hash = new_token_hash
    new_rt = RefreshToken(
        user_id=user.id,
        token_hash=new_token_hash,
        expires_at=datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
    )
    db.add(new_rt)
    await db.commit()

    new_access = create_access_token({"sub": str(user.id), "role": user.role.value})
    _set_refresh_cookie(response, new_refresh_raw)

    return {
        "access_token": new_access,
        "token_type": "bearer",
        "expires_in": settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    }


@router.post("/logout")
async def logout(
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    refresh_token: str | None = Cookie(default=None, alias=COOKIE_NAME),
):
    if refresh_token:
        token_hash = _hash_token(refresh_token)
        result = await db.execute(select(RefreshToken).where(RefreshToken.token_hash == token_hash))
        rt = result.scalar_one_or_none()
        if rt:
            rt.revoked = True
    record_audit(
        db,
        action=AuditAction.logout,
        actor=current_user,
        target_user_id=current_user.id,
        request=request,
    )
    await db.commit()

    response.delete_cookie(key=COOKIE_NAME, path="/api/v1/auth")
    return {"message": "Logged out successfully"}


@router.post("/logout-all")
async def logout_all(
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    """Завершить все активные сессии пользователя на всех устройствах."""
    count = await revoke_all_sessions(db, current_user.id)
    record_audit(
        db,
        action=AuditAction.sessions_revoked,
        actor=current_user,
        target_user_id=current_user.id,
        request=request,
        meta={"revoked": count, "reason": "logout_all"},
    )
    await db.commit()
    response.delete_cookie(key=COOKIE_NAME, path="/api/v1/auth")
    return {"message": "Все сессии завершены", "revoked": count}


@router.get("/me")
async def me(current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]):
    # Шейп общий с ответом логина и приёма инвайта — см. services/user_payload.
    return await resolve_user_payload(db, current_user)


@router.post("/change-password")
async def change_password(
    body: dict,
    request: Request,
    response: Response,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    old_password = body.get("old_password", "")
    new_password = body.get("new_password", "")

    if len(new_password) < 8:
        raise HTTPException(status_code=422, detail="Пароль должен быть минимум 8 символов")

    if not verify_password(old_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Неверный текущий пароль")
    if verify_password(new_password, current_user.hashed_password):
        raise HTTPException(status_code=422, detail="Новый пароль должен отличаться от текущего")

    current_user.hashed_password = hash_password(new_password)
    current_user.must_change_password = False

    # End every existing session, then issue a fresh one for this device so the
    # user who just changed their password stays logged in here while all other
    # devices are signed out.
    revoked = await revoke_all_sessions(db, current_user.id)
    new_refresh_raw = create_refresh_token()
    db.add(
        RefreshToken(
            user_id=current_user.id,
            token_hash=_hash_token(new_refresh_raw),
            expires_at=datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
        )
    )
    record_audit(
        db,
        action=AuditAction.password_changed,
        actor=current_user,
        target_user_id=current_user.id,
        request=request,
        meta={"other_sessions_revoked": revoked},
    )
    await db.commit()
    _set_refresh_cookie(response, new_refresh_raw)
    return {"message": "Пароль изменён"}
