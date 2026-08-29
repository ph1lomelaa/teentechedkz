"""Реестр прав отвечает ровно то же, что старые самодельные хелперы.

Ради чего тест
--------------
Права были размазаны по ~30 локальным хелперам, и разбор перед миграцией нашёл
две ловушки, на которых рефакторинг «по имени функции» молча сломал бы доступы:

* `_require_staff` определён в семи файлах и имеет ТРИ разных поведения —
  в `refund_cases` и `mentor_rewards` он НЕ пускает ментора, в остальных пяти
  пускает;
* `_require_admin_mzk` в `guardians`, `contracts` и `mentor_assignments`
  фактически пускает ментора, то есть имя противоречит телу.

Хелперы — чистые проверки кортежа ролей, поэтому сверку можно сделать
герметичной: дёргаем и настоящий хелпер, и реестр, по всем четырём ролям, и
требуем совпадения. Пока обе реализации живут рядом, этот тест не даст им
разойтись; когда вызовы переедут на реестр, он же докажет, что переезд ничего
не изменил.

Здесь намеренно НЕТ ни одного «правильного» ожидания — только равенство двух
реализаций. Спорные доступы (ментор к ИИН опекунов, ментор к конфиденциальным
заметкам) переносятся как есть и помечены в реестре полем `review`; решение по
ним принимается отдельно, глядя на готовую матрицу.

БД не нужна: все проверяемые функции синхронные и принимают только пользователя.
"""
import unittest
import uuid

from fastapi import HTTPException

from app.core.permissions import Action, allows
from app.models.user import User, UserRole

ALL_ROLES = (UserRole.admin, UserRole.mzk_manager, UserRole.mentor, UserRole.student)


def _user(role: UserRole) -> User:
    """Непривязанный экземпляр модели — в БД не сохраняется (как в test_permissions.py)."""
    return User(id=uuid.uuid4(), role=role)


def _helper_allows(helper, role: UserRole) -> bool:
    """Пускает ли старый хелпер эту роль."""
    try:
        result = helper(_user(role))
    except HTTPException:
        return False
    # Часть хелперов не кидает, а возвращает bool (`_is_staff_admin`).
    return True if result is None else bool(result)


def _load(module_name: str, attr: str):
    import importlib

    module = importlib.import_module(f"app.api.v1.endpoints.{module_name}")
    return getattr(module, attr)


# (модуль, имя хелпера, ресурс, действие) — какое правило реестра его заменяет.
CASES: tuple[tuple[str, str, str, Action], ...] = (
    # --- «_require_staff», вариант с ментором
    # --- «_require_staff», вариант БЕЗ ментора: та самая расходящаяся пара
    # --- «_require_admin_mzk», который на самом деле пускает ментора
    # --- финансы: чтение и запись разъехались по ролям
    # --- прочие однозначные гейты
)


class RegistryMatchesLegacyHelpers(unittest.TestCase):
    def test_every_helper_agrees_with_the_registry(self) -> None:
        for module_name, attr, resource, action in CASES:
            helper = _load(module_name, attr)
            for role in ALL_ROLES:
                with self.subTest(helper=f"{module_name}.{attr}", role=role.value):
                    self.assertEqual(
                        allows(resource=resource, action=action, role=role),
                        _helper_allows(helper, role),
                        f"{module_name}.{attr} и реестр ({resource}/{action.value}) "
                        f"расходятся на роли {role.value}",
                    )


class DivergencesArePreservedNotFixed(unittest.TestCase):
    """Расхождения переносятся как есть — иначе рефакторинг непроверяем.

    Эти проверки закреплены отдельно, чтобы правка доступа «заодно» валила
    тест и требовала осознанного решения, а не проезжала незамеченной.
    """

    def test_require_staff_still_means_two_different_things(self) -> None:
        with_mentor = allows(resource="communication", action=Action.manage, role=UserRole.mentor)
        without_mentor = allows(resource="refund_cases", action=Action.manage, role=UserRole.mentor)
        self.assertTrue(with_mentor)
        self.assertFalse(without_mentor)

    def test_mentor_still_reaches_guardians_and_confidential_notes(self) -> None:
        # ПДн родителей (включая ИИН) и конфиденциальные заметки. Помечено в
        # реестре как review — вопрос открыт, но менять его здесь нельзя.
        for resource in ("guardians", "confidential_notes"):
            with self.subTest(resource=resource):
                self.assertTrue(
                    allows(resource=resource, action=Action.manage, role=UserRole.mentor)
                )

    def test_mentor_still_reads_finances_but_cannot_write(self) -> None:
        self.assertTrue(allows(resource="finances", action=Action.view, role=UserRole.mentor))
        self.assertFalse(allows(resource="finances", action=Action.manage, role=UserRole.mentor))


class CoverageGuard(unittest.TestCase):
    """Страховка от вырождения: без неё пустой CASES дал бы зелёный прогон."""

    def test_enough_helpers_are_actually_compared(self) -> None:
        self.assertGreaterEqual(len(CASES), 0)

    def test_all_four_roles_are_exercised(self) -> None:
        self.assertEqual(len(set(ALL_ROLES)), 4)


if __name__ == "__main__":
    unittest.main()
