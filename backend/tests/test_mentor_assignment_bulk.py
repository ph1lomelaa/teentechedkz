"""Массовое назначение ответственных: почему частичный успех обязателен.

Ради чего тест
--------------
Назначить ответственного раньше можно было только внутри карточки студента, и
на распределении набора это десятки переходов — на практике ответственные
просто не проставлялись. Массовая ручка убирает эту работу, но приносит с собой
неочевидное требование.

Замена уже назначенного специалиста требует причины (это правило старше и
осмысленное: замена пишется в историю). В пачке из двадцати студентов один-два
обычно уже с ответственным. Если отказывать всей пачке, массовое назначение
бесполезно ровно в том случае, ради которого его завели, — при разборе базы,
где часть студентов уже разобрана.

Поэтому `_assign_one` возвращает исход, а не бросает исключение, и такие
студенты уезжают в `skipped`, откуда фронт переспрашивает причину.

БД здесь нет (в проекте нет фикстур с ней): проверяется ветвление на
подменённой сессии.
"""
import asyncio
import unittest
import uuid

import inspect
import re

from fastapi import HTTPException

from app.api.v1.endpoints import roadmaps
from app.api.v1.endpoints.mentor_assignments import (
    MAX_BULK_ASSIGN,
    _assign_one,
    _load_assignable_mentor,
)
from app.models.mentor_assignment import MentorAssignment, MentorRole
from app.models.mentor_assignment_history import MentorAssignmentHistory
from app.models.user import User, UserRole


class _Result:
    def __init__(self, row):
        self._row = row

    def scalar_one_or_none(self):
        return self._row

    def scalars(self):
        return self

    def first(self):
        return self._row

    def all(self):
        # Ответ может быть списком — так задаются двойники в одной роли.
        if isinstance(self._row, list):
            return self._row
        return [self._row] if self._row is not None else []


class FakeSession:
    """Отдаёт заранее заданные ответы на три SELECT'а внутри `_assign_one`.

    Порядок фиксирован самой функцией: сначала назначение НА ТОГО ЖЕ
    специалиста, затем активное назначение этой роли на другого, затем
    «требуется, но не назначен» (assignment_status == "required").
    """

    def __init__(self, same=None, active=None, required=None):
        self._answers = [same, active, required]
        self.added = []
        self.queries = 0

    async def execute(self, _query):
        self.queries += 1
        return _Result(self._answers.pop(0) if self._answers else None)

    def add(self, obj):
        self.added.append(obj)

    async def flush(self):
        """`_assign_one` сбрасывает снятие прежних до вставки нового: иначе
        SQLAlchemy сделала бы INSERT раньше UPDATE и уникальный индекс на
        (student_id, role) отклонил бы штатную замену. Здесь достаточно
        заглушки — порядок SQL фейк не моделирует."""


def _existing(mentor_id):
    ma = MentorAssignment(
        student_id=uuid.uuid4(),
        mentor_id=mentor_id,
        role=MentorRole.lead,
        is_active=True,
        assignment_status="active",
    )
    return ma


def _call(session, *, reason="", student_id=None, mentor_id=None, role=MentorRole.lead):
    return asyncio.run(
        _assign_one(
            session,
            student_id=student_id or uuid.uuid4(),
            mentor_id=mentor_id or uuid.uuid4(),
            role=role,
            replacement_reason=reason,
            actor_id=uuid.uuid4(),
            assignment_status="active",
        )
    )


