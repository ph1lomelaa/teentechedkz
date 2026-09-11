"""Массовая выгрузка ссылок на вход + специализация ментора.

Ради чего тест
--------------
Ссылка на вход — это возможность задать чужой пароль. Поодиночке её выдавала
`create_login_link`, и её инварианты закреплены в test_login_link.py. Выгрузка
делает то же самое пачкой, и опасны ровно те же места плюс два своих:

1. **Пачка не должна ронять себя об одного.** Неактивный аккаунт и аккаунт
   ученика ссылку не получают (иначе переход по ней активировал бы аккаунт
   мимо решения админа). Но отказ обязан быть пропуском одной строки, а не
   ошибкой на весь запрос: 15 живых ссылок полезнее, чем ноль.
2. **Пропущенных обязано быть видно.** Файл на 14 строк вместо 16 без
   объяснений — это тихая потеря людей.

И отдельный инвариант специализации: `mentor_specialties` — подпись, а не
право. Стоит ей просочиться в реестр прав, и редактирование поля в настройках
станет раздачей доступов.
"""
import inspect
import unittest

import openpyxl

from app.core import permissions
from app.core.permissions import Action
from app.models.mentor_assignment import MentorRole
from app.models.user import UserRole
from app.services.excel_export import export_login_links, specialties_ru


def _source() -> str:
    from app.api.v1.endpoints import users

    return inspect.getsource(users.export_login_links_xlsx)


class RouteTests(unittest.TestCase):
    def test_route_is_registered_as_a_post(self) -> None:
        from app.api.v1.endpoints import users

        route = next(
            (r for r in users.router.routes if r.path == "/users/login-links/export"), None
        )
        self.assertIsNotNone(route, "ручка выгрузки не зарегистрирована")
        # POST, а не GET: вызов создаёт инвайты и гасит прежние — это мутация,
        # и GET сделал бы её повторяемой из адресной строки и из префетча.
        self.assertEqual(route.methods, {"POST"})

    def test_it_is_declared_before_the_single_link_route(self) -> None:
        # `/{user_id}/login-link` совпадает по форме пути. Порядок объявления —
        # то, что не даёт литеральному маршруту уехать в user_id.
        from app.api.v1.endpoints import users

        paths = [r.path for r in users.router.routes]
        self.assertLess(
            paths.index("/users/login-links/export"),
            paths.index("/users/{user_id}/login-link"),
        )


class GateTests(unittest.TestCase):
    def test_it_asks_the_registry_for_users_manage(self) -> None:
        self.assertIn('require_access(current_user, "users", Action.manage)', _source())

    def test_only_admin_holds_that_right(self) -> None:
        rule = permissions.rule_for("users", Action.manage)
        self.assertTrue(rule.locked)
        self.assertEqual(set(rule.roles), {UserRole.admin})


class SkipTests(unittest.TestCase):
    """Главная проверка файла: отказ — это пропуск строки, а не 409 на пачку."""

    def test_inactive_and_student_accounts_are_skipped(self) -> None:
        source = _source()
        self.assertIn("if not user.is_active:", source)
        self.assertIn("UserRole.student", source)
        self.assertIn("skipped.append", source)

    def test_the_skip_happens_before_the_invite_is_issued(self) -> None:
        # Порядок и есть защита: выпусти ссылку раньше проверки — и она уже
        # существует к моменту отказа.
        source = _source()
        # `issue_invite(` со скобкой: без неё индекс находит упоминание в
        # докстринге, и проверка порядка перестаёт что-либо значить.
        self.assertLess(source.index("if not user.is_active:"), source.index("issue_invite("))

    def test_a_skip_does_not_raise(self) -> None:
        # `continue`, а не HTTPException: один неактивный ментор не должен
        # оставлять остальных пятнадцать без ссылок.
        source = _source()
        skip_block = source[source.index("skipped.append") : source.index("invite, raw_token")]
        self.assertNotIn("HTTPException", skip_block)


class AuditTests(unittest.TestCase):
    def test_every_issued_link_is_recorded_separately(self) -> None:
        source = _source()
        self.assertIn("record_audit(", source)
        self.assertIn('"kind": "login_link_bulk"', source)
        # Запись внутри цикла: «выдал 16 ссылок» не отвечает, чей доступ трогали.
        self.assertLess(source.index("for user in users:"), source.index("record_audit("))


class TtlTests(unittest.TestCase):
    def test_default_is_two_weeks(self) -> None:
        from app.api.v1.endpoints import users

        self.assertEqual(users.BULK_LINK_TTL_HOURS, 336)

    def test_the_shared_invite_default_is_left_alone(self) -> None:
        # 72 часа — про ссылку в руки конкретному человеку. Файл уходит в чат и
        # открывают его неделю; удлинять при этом общий дефолт нельзя.
        from app.services import invites

        self.assertEqual(invites.INVITE_TTL_HOURS, 72)

    def test_the_ttl_reaches_the_invite(self) -> None:
        # Константы мало: объявить 336 и не передать их в issue_invite — значит
        # раздать ссылки на 72 часа, и обнаружится это через три дня звонками
        # «ссылка не работает».
        self.assertIn("ttl_hours=ttl_hours", _source())

    def test_ttl_is_bounded(self) -> None:
        from app.api.v1.endpoints import users

        source = _source()
        self.assertIn("MAX_LINK_TTL_HOURS", source)
        self.assertEqual(users.MAX_LINK_TTL_HOURS, 720)


