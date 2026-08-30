"""Матрица прав доступа (Этап 2.1). Только админ.

Зачем эндпоинт
--------------
Вопрос «что может ментор?» до реестра требовал чтения сорока файлов. Реестр
ответ знает, но он лежит в коде — а спрашивают его люди, которые в код не
ходят. Этот эндпоинт и есть тот самый ответ, отданный наружу.

Почему после подключения, а не до
---------------------------------
Матрица поверх неподключённого реестра рисовала бы желаемое, а не фактическое.
`test_permissions_wiring.py` держит инвариант «по роли решает реестр, и только
он» — на нём и стоит истинность этой страницы: она показывает то же, что
проверяет эндпоинт, потому что спрашивает те же функции.

БД здесь не нужна: реестр — чистые данные уровня модуля.
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import permissions
from app.core.database import get_db
from app.core.deps import CurrentUser
from app.core.permissions import Action
from app.models.audit_log import AuditAction
from app.models.user import UserRole
from app.schemas.permissions import (
    MatrixRule,
    MatrixSummary,
    PermissionMatrix,
    RoleCell,
)
from app.services.audit import record_audit
from app.services.permission_overrides import reload_overrides, save_override

router = APIRouter(prefix="/permissions", tags=["permissions"])

# Порядок колонок матрицы: от самой полной роли к самой узкой, как в UserRole.
_ROLES: tuple[UserRole, ...] = tuple(UserRole)


def _cell(resource: str, action: Action, role: UserRole) -> RoleCell:
    """Решение для одной клетки — строго через публичное API реестра.

    Читать `Rule.roles` напрямую здесь нельзя: тогда матрица показывала бы
    содержимое данных, а не то, что ответит `allows()` эндпоинту. Разойтись
    этим двум ответам мы позволить не можем — иначе страница лжёт молча.
    """
    allowed = permissions.allows(resource=resource, action=action, role=role)
    return RoleCell(
        allowed=allowed,
        scope=permissions.scope_for(resource=resource, action=action, role=role) if allowed else None,
    )


@router.get("/matrix", response_model=PermissionMatrix)
async def get_permission_matrix(current_user: CurrentUser) -> PermissionMatrix:
    """Весь реестр в виде «ресурс × действие → четыре роли»."""
    permissions.require_access(current_user, "permissions", Action.view)
    rules = permissions.all_rules()
    overridden = permissions.overrides()
    return PermissionMatrix(
        roles=list(_ROLES),
        actions=list(Action),
        resources=list(permissions.resources()),
        rules=[
            MatrixRule(
                resource=rule.resource,
                action=rule.action,
                roles={role: _cell(rule.resource, rule.action, role) for role in _ROLES},
                basis=rule.basis,
                extra_rules=list(rule.extra_rules),
                denied_detail=rule.denied_detail,
                error_code=rule.error_code,
                review=rule.review,
                locked=rule.locked,
                is_overridden=(rule.resource, rule.action) in overridden,
            )
            for rule in rules
        ],
        summary=MatrixSummary(
            resources=len(permissions.resources()),
            rules=len(rules),
            needs_review=sum(1 for rule in rules if rule.review),
            rules_with_extra=sum(1 for rule in rules if rule.extra_rules),
            extra_rules=sum(len(rule.extra_rules) for rule in rules),
        ),
    )


@router.put("/matrix/{resource}/{action}")
async def set_permission(
    resource: str,
    action: Action,
    body: dict,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    """Изменить состав ролей у правила.

    Один переключатель меняет всё сразу: пункт меню, роут и сам эндпоинт — они
    читают один ключ. Именно ради этого из интерфейса убирался хардкод: пока
    место решало по роли в коде, никакая настройка его не сдвигала.
    """
    permissions.require_access(current_user, "permissions", Action.manage)

    rule = permissions.rule_for(resource, action)
    if rule is None:
        raise HTTPException(status_code=404, detail="Такого правила нет в реестре")
    if rule.locked:
        # Снять это право — значит отрезать себе вход в настройки и не иметь
        # чем вернуть. Запрет живёт и здесь, и в set_overrides: слой данных
        # обойти тоже нельзя.
        raise HTTPException(
            status_code=422,
            detail="Это правило защищено от изменения: без него нельзя управлять системой",
            headers={"X-Error-Code": "PERMISSION_RULE_LOCKED"},
        )

    raw_roles = body.get("roles")
    if not isinstance(raw_roles, list):
        raise HTTPException(status_code=422, detail="Укажите roles списком")
    try:
        roles = frozenset(UserRole(value) for value in raw_roles)
    except ValueError:
        raise HTTPException(status_code=422, detail="Неизвестная роль в списке")

    before = sorted(role.value for role in (permissions.allowed_roles(resource, action) or frozenset()))
    after = sorted(role.value for role in roles)

    await save_override(
        db, resource=resource, action=action, roles=roles, updated_by=current_user.id
    )
    record_audit(
        db,
        action=AuditAction.permission_changed,
        actor=current_user,
        target_user_id=current_user.id,
        request=request,
        meta={"resource": resource, "action": action.value, "before": before, "after": after},
    )
    await db.commit()
    await reload_overrides(db)

    return {
        "resource": resource,
        "action": action.value,
        "roles": after,
        "previous_roles": before,
    }