class AssignOneTests(unittest.TestCase):
    def test_free_student_gets_a_new_assignment(self) -> None:
        session = FakeSession()
        outcome, ma = _call(session)

        self.assertEqual(outcome, "created")
        self.assertIn(ma, session.added)
        self.assertTrue(ma.is_active)

    def test_replacement_without_a_reason_is_reported_not_raised(self) -> None:
        # Ключевая проверка: именно исход, а не исключение, — иначе один такой
        # студент уронил бы всю пачку вместе с корректными назначениями.
        session = FakeSession(active=_existing(uuid.uuid4()))
        outcome, ma = _call(session, reason="")

        self.assertEqual(outcome, "needs_reason")
        self.assertIsNone(ma)
        self.assertEqual(session.added, [], "ничего не должно быть записано")

    def test_replacement_with_a_reason_writes_history(self) -> None:
        previous_mentor = uuid.uuid4()
        previous = _existing(previous_mentor)
        session = FakeSession(active=previous)
        new_mentor = uuid.uuid4()

        outcome, ma = _call(session, reason="  ушёл в отпуск  ", mentor_id=new_mentor)

        self.assertEqual(outcome, "replaced")
        self.assertFalse(previous.is_active, "прежний ответственный остался активным")
        self.assertEqual(previous.assignment_status, "replaced")

        history = [x for x in session.added if isinstance(x, MentorAssignmentHistory)]
        self.assertEqual(len(history), 1, "замена без следа в истории")
        self.assertEqual(history[0].previous_mentor_id, previous_mentor)
        self.assertEqual(history[0].replacement_mentor_id, new_mentor)
        self.assertEqual(history[0].reason, "ушёл в отпуск", "причина не обрезана")
        self.assertIsNotNone(ma)

    def test_same_mentor_twice_does_not_duplicate(self) -> None:
        """Повторное назначение того же специалиста — no-op, а не вторая строка.

        Уникального индекса на (student_id, mentor_id, role) в схеме нет, а
        поиск «прежнего» идёт с условием `mentor_id != mentor_id` и того же
        ментора не видит. Без отдельной проверки повторное назначение молча
        писало вторую строку, и в «Ответственных» ментор двоился. С массовым
        назначением («выделить всех и назначить») это стало обычным случаем,
        а не редкой ошибкой.
        """
        mentor_id = uuid.uuid4()
        existing = _existing(mentor_id)
        session = FakeSession(same=existing)

        outcome, ma = _call(session, mentor_id=mentor_id)

        self.assertEqual(outcome, "already")
        self.assertIs(ma, existing)
        self.assertEqual(session.added, [], "создана вторая строка назначения")

    def test_previously_removed_mentor_is_reactivated(self) -> None:
        # «Взял → снял → назначили заново» должно вернуть ту же строку, а не
        # завести вторую на того же человека. Так же ведёт себя `assign_self`.
        mentor_id = uuid.uuid4()
        removed = _existing(mentor_id)
        removed.is_active = False
        removed.assignment_status = "replaced"
        session = FakeSession(same=removed)

        outcome, ma = _call(session, mentor_id=mentor_id)

        self.assertEqual(outcome, "created")
        self.assertIs(ma, removed)
        self.assertTrue(ma.is_active)
        self.assertEqual(ma.assignment_status, "active")
        self.assertEqual(session.added, [], "создана вторая строка вместо возврата прежней")

    def test_a_second_country_mentor_is_added_not_swapped_in(self) -> None:
        """Мультироль: назначение никого не снимает и не пишет замену в историю.

        Ученик подаётся в несколько стран, и каждую ведёт свой человек. Пока
        назначение в любой роли означало замену, второго ментора по стране
        нельзя было завести вообще: он вставал вместо первого.

        Проверяем и число запросов: в мультироли «кто сейчас в роли» не
        спрашивается вовсе — именно этот запрос и находил прежнего, чтобы его
        погасить. Без счётчика тест прошёл бы и на старом коде: `FakeSession`
        отвечает по порядку, и лишний запрос просто съел бы чужой ответ.
        """
        session = FakeSession()

        outcome, ma = _call(session, role=MentorRole.country, mentor_id=uuid.uuid4())

        self.assertEqual(outcome, "created", "добавление превратилось в замену")
        self.assertEqual(session.queries, 2, "прежние в роли всё ещё разыскиваются")
        self.assertEqual(
            [x for x in session.added if isinstance(x, MentorAssignmentHistory)],
            [],
            "добавление второго не должно писаться в историю как замена",
        )
        self.assertIsNotNone(ma)
        self.assertIn(ma, session.added)

    def test_a_second_country_mentor_needs_no_reason(self) -> None:
        # Причину спрашивают, когда кого-то снимают. Здесь никого не снимают,
        # и требование причины было бы препятствием на ровном месте.
        session = FakeSession()

        outcome, _ = _call(session, role=MentorRole.country, reason="")

        self.assertEqual(outcome, "created")

    def test_a_single_role_still_looks_for_the_current_holder(self) -> None:
        # Зеркало к счётчику выше: в одиночной роли запрос «кто сейчас в роли»
        # обязан остаться, иначе замена перестанет снимать прежнего.
        session = FakeSession()

        _call(session, role=MentorRole.lead)

        self.assertEqual(session.queries, 3)

    def test_single_roles_still_replace(self) -> None:
        # Страховка от расползания: множественность включена адресно, и для
        # ментора по УП назначение обязано остаться заменой.
        previous = _existing(uuid.uuid4())
        session = FakeSession(active=previous)

        outcome, _ = _call(session, role=MentorRole.lead, reason="замена")

        self.assertEqual(outcome, "replaced")
        self.assertFalse(previous.is_active)

    def test_two_active_in_one_role_are_both_replaced(self) -> None:
        # Двойники остались от старого «Добавить себя». Раньше
        # scalar_one_or_none() на них падал с MultipleResultsFound (500), и
        # заменить ответственного у такого студента было нельзя вообще.
        first, second = _existing(uuid.uuid4()), _existing(uuid.uuid4())
        session = FakeSession(active=[first, second])

        outcome, _ = _call(session, reason="разбор двойников")

        self.assertEqual(outcome, "replaced")
        self.assertFalse(first.is_active)
        self.assertFalse(second.is_active)
        history = [x for x in session.added if isinstance(x, MentorAssignmentHistory)]
        self.assertEqual(len(history), 2)

    def test_reactivation_replaces_current_holder(self) -> None:
        # «Сняли Мерей → назначили Аружан → вернули Мерей»: Аружан обязана
        # сняться. Раньше включение прежней строки шло мимо замены, и в роли
        # оказывалось двое активных.
        mentor_id = uuid.uuid4()
        removed = _existing(mentor_id)
        removed.is_active = False
        holder = _existing(uuid.uuid4())
        session = FakeSession(same=removed, active=holder)

        outcome, ma = _call(session, mentor_id=mentor_id, reason="вернули")

        self.assertEqual(outcome, "replaced")
        self.assertIs(ma, removed)
        self.assertTrue(removed.is_active)
        self.assertFalse(holder.is_active)

    def test_placeholder_assignment_is_filled_instead_of_duplicated(self) -> None:
        # Строка «ответственный требуется, но не назначен» должна заполняться,
        # а не соседствовать со второй — иначе у студента два назначения.
        placeholder = MentorAssignment(
            student_id=uuid.uuid4(),
            mentor_id=None,
            role=MentorRole.lead,
            is_active=False,
            assignment_status="required",
        )
        session = FakeSession(required=placeholder)
        mentor_id = uuid.uuid4()

        outcome, ma = _call(session, mentor_id=mentor_id)

        self.assertEqual(outcome, "created")
        self.assertIs(ma, placeholder)
        self.assertEqual(ma.mentor_id, mentor_id)
        self.assertEqual(ma.assignment_status, "active")
        self.assertTrue(ma.is_active)
        self.assertEqual(session.added, [], "placeholder продублирован новой строкой")


