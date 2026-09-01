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

# Аккаунт заведён, но администратор его ещё не открыл (самозапись ментора,
# app/api/v1/endpoints/public.py:155, или первый вход через Google). Раньше такой
# человек получал 401 на логине и не видел вообще ничего — только ошибку входа.
# Теперь он входит и попадает на экран ожидания; дальше этих путей не проходит.
#
# Список намеренно короче остальных: pending-аккаунт не подтверждён никем, и ни
# одного чужого объекта он касаться не должен. Профиль и выход — всё.
_PENDING_APPROVAL_ALLOWED_PATHS = frozenset(
    {
        "/api/v1/auth/me",
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


def pending_approval_gate_applies(*, is_active: bool, path: str) -> bool:
    """Держать ли этот запрос на экране ожидания?

    Чистая и без БД — по той же причине, что и `agreement_gate_applies` ниже:
    это поверхность, где неверное условие либо запирает всех, либо пускает
    неподтверждённый аккаунт в чужие данные. Оба исхода дорогие, а покрыть их
    тестами можно только если решение отделено от похода в базу.

    Вызывать только после того, как account_revoked_after_activation() внизу
    исключила случай «был активен и его отключили» — эта функция размечает
    исключительно «ждёт первого одобрения», а не любой is_active=False.
    """
    if is_active:
        return False
    return path not in _PENDING_APPROVAL_ALLOWED_PATHS


def account_revoked_after_activation(*, is_active: bool, has_logged_in_before: bool) -> bool:
    """Аккаунт был активен и его явно отключили — а не «ждёт первого одобрения».

    is_active=False само по себе не различает два непохожих случая: новый
    заявитель, которого никто ещё не одобрил, и студент/сотрудник, доступ
    которому только что отключили. Оба делят одно поле User.is_active.
    has_logged_in_before (last_login_at is not None) — сигнал, что аккаунт
    уже работал: если работал и вдруг is_active=False, это осознанное
    отключение, а не ожидание первого одобрения.

    Кому это касается: PATCH /students/{id}/access при отключении явно рвёт
    все сессии (student_access.py: revoke_all_sessions). Без этой проверки
    отключённый тут же логинился бы заново паролем и получал новый токен —
    revoke сводился бы к нулю. И login(), и get_current_user() обязаны
    спрашивать это раньше «мягкого» pending_approval_gate_applies.
    """
    return not is_active and has_logged_in_before


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
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")

    # Отключённый после того, как уже был активен, — жёсткий отказ, тот же,
    # что был до появления экрана ожидания. Проверяется раньше мягкого гейта
    # ниже: тот размечает только «ждёт первого одобрения».
    if account_revoked_after_activation(
        is_active=user.is_active, has_logged_in_before=user.last_login_at is not None
    ):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")

    # Первым из трёх гейтов: пока аккаунт не открыт администратором, остальные
    # вопросы (временный пароль, подпись регламента) не имеют смысла.
    if pending_approval_gate_applies(is_active=user.is_active, path=request.url.path):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Заявка ещё не одобрена администратором",
            headers={"X-Error-Code": "ACCOUNT_PENDING_APPROVAL"},
        )

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


# `require_roles` / `AdminOnly` / `StaffOnly` удалены 30.08.2026. Это был
# последний остаток второй системы прав: константа ролей на маршруте решала
# мимо реестра, поэтому переключатель в конструкторе прав менял матрицу и меню,
# но не эндпоинт. Состав ролей задаёт только `app/core/permissions.py`.


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
