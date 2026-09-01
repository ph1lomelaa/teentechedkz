"""Одноразовая ссылка для входа тому, кто уже зарегистрирован (Часть 1.3).

Ради чего тест
--------------
Восстановления пароля в системе нет, почты нет. Пока это так, забывший пароль
зависит от того, что администратор впишет ему новый пароль руками и передаст
его — то есть узнает чужой пароль. Ссылка убирает этот шаг: человек задаёт
пароль сам.

Опасны здесь два места:

1. **Неактивный аккаунт.** `accept_invite` попутно ставит `is_active=True`.
   Выдай ссылку ждущему одобрения — переход по ней активирует аккаунт мимо
   решения админа, и кнопка «выслать ссылку» тихо становится кнопкой
   «одобрить заявку». Одобрение обязано оставаться отдельным действием.
2. **Право.** Выдача ссылки — это возможность сменить чужой пароль. Ручка
   обязана спрашивать `users:manage` у реестра, а не решать по роли сама.
"""
import ast
import inspect
import os
import unittest

from app.core import permissions
from app.core.permissions import Action
from app.models.user import UserRole

ENDPOINT = os.path.join(
    os.path.dirname(os.path.dirname(__file__)),
    "app", "api", "v1", "endpoints", "users.py",
)


def _source() -> str:
    from app.api.v1.endpoints import users

    return inspect.getsource(users.create_login_link)


class RouteExistsTests(unittest.TestCase):
    def test_route_is_registered(self) -> None:
        from app.api.v1.endpoints import users

        paths = {route.path for route in users.router.routes}
        self.assertIn("/users/{user_id}/login-link", paths)

    def test_route_is_a_post(self) -> None:
        from app.api.v1.endpoints import users

        route = next(r for r in users.router.routes if r.path == "/users/{user_id}/login-link")
        self.assertEqual(route.methods, {"POST"})


class GateTests(unittest.TestCase):
    def test_it_asks_the_registry_for_users_manage(self) -> None:
        self.assertIn('require_access(current_user, "users", Action.manage)', _source())

    def test_it_does_not_decide_by_role_itself(self) -> None:
        # Ровно та форма, из-за которой конструктор прав однажды перестал
        # работать: решение по роли рядом с реестром, но мимо него.
        source = _source()
        self.assertNotIn(".role ==", source)
        self.assertNotIn(".role in", source)

    def test_only_admin_holds_that_right(self) -> None:
        # `users:manage` заперто (`locked`), поэтому состав ролей здесь —
        # не предмет настройки, и проверка не станет ложной после правки в
        # конструкторе.
        rule = permissions.rule_for("users", Action.manage)
        self.assertTrue(rule.locked)
        self.assertEqual(set(rule.roles), {UserRole.admin})


class InactiveAccountTests(unittest.TestCase):
    def test_an_inactive_account_is_refused(self) -> None:
        # Главная проверка файла.
        source = _source()
        self.assertIn("if not user.is_active:", source)
        self.assertIn("409", source)

    def test_the_refusal_comes_before_the_invite_is_issued(self) -> None:
        # Порядок здесь и есть защита: выпуск ссылки после проверки, иначе
        # ссылка уже существует к моменту отказа.
        source = _source()
        self.assertLess(source.index("if not user.is_active:"), source.index("issue_invite"))


class AuditTests(unittest.TestCase):
    def test_issuing_a_link_is_recorded(self) -> None:
        source = _source()
        self.assertIn("record_audit(", source)
        self.assertIn('"kind": "login_link"', source)


class ReuseTests(unittest.TestCase):
    """Ссылка выпускается той же механикой, что и приглашение, — не второй."""

    def test_it_calls_the_shared_issue_invite(self) -> None:
        self.assertIn("issue_invite(", _source())

    def test_issuing_supersedes_the_previous_unused_link(self) -> None:
        # Свойство `issue_invite`, на которое здесь опираются: старая ссылка
        # перестаёт работать. Без него у одного человека жила бы пачка
        # действующих ссылок, и отозвать их было бы нечем.
        from app.services import invites

        source = inspect.getsource(invites.issue_invite)
        self.assertIn("delete(StudentInvite)", source)
        self.assertIn("used_at.is_(None)", source)

    def test_no_second_invite_helper_was_written(self) -> None:
        # Вторая механика приглашений — ровно тот способ, которым в этом
        # проекте уже однажды завелась вторая система прав.
        tree = ast.parse(open(ENDPOINT, encoding="utf-8").read())
        names = {
            node.name
            for node in ast.walk(tree)
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        }
        self.assertFalse({n for n in names if "invite" in n and n.startswith("_")})


if __name__ == "__main__":
    unittest.main()