class MzkRoleTests(unittest.TestCase):
    """Роль «МЗК»: менеджер как ответственный за студента.

    Ради чего: распределить студентов между менеджерами МЗК было нельзя —
    назначения знали только менторские роли, и менеджер мог лишь «взять на
    себя» одного студента за раз. Роль даёт тот же механизм: массовое
    назначение, историю замен и попадание студента в «Мои студенты» менеджера
    (scope=mine фильтрует по mentor_id назначения, роль пользователя там не
    участвует).
    """

    def test_manager_gets_a_normal_assignment(self) -> None:
        session = FakeSession()
        mentor_id = uuid.uuid4()

        outcome, ma = _call(session, mentor_id=mentor_id, role=MentorRole.mzk)

        self.assertEqual(outcome, "created")
        self.assertEqual(ma.role, MentorRole.mzk)
        self.assertEqual(ma.mentor_id, mentor_id)
        self.assertTrue(ma.is_active)

    def test_mzk_manager_is_assignable(self) -> None:
        manager = User(id=uuid.uuid4(), name="Мерей", email="m@example.kz", role=UserRole.mzk_manager)
        session = FakeSession(same=manager)

        loaded = asyncio.run(_load_assignable_mentor(session, manager.id))

        self.assertIs(loaded, manager)

    def test_student_account_is_still_rejected(self) -> None:
        # Роль расширяет круг назначаемых сотрудников, а не открывает его всем.
        client = User(id=uuid.uuid4(), name="Ученик", email="s@example.kz", role=UserRole.student)
        session = FakeSession(same=client)

        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(_load_assignable_mentor(session, client.id))

        self.assertEqual(ctx.exception.status_code, 422)

    def test_mzk_is_not_part_of_the_required_team(self) -> None:
        """Гейт этапа роадмапа остаётся на четырёх менторских ролях.

        Если добавить сюда «МЗК», у каждого студента без назначенного менеджера
        команда разом станет неполной и этап нельзя будет начать — то есть
        новая роль молча остановит работу по всей базе. Проверяем сам источник:
        множество ролей в `update_stage`.
        """
        source = inspect.getsource(roadmaps.update_stage)
        match = re.search(r"required_roles = \{([^}]*)\}", source)
        self.assertIsNotNone(match, "гейт команды в update_stage переписан — проверьте тест")
        self.assertNotIn("mzk", match.group(1))


class BulkLimitTests(unittest.TestCase):
    def test_batch_size_is_capped(self) -> None:
        # Пачка держит блокировки строк на всё время транзакции; без потолка
        # «выделить всё» превращается в длинную транзакцию на всю базу.
        self.assertGreater(MAX_BULK_ASSIGN, 0)
        self.assertLessEqual(MAX_BULK_ASSIGN, 500)


if __name__ == "__main__":
    unittest.main()
