"""Один шейп пользователя на все ответы (Этап 2.3).

Ради чего тест
--------------
Ответов с пользователем три: `POST /auth/login`, приём инвайта (обе ручки, через
`issue_session`) и `GET /auth/me`. Собирались они двумя независимыми литералами
и уже разъехались: `/me` отдавал `telegram_username`, `phone` и `is_active`, а
логин — нет. Никто не заметил, потому что поля читались из другого источника.

С правами так не будет: если `permissions` уедут в `/me`, но не в ответ логина,
меню и роуты сразу после входа окажутся пустыми, а после F5 — полными. Причём
воспроизводится это только «свежим» входом, то есть в разработке почти никогда.

Поэтому тест проверяет не содержимое полей, а ИНВАРИАНТ: набор ключей у всех
ответов один и тот же, и берётся он из одной функции. Плюс `inspect.getsource`
на обоих местах вызова — чтобы литерал не вернулся туда через полгода.

БД не нужна: решающая часть (`build_user_payload`) чистая и синхронная.
"""
import inspect
import unittest
import uuid

from app.api.v1.endpoints import auth as auth_endpoint
from app.core import permissions
from app.core.permissions import Action
from app.models.user import User, UserRole
from app.services import sessions
from app.services.user_payload import build_user_payload

ALL_ROLES = (UserRole.admin, UserRole.mzk_manager, UserRole.mentor, UserRole.student)

EXPECTED_KEYS = {
    "id",
    "name",
    "email",
    "role",
    "telegram_username",
    "phone",
    "is_active",
    "must_change_password",
    "agreement_signature_required",
    "permissions",
}


def _user(role: UserRole = UserRole.mentor) -> User:
    return User(
        id=uuid.uuid4(),
        name="Иван",
        email="ivan@example.com",
        role=role,
        is_active=True,
        must_change_password=False,
    )


class PayloadShapeTests(unittest.TestCase):
    def test_payload_has_exactly_the_agreed_keys(self) -> None:
        payload = build_user_payload(_user(), agreement_signature_required=False)
        self.assertEqual(set(payload), EXPECTED_KEYS)

    def test_id_is_serialisable(self) -> None:
        # uuid.UUID не переживает json-сериализацию у Starlette без str().
        payload = build_user_payload(_user(), agreement_signature_required=False)
        self.assertIsInstance(payload["id"], str)

    def test_role_travels_as_its_value_not_as_enum(self) -> None:
        payload = build_user_payload(_user(UserRole.mzk_manager), agreement_signature_required=False)
        self.assertEqual(payload["role"], "mzk_manager")

    def test_agreement_flag_is_passed_through(self) -> None:
        payload = build_user_payload(_user(), agreement_signature_required=True)
        self.assertTrue(payload["agreement_signature_required"])


class PermissionsInPayloadTests(unittest.TestCase):
    def test_permissions_match_the_registry(self) -> None:
        for role in ALL_ROLES:
            with self.subTest(role=role):
                payload = build_user_payload(_user(role), agreement_signature_required=False)
                self.assertEqual(
                    sorted(payload["permissions"]),
                    sorted(permissions.granted_for(role)),
                )

    def test_every_permission_is_a_real_registry_pair(self) -> None:
        # Строка «ресурс:действие», которой нет в реестре, на фронте откроет
        # раздел, которого бэкенд не пустит.
        known = {f"{rule.resource}:{rule.action.value}" for rule in permissions.all_rules()}
        for role in ALL_ROLES:
            payload = build_user_payload(_user(role), agreement_signature_required=False)
            with self.subTest(role=role):
                self.assertTrue(set(payload["permissions"]) <= known)

    def test_permissions_agree_with_allows(self) -> None:
        for role in ALL_ROLES:
            granted = set(permissions.granted_for(role))
            for rule in permissions.all_rules():
                key = f"{rule.resource}:{rule.action.value}"
                with self.subTest(role=role, key=key):
                    self.assertEqual(
                        key in granted,
                        permissions.allows(
                            resource=rule.resource, action=rule.action, role=role
                        ),
                    )

    def test_roles_do_not_all_get_the_same_thing(self) -> None:
        # Защита от «случайно отдали всем всё»: расклад обязан различаться.
        admin = set(permissions.granted_for(UserRole.admin))
        student = set(permissions.granted_for(UserRole.student))
        self.assertLess(len(student), len(admin))
        # Админ НЕ надмножество всех остальных, и это не ошибка: личный кабинет
        # принадлежит владельцу, а не управленцу (permissions.py:378). Код,
        # который считает «админ может всё», на этом правиле ошибётся.
        self.assertEqual(student - admin, {"portal:view"})

    def test_scope_does_not_leak_into_the_payload(self) -> None:
        # Скоуп остаётся на сервере: фронт, фильтрующий по нему, стал бы вторым
        # местом, где решается объём выдачи.
        payload = build_user_payload(_user(UserRole.mentor), agreement_signature_required=False)
        self.assertTrue(all(entry.count(":") == 1 for entry in payload["permissions"]))
        self.assertIn(f"students:{Action.view.value}", payload["permissions"])


class SingleBuilderWiringTests(unittest.TestCase):
    """Литерал не должен вернуться ни в одну из точек входа."""

    def test_me_endpoint_uses_the_shared_builder(self) -> None:
        source = inspect.getsource(auth_endpoint.me)
        self.assertIn("resolve_user_payload", source)
        self.assertNotIn('"email"', source, "/auth/me снова собирает пользователя вручную")

    def test_issue_session_uses_the_shared_builder(self) -> None:
        source = inspect.getsource(sessions.issue_session)
        self.assertIn("resolve_user_payload", source)
        self.assertNotIn('"email"', source, "issue_session снова собирает пользователя вручную")

    def test_no_other_place_builds_a_user_literal(self) -> None:
        # Третья форма (приём инвайта) обязана оставаться пересказом
        # issue_session, а не собственным словарём.
        from app.api.v1.endpoints import invites

        for name in ("accept", "accept_by_code"):
            with self.subTest(handler=name):
                source = inspect.getsource(getattr(invites, name))
                self.assertIn("issue_session", source)
                self.assertNotIn('"role":', source)


if __name__ == "__main__":
    unittest.main()
