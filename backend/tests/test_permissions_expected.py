"""Явный расклад доступов — что именно может каждая роль.

Ради чего тест
--------------
Пока самодельные хелперы жили рядом с реестром, правду держал
`test_permissions_conformance.py`: он сверял две независимые реализации. Как
только вызовы переедут на реестр и хелперы исчезнут, сверять станет не с чем —
та проверка выродится в тавтологию.

Поэтому расклад пришпилен здесь отдельно и явно: каждая пара «ресурс + действие»
перечисляет роли поимённо. Таблица снята с ФАКТИЧЕСКОГО поведения системы на
момент миграции (она была доказана равной старым хелперам), а не с того, как
должно быть. Любая правка доступа — хоть расширение, хоть сужение — валит этот
тест и требует осознанного решения вместо тихого проезда.

Спорные места (ментор к ИИН опекунов, ментор к конфиденциальным заметкам,
чтение справочников вообще без проверки роли) перечислены здесь как есть и
помечены в реестре полем `review`. Тест фиксирует статус-кво, а не одобряет его.
"""
import unittest

from app.core.permissions import Action, RULES, Scope, allows, scope_for
from app.models.user import UserRole

ALL_ROLES = (UserRole.admin, UserRole.mzk_manager, UserRole.mentor, UserRole.student)

