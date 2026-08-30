"""Каждое правило реестра должно кем-то проверяться.

Ради чего тест
--------------
В `deps.py` жила вторая система прав — `PERMISSIONS`, `ROLE_PERMISSIONS`,
`has_permission`, `require_permission`. Она умерла тихо: два права из шести не
вызывались ниоткуда вообще, и заметить это можно было только вручную. Права
удалили в конце Этапа 1, а саму систему — 30.08.2026, перенеся четыре
оставшихся операционных права в реестр.

Мёртвое право опаснее отсутствующего: матрица показывает строку, админ на неё
рассчитывает, а код никогда её не спрашивает. Раньше этот файл сторожил четыре
права; теперь — все 55 ресурсов реестра.

БД не нужна: разбор исходников плюс чистые функции реестра.
"""
import ast
import os
import unittest

from app.core import permissions

ENDPOINTS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "app", "api", "v1", "endpoints")

# Функции реестра, вызов которых считается «ресурс используется».
_REGISTRY_CALLS = frozenset({"require_access", "allows", "scope_for", "rule_for"})

# Ресурсы, закрытые не вызовом, а зависимостью на роутере. Список именной,
# чтобы под этим предлогом нельзя было оставить в реестре мёртвую строку.
ROUTER_GUARDED = {
    # audit.py:15 — APIRouter(..., dependencies=[AdminOnly]) на весь модуль.
    "audit",
}


def _resources_used_by_endpoints() -> set[str]:
    """Строковые литералы, переданные в функции реестра.

    Разбор через ast, а не регуляркой: ресурс нередко выбирается тернарником
    (`tasks.py:191` — назначение ментору или МЗК), и оба исхода обязаны
    считаться использованными.
    """
    used: set[str] = set()
    for filename in sorted(os.listdir(ENDPOINTS_DIR)):
        if not filename.endswith(".py"):
            continue
        with open(os.path.join(ENDPOINTS_DIR, filename), encoding="utf-8") as handle:
            tree = ast.parse(handle.read())
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            func = node.func
            name = func.attr if isinstance(func, ast.Attribute) else getattr(func, "id", None)
            if name not in _REGISTRY_CALLS:
                continue
            for argument in list(node.args) + [kw.value for kw in node.keywords]:
                used.update(
                    inner.value
                    for inner in ast.walk(argument)
                    if isinstance(inner, ast.Constant) and isinstance(inner.value, str)
                )
    return used


class EveryRuleIsEnforcedTests(unittest.TestCase):
    def test_no_resource_is_dead(self) -> None:
        dead = sorted(set(permissions.resources()) - _resources_used_by_endpoints() - ROUTER_GUARDED)
        self.assertEqual(
            dead,
            [],
            "Ресурс объявлен в реестре, но ниоткуда не проверяется. Матрица "
            "покажет строку, которую код не спрашивает — удали правило или "
            "вызови require_access: " + ", ".join(dead),
        )

    def test_router_guarded_list_stays_short(self) -> None:
        # Исключение — это дыра в проверке. Их должно быть видно по пальцам.
        self.assertLessEqual(len(ROUTER_GUARDED), 3)

    def test_router_guarded_resources_really_exist(self) -> None:
        # Устаревшее исключение молча ослабляет тест.
        for resource in ROUTER_GUARDED:
            with self.subTest(resource=resource):
                self.assertIn(resource, permissions.resources())


class OperationalPermissionsMovedTests(unittest.TestCase):
    """Четыре операционных права переехали в реестр — расклад сохранён."""

    def test_second_permission_system_is_gone(self) -> None:
        from app.core import deps

        for name in ("PERMISSIONS", "ROLE_PERMISSIONS", "has_permission", "require_permission"):
            with self.subTest(symbol=name):
                self.assertFalse(
                    hasattr(deps, name),
                    f"deps.{name} вернулся — систем прав снова две",
                )

    def test_roles_carried_over_unchanged(self) -> None:
        from app.models.user import UserRole

        expected = {
            "tasks_assign_mentor": {UserRole.admin, UserRole.mzk_manager},
            "tasks_assign_mzk": {UserRole.admin, UserRole.mzk_manager},
            "tasks_accept_result": {UserRole.admin, UserRole.mzk_manager},
            # Единственное, что было и у ментора.
            "tasks_deadlines": {UserRole.admin, UserRole.mzk_manager, UserRole.mentor},
        }
        for resource, roles in expected.items():
            with self.subTest(resource=resource):
                rule = permissions.rule_for(resource, permissions.Action.manage)
                self.assertIsNotNone(rule)
                self.assertEqual(set(rule.roles), roles)

    def test_refusal_shape_is_unchanged(self) -> None:
        # На X-Error-Code завязан фронт; смена кода — молчаливая поломка
        # обработчика ошибок, а не косметика.
        for resource in ("tasks_assign_mentor", "tasks_assign_mzk", "tasks_accept_result", "tasks_deadlines"):
            with self.subTest(resource=resource):
                rule = permissions.rule_for(resource, permissions.Action.manage)
                self.assertEqual(rule.error_code, "PERMISSION_REQUIRED")


if __name__ == "__main__":
    unittest.main()
