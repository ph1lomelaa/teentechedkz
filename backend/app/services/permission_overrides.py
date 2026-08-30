"""Мост между таблицей переопределений и чистым реестром прав.

Реестр (`app/core/permissions.py`) не знает про базу и не должен: решение о
доступе обязано оставаться синхронным и покрываемым тестами без поднятия
приложения. Поэтому поход в БД живёт здесь, а реестру переопределения просто
приносят готовым словарём.

Кэш обязателен: `allows()` вызывается на каждом запросе, местами по десятку раз,
и ходить за этим в базу нельзя. Кэш — сам словарь внутри реестра; здесь только
его загрузка и перезагрузка после правки.

Многопроцессность: у каждого воркера свой словарь. После правки перезагружается
только тот процесс, который её выполнил, — остальные подхватят на следующем
`reload_overrides()`. Пока правки редки (это настройка, а не поток), достаточно
периодической перезагрузки; если понадобится мгновенная — сигнал через Redis,
он в проекте уже есть.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import permissions
from app.core.permissions import Action
from app.models.permission_override import PermissionOverride
from app.models.user import UserRole


def _parse(row: PermissionOverride) -> tuple[tuple[str, Action], frozenset[UserRole]] | None:
    """Строку базы — в пару реестра. Мусор молча пропускаем.

    Строка могла пережить переименование ресурса или роли: тогда она относится
    к правилу, которого больше нет, и применить её не к чему. Падать здесь
    нельзя — это стартовый путь приложения.
    """
    try:
        action = Action(row.action)
    except ValueError:
        return None
    roles: set[UserRole] = set()
    for raw in row.roles or []:
        try:
            roles.add(UserRole(raw))
        except ValueError:
            continue
    return (row.resource, action), frozenset(roles)


async def reload_overrides(db: AsyncSession) -> int:
    """Перечитать таблицу и заменить переопределения в реестре целиком.

    Возвращает количество применённых правил — запертые и неизвестные реестру
    отбрасываются внутри `set_overrides`.
    """
    rows = (await db.execute(select(PermissionOverride))).scalars().all()
    parsed = {}
    for row in rows:
        item = _parse(row)
        if item is not None:
            parsed[item[0]] = item[1]
    permissions.set_overrides(parsed)
    return len(permissions.overrides())


async def save_override(
    db: AsyncSession,
    *,
    resource: str,
    action: Action,
    roles: frozenset[UserRole],
    updated_by,
) -> None:
    """Записать новый состав ролей. Транзакцией владеет вызывающий."""
    existing = await db.scalar(
        select(PermissionOverride).where(
            PermissionOverride.resource == resource,
            PermissionOverride.action == action.value,
        )
    )
    payload = sorted(role.value for role in roles)
    if existing:
        existing.roles = payload
        existing.updated_by = updated_by
    else:
        db.add(PermissionOverride(
            resource=resource,
            action=action.value,
            roles=payload,
            updated_by=updated_by,
        ))
