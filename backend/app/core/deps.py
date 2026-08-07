from typing import Annotated
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.config import settings
from app.core.database import get_db
from app.core.security import decode_access_token
from app.models.user import User, UserRole
from app.models.student import Student

bearer_scheme = HTTPBearer(auto_error=True)

PERMISSIONS = frozenset({
    "assign_mentor_tasks",
    "assign_mzk_tasks",
    "accept_mentor_results",
    "manage_deadlines",
    "manage_users",
    "manage_regulations",
})

ROLE_PERMISSIONS = {
    UserRole.admin: PERMISSIONS,
    UserRole.mzk_manager: frozenset({
        "assign_mentor_tasks", "assign_mzk_tasks", "accept_mentor_results", "manage_deadlines",
    }),
    UserRole.mentor: frozenset({"manage_deadlines"}),
    UserRole.student: frozenset(),
}


def has_permission(user: User, permission: str) -> bool:
    """Return operational permission without granting admin access to work itself."""
    return permission in ROLE_PERMISSIONS.get(user.role, frozenset())


def require_permission(user: User, permission: str) -> None:
    if permission not in PERMISSIONS or not has_permission(user, permission):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Недостаточно прав для операции",
            headers={"X-Error-Code": "PERMISSION_REQUIRED"},
        )

# While a password is still temporary (must_change_password), only these paths
# are reachable — the user has to set a real password before doing anything else
# (Этап 0.5). login/refresh don't pass through this dependency, so they stay open.
_TEMP_PASSWORD_ALLOWED_PATHS = frozenset(
    {
        "/api/v1/auth/me",
        "/api/v1/auth/change-password",
        "/api/v1/auth/logout",
        "/api/v1/auth/logout-all",
    }
)

# Same idea for the agreement gate (ОС 30/07, Блок C, § 5.3): a mentor or MZK
# manager with an unsigned agreement can only reach these paths until they sign.
# Extended to `student` (регламент Академ Хэда: «только после подписи, открывать
# систему для работы») — the portal shell needs its own profile path to render.
_AGREEMENT_ALLOWED_PATHS = frozenset(
    {
        "/api/v1/auth/me",
        "/api/v1/auth/logout",
        "/api/v1/auth/logout-all",
        "/api/v1/agreements/pending",
        "/api/v1/portal/profile",
    }
)


_AGREEMENT_PRE_SIGNATURE_ACTIONS = frozenset({"sign", "preview", "download"})


def _agreement_sign_path_allowed(path: str) -> bool:
    """/api/v1/agreements/{id}/{sign|preview|download} — что доступно до подписи.

    `sign` — единственный мутирующий путь. `preview` и `download` обязаны быть
    здесь же: подписать нельзя, не открыв документ (фронт держит чекбокс
    заблокированным до просмотра), поэтому без них гейт замыкается сам на себя —
    превью отдаёт 403, и подписать регламент становится невозможно.

    Права на сам документ это не ослабляет: can_download_agreement всё так же
    отдаёт только опубликованный регламент своей аудитории.
    """
    parts = path.split("/")
    return (
        len(parts) == 6
        and parts[1:4] == ["api", "v1", "agreements"]
        and parts[5] in _AGREEMENT_PRE_SIGNATURE_ACTIONS
    )


_AGREEMENT_GATED_ROLES = frozenset({UserRole.mentor, UserRole.mzk_manager, UserRole.student})


def agreement_gate_applies(*, enabled: bool, role: UserRole, path: str) -> bool:
    """Should this request even be checked against pending agreement signatures?

    Pure and DB-free on purpose: this is the exact surface where a wrong
    condition locks out everyone, including admin (§ 5.3 плана). Kept separate
    from get_current_user so the role/path logic has a unit test that doesn't
    need a database. `admin` and `mzk_manager` are NEVER gated — admin
    regламенты (AgreementAudience.admin) are for acknowledgement only, no
    forced signature.
    """
    if not enabled:
        return False
    if role not in _AGREEMENT_GATED_ROLES:
        return False
    if path in _AGREEMENT_ALLOWED_PATHS:
        return False
    if _agreement_sign_path_allowed(path):
        return False
    return True


async def get_current_user(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(bearer_scheme)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    payload = decode_access_token(credentials.credentials)
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")

    if user.must_change_password and request.url.path not in _TEMP_PASSWORD_ALLOWED_PATHS:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Сначала смените временный пароль",
            headers={"X-Error-Code": "PASSWORD_CHANGE_REQUIRED"},
        )

    # Block operational roles with unsigned current regulations. Admin retains
    # management access; executor-specific checks are enforced at mutations.
    if agreement_gate_applies(enabled=settings.ENABLE_AGREEMENT_GATE, role=user.role, path=request.url.path):
        # EXISTS с индексом (user_id, agreement_id) — ноль лишних запросов для
        # остальных ролей (проверка вообще не выполняется), для ментора — один
        # дешёвый индексный lookup на каждый запрос.
        from app.services.agreements import has_pending_agreement_signature

        if await has_pending_agreement_signature(db, user):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Сначала подпишите регламент",
                headers={"X-Error-Code": "AGREEMENT_SIGNATURE_REQUIRED"},
            )

    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_roles(*roles: UserRole):
    async def _check(current_user: CurrentUser) -> User:
        if current_user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied",
                headers={"X-Error-Code": "FORBIDDEN"},
            )
        return current_user
    return Depends(_check)


AdminOrMZK = require_roles(UserRole.admin, UserRole.mzk_manager)
AdminOnly = require_roles(UserRole.admin)
# Any back-office employee (student portal accounts are excluded).
StaffOnly = require_roles(UserRole.admin, UserRole.mzk_manager, UserRole.mentor)
AllStaff = StaffOnly  # backwards-compatible alias
StudentOnly = require_roles(UserRole.student)


async def get_current_student(
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Student:
    """Resolve the students record behind a logged-in portal (student) account.

    The student card is the source of truth; a `student` user simply resolves
    to `students WHERE user_id = me`. Staff never pass through here.
    """
    if current_user.role != UserRole.student:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Доступ только для студентов",
            headers={"X-Error-Code": "FORBIDDEN"},
        )
    result = await db.execute(select(Student).where(Student.user_id == current_user.id))
    student = result.scalar_one_or_none()
    if not student:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="К аккаунту не привязана карточка студента",
        )
    return student


CurrentStudent = Annotated[Student, Depends(get_current_student)]
