"""Аккаунт, ждущий одобрения: входит, но никуда не проходит.

Ради чего тест
--------------
До этой правки неактивный пользователь получал 401 на логине. Человек оставлял
заявку, ждал и видел только ошибку входа — ни статуса, ни объяснения. Теперь он
входит и попадает на экран ожидания.

Это **ослабление**: раньше токена не было вовсе, теперь он есть. Значит вся
защита переехала в один гейт, и цена ошибки в нём — неподтверждённый аккаунт
внутри чужих данных.

Показательно, что при снятии старой проверки **не упал ни один из 415 тестов**:
на «неактивный не проходит» не было ни одной проверки вообще. Этот файл —
первая.

Решение вынесено в чистую функцию (`pending_approval_gate_applies`) тем же
приёмом, что и гейт регламента: без этого расклад путей нельзя покрыть, не
поднимая базу.
"""
import inspect
import unittest

from app.core import deps
from app.core.deps import (
    _AGREEMENT_ALLOWED_PATHS,
    _PENDING_APPROVAL_ALLOWED_PATHS,
    _TEMP_PASSWORD_ALLOWED_PATHS,
    pending_approval_gate_applies,
)

# То, до чего ждущий одобрения не должен дотянуться. Не выдуманный список:
# каждый путь — настоящий эндпоинт с чужими персональными данными.
SENSITIVE_PATHS = (
    "/api/v1/students",
    "/api/v1/students/2f1c9e5a-0000-0000-0000-000000000001",
    "/api/v1/guardians/student/2f1c9e5a-0000-0000-0000-000000000001",
    "/api/v1/guardians/2f1c9e5a-0000-0000-0000-000000000001/reveal-iin",
    "/api/v1/confidential-notes",
    "/api/v1/payments",
    "/api/v1/contracts",
    "/api/v1/tasks",
    "/api/v1/workspace/dashboard",
    "/api/v1/portal/profile",
    "/api/v1/users",
    "/api/v1/audit",
    "/api/v1/permissions/matrix",
    "/api/v1/export/students",
    "/api/v1/telegram-chats/",
)


class PendingAccountIsHeldTests(unittest.TestCase):
    def test_active_account_is_never_held(self) -> None:
        for path in SENSITIVE_PATHS + tuple(_PENDING_APPROVAL_ALLOWED_PATHS):
            with self.subTest(path=path):
                self.assertFalse(pending_approval_gate_applies(is_active=True, path=path))

    def test_pending_account_reaches_nothing_sensitive(self) -> None:
        # Главная проверка файла.
        for path in SENSITIVE_PATHS:
            with self.subTest(path=path):
                self.assertTrue(pending_approval_gate_applies(is_active=False, path=path))

    def test_pending_account_can_read_itself_and_leave(self) -> None:
        # Иначе экран ожидания нечем нарисовать, а выйти нельзя — человек
        # оказывается заперт в интерфейсе, из которого нет выхода.
        for path in ("/api/v1/auth/me", "/api/v1/auth/logout", "/api/v1/auth/logout-all"):
            with self.subTest(path=path):
                self.assertFalse(pending_approval_gate_applies(is_active=False, path=path))

    def test_unknown_path_is_held_by_default(self) -> None:
        # Новый эндпоинт не должен открываться ждущему сам собой: список —
        # разрешающий, а не запрещающий.
        self.assertTrue(pending_approval_gate_applies(is_active=False, path="/api/v1/brand-new-thing"))

    def test_gate_does_not_match_by_prefix(self) -> None:
        # "/api/v1/auth/me" разрешён, но "/api/v1/auth/me/students" — нет.
        self.assertTrue(pending_approval_gate_applies(is_active=False, path="/api/v1/auth/me/students"))


class AllowListShapeTests(unittest.TestCase):
    def test_pending_list_is_the_narrowest_of_the_three(self) -> None:
        # Три гейта живут рядом и легко расползаются. Ждущий одобрения
        # подтверждён меньше всех — и пускать его должно строго меньше.
        self.assertTrue(_PENDING_APPROVAL_ALLOWED_PATHS < _AGREEMENT_ALLOWED_PATHS)
        self.assertTrue(_PENDING_APPROVAL_ALLOWED_PATHS < _TEMP_PASSWORD_ALLOWED_PATHS)

    def test_pending_list_stays_small(self) -> None:
        self.assertLessEqual(len(_PENDING_APPROVAL_ALLOWED_PATHS), 4)


class GateIsActuallyWiredTests(unittest.TestCase):
    """Чистая функция бесполезна, если её не зовут."""

    def test_get_current_user_calls_the_gate(self) -> None:
        source = inspect.getsource(deps.get_current_user)
        self.assertIn("pending_approval_gate_applies", source)

    def test_gate_runs_before_the_other_two(self) -> None:
        # Порядок содержательный: пока аккаунт не открыт, ни временный пароль,
        # ни подпись регламента не имеют смысла. Если гейт уедет вниз, человек
        # будет подписывать регламент до того, как его вообще одобрили.
        source = inspect.getsource(deps.get_current_user)
        self.assertLess(
            source.index("pending_approval_gate_applies"),
            source.index("must_change_password"),
        )
        self.assertLess(
            source.index("pending_approval_gate_applies"),
            source.index("agreement_gate_applies"),
        )

    def test_login_no_longer_rejects_inactive_accounts(self) -> None:
        # Смысл всей правки: вход неактивного проходит, а держит его гейт.
        from app.api.v1.endpoints import auth

        source = inspect.getsource(auth.login)
        self.assertNotIn("is_active", source, "логин снова отбивает неактивного сам")

    def test_refresh_keeps_pending_sessions_alive(self) -> None:
        # Иначе ждущего одобрения выкидывает на логин каждые 15 минут.
        from app.api.v1.endpoints import auth

        source = inspect.getsource(auth.refresh)
        self.assertNotIn("user.is_active", source)


if __name__ == "__main__":
    unittest.main()
