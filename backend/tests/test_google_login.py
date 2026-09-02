"""Вход через Google: что именно здесь нельзя сломать.

Ради чего тест
--------------
Восстановления пароля в системе нет, почты тоже нет — Google становится
единственным путём для забывшего пароль, и поэтому оказывается самой ценной
дверью. Ошибка в проверке токена стоит не «неудобства», а чужого аккаунта.

Опасны ровно два места, и оба покрыты ниже:

1. **`aud`.** Токен, выписанный Google для чужого сайта, подписан настоящим
   ключом Google и проходит любую проверку подписи. Отличает его только
   аудитория. Не передать `audience` в `verify_oauth2_token` — значит впустить
   владельца любого стороннего сайта с входом через Google.
2. **`email_verified`.** Google выдаёт токены и на аккаунты с
   неподтверждённым адресом. Связывать по такому адресу — значит отдать чужой
   профиль тому, кто просто указал чужой email при регистрации.

Сеть здесь не нужна и не должна быть нужна: разбор клеймов подменяется, а
проверяется наше поведение поверх него.
"""
import unittest
from unittest import mock

from app.core.config import settings
from app.services import google_auth
from app.services.google_auth import (
    GoogleAuthError,
    GoogleAuthNotConfigured,
    verify_id_token,
)

CLIENT_ID = "1234.apps.googleusercontent.com"

CLAIMS = {
    "iss": "https://accounts.google.com",
    "aud": CLIENT_ID,
    "sub": "108000000000000000000",
    "email": "Person@Example.com",
    "email_verified": True,
    "name": "Айгерим",
}


def _with_claims(claims):
    """Подменить разбор токена, оставив нашу логику поверх него нетронутой."""
    return mock.patch.object(
        google_auth.google_id_token, "verify_oauth2_token", return_value=claims
    )


class ConfigurationTests(unittest.TestCase):
    def test_disabled_until_a_client_id_is_set(self) -> None:
        with mock.patch.object(settings, "GOOGLE_OAUTH_CLIENT_ID", ""):
            self.assertFalse(google_auth.is_configured())
            with self.assertRaises(GoogleAuthNotConfigured):
                verify_id_token("whatever")

    def test_enabled_once_a_client_id_is_set(self) -> None:
        with mock.patch.object(settings, "GOOGLE_OAUTH_CLIENT_ID", CLIENT_ID):
            self.assertTrue(google_auth.is_configured())


class AudienceTests(unittest.TestCase):
    def test_our_client_id_is_passed_as_the_audience(self) -> None:
        # Главная проверка файла: без `audience=` библиотека не сверяет `aud`,
        # и подходит токен, выписанный для чужого приложения.
        with mock.patch.object(settings, "GOOGLE_OAUTH_CLIENT_ID", CLIENT_ID):
            with _with_claims(CLAIMS) as verify:
                verify_id_token("token")
        self.assertEqual(verify.call_args.kwargs.get("audience"), CLIENT_ID)

    def test_a_rejected_token_never_becomes_an_identity(self) -> None:
        with mock.patch.object(settings, "GOOGLE_OAUTH_CLIENT_ID", CLIENT_ID):
            with mock.patch.object(
                google_auth.google_id_token,
                "verify_oauth2_token",
                side_effect=ValueError("Token has wrong audience"),
            ):
                with self.assertRaises(GoogleAuthError):
                    verify_id_token("token")

    def test_a_foreign_issuer_is_refused(self) -> None:
        with mock.patch.object(settings, "GOOGLE_OAUTH_CLIENT_ID", CLIENT_ID):
            with _with_claims({**CLAIMS, "iss": "https://evil.example"}):
                with self.assertRaises(GoogleAuthError):
                    verify_id_token("token")


class EmailVerifiedTests(unittest.TestCase):
    def test_verified_flag_is_carried_through(self) -> None:
        with mock.patch.object(settings, "GOOGLE_OAUTH_CLIENT_ID", CLIENT_ID):
            with _with_claims(CLAIMS):
                self.assertTrue(verify_id_token("token").email_verified)

    def test_unverified_stays_unverified(self) -> None:
        with mock.patch.object(settings, "GOOGLE_OAUTH_CLIENT_ID", CLIENT_ID):
            with _with_claims({**CLAIMS, "email_verified": False}):
                self.assertFalse(verify_id_token("token").email_verified)

    def test_the_string_false_is_not_true(self) -> None:
        # Google кладёт в это поле и bool, и строку. `bool("false")` истинно —
        # на этом месте проверка выключилась бы целиком и молча.
        with mock.patch.object(settings, "GOOGLE_OAUTH_CLIENT_ID", CLIENT_ID):
            for raw in ("false", "False", "", "0", None):
                with self.subTest(raw=raw):
                    with _with_claims({**CLAIMS, "email_verified": raw}):
                        self.assertFalse(verify_id_token("token").email_verified)

    def test_the_string_true_is_true(self) -> None:
        with mock.patch.object(settings, "GOOGLE_OAUTH_CLIENT_ID", CLIENT_ID):
            for raw in ("true", "True", "1", True):
                with self.subTest(raw=raw):
                    with _with_claims({**CLAIMS, "email_verified": raw}):
                        self.assertTrue(verify_id_token("token").email_verified)

    def test_missing_flag_is_not_verified(self) -> None:
        claims = {k: v for k, v in CLAIMS.items() if k != "email_verified"}
        with mock.patch.object(settings, "GOOGLE_OAUTH_CLIENT_ID", CLIENT_ID):
            with _with_claims(claims):
                self.assertFalse(verify_id_token("token").email_verified)


