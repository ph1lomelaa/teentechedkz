"""Удаление сотрудника: почему оно разрешено далеко не всем.

Ради чего тест
--------------
`DELETE /users/{id}` раньше назывался удалением, а только снимал `is_active`.
Мусорные аккаунты («test», приглашения, которыми не воспользовались) копились
навсегда и висели в списках выбора.

Настоящее удаление опасно: на `users.id` около восьмидесяти внешних ключей.
Часть без `ondelete` — там `DELETE` упадёт ошибкой БД. Часть с `CASCADE` — и
вот это хуже: удаление молча унесло бы чекины, оценки ОКК МЗК, штрафы,
вознаграждения, жалобы и переписку, то есть историю по деньгам и регламентам.

Поэтому удаление разрешено ровно тогда, когда стирать нечего. Три вещи, которые
легко потерять при правке:

* набор источников не должен усохнуть — каждый выпавший оттуда становится
  тихо разрешённым удалением с CASCADE за спиной;
* деактивация и удаление обязаны остаться разными ручками с разными именами;
* удалить себя или последнего админа нельзя.

БД здесь нет (фикстур с ней в проекте нет): проверяются реестр источников,
маршруты и текст условий.
"""
import inspect
import unittest

from app.api.v1.endpoints import users
from app.services import user_deletion


class BlockerSourcesTests(unittest.TestCase):
    def test_the_cascade_tables_are_all_covered(self) -> None:
        # Именно эти таблицы стоят с ondelete="CASCADE" на users.id, то есть
        # молча исчезли бы вместе с аккаунтом. Каждая обязана быть блокером.
        tables = {column.parent.class_.__tablename__ for _, column in user_deletion._SOURCES}
        for cascading in (
            "user_checkins",
            "mzk_quality_scores",
            "mzk_reviews",
            "mentor_task_penalties",
            "mentor_stage_rewards",
            "complaints",
        ):
            with self.subTest(table=cascading):
                self.assertIn(cascading, tables, f"{cascading} удалится каскадом незаметно")

    def test_money_and_paperwork_are_covered(self) -> None:
        # Таблицы без ondelete: тут DELETE упал бы ошибкой БД, и пользователь
        # увидел бы 500 вместо объяснения.
        tables = {column.parent.class_.__tablename__ for _, column in user_deletion._SOURCES}
        for restricted in ("contracts", "payments", "documents", "mentor_assignments"):
            with self.subTest(table=restricted):
                self.assertIn(restricted, tables)

    def test_every_label_is_human_readable(self) -> None:
        # Подписи идут прямо в диалог админу, а не в лог.
        for label, _ in user_deletion._SOURCES:
            with self.subTest(label=label):
                self.assertTrue(label.strip())
                self.assertNotIn("_", label, "в диалоге не должно быть имён колонок")

    def test_the_summary_reads_as_a_sentence(self) -> None:
        text = user_deletion.describe_blockers(
            [{"entity": "назначений на студентов", "count": 3}, {"entity": "созданных задач", "count": 12}]
        )
        self.assertEqual(text, "3 назначений на студентов, 12 созданных задач")


class RouteTests(unittest.TestCase):
    @staticmethod
    def _methods(path: str) -> set[str]:
        """Все методы, объявленные на этом пути.

        Не первый совпавший маршрут: на `/users/{user_id}` их три (GET, PATCH,
        DELETE), и `next(...)` отвечал бы про соседа.
        """
        methods: set[str] = set()
        for route in users.router.routes:
            if route.path == path:
                methods |= route.methods
        return methods

    def test_deactivation_moved_off_the_delete_verb(self) -> None:
        # Имя метода обещало удаление, а метод его не делал. Теперь DELETE
        # действительно удаляет, и деактивация обязана быть отдельной ручкой.
        self.assertEqual(self._methods("/users/{user_id}/deactivate"), {"POST"})

    def test_delete_is_a_separate_route(self) -> None:
        self.assertIn("DELETE", self._methods("/users/{user_id}"))

    def test_the_check_is_available_before_pressing_delete(self) -> None:
        # Узнать об отказе из ошибки после подтверждения — худший момент.
        self.assertEqual(self._methods("/users/{user_id}/deletion-check"), {"GET"})

    def test_assignable_is_declared_before_the_id_route(self) -> None:
        # `/users/assignable` совпадает по форме с `/users/{user_id}` — порядок
        # объявления не даёт литеральному пути уехать в user_id.
        paths = [r.path for r in users.router.routes]
        self.assertLess(paths.index("/users/assignable"), paths.index("/users/{user_id}"))


class DeletionGuardsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.source = inspect.getsource(users.delete_user)

    def test_self_deletion_is_refused(self) -> None:
        self.assertIn("current_user.id", self.source)
        self.assertIn("самого себя", self.source)

    def test_the_last_admin_is_protected(self) -> None:
        # Иначе систему некому администрировать: роль себе не выдашь, смена
        # собственной роли запрещена.
        self.assertIn("последний администратор", self.source)

    def test_blockers_are_checked_before_the_delete(self) -> None:
        self.assertLess(
            self.source.index("user_blockers"),
            self.source.index("db.delete"),
            "удаление идёт раньше проверки следов",
        )

    def test_the_refusal_points_at_deactivation(self) -> None:
        # Отказ без выхода — тупик: админ пришёл убрать человека из списков, и
        # это по-прежнему возможно.
        self.assertIn("деактивировать", self.source)

    def test_the_audit_survives_the_row(self) -> None:
        # После DELETE имени и почты в базе не останется — единственный способ
        # ответить «кто был этот id» лежит в meta.
        self.assertIn("record_audit", self.source)
        self.assertIn('"email"', self.source)
