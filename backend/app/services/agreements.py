"""Shared queries for the agreement gate (ОС 30/07, Блок C).

Kept separate from app.core.deps so the same EXISTS check backs both the
request-time gate and read paths (/auth/me, SettingsUsersPage «Регламент»
column) without duplicating the query.
"""
from __future__ import annotations

import uuid

from sqlalchemy import exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agreement import Agreement, AgreementAudience, AgreementSignature, AgreementStatus
from app.models.user import User, UserRole

_AUDIENCE_BY_ROLE = {
    UserRole.mentor: AgreementAudience.mentor,
    UserRole.student: AgreementAudience.student,
    UserRole.mzk_manager: AgreementAudience.mzk,
    UserRole.admin: AgreementAudience.admin,
}


def audience_for_role(role: UserRole) -> AgreementAudience | None:
    return _AUDIENCE_BY_ROLE.get(role)


def roles_for_audience(audience: AgreementAudience) -> list[UserRole]:
    """Обратное отображение — кто обязан подписать регламент этой аудитории.

    Нужно списку «кто ещё не подписал»: там мы идём от документа к людям, а не
    наоборот. Отдельного словаря сознательно не заводим, чтобы два отображения
    не разъехались.
    """
    return [role for role, aud in _AUDIENCE_BY_ROLE.items() if aud == audience]


def signature_covers_version(*, signed_version: int | None, current_version: int) -> bool:
    """Закрывает ли подпись действующую редакцию документа.

    Вынесено из SQL отдельной функцией, чтобы правило переподписи можно было
    проверить тестом без БД: именно его отсутствие делало проверку версий
    мёртвой — подпись засчитывалась навсегда, независимо от редакции.
    """
    return signed_version is not None and signed_version == current_version


async def has_pending_agreement_signature(db: AsyncSession, user: User) -> bool:
    """True if `user`'s audience has a published agreement they haven't signed.

    Подпись засчитывается только за действующую редакцию: если админ изменил
    содержание опубликованного документа, version вырос, и старая подпись его
    больше не закрывает. Без сверки версий переподписать новую редакцию было
    невозможно — гейт считал человека подписавшим навсегда.
    """
    audience = audience_for_role(user.role)
    if audience is None:
        return False

    result = await db.execute(
        select(
            exists().where(
                Agreement.audience == audience,
                Agreement.status == AgreementStatus.published,
                Agreement.is_active == True,  # noqa: E712
                ~exists().where(
                    AgreementSignature.agreement_id == Agreement.id,
                    AgreementSignature.user_id == user.id,
                    AgreementSignature.agreement_version == Agreement.version,
                ),
            )
        )
    )
    return bool(result.scalar())
