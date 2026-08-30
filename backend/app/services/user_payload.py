"""Единственное место, где собирается «пользователь» для фронта (Этап 2.3).

Ради чего модуль
----------------
Форм ответа с пользователем три — `POST /auth/login`, приём инвайта (обе ручки,
через `issue_session`) и `GET /auth/me`. Собирались они двумя независимыми
литералами и УЖЕ разъехались: `/me` отдавал `telegram_username`, `phone` и
`is_active`, а логин — нет. Поля читались редко, поэтому расхождение никого не
разбудило: сразу после входа `user.is_active` был `undefined`, а после
перезагрузки страницы — `true`.

С правами такое расхождение тихим не останется. Если `permissions` уедут в
`/me`, но не в ответ логина, меню и роуты после входа будут пустыми, а после
F5 — полными. Поэтому шейп ровно один, и обе точки входа зовут эту функцию.

Почему функция разделена надвое
-------------------------------
`build_user_payload` — чистая и синхронная: её можно покрыть тестами без базы,
а именно она решает, что видит фронт. Асинхронный поход за подписью регламента
вынесен в тонкую обёртку `resolve_user_payload`. Приём тот же, что у
`agreement_gate_applies` в `app/core/deps.py`.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core import permissions
from app.core.config import settings
from app.models.user import User


def build_user_payload(user: User, *, agreement_signature_required: bool) -> dict[str, Any]:
    """Пользователь так, как его видит фронт. Одна форма для всех ответов."""
    return {
        "id": str(user.id),
        "name": user.name,
        "email": user.email,
        "role": user.role.value,
        "telegram_username": user.telegram_username,
        "phone": user.phone,
        "is_active": user.is_active,
        "must_change_password": user.must_change_password,
        "agreement_signature_required": agreement_signature_required,
        # Права роли, «ресурс:действие». Считает реестр — фронт их не выводит
        # из роли, иначе появился бы второй, никем не проверяемый расклад.
        #
        # У неоткрытого аккаунта прав нет ни одного, хотя роль у него уже есть:
        # права появляются вместе с активацией. `can()` на той стороне
        # закрывает по пустому списку всё, включая меню и роуты.
        "permissions": [] if not user.is_active else list(permissions.granted_for(user.role)),
    }


async def resolve_user_payload(db: AsyncSession, user: User) -> dict[str, Any]:
    """То же самое, но со сходом в базу за статусом подписи регламента."""
    from app.services.agreements import has_pending_agreement_signature

    required = settings.ENABLE_AGREEMENT_GATE and await has_pending_agreement_signature(db, user)
    return build_user_payload(user, agreement_signature_required=required)
