"""Восстановление доступа ментора: временный пароль и привязка Google.

Ради чего тест
--------------
Проблема, из которой выросла эта пачка правок, звучала как «половина менторов
забыла пароли». На деле пароля у них не было никогда: ментор, пришедший через
/join, заводится с заглушкой вместо хеша и может войти только кнопкой Google, а
`/auth/login` отвечал ему общим «неверный email или пароль». Человек шёл
вспоминать то, чего не существовало.

Здесь закреплены три вещи, каждая из которых по отдельности возвращает эту
проблему обратно:

1. Заглушка распознаётся (`is_google_only`) и вход отвечает по существу.
2. Одобрение заявки выдаёт временный пароль — второй рабочий путь входа.
3. Привязка Google требует `email_verified`: без этого чужой Google-аккаунт с
   неподтверждённым, но совпадающим адресом получил бы вход в аккаунт ментора.

БД здесь нет (в проекте нет фикстур с ней), поэтому там, где нужна сессия,
проверяется исходник — тот же приём, что в test_google_login.py.
"""
import inspect
import unittest

from app.core.security import (
    GOOGLE_ONLY_PASSWORD,
    hash_password,
    is_google_only,
    verify_password,
)
from app.services.passwords import PW_ALPHABET, gen_password


class GoogleOnlyAccountTests(unittest.TestCase):
    def test_stub_is_recognised(self) -> None:
        self.assertTrue(is_google_only(GOOGLE_ONLY_PASSWORD))

    def test_real_hash_is_not_mistaken_for_the_stub(self) -> None:
        # Иначе сброс пароля превратил бы обычный аккаунт в «только Google».
        self.assertFalse(is_google_only(hash_password("whatever")))

    def test_stub_still_refuses_every_password(self) -> None:
        # Страховка на случай, если заглушку однажды поменяют на что-то,
        # что bcrypt согласится разобрать.
        self.assertFalse(verify_password("anything", GOOGLE_ONLY_PASSWORD))
        self.assertFalse(verify_password(GOOGLE_ONLY_PASSWORD, GOOGLE_ONLY_PASSWORD))


class LoginErrorTests(unittest.TestCase):
    def test_login_answers_google_only_before_the_generic_refusal(self) -> None:
        source = inspect.getsource(
            __import__("app.api.v1.endpoints.auth", fromlist=["auth"]).login
        )
        self.assertIn("GOOGLE_ONLY", source)
        # Порядок важен: общий отказ идёт ниже, иначе ветка недостижима —
        # verify_password на заглушке вернёт False и выйдет раньше.
        self.assertLess(
            source.index("GOOGLE_ONLY"),
            source.index("Неверный email или пароль"),
            "ветка про Google оказалась после общего отказа и не сработает",
        )


class TempPasswordTests(unittest.TestCase):
    def test_generated_password_is_readable_aloud(self) -> None:
        # Пароль всегда диктуется человеком человеку: символы, которые путают
        # при чтении (O/0, I/l/1), делают эту передачу ненадёжной.
        for _ in range(50):
            password = gen_password()
            self.assertEqual(len(password), 10)
            self.assertTrue(set(password) <= set(PW_ALPHABET))
        self.assertFalse(set("O0Il1") & set(PW_ALPHABET))

    def test_passwords_are_not_repeated(self) -> None:
        self.assertEqual(len({gen_password() for _ in range(200)}), 200)

    def test_approval_issues_a_password_for_a_passwordless_account(self) -> None:
        from app.api.v1.endpoints import access_requests

        source = inspect.getsource(access_requests._grant_staff_role)
        self.assertIn("is_google_only", source)
        self.assertIn("gen_password", source)
        # Без этого человек войдёт временным паролем и оставит его навсегда.
        self.assertIn("must_change_password = True", source)
        self.assertIn("temp_password", source)

    def test_single_and_bulk_approval_share_one_implementation(self) -> None:
        """Обе ручки выдают роль через один хелпер.

        Разойдись они — массовое одобрение забыло бы выдать временный пароль,
        и половина одобренных снова осталась бы без входа. Ровно та проблема,
        с которой всё началось.
        """
        from app.api.v1.endpoints import access_requests

        for endpoint in (access_requests.approve_request, access_requests.bulk_approve_staff):
            source = inspect.getsource(endpoint)
            self.assertIn("_grant_staff_role", source, endpoint.__name__)
            # Своей копии выдачи пароля быть не должно.
            self.assertNotIn("gen_password(", source, endpoint.__name__)

    def test_staff_reset_revokes_sessions_and_forces_a_change(self) -> None:
        from app.api.v1.endpoints import users

        source = inspect.getsource(users.reset_user_password)
        self.assertIn("revoke_all_sessions", source)
        self.assertIn("must_change_password = True", source)
        # Сброс самому себе оборвал бы собственную сессию администратора.
        self.assertIn("current_user.id", source)


class GoogleLinkTests(unittest.TestCase):
    def test_route_exists(self) -> None:
        from app.api.v1.endpoints import auth

        paths = {route.path for route in auth.router.routes}
        self.assertIn("/auth/google/link", paths)
        self.assertIn("/auth/me/emails", paths)

    def test_link_requires_a_verified_email(self) -> None:
        from app.api.v1.endpoints import auth

        source = inspect.getsource(auth.link_google_account)
        self.assertIn("identity.email_verified", source)

    def test_link_refuses_an_address_owned_by_someone_else(self) -> None:
        # Иначе привязка становится способом увести чужой аккаунт.
        from app.api.v1.endpoints import auth

        source = inspect.getsource(auth.link_google_account)
        self.assertIn("email_in_use", source)
        self.assertIn("409", source)

    def test_link_and_unlink_are_audited_as_themselves(self) -> None:
        """Привязка и отвязка пишутся своими действиями, а не «входом».

        В `AuditAction` для этого заранее заведены `google_linked` /
        `google_unlinked`. Записать привязку как `login_success` — значит
        засорить статистику входов и потерять событие: разобрать потом
        «я привязывал Google, но войти не могу» будет нечем.
        """
        from app.api.v1.endpoints import auth

        link_src = inspect.getsource(auth.link_google_account)
        self.assertIn("AuditAction.google_linked", link_src)
        self.assertNotIn("AuditAction.login_success", link_src)

        unlink_src = inspect.getsource(auth.unlink_my_email)
        self.assertIn("AuditAction.google_unlinked", unlink_src)

    def test_link_is_self_scoped(self) -> None:
        # Ручка работает только со своим аккаунтом: она не должна принимать
        # чужой user_id ни в каком виде.
        from app.api.v1.endpoints import auth

        signature = inspect.signature(auth.link_google_account)
        self.assertIn("current_user", signature.parameters)
        self.assertNotIn("user_id", signature.parameters)


if __name__ == "__main__":
    unittest.main()