class SupersedeTests(unittest.TestCase):
    """Повторная выгрузка гасит ссылки из прошлой — и это обязано быть так."""

    def test_issuing_deletes_the_previous_unused_invite(self) -> None:
        # Свойство issue_invite, на которое опирается выгрузка: одна живая
        # ссылка на человека. Без него после трёх выгрузок у ментора три
        # действующих ссылки, и отозвать их нечем.
        from app.services import invites

        source = inspect.getsource(invites.issue_invite)
        self.assertIn("delete(StudentInvite)", source)
        self.assertIn("used_at.is_(None)", source)

    def test_the_export_uses_that_shared_mechanism(self) -> None:
        # Своя выдача токенов внутри выгрузки обошла бы это правило стороной.
        self.assertIn("issue_invite(", _source())

    def test_a_stale_token_no_longer_resolves(self) -> None:
        # Цена свойства: старый токен обязан переставать работать. Проверяем
        # сам resolve_valid_invite — он отсекает ненайденное, использованное и
        # просроченное, а удалённый инвайт попадает в первую ветку.
        from app.services import invites

        source = inspect.getsource(invites.resolve_valid_invite)
        self.assertIn("if not invite:", source)
        self.assertIn("return None", source)


class WorkbookTests(unittest.TestCase):
    """Чистая функция — проверяется без базы, фикстур с БД в проекте нет."""

    def _book(self, rows, skipped):
        import io

        return openpyxl.load_workbook(io.BytesIO(export_login_links(rows, skipped)))

    def test_both_sheets_exist(self) -> None:
        wb = self._book([], [])
        self.assertEqual(wb.sheetnames, ["Ссылки", "Пропущены"])

    def test_a_row_carries_the_link_and_the_specialty(self) -> None:
        wb = self._book(
            [{
                "name": "Айгерим",
                "email": "a@example.kz",
                "role": UserRole.mentor,
                "mentor_specialties": ["career", "country"],
                "invite_url": "https://teenteched.kz/invite/abc",
                "invite_code": "K7NPQR23",
                "expires_at": "25.09.2026 13:00",
            }],
            [],
        )
        row = [cell.value for cell in wb["Ссылки"][2]]
        self.assertEqual(
            row,
            [
                "Айгерим",
                "a@example.kz",
                "Ментор",
                "Профориентолог, Ментор по стране",
                "https://teenteched.kz/invite/abc",
                "K7NPQR23",
                "25.09.2026 13:00",
            ],
        )

    def test_skipped_people_carry_a_reason(self) -> None:
        wb = self._book([], [{"name": "Данияр", "email": "d@example.kz", "reason": "Аккаунт не активирован"}])
        self.assertEqual(
            [cell.value for cell in wb["Пропущены"][2]],
            ["Данияр", "d@example.kz", "Аккаунт не активирован"],
        )


class SpecialtyLabelTests(unittest.TestCase):
    def test_every_mentor_role_has_a_label(self) -> None:
        # Иначе в файле у координатора окажется 'portfolio' вместо «Портфолио».
        for role in MentorRole:
            self.assertNotEqual(specialties_ru([role.value]), role.value)

    def test_an_unknown_value_is_shown_as_is(self) -> None:
        self.assertEqual(specialties_ru(["ufo"]), "ufo")

    def test_empty_is_empty(self) -> None:
        self.assertEqual(specialties_ru(None), "")


class SpecialtyValidationTests(unittest.TestCase):
    def _parse(self, raw):
        from app.api.v1.endpoints.users import _parse_specialties

        return _parse_specialties(raw)

    def test_known_values_pass(self) -> None:
        self.assertEqual(self._parse(["career", "lead"]), ["career", "lead"])

    def test_duplicates_collapse(self) -> None:
        self.assertEqual(self._parse(["career", "career"]), ["career"])

    def test_unknown_value_is_refused(self) -> None:
        from fastapi import HTTPException

        with self.assertRaises(HTTPException) as caught:
            self._parse(["profori"])
        self.assertEqual(caught.exception.status_code, 422)

    def test_a_non_list_is_refused(self) -> None:
        from fastapi import HTTPException

        with self.assertRaises(HTTPException):
            self._parse("career")

    def test_the_vocabulary_is_mentor_role_itself(self) -> None:
        # Второй справочник специализаций означал бы значение, под которое
        # нельзя назначить: назначения знают только MentorRole.
        from app.api.v1.endpoints import users

        self.assertIn("MentorRole", inspect.getsource(users._parse_specialties))


class SpecialtyIsNotAPermissionTests(unittest.TestCase):
    """Подпись не должна становиться правом."""

    def test_the_permission_registry_does_not_read_it(self) -> None:
        self.assertNotIn("mentor_specialties", inspect.getsource(permissions))

    def test_mentor_scope_does_not_read_it(self) -> None:
        from app.services import mentor_scope

        self.assertNotIn("mentor_specialties", inspect.getsource(mentor_scope))

    def test_changing_it_does_not_revoke_sessions(self) -> None:
        # Смена роли рвёт сессии намеренно (права изменились). Специализация
        # прав не меняет, и обрыв работы ментора на ровном месте здесь был бы
        # признаком, что поле всё-таки считают правом.
        from app.api.v1.endpoints import users

        source = inspect.getsource(users.update_user)
        block = source[source.index('if "mentor_specialties" in body:') :]
        block = block[: block.index('if "is_active" in body:')]
        self.assertNotIn("revoke_sessions = True", block)


if __name__ == "__main__":
    unittest.main()
