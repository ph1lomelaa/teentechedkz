"""Имя, которое никогда не было определено, не должно доезжать до прода.

Ради чего тест
--------------
При добавлении скоуп-проверки в `PATCH /students/{id}` вызов
`require_student_access` был написан, а импорт — забыт. Все 441 тест остались
зелёными: эндпоинты покрыты проверками реестра и формы, но не вызовами, а
`NameError` в Python возникает только при исполнении. В проде это был бы 500 на
каждой правке карточки ученика.

У бэкенда нет линтера вообще — ни ruff, ни flake8, ни mypy; в CI линтуется
только фронт. То есть целый класс ошибок здесь ловился исключительно тем,
что кто-то откроет страницу.

Проверка построена на `symtable` из стандартной библиотеки — новых зависимостей
не нужно. Она сознательно узкая: только «имя используется, но нигде в модуле не
определено и не является встроенным». Это ровно F821 у pyflakes и самая дорогая
из ошибок, которые статически видны.
"""
import builtins
import os
import symtable
import unittest

BACKEND = os.path.dirname(os.path.dirname(__file__))
CHECKED_DIRS = (
    os.path.join(BACKEND, "app", "api", "v1", "endpoints"),
    os.path.join(BACKEND, "app", "services"),
    os.path.join(BACKEND, "app", "core"),
)

BUILTIN_NAMES = set(dir(builtins))

# Имена, которые интерпретатор подставляет сам и в symtable выглядят свободными.
IMPLICIT = {"__class__", "__file__", "__name__", "__doc__", "__package__"}


def _undefined_in(path: str) -> set[str]:
    with open(path, encoding="utf-8") as handle:
        source = handle.read()
    table = symtable.symtable(source, path, "exec")
    found: set[str] = set()

    def visit(scope: symtable.SymbolTable, outer: set[str]) -> None:
        # Имена, объявленные в этой области: присваивания, параметры, импорты.
        declared = outer | {
            sym.get_name()
            for sym in scope.get_symbols()
            if sym.is_assigned() or sym.is_parameter() or sym.is_imported()
        }
        for sym in scope.get_symbols():
            name = sym.get_name()
            if not sym.is_referenced():
                continue
            if sym.is_assigned() or sym.is_parameter() or sym.is_imported():
                continue
            if name in declared or name in BUILTIN_NAMES or name in IMPLICIT:
                continue
            found.add(name)
        for child in scope.get_children():
            visit(child, declared)

    visit(table, set())
    return found


class NoUndefinedNamesTests(unittest.TestCase):
    def test_every_used_name_is_defined(self) -> None:
        offenders: dict[str, set[str]] = {}
        for directory in CHECKED_DIRS:
            for filename in sorted(os.listdir(directory)):
                if not filename.endswith(".py"):
                    continue
                path = os.path.join(directory, filename)
                undefined = _undefined_in(path)
                if undefined:
                    offenders[os.path.relpath(path, BACKEND)] = undefined

        self.assertEqual(
            offenders,
            {},
            "Имя используется, но нигде не определено — в проде это NameError. "
            f"Скорее всего забыт импорт: {offenders}",
        )

    def test_the_check_actually_detects_a_missing_import(self) -> None:
        # Тест, который ничего не ловит, хуже отсутствующего: он создаёт
        # ощущение защиты. Проверяем на заведомо сломанном исходнике.
        broken = "def handler():\n    return require_student_access()\n"
        path = os.path.join(BACKEND, "tests", "__probe__.py")
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(broken)
        try:
            self.assertIn("require_student_access", _undefined_in(path))
        finally:
            os.remove(path)


if __name__ == "__main__":
    unittest.main()
