"""Стандартные услуги: почему `ensure_default_services` обязана сбрасывать в БД.

Ради чего тест
--------------
Сессия приложения собрана с `autoflush=False` (core/database.py). Из-за этого
добавленные, но не сброшенные строки не видны собственным же SELECT'ам той же
транзакции. `ensure_default_services` обещает в докстринге идемпотентность —
и без flush это обещание ложное: второй вызов не увидит строк первого и
добавит дубли, а `_apply_intake_services` (sync.py), который делает SELECT по
услуге сразу после, заведёт вторую строку того же типа.

Стоило это 500-й на «Создать студентов из анкет»: падало на
`uq_services_student_service_type` уже при коммите, то есть после того, как
десятки студентов были собраны, — и не создавалось ни одного.

БД здесь не нужна: проверяется контракт функции с сессией, а не SQL. Сессия
подменена ровно настолько, чтобы увидеть порядок вызовов.
"""
import asyncio
import unittest
import uuid

from app.services.default_services import DEFAULT_SERVICE_TYPES, ensure_default_services


class _Result:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


class FakeSession:
    """Минимальная сессия: помнит порядок add/flush и что «видно» в БД.

    `execute` отдаёт только те строки, которые уже сброшены — так же, как
    ведёт себя настоящая сессия с autoflush=False.
    """

    def __init__(self):
        self.pending = []
        self.flushed = []
        self.calls = []

    def add(self, obj):
        self.calls.append("add")
        self.pending.append(obj)

    async def flush(self):
        self.calls.append("flush")
        self.flushed.extend(self.pending)
        self.pending = []

    async def execute(self, _query):
        self.calls.append("execute")
        return _Result([(s.service_type,) for s in self.flushed])


class EnsureDefaultServicesTests(unittest.TestCase):
    def test_created_rows_are_flushed(self) -> None:
        session = FakeSession()
        created = asyncio.run(ensure_default_services(session, uuid.uuid4()))

        self.assertEqual(created, len(DEFAULT_SERVICE_TYPES))
        self.assertEqual(session.pending, [], "строки остались несброшенными")
        self.assertEqual(len(session.flushed), len(DEFAULT_SERVICE_TYPES))
        self.assertEqual(session.calls[-1], "flush", "flush должен идти последним")

    def test_second_call_sees_the_first_and_adds_nothing(self) -> None:
        # Это и есть та самая идемпотентность. Без flush внутри второй вызов
        # не увидел бы строк первого и продублировал бы весь набор.
        session = FakeSession()
        student_id = uuid.uuid4()
        asyncio.run(ensure_default_services(session, student_id))
        created_again = asyncio.run(ensure_default_services(session, student_id))

        self.assertEqual(created_again, 0)
        self.assertEqual(len(session.flushed), len(DEFAULT_SERVICE_TYPES))

    def test_no_flush_when_nothing_created(self) -> None:
        # Лишний flush в чужой транзакции — не бесплатно; когда добавлять
        # нечего, трогать сессию незачем.
        session = FakeSession()
        student_id = uuid.uuid4()
        asyncio.run(ensure_default_services(session, student_id))
        session.calls.clear()
        asyncio.run(ensure_default_services(session, student_id))

        self.assertNotIn("flush", session.calls)


if __name__ == "__main__":
    unittest.main()
