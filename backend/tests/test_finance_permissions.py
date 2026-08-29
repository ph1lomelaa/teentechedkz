"""Права на финансовый раздел: смотреть может ментор, менять — нет.

Контекст: проверка называлась `_require_admin_mzk`, но в теле пропускала ещё и
`UserRole.mentor`. Имя врало, и по нему нельзя было понять, что ментор проходит.
Хуже того, одна и та же функция стояла и на чтении, и на `POST /payments` с
`PATCH /payments/{id}` — то есть ментор мог создавать и править платежи, хотя
раздел ему открывали только на просмотр.

Проверки разделили на чтение и запись, и этот файл фиксирует именно то, что их
различает: роль ментора проходит чтение и не проходит запись.

Обновлено при переезде на единый реестр прав (app/core/permissions.py). Локальные
`_require_finance_read` / `_require_finance_write` удалены — их заменили правила
`finances/view` и `finances/manage`. Смысл проверок не изменился: та же дыра,
та же граница ролей, только источник решения теперь один на всё приложение.
Логика по-прежнему чистая, БД не нужна.
"""
import inspect
import unittest
import uuid

from fastapi import HTTPException

from app.core.permissions import Action, allows, require_access
from app.models.user import User, UserRole


def _user(role: UserRole) -> User:
    return User(id=uuid.uuid4(), role=role)


ADMIN = _user(UserRole.admin)
MZK = _user(UserRole.mzk_manager)
MENTOR = _user(UserRole.mentor)
STUDENT = _user(UserRole.student)


class FinanceReadTests(unittest.TestCase):
    def test_mentor_can_read(self):
        """Главное отличие от записи — ментор смотрит финансы целиком."""
        self.assertIsNone(require_access(MENTOR, "finances", Action.view))

    def test_admin_and_mzk_can_read(self):
        self.assertIsNone(require_access(ADMIN, "finances", Action.view))
        self.assertIsNone(require_access(MZK, "finances", Action.view))

    def test_student_cannot_read(self):
        with self.assertRaises(HTTPException) as ctx:
            require_access(STUDENT, "finances", Action.view)
        self.assertEqual(ctx.exception.status_code, 403)


class FinanceWriteTests(unittest.TestCase):
    def test_mentor_cannot_write(self):
        """Ровно та дыра, ради которой проверку разделили."""
        with self.assertRaises(HTTPException) as ctx:
            require_access(MENTOR, "finances", Action.manage)
        self.assertEqual(ctx.exception.status_code, 403)

    def test_admin_and_mzk_can_write(self):
        self.assertIsNone(require_access(ADMIN, "finances", Action.manage))
        self.assertIsNone(require_access(MZK, "finances", Action.manage))

    def test_student_cannot_write(self):
        with self.assertRaises(HTTPException) as ctx:
            require_access(STUDENT, "finances", Action.manage)
        self.assertEqual(ctx.exception.status_code, 403)

    def test_read_and_write_really_differ(self):
        # Если однажды правила сольются обратно в одно, разница исчезнет молча —
        # эта проверка не даст.
        self.assertTrue(allows(resource="finances", action=Action.view, role=UserRole.mentor))
        self.assertFalse(allows(resource="finances", action=Action.manage, role=UserRole.mentor))


class GateWiringTests(unittest.TestCase):
    """Гейты должны стоять на маршрутах, а не только существовать."""

    def test_mutating_routes_require_write_access(self):
        from app.api.v1.endpoints import payments

        for name in ("create_payment", "update_payment"):
            source = inspect.getsource(getattr(payments, name))
            with self.subTest(route=name):
                self.assertIn(
                    'require_access(current_user, "finances", Action.manage)',
                    source,
                    f"{name} должен требовать право записи",
                )
                self.assertNotIn(
                    'require_access(current_user, "finances", Action.view)',
                    source,
                    f"{name} не должен ограничиваться чтением",
                )

    def test_read_routes_require_read_access(self):
        from app.api.v1.endpoints import payments

        for name in ("list_payments", "finance_summary"):
            source = inspect.getsource(getattr(payments, name))
            with self.subTest(route=name):
                self.assertIn('require_access(current_user, "finances", Action.view)', source)

    def test_no_local_finance_gate_survived_the_migration(self):
        from app.api.v1.endpoints import payments

        source = inspect.getsource(payments)
        for stale in ("_require_finance_read", "_require_finance_write", "_require_admin_mzk"):
            with self.subTest(gate=stale):
                self.assertNotIn(stale, source, "остался самодельный гейт в обход реестра")


if __name__ == "__main__":
    unittest.main()
