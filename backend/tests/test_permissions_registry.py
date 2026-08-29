"""Свойства реестра прав (app/core/permissions.py).

Ради чего тест
--------------
Реестр — то самое место, где одна опечатка запирает вход всем сразу либо
наоборот открывает раздел с ПДн. Поэтому проверяются не только решения по
ролям, но и структурные свойства, которые легко сломать незаметно:

* незнакомая пара «ресурс + действие» обязана ОТКАЗЫВАТЬ, а не пропускать —
  реестр, молча пропускающий неописанное, бесполезен как гарантия;
* форма отказа (403 против 404) — часть правила: 404 отдаётся там, где чужой
  объект не должен подтверждать факт своего существования;
* у ресурсов с условной логикой обязаны быть заполнены `extra_rules`, иначе
  матрица начнёт показывать неполную правду, ничем этого не выдав;
* `basis` заполняется только настоящими ссылками из кода — выдуманный номер
  пункта регламента хуже пустого поля.

БД не нужна: весь модуль — чистые функции над неизменяемыми данными.
"""
import re
import unittest
import uuid

from fastapi import HTTPException

from app.core.permissions import (
    ADMIN,
    CONDITIONAL_RESOURCES,
    MANAGERS,
    STAFF,
    Action,
    Rule,
    RULES,
    Scope,
    all_rules,
    allows,
    require_access,
    resources,
    rule_for,
    scope_for,
)
from app.models.user import User, UserRole

ALL_ROLES = (UserRole.admin, UserRole.mzk_manager, UserRole.mentor, UserRole.student)


def _user(role: UserRole) -> User:
    return User(id=uuid.uuid4(), role=role)


class StructureTests(unittest.TestCase):
    def test_no_duplicate_rules(self) -> None:
        keys = [r.key for r in RULES]
        duplicates = {k for k in keys if keys.count(k) > 1}
        self.assertEqual(duplicates, set(), f"Дублирующиеся правила: {duplicates}")

    def test_every_rule_grants_someone(self) -> None:
        # Правило без ролей — мёртвая строка: раздел закрыт для всех, включая
        # админа, и это почти наверняка опечатка, а не решение.
        for rule in RULES:
            with self.subTest(rule=f"{rule.resource}/{rule.action.value}"):
                self.assertTrue(rule.roles, "правило не даёт доступа никому")

    def test_admin_is_never_locked_out_of_management(self) -> None:
        # Заперев админа, систему нельзя починить из интерфейса.
        for rule in RULES:
            if rule.action in (Action.manage, Action.edit):
                with self.subTest(rule=f"{rule.resource}/{rule.action.value}"):
                    self.assertIn(UserRole.admin, rule.roles)

    def test_role_sets_are_the_shared_constants(self) -> None:
        # Смысл реестра в том, что кортеж (admin, МЗК, ментор) существует в
        # одном экземпляре, а не в десяти копиях под пятью именами, как было.
        self.assertEqual(STAFF, frozenset({UserRole.admin, UserRole.mzk_manager, UserRole.mentor}))
        self.assertEqual(MANAGERS, frozenset({UserRole.admin, UserRole.mzk_manager}))
        self.assertEqual(ADMIN, frozenset({UserRole.admin}))

    def test_rules_are_immutable(self) -> None:
        with self.assertRaises(Exception):
            RULES[0].roles = frozenset()  # type: ignore[misc]


class DecisionTests(unittest.TestCase):
    def test_unknown_resource_is_denied_for_every_role(self) -> None:
        for role in ALL_ROLES:
            with self.subTest(role=role.value):
                self.assertFalse(
                    allows(resource="ресурс-которого-нет", action=Action.view, role=role)
                )

    def test_unknown_action_on_known_resource_is_denied(self) -> None:
        self.assertFalse(allows(resource="finances", action=Action.delete, role=UserRole.admin))

    def test_require_raises_for_undefined_pair(self) -> None:
        with self.assertRaises(HTTPException) as ctx:
            require_access(_user(UserRole.admin), "ресурс-которого-нет", Action.view)
        self.assertEqual(ctx.exception.status_code, 403)
        self.assertEqual(ctx.exception.headers["X-Error-Code"], "PERMISSION_UNDEFINED")

    def test_require_passes_allowed_role(self) -> None:
        require_access(_user(UserRole.admin), "finances", Action.manage)  # не должно бросить

    def test_require_denies_with_403_and_error_code(self) -> None:
        with self.assertRaises(HTTPException) as ctx:
            require_access(_user(UserRole.student), "finances", Action.manage)
        self.assertEqual(ctx.exception.status_code, 403)
        # Именно FORBIDDEN: на этот код завязан фронт (client.ts:152), который по
        # нему перечитывает профиль после смены роли админом. Контракт пришпилен
        # здесь, чтобы его нельзя было поменять «заодно».
        self.assertEqual(ctx.exception.headers["X-Error-Code"], "FORBIDDEN")

    def test_role_denial_is_always_403_never_404(self) -> None:
        """404 — свойство скоуп-слоя, не проверки роли.

        Первая версия реестра держала форму отказа полем `deny` и проставила
        404 там, где на самом деле его отдаёт require_student_access, увидев
        ментора вне назначений. Отказ по роли 404 не отдаёт никогда: иначе
        «тебе сюда нельзя» неотличимо от «такого объекта нет».
        """
        for resource, action in (
            ("applications", Action.manage),
            ("meetings", Action.manage),
            ("roadmaps", Action.edit),
            ("documents", Action.manage),
            ("student_access", Action.manage),
        ):
            with self.subTest(resource=resource):
                with self.assertRaises(HTTPException) as ctx:
                    require_access(_user(UserRole.student), resource, action)
                self.assertEqual(ctx.exception.status_code, 403)


