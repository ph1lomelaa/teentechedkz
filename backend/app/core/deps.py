from typing import Annotated
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.security import decode_access_token
from app.models.user import User, UserRole
from app.models.student import Student

bearer_scheme = HTTPBearer(auto_error=True)

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
