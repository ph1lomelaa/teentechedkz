"""Зоны ответственности: кто ведёт какой участок у ученика.

Ради чего тест
--------------
Раздел заведён, чтобы ответить на вопрос, которого система не понимала: «кто
ведёт встречи именно у этого ученика». У ученика несколько менторов и МЗК, и до
сих пор ответа не было нигде.

Главный риск здесь не в багах выдачи, а в подмене смысла. Через полгода кто-то
захочет «раз уж есть ответственный — пусть остальные не лезут», и добавит
проверку ответственности перед действием. С этого момента отпуск ответственного
останавливает работу, а право перестаёт что-либо значить, потому что решает уже
не оно.

Поэтому файл проверяет два разных класса вещей: расклад зон и — отдельно — что
ответственность нигде не участвует в решении о доступе.

БД не нужна: покрытие и разбор зоны — чистые функции над перечислением.
"""
import inspect
import os
import re
import unittest

from fastapi import HTTPException

from app.api.v1.endpoints import responsibilities as endpoint
from app.models.student_responsibility import ResponsibilityArea
from app.models.user import UserRole

ENDPOINTS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "app", "api", "v1", "endpoints")
SERVICES_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "app", "services")


class AreaCatalogueTests(unittest.TestCase):
    def test_ten_areas_agreed_with_the_product(self) -> None:
        self.assertEqual(
            [area.value for area in endpoint.AREA_ORDER],
            [
                "meetings", "telegram", "notes", "tasks", "roadmap",
                "documents", "portfolio", "applications", "questionnaires", "finance",
            ],
        )

    def test_order_is_the_enum_order(self) -> None:
        # Порядок зон — один на все экраны. Если он разъедется, матрицу
        # «ученики × зоны» станет нельзя читать глазами по строкам.
        self.assertEqual(endpoint.AREA_ORDER, tuple(ResponsibilityArea))

    def test_unknown_area_is_rejected(self) -> None:
        with self.assertRaises(HTTPException) as ctx:
            endpoint._parse_area("meetngs")
        self.assertEqual(ctx.exception.status_code, 422)

    def test_known_area_parses(self) -> None:
        self.assertIs(endpoint._parse_area("roadmap"), ResponsibilityArea.roadmap)

    def test_student_cannot_be_made_responsible(self) -> None:
        # Кабинет — не рабочая роль: участок на него не вешается.
        self.assertNotIn(UserRole.student, endpoint.ASSIGNABLE_ROLES)
        for role in (UserRole.admin, UserRole.mzk_manager, UserRole.mentor):
            self.assertIn(role, endpoint.ASSIGNABLE_ROLES)


class CoverageTests(unittest.TestCase):
    """Пустая зона — это не ошибка, а вопрос без ответа. Их и надо видеть."""

    def test_nothing_assigned(self) -> None:
        coverage = endpoint._coverage({})
        self.assertEqual(coverage["covered"], 0)
        self.assertEqual(len(coverage["missing_areas"]), 10)
        self.assertFalse(coverage["is_complete"])

    def test_partially_assigned(self) -> None:
        coverage = endpoint._coverage({"meetings": {}, "tasks": {}})
        self.assertEqual(coverage["covered"], 2)
        self.assertEqual(coverage["covered_areas"], ["meetings", "tasks"])
        self.assertNotIn("meetings", coverage["missing_areas"])
        self.assertIn("roadmap", coverage["missing_areas"])
        self.assertFalse(coverage["is_complete"])

    def test_fully_assigned(self) -> None:
        coverage = endpoint._coverage({area.value: {} for area in ResponsibilityArea})
        self.assertEqual(coverage["covered"], coverage["total"])
        self.assertEqual(coverage["missing_areas"], [])
        self.assertTrue(coverage["is_complete"])

    def test_missing_keeps_the_declared_order(self) -> None:
        # Список пустых зон читают глазами — вразнобой он бесполезен.
        coverage = endpoint._coverage({"telegram": {}})
        self.assertEqual(coverage["missing_areas"][0], "meetings")
        self.assertEqual(coverage["missing_areas"][-1], "finance")


class GatesUseTheRegistryTests(unittest.TestCase):
    def test_reads_require_view(self) -> None:
        for name in ("list_areas", "my_responsibilities", "student_responsibilities", "responsibilities_overview"):
            with self.subTest(handler=name):
                source = inspect.getsource(getattr(endpoint, name))
                self.assertIn('require_access(current_user, "responsibilities", Action.view)', source)

    def test_writes_require_manage(self) -> None:
        for name in ("assign_responsibility", "clear_responsibility"):
            with self.subTest(handler=name):
                source = inspect.getsource(getattr(endpoint, name))
                self.assertIn('require_access(current_user, "responsibilities", Action.manage)', source)

    def test_every_handler_is_scoped_or_explicitly_not(self) -> None:
        # Всё, что адресует конкретного ученика, обязано пройти через скоуп —
        # иначе ментор дотянется до чужого ученика по прямому id.
        for name in ("student_responsibilities", "assign_responsibility", "clear_responsibility"):
            with self.subTest(handler=name):
                source = inspect.getsource(getattr(endpoint, name))
                self.assertIn("require_student_access", source)


class ResponsibilityNeverGatesAccessTests(unittest.TestCase):
    """Главное свойство раздела — и единственное, что легко потерять.

    Ответственность вешает табличку с именем; дверь открывает право. Если
    ответственность начнёт запрещать, отпуск ответственного остановит работу, а
    право перестанет что-либо решать.
    """

    def _sources(self) -> list[tuple[str, str]]:
        out = []
        for directory in (ENDPOINTS_DIR, SERVICES_DIR):
            for filename in sorted(os.listdir(directory)):
                if not filename.endswith(".py") or filename == "__init__.py":
                    continue
                if filename == "responsibilities.py":
                    continue  # сам раздел, он и обязан работать с таблицей
                with open(os.path.join(directory, filename), encoding="utf-8") as handle:
                    out.append((filename, handle.read()))
        return out

    def test_no_other_module_reads_the_table(self) -> None:
        offenders = [name for name, src in self._sources() if "StudentResponsibility" in src]
        self.assertEqual(
            offenders,
            [],
            "Ответственность попала в чужой модуль. Если это проверка доступа — "
            "её нельзя: право решает, кому можно, а ответственность только "
            "показывает, чей это участок. См. models/student_responsibility.py: "
            + ", ".join(offenders),
        )

    def test_no_permission_check_mentions_responsibility(self) -> None:
        # Второй заход к тому же: отказ, объяснённый ответственностью.
        #
        # Паттерн намеренно с «responsibilit», а не «responsib»: в students.py
        # давно живёт своё `responsibles` — это специализации менторов из
        # mentor_assignments (ментор по IELTS, по визе), совсем другая сущность.
        # Слова похожи, смысл разный, и широкий паттерн ловил именно её.
        pattern = re.compile(r"(403|404).{0,120}responsibilit", re.IGNORECASE | re.DOTALL)
        offenders = [name for name, src in self._sources() if pattern.search(src)]
        self.assertEqual(offenders, [], f"Отказ по ответственности: {offenders}")

    def test_registry_does_not_know_about_responsibility_holders(self) -> None:
        from app.core import permissions

        source = inspect.getsource(permissions)
        self.assertNotIn("StudentResponsibility", source)
        self.assertNotIn("ResponsibilityArea", source)


if __name__ == "__main__":
    unittest.main()