class ScopeTests(unittest.TestCase):
    def test_scope_defaults_to_all(self) -> None:
        self.assertEqual(
            scope_for(resource="finances", action=Action.manage, role=UserRole.admin),
            Scope.all,
        )

    def test_mentor_is_scoped_to_assigned_students(self) -> None:
        self.assertEqual(
            scope_for(resource="documents", action=Action.manage, role=UserRole.mentor),
            Scope.assigned,
        )

    def test_student_is_scoped_to_own_record(self) -> None:
        self.assertEqual(
            scope_for(resource="documents", action=Action.view, role=UserRole.student),
            Scope.own,
        )

    def test_unknown_pair_reports_all_rather_than_crashing(self) -> None:
        self.assertEqual(
            scope_for(resource="нет-такого", action=Action.view, role=UserRole.mentor),
            Scope.all,
        )


class ConditionalRulesTests(unittest.TestCase):
    """Правила, не влезающие в матрицу, обязаны быть названы.

    Их 22, они остаются кодом — но матрица без пометки «+N доп. правил»
    обещала бы полноту, которой у неё нет.
    """

    def test_conditional_resources_document_their_extra_rules(self) -> None:
        for resource in sorted(CONDITIONAL_RESOURCES):
            with self.subTest(resource=resource):
                rules = [r for r in RULES if r.resource == resource]
                self.assertTrue(rules, f"ресурс {resource} объявлен условным, но правил нет")
                self.assertTrue(
                    any(r.extra_rules for r in rules),
                    f"у {resource} стёрты extra_rules — матрица начнёт врать о полноте",
                )

    def test_extra_rules_point_at_code(self) -> None:
        # Заметка без указателя на файл через полгода бесполезна.
        pointer = re.compile(r"\.(py|tsx?):\d+")
        for rule in RULES:
            for note in rule.extra_rules:
                with self.subTest(rule=f"{rule.resource}/{rule.action.value}"):
                    self.assertRegex(note, pointer, f"нет ссылки на код: {note!r}")


class BasisTests(unittest.TestCase):
    def test_basis_looks_like_a_real_citation(self) -> None:
        # Настоящие ссылки в коде выглядят как «п.7.4», «Регламент МЗК п.3.2»,
        # «Прил. № 3, п. 2.1». Всё остальное — выдумка, а выдуманный пункт
        # регламента хуже пустого поля.
        citation = re.compile(r"(п\.\s?\d+\.\d+|Прил\. № ?\d+)")
        for rule in RULES:
            if rule.basis is None:
                continue
            with self.subTest(rule=f"{rule.resource}/{rule.action.value}"):
                self.assertRegex(rule.basis, citation, f"подозрительная ссылка: {rule.basis!r}")

    def test_some_rules_actually_cite_regulations(self) -> None:
        self.assertGreaterEqual(sum(1 for r in RULES if r.basis), 8)


class ReviewFlagTests(unittest.TestCase):
    def test_known_divergences_are_flagged_for_review(self) -> None:
        # Эти места переносятся как есть, но обязаны быть видны в матрице как
        # «требует решения» — иначе разбор потеряется.
        for resource, action in (
            ("guardians", Action.manage),
            ("contracts", Action.manage),
            ("mentor_assignments", Action.manage),
            ("universities", Action.manage),
            ("scholarships", Action.manage),
        ):
            with self.subTest(resource=resource):
                rule = rule_for(resource, action)
                assert rule is not None
                self.assertTrue(rule.review, f"{resource}: расхождение не помечено")


class SerialisationTests(unittest.TestCase):
    """Эндпоинт матрицы отдаёт наружу именно это — форма важна."""

    def test_all_rules_returns_everything(self) -> None:
        self.assertEqual(len(all_rules()), len(RULES))

    def test_resources_are_unique_and_ordered(self) -> None:
        listed = resources()
        self.assertEqual(len(listed), len(set(listed)))
        self.assertEqual(listed[0], RULES[0].resource)

    def test_registry_is_not_trivially_small(self) -> None:
        # Страховка от вырождения: пустой реестр прошёл бы половину тестов выше.
        self.assertGreaterEqual(len(RULES), 40)
        self.assertGreaterEqual(len(resources()), 30)


if __name__ == "__main__":
    unittest.main()
