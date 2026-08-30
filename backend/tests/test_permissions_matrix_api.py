"""GET /api/v1/permissions/matrix (Этап 2.1).

Ради чего тест
--------------
Матрица опасна ровно одним: она выглядит убедительно. Страница с галочками
читается как истина, даже когда расходится с поведением — и тогда она хуже, чем
её отсутствие, потому что по ней принимают решения о доступе к ПДн.

Поэтому проверяется не «эндпоинт вернул 200», а два свойства:

* каждая клетка совпадает с тем, что ответит `allows()`/`scope_for()` —
  те же функции, которые пускают или не пускают в эндпоинтах;
* сама матрица закрыта от всех, кроме админа. Расклад прав целиком — это карта
  того, где что лежит; ментору она не положена.

БД не нужна: реестр чистый, а `get_current_user` подменяется целиком — вместе с
его зависимостями (bearer-схема и сессия), поэтому до базы дело не доходит.
"""
import unittest
import uuid

from starlette.testclient import TestClient

from app.core import permissions
from app.core.deps import get_current_user
from app.core.permissions import Action, Scope
from app.main import app
from app.models.user import User, UserRole

ALL_ROLES = (UserRole.admin, UserRole.mzk_manager, UserRole.mentor, UserRole.student)

MATRIX_URL = "/api/v1/permissions/matrix"


def _user(role: UserRole) -> User:
    return User(id=uuid.uuid4(), role=role)


class _MatrixClientCase(unittest.TestCase):
    def _as(self, role: UserRole) -> TestClient:
        app.dependency_overrides[get_current_user] = lambda: _user(role)
        self.addCleanup(app.dependency_overrides.pop, get_current_user, None)
        return TestClient(app)


class MatrixAccessTests(_MatrixClientCase):
    def test_admin_gets_the_matrix(self) -> None:
        response = self._as(UserRole.admin).get(MATRIX_URL)
        self.assertEqual(response.status_code, 200)

    def test_every_other_role_is_denied(self) -> None:
        for role in (UserRole.mzk_manager, UserRole.mentor, UserRole.student):
            with self.subTest(role=role):
                response = self._as(role).get(MATRIX_URL)
                self.assertEqual(response.status_code, 403)
                self.assertEqual(response.headers.get("X-Error-Code"), "FORBIDDEN")

    def test_anonymous_never_reaches_the_registry(self) -> None:
        # Без подмены зависимости запрос упирается в bearer-схему и до БД
        # не доходит — поэтому тест остаётся без базы.
        response = TestClient(app).get(MATRIX_URL)
        self.assertIn(response.status_code, (401, 403))


class MatrixContentTests(_MatrixClientCase):
    def setUp(self) -> None:
        self.payload = self._as(UserRole.admin).get(MATRIX_URL).json()

    def test_every_cell_equals_what_the_registry_answers(self) -> None:
        # Главная проверка файла: матрица обязана быть пересказом решений
        # реестра, а не второй, независимо собранной таблицей.
        for row in self.payload["rules"]:
            action = Action(row["action"])
            for role in ALL_ROLES:
                cell = row["roles"][role.value]
                with self.subTest(resource=row["resource"], action=action, role=role):
                    expected = permissions.allows(
                        resource=row["resource"], action=action, role=role
                    )
                    self.assertEqual(cell["allowed"], expected)

    def test_scope_is_reported_only_where_access_is_granted(self) -> None:
        for row in self.payload["rules"]:
            action = Action(row["action"])
            for role in ALL_ROLES:
                cell = row["roles"][role.value]
                with self.subTest(resource=row["resource"], action=action, role=role):
                    if not cell["allowed"]:
                        # `scope_for` вернул бы `all` — клетка «нельзя, но весь
                        # раздел» читалась бы как разрешение.
                        self.assertIsNone(cell["scope"])
                    else:
                        self.assertEqual(
                            cell["scope"],
                            permissions.scope_for(
                                resource=row["resource"], action=action, role=role
                            ).value,
                        )

    def test_mentor_scope_survives_serialization(self) -> None:
        # Скоуп — второй axis матрицы; если он потеряется, страница покажет
        # ментору «весь раздел» там, где он видит только своих студентов.
        row = next(
            r for r in self.payload["rules"]
            if r["resource"] == "students" and r["action"] == Action.view.value
        )
        self.assertEqual(row["roles"][UserRole.mentor.value]["scope"], Scope.assigned.value)
        self.assertEqual(row["roles"][UserRole.student.value]["scope"], Scope.own.value)
        self.assertEqual(row["roles"][UserRole.admin.value]["scope"], Scope.all.value)

    def test_nothing_from_the_registry_is_dropped(self) -> None:
        self.assertEqual(len(self.payload["rules"]), len(permissions.all_rules()))
        self.assertEqual(self.payload["resources"], list(permissions.resources()))
        self.assertEqual(self.payload["roles"], [role.value for role in ALL_ROLES])
        self.assertEqual(self.payload["actions"], [action.value for action in Action])

    def test_rules_keep_registry_order(self) -> None:
        # Порядок объявления в реестре сгруппирован по доменам (студенты,
        # финансы, задачи...). Страница на него опирается — сортировать нечем.
        self.assertEqual(
            [(row["resource"], row["action"]) for row in self.payload["rules"]],
            [(rule.resource, rule.action.value) for rule in permissions.all_rules()],
        )

    def test_review_marks_and_extra_rules_reach_the_client(self) -> None:
        # Ровно то, ради чего матрица и затевалась: расхождения, сохранённые
        # намеренно, обязаны быть видны, а не утонуть в сериализации.
        flagged = {row["resource"] for row in self.payload["rules"] if row["review"]}
        self.assertIn("guardians", flagged)
        self.assertTrue(
            any(row["extra_rules"] for row in self.payload["rules"]),
            "условные правила потерялись — матрица показывает неполную правду",
        )

    def test_summary_counts_match_the_rules(self) -> None:
        rows = self.payload["rules"]
        self.assertEqual(self.payload["summary"]["rules"], len(rows))
        self.assertEqual(self.payload["summary"]["resources"], len(self.payload["resources"]))
        self.assertEqual(
            self.payload["summary"]["needs_review"],
            sum(1 for row in rows if row["review"]),
        )
        self.assertEqual(
            self.payload["summary"]["rules_with_extra"],
            sum(1 for row in rows if row["extra_rules"]),
        )
        self.assertEqual(
            self.payload["summary"]["extra_rules"],
            sum(len(row["extra_rules"]) for row in rows),
        )


if __name__ == "__main__":
    unittest.main()