class ClaimsTests(unittest.TestCase):
    def test_email_is_normalised(self) -> None:
        # Поиск аккаунта идёт по нормализованному адресу; вернув «Person@Example.com»,
        # мы бы завели второй аккаунт тому, у кого он уже есть.
        with mock.patch.object(settings, "GOOGLE_OAUTH_CLIENT_ID", CLIENT_ID):
            with _with_claims(CLAIMS):
                self.assertEqual(verify_id_token("token").email, "person@example.com")

    def test_no_email_is_refused(self) -> None:
        with mock.patch.object(settings, "GOOGLE_OAUTH_CLIENT_ID", CLIENT_ID):
            with _with_claims({**CLAIMS, "email": ""}):
                with self.assertRaises(GoogleAuthError):
                    verify_id_token("token")

    def test_empty_token_is_refused_without_a_network_call(self) -> None:
        with mock.patch.object(settings, "GOOGLE_OAUTH_CLIENT_ID", CLIENT_ID):
            with _with_claims(CLAIMS) as verify:
                with self.assertRaises(GoogleAuthError):
                    verify_id_token("")
        verify.assert_not_called()


class PasswordlessAccountTests(unittest.TestCase):
    """Аккаунт, заведённый через Google, не имеет пароля — и это не ошибка."""

    def test_password_login_into_a_google_account_is_a_plain_no(self) -> None:
        # Раньше `UnknownHashError` уходил наружу: 500 вместо «неверный пароль»,
        # и по коду ответа было видно, что такой аккаунт существует.
        from app.core.security import verify_password

        self.assertFalse(verify_password("anything", "!google"))
        self.assertFalse(verify_password("", "!"))

    def test_real_hashes_still_work(self) -> None:
        from app.core.security import hash_password, verify_password

        hashed = hash_password("correct horse")
        self.assertTrue(verify_password("correct horse", hashed))
        self.assertFalse(verify_password("wrong", hashed))


class EndpointShapeTests(unittest.TestCase):
    """Форма эндпоинта: то, на что опирается экран входа."""

    def test_google_routes_exist(self) -> None:
        from app.api.v1.endpoints import auth

        paths = {route.path for route in auth.router.routes}
        self.assertIn("/auth/google", paths)
        self.assertIn("/auth/google/config", paths)

    def test_unknown_email_is_refused_instead_of_creating_an_account(self) -> None:
        """Вход не заводит аккаунтов — это делает только /public/join.

        Раньше здесь была ровно обратная проверка: незнакомая почта создавала
        `User(role=mentor, is_active=False)`. Получалась вторая точка создания
        аккаунта, и куда худшего качества — без ФИО, без телефона и без строки
        в очереди заявок. Ученик, нажавший «Войти через Google» вместо
        регистрации, попадал в систему, но сопоставить его с карточкой было
        нечем, а администратор его в очереди не видел.

        Проверка по исходнику, а не по поведению: в проекте нет фикстур с БД, а
        эндпоинту нужна сессия. Настоящее покрытие — ручной сценарий (план,
        проверка 1) и то, что создание `User` живёт теперь ровно в одном месте.
        """
        import inspect

        from app.api.v1.endpoints import auth

        source = inspect.getsource(auth.login_with_google)
        # Ищем `db.add(` — сам факт записи строки, а не упоминание модели:
        # слово `User(` встречается в комментарии, объясняющем эту же правку.
        self.assertNotIn("db.add(", source, "вход снова начал заводить аккаунты")
        self.assertIn("NO_ACCOUNT", source)

    def test_account_creation_lives_in_exactly_one_place(self) -> None:
        # Смысл всей правки одной проверкой: самозапись — только через /join,
        # и там собираются ФИО с телефоном, без которых заявку не сопоставить.
        import inspect

        from app.api.v1.endpoints import public

        self.assertIn("db.add(user)", inspect.getsource(public.join))

    def test_unverified_email_is_refused_in_the_endpoint(self) -> None:
        import inspect

        from app.api.v1.endpoints import auth

        source = inspect.getsource(auth.login_with_google)
        self.assertIn("identity.email_verified", source)


if __name__ == "__main__":
    unittest.main()