# (ресурс, действие) -> роли, которым доступ открыт. Всё, чего здесь нет, закрыто.
EXPECTED_ACCESS: dict[tuple[str, Action], tuple[str, ...]] = {
    ("agreements", Action.manage): ("admin",),
    ("agreements", Action.view): ("admin", "mzk_manager", "mentor", "student"),
    ("applications", Action.manage): ("admin", "mzk_manager", "mentor"),
    ("applications", Action.view): ("admin", "mzk_manager", "mentor", "student"),
    ("audit", Action.view): ("admin",),
    ("chat", Action.manage): ("admin", "mzk_manager", "mentor"),
    ("chat", Action.view): ("admin", "mzk_manager", "mentor", "student"),
    ("checkins", Action.view): ("admin", "mzk_manager"),
    ("communication", Action.manage): ("admin", "mzk_manager", "mentor"),
    ("complaints", Action.manage): ("admin", "mzk_manager"),
    ("complaints", Action.view): ("admin", "mzk_manager", "mentor", "student"),
    # review: ментор допущен к конфиденциальным заметкам
    ("confidential_notes", Action.manage): ("admin", "mzk_manager", "mentor"),
    ("contract_addenda", Action.view): ("admin", "mzk_manager", "mentor", "student"),
    ("contract_addenda", Action.manage): ("admin", "mzk_manager"),
    # Решение 30.08.2026: смотреть договор может весь персонал, править —
    # только управление. Раньше одно право отвечало за оба вопроса.
    ("contracts", Action.view): ("admin", "mzk_manager", "mentor"),
    ("contracts", Action.manage): ("admin", "mzk_manager"),
    # Решение 30.08.2026: справочник правит только управление.
    ("countries", Action.edit): ("admin", "mzk_manager"),
    # review: чтение справочника не проверяет роль вообще
    ("countries", Action.view): ("admin", "mzk_manager", "mentor", "student"),
    ("credentials", Action.manage): ("admin", "mzk_manager", "mentor", "student"),
    ("documents", Action.manage): ("admin", "mzk_manager", "mentor"),
    ("documents", Action.view): ("admin", "mzk_manager", "mentor", "student"),
    ("emergency_contacts", Action.manage): ("admin", "mzk_manager", "mentor"),
    ("export", Action.manage): ("admin", "mzk_manager", "mentor"),
    ("finances", Action.manage): ("admin", "mzk_manager"),
    # review: ментор видит финансы целиком — решение продукта
    ("finances", Action.view): ("admin", "mzk_manager", "mentor"),
    # review: ПДн родителей, включая ИИН, а имя функции обещало admin+МЗК
    ("guardians", Action.manage): ("admin", "mzk_manager", "mentor"),
    ("knowledge", Action.manage): ("admin",),
    ("knowledge", Action.view): ("admin", "mzk_manager", "mentor"),
    ("meetings", Action.manage): ("admin", "mzk_manager", "mentor"),
    ("meetings", Action.view): ("admin", "mzk_manager", "mentor", "student"),
    # review: имя функции обещало admin+МЗК
    ("mentor_assignments", Action.manage): ("admin", "mzk_manager", "mentor"),
    ("mentor_rewards", Action.manage): ("admin", "mzk_manager"),
    ("mentor_rewards", Action.view): ("admin", "mzk_manager", "mentor"),
    ("mzk_quality", Action.manage): ("admin",),
    ("mzk_quality", Action.view): ("admin", "mzk_manager", "mentor"),
    ("note_sessions", Action.manage): ("admin", "mzk_manager", "mentor"),
    ("notes", Action.manage): ("admin", "mzk_manager", "mentor"),
    ("integrations", Action.manage): ("admin", "mzk_manager", "mentor"),
    ("notion", Action.create): ("admin",),
    ("notion", Action.manage): ("admin", "mzk_manager", "mentor"),
    # review: _check_access принимает student_id и не проверяет его
    ("portfolio", Action.manage): ("admin", "mzk_manager", "mentor"),
    ("permissions", Action.view): ("admin",),
    ("permissions", Action.manage): ("admin",),
    ("portal", Action.view): ("student",),
    ("questionnaires", Action.manage): ("admin", "mzk_manager", "mentor"),
    ("questionnaires", Action.view): ("admin", "mzk_manager", "mentor", "student"),
    ("responsibilities", Action.view): ("admin", "mzk_manager", "mentor"),
    ("responsibilities", Action.manage): ("admin", "mzk_manager"),
    ("refund_approval", Action.manage): ("admin",),
    ("refund_cases", Action.manage): ("admin", "mzk_manager"),
    ("reward_rules", Action.manage): ("admin",),
    ("reward_rules", Action.view): ("admin", "mzk_manager", "mentor"),
    ("roadmap_templates", Action.create): ("admin",),
    # review: константа названа TEMPLATE_ADMIN, но включает ментора
    ("roadmap_templates", Action.manage): ("admin", "mzk_manager", "mentor"),
    ("roadmaps", Action.edit): ("admin", "mzk_manager", "mentor"),
    ("roadmaps", Action.view): ("admin", "mzk_manager", "mentor", "student"),
    # review: докстринг обещает admin+МЗК, код пускает ментора
    ("scholarships", Action.manage): ("admin", "mzk_manager", "mentor"),
    ("security_incidents", Action.manage): ("admin", "mzk_manager"),
    ("services", Action.manage): ("admin", "mzk_manager", "mentor"),
    ("student_access", Action.manage): ("admin", "mzk_manager", "mentor"),
    ("student_universities", Action.manage): ("admin", "mzk_manager", "mentor", "student"),
    ("status_history", Action.view): ("admin", "mzk_manager", "mentor"),
    # Решение 30.08.2026: карточку заводит и правит персонал, ментор — только
    # своих. До этого обе ручки не проверяли ничего, включая роль студента.
    ("students", Action.create): ("admin", "mzk_manager", "mentor"),
    ("students", Action.edit): ("admin", "mzk_manager", "mentor"),
    ("students", Action.manage): ("admin", "mzk_manager"),
    ("students", Action.view): ("admin", "mzk_manager", "mentor", "student"),
    ("sync", Action.create): ("admin",),
    ("sync", Action.manage): ("admin", "mzk_manager", "mentor"),
    ("tasks", Action.manage): ("admin", "mzk_manager", "mentor"),
    # задача без привязки к студенту — ментору недоступна
    ("tasks_general", Action.manage): ("admin", "mzk_manager"),
    ("tasks_bulk", Action.manage): ("admin", "mzk_manager"),
    ("tasks_review", Action.manage): ("admin", "mzk_manager"),
    ("tasks", Action.view): ("admin", "mzk_manager", "mentor", "student"),
    # Перенесены из deps.ROLE_PERMISSIONS один в один (30.08.2026).
    ("tasks_assign_mentor", Action.manage): ("admin", "mzk_manager"),
    ("tasks_assign_mzk", Action.manage): ("admin", "mzk_manager"),
    ("tasks_accept_result", Action.manage): ("admin", "mzk_manager"),
    ("tasks_deadlines", Action.manage): ("admin", "mzk_manager", "mentor"),
    ("telegram_chats", Action.manage): ("admin", "mzk_manager"),
    ("telegram_chats", Action.view): ("admin", "mzk_manager", "mentor"),
    # review: константа названа ADMIN, но включает МЗК
    ("universities", Action.create): ("admin",),
    ("universities", Action.manage): ("admin", "mzk_manager"),
    # review: чтение справочника не проверяет роль вообще
    ("universities", Action.view): ("admin", "mzk_manager", "mentor", "student"),
    ("users", Action.manage): ("admin",),
    ("users", Action.view): ("admin", "mzk_manager", "mentor"),
    ("workspace", Action.view): ("admin", "mzk_manager", "mentor"),
}


