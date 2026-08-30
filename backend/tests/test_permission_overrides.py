"""Настраиваемые права: переопределения из конструктора.

Ради чего тест
--------------
До этого реестр был константой в коде: чтобы поменять доступ, нужен был
программист и деплой. Теперь состав ролей у правила меняет админ из интерфейса —
и это самая опасная поверхность во всей системе, потому что один вызов способен
и открыть раздел с ПДн, и закрыть вход всем сразу.

Три свойства, которые обязаны держаться:

1. **Запертое правило не переключается.** Сняв право админа на управление
   правами, вернуть его было бы уже нечем: интерфейс закрыт, а других ручек
   нет. Запрет продублирован в двух слоях — в эндпоинте и в `set_overrides`,
   чтобы его нельзя было обойти записью прямо в базу.
2. **Реестр остаётся списком допустимого.** Строка про несуществующее правило
   не должна создавать право из ниоткуда — иначе переименование ресурса
   оставляет висеть правило-призрак, которого никто не проверяет.
3. **Замена, а не дополнение.** Снятое в базе переопределение обязано
   перестать действовать, а не доживать в памяти до перезапуска.

БД не нужна: слой переопределений — чистый словарь, база приносит его снаружи.
"""
import unittest

from app.core import permissions
from app.core.permissions import Action
from app.models.user import UserRole


class OverrideTests(unittest.TestCase):
    def tearDown(self) -> None:
        # Реестр — глобальное состояние процесса. Не убрать за собой значит
        # незаметно поменять расклад для всех остальных тестов.
        permissions.set_overrides({})

    def test_override_changes_the_answer(self) -> None:
        self.assertFalse(permissions.allows(resource="checkins", action=Action.view, role=UserRole.mentor))
        permissions.set_overrides({
            ("checkins", Action.view): frozenset({UserRole.admin, UserRole.mentor}),
        })
        self.assertTrue(permissions.allows(resource="checkins", action=Action.view, role=UserRole.mentor))
        # И снимает у того, кого в новом составе нет.
        self.assertFalse(permissions.allows(resource="checkins", action=Action.view, role=UserRole.mzk_manager))

    def test_empty_set_is_a_legal_value(self) -> None:
        # «Никому» — осмысленная настройка, а не пустой ввод.
        permissions.set_overrides({("checkins", Action.view): frozenset()})
        for role in UserRole:
            with self.subTest(role=role):
                self.assertFalse(permissions.allows(resource="checkins", action=Action.view, role=role))

    def test_clearing_restores_the_code_default(self) -> None:
        permissions.set_overrides({("checkins", Action.view): frozenset({UserRole.mentor})})
        permissions.set_overrides({})
        self.assertTrue(permissions.allows(resource="checkins", action=Action.view, role=UserRole.admin))
        self.assertFalse(permissions.allows(resource="checkins", action=Action.view, role=UserRole.mentor))

    def test_replaces_rather_than_merges(self) -> None:
        permissions.set_overrides({("checkins", Action.view): frozenset({UserRole.mentor})})
        permissions.set_overrides({("students", Action.view): frozenset({UserRole.admin})})
        # Первое переопределение обязано исчезнуть, а не остаться в памяти.
        self.assertNotIn(("checkins", Action.view), permissions.overrides())

    def test_unknown_rule_creates_nothing(self) -> None:
        permissions.set_overrides({("made_up_resource", Action.view): frozenset({UserRole.student})})
        self.assertFalse(
            permissions.allows(resource="made_up_resource", action=Action.view, role=UserRole.student)
        )
        self.assertEqual(permissions.overrides(), {})


class LockedRulesTests(unittest.TestCase):
    """Правила, снятие которых лишает возможности вернуть что-либо обратно."""

    def tearDown(self) -> None:
        permissions.set_overrides({})

    def test_locked_rules_exist_and_are_the_critical_ones(self) -> None:
        locked = {(r.resource, r.action.value) for r in permissions.all_rules() if r.locked}
        self.assertIn(("permissions", "manage"), locked)
        self.assertIn(("permissions", "view"), locked)
        self.assertIn(("users", "manage"), locked)
        self.assertIn(("portal", "view"), locked)

    def test_locked_rule_cannot_be_overridden_through_data(self) -> None:
        # Главная проверка: запрет не должен держаться только на эндпоинте.
        # Строка, дописанная прямо в базу, обязана быть проигнорирована.
        permissions.set_overrides({("permissions", Action.manage): frozenset({UserRole.student})})
        self.assertEqual(permissions.overrides(), {})
        self.assertFalse(
            permissions.allows(resource="permissions", action=Action.manage, role=UserRole.student)
        )
        self.assertTrue(
            permissions.allows(resource="permissions", action=Action.manage, role=UserRole.admin)
        )

    def test_admin_cannot_lose_the_way_back(self) -> None:
        # Попытка закрыть всё разом не должна отобрать у админа настройку прав.
        permissions.set_overrides({
            (rule.resource, rule.action): frozenset()
            for rule in permissions.all_rules()
        })
        self.assertTrue(
            permissions.allows(resource="permissions", action=Action.manage, role=UserRole.admin)
        )
        self.assertTrue(
            permissions.allows(resource="users", action=Action.manage, role=UserRole.admin)
        )


class RegistryStaysThePlaceOfTruthTests(unittest.TestCase):
    def test_scope_is_not_overridable(self) -> None:
        # Конструктор меняет «кому можно», но не «сколько данных видно»:
        # фильтрация живёт в mentor_scope и обязана остаться одна.
        permissions.set_overrides({("students", Action.view): frozenset({UserRole.mentor})})
        try:
            self.assertEqual(
                permissions.scope_for(resource="students", action=Action.view, role=UserRole.mentor).value,
                "assigned",
            )
        finally:
            permissions.set_overrides({})

    def test_module_still_has_no_database(self) -> None:
        import inspect

        source = inspect.getsource(permissions)
        for forbidden in ("AsyncSession", "get_db", "select(", "await "):
            with self.subTest(token=forbidden):
                self.assertNotIn(forbidden, source, "реестр обязан оставаться без БД")


if __name__ == "__main__":
    unittest.main()
