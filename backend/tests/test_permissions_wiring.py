"""Реестр прав должен быть подключён, а не просто существовать.

Ради чего тест
--------------
В `app/core/deps.py` уже был реестр прав — `PERMISSIONS`, `ROLE_PERMISSIONS`,
`has_permission`, `require_permission`. Он прожил без пользы: `require_permission`
вызывается из пяти мест, все в `tasks.py`, а права `manage_users` и
`manage_regulations` не вызываются ниоткуда вообще. Остальные 354 эндпоинта
завели себе по самодельному гейту.

Ровно так реестр умирает второй раз: код пишется, тесты на решения зелёные,
а эндпоинты продолжают проверять роль по-своему — и матрица показывает
красивую неправду.

Этот файл следит за подключением. Приём взят из `test_finance_permissions.py`
(класс `GateWiringTests`): читаем исходник и требуем, чтобы гейт стоял на
маршруте. По мере переезда модулей список `MIGRATED` растёт, а счётчик
самодельных гейтов в `test_ad_hoc_gate_count_only_goes_down` — падает.
"""
import ast
import inspect
import os
import re
import unittest

from app.core import permissions

ENDPOINTS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "app", "api", "v1", "endpoints")

# Паттерн локального гейта: то, что реестр обязан заменить.
_GATE_NAME = re.compile(
    r"^(_?require_|_?assert_|_check_access$|_staff$|_staff_|_is_staff_|_?can_)"
)

# Хелперы, которые вообще не решают по роли: они фильтруют данные (скоуп) или
# валидируют содержимое запроса. Реестр их не заменяет — по решению Этапа 1 скоуп
# остаётся в app/services/mentor_scope.py, пока не сведены два конфликтующих
# определения «мои студенты». Перечислены поимённо, чтобы под этим предлогом
# нельзя было оставить в модуле настоящую проверку роли.
SCOPE_ONLY_HELPERS = frozenset({
    "_require_chat_access",            # доступ к переписке через студента, 404
    "_require_workspace_student",      # скоуп воркспейса
    "_require_approved_change_basis",  # требует поля в теле запроса, не роль
})

# Признак «решения по роли»: сравнение с НАБОРОМ ролей. Именно это и есть право,
# и именно это обязано жить в реестре. Сравнение `role == UserRole.student`
# оставлено законным: это не право, а развилка по владельцу внутри скоупа
# («моя карточка или чужая»).
_ROLE_SET_CHECK = re.compile(r"\.role\s+(?:not\s+)?in\s")
_ROLE_EQ_CHECK = re.compile(r"\.role\s*==")
_REGISTRY_CALL = re.compile(r"\b(require_access|allows)\(")


def _gate_sources() -> list[tuple[str, str, str]]:
    """(модуль, имя гейта, исходник) для всех гейтов в эндпоинтах."""
    out = []
    for filename in sorted(os.listdir(ENDPOINTS_DIR)):
        if not filename.endswith(".py") or filename == "__init__.py":
            continue
        path = os.path.join(ENDPOINTS_DIR, filename)
        src = open(path, encoding="utf-8").read()
        for node in ast.walk(ast.parse(src)):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and _GATE_NAME.match(node.name):
                out.append((filename[:-3], node.name, ast.get_source_segment(src, node) or ""))
    return out


class GatesDelegateToRegistryTests(unittest.TestCase):
    """Главное правило Этапа 1: по роли решает реестр, и только он.

    Счётчик гейтов тут не годится: после миграции хелперы никуда не делись —
    они стали скоуповыми обёртками, которые сами зовут реестр. Считать надо не
    количество, а то, кто принимает решение.
    """

    def test_no_gate_compares_role_against_a_set(self) -> None:
        offenders = [
            f"{mod}.{name}"
            for mod, name, src in _gate_sources()
            if name not in SCOPE_ONLY_HELPERS and _ROLE_SET_CHECK.search(src)
        ]
        self.assertEqual(
            offenders,
            [],
            "Проверка роли по набору живёт мимо реестра — перенеси её в "
            "app/core/permissions.py и вызови require_access(): " + ", ".join(offenders),
        )

    def test_gates_that_branch_on_role_also_consult_the_registry(self) -> None:
        # Развилка «я владелец?» законна, но право на сам раздел всё равно
        # обязано спрашиваться у реестра, а не подразумеваться.
        offenders = [
            f"{mod}.{name}"
            for mod, name, src in _gate_sources()
            if name not in SCOPE_ONLY_HELPERS
            and _ROLE_EQ_CHECK.search(src)
            and not _REGISTRY_CALL.search(src)
        ]
        self.assertEqual(offenders, [], f"Гейты решают по роли без реестра: {offenders}")

    def test_scope_only_helpers_really_have_no_role_logic(self) -> None:
        # Список-исключение не должен стать местом, куда прячут права.
        for mod, name, src in _gate_sources():
            if name not in SCOPE_ONLY_HELPERS:
                continue
            with self.subTest(gate=f"{mod}.{name}"):
                self.assertIsNone(
                    _ROLE_SET_CHECK.search(src),
                    f"{mod}.{name} числится скоуповым, но проверяет роль",
                )

    def test_the_exception_list_stays_small(self) -> None:
        self.assertLessEqual(len(SCOPE_ONLY_HELPERS), 5)


class RegistryApiTests(unittest.TestCase):
    """Форма модуля — на неё опираются и эндпоинты, и матрица."""

    def test_decision_functions_are_pure_and_sync(self) -> None:
        # Асинхронная проверка прав означала бы поход в БД, а вместе с ним —
        # невозможность покрыть расклад тестами без базы. См. deps.py:99.
        for name in ("allows", "scope_for", "rule_for", "require_access"):
            with self.subTest(function=name):
                self.assertFalse(inspect.iscoroutinefunction(getattr(permissions, name)))

    def test_decision_functions_take_primitives(self) -> None:
        # `allows` не должен принимать User/Request/Session — иначе его нельзя
        # вызвать из теста без поднятия половины приложения.
        params = inspect.signature(permissions.allows).parameters
        self.assertEqual(set(params), {"resource", "action", "role"})
        for param in params.values():
            self.assertEqual(param.kind, inspect.Parameter.KEYWORD_ONLY)

    def test_module_does_not_touch_the_database(self) -> None:
        source = inspect.getsource(permissions)
        for forbidden in ("AsyncSession", "get_db", "select(", "await "):
            with self.subTest(token=forbidden):
                self.assertNotIn(forbidden, source, "реестр обязан оставаться без БД")


if __name__ == "__main__":
    unittest.main()