class ExpectedAccessTests(unittest.TestCase):
    def test_registry_matches_the_expected_table(self) -> None:
        for (resource, action), allowed in EXPECTED_ACCESS.items():
            for role in ALL_ROLES:
                with self.subTest(resource=resource, action=action.value, role=role.value):
                    self.assertEqual(
                        allows(resource=resource, action=action, role=role),
                        role.value in allowed,
                        f"{resource}/{action.value}: доступ роли {role.value} изменился. "
                        "Если это осознанно — поправь таблицу и объясни в описании коммита.",
                    )

    def test_table_covers_every_rule(self) -> None:
        # Новое правило без строки в таблице означало бы доступ, который никто
        # не пришпилил, — ровно то состояние, из которого мы уходим.
        missing = {r.key for r in RULES} - set(EXPECTED_ACCESS)
        self.assertEqual(missing, set(), f"Правила без ожидания в таблице: {sorted(missing)}")

    def test_table_has_no_stale_rows(self) -> None:
        extra = set(EXPECTED_ACCESS) - {r.key for r in RULES}
        self.assertEqual(extra, set(), f"Ожидания для несуществующих правил: {sorted(extra)}")


class ScopePinningTests(unittest.TestCase):
    """Скоуп из реестра стал влиять на поведение — значит, пришпилен как и роли.

    `students._can_see_student` больше не выписывает набор ролей у себя, а
    спрашивает реестр: `scope_for(students/view)`. Опечатка в объявлении скоупа
    теперь открывает ментору всех студентов, поэтому объявление проверяется.
    """

    def test_students_view_scope(self) -> None:
        expected = {
            UserRole.admin: Scope.all,
            UserRole.mzk_manager: Scope.all,
            UserRole.mentor: Scope.assigned,
            UserRole.student: Scope.own,
        }
        for role, scope in expected.items():
            with self.subTest(role=role.value):
                self.assertIs(
                    scope_for(resource="students", action=Action.view, role=role), scope
                )

    def test_mentor_is_never_unscoped_on_student_data(self) -> None:
        # Ментор, получивший Scope.all на карточках студентов, видит всю базу.
        for resource in ("students", "documents", "meetings", "roadmaps", "tasks"):
            with self.subTest(resource=resource):
                self.assertIsNot(
                    scope_for(resource=resource, action=Action.view, role=UserRole.mentor),
                    Scope.all,
                )

    def test_student_is_always_scoped_to_own(self) -> None:
        for resource in ("students", "documents", "meetings", "roadmaps", "tasks",
                         "applications", "questionnaires", "credentials"):
            with self.subTest(resource=resource):
                self.assertIs(
                    scope_for(resource=resource, action=Action.view, role=UserRole.student)
                    if (resource, Action.view) in EXPECTED_ACCESS
                    else Scope.own,
                    Scope.own,
                )


class SensitiveResourceTests(unittest.TestCase):
    """Отдельно — то, где ошибка стоит дороже всего.

    Эти проверки дублируют таблицу намеренно: строку в большом словаре легко
    поправить не глядя, а именованный тест про ПДн заставляет остановиться.
    """

    def test_student_never_reaches_staff_only_resources(self) -> None:
        for resource in (
            "guardians", "confidential_notes", "finances", "contracts",
            "users", "audit", "security_incidents", "refund_cases",
            "mentor_rewards", "mzk_quality", "workspace", "export",
        ):
            for action in (Action.view, Action.manage):
                with self.subTest(resource=resource, action=action.value):
                    self.assertFalse(
                        allows(resource=resource, action=action, role=UserRole.student)
                    )

    def test_only_admin_manages_users_audit_and_agreements(self) -> None:
        for resource, action in (
            ("users", Action.manage),
            ("audit", Action.view),
            ("agreements", Action.manage),
        ):
            for role in (UserRole.mzk_manager, UserRole.mentor, UserRole.student):
                with self.subTest(resource=resource, role=role.value):
                    self.assertFalse(allows(resource=resource, action=action, role=role))

    def test_mentor_cannot_write_finances(self) -> None:
        self.assertFalse(allows(resource="finances", action=Action.manage, role=UserRole.mentor))


if __name__ == "__main__":
    unittest.main()
