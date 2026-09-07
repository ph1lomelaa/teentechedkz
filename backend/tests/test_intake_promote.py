"""Автосоздание карточек из анкет: решение «создать или отдать человеку».

Ради чего тест
--------------
`promote_new_submissions` теперь вызывается сама после каждого синка Google-форм,
без человека рядом. Единственное, что стоит между ней и дублями в общей базе, —
повторный транслит-матч: анкету, похожую на уже существующего студента, она
обязана НЕ создавать, а пометить кандидатом на ручную привязку.

Отдельно проверяется дедуп внутри одного прогона: две анкеты одного человека
(Пакет и Кейс приходят разными строками) не должны дать две карточки. Раньше
это было безопасно потому, что кнопку жал человек и видел результат; у
автоматики такого предохранителя нет.

БД здесь не нужна: проверяется логика ветвления, а не SQL. Сессия и матчер
подменены ровно настолько, чтобы увидеть принятые решения.
"""
import asyncio
import unittest
import uuid
from dataclasses import dataclass
from unittest import mock

from app.models.intake_submission import IntakeSource, IntakeStatus
from app.services import intake_promote


@dataclass
class _Match:
    student_id: uuid.UUID | None
    confidence: float


class _Submission:
    """Строка анкеты в том виде, в каком её читает promote_new_submissions."""

    def __init__(self, full_name: str, phone: str = "+77000000000"):
        self.id = uuid.uuid4()
        self.source = IntakeSource.cases
        self.full_name = full_name
        self.phone_normalized = phone
        self.status = IntakeStatus.new
        self.suggested_student_id = None
        self.suggested_confidence = None
        self.student_id = None
        self.linked_by = None
        self.linked_at = None


class _Result:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return self

    def all(self):
        return self._rows


class FakeSession:
    def __init__(self, submissions):
        self._submissions = submissions
        self.committed = False

    async def execute(self, _query):
        return _Result(self._submissions)


class _FakeStudent:
    def __init__(self, name):
        self.id = uuid.uuid4()
        self.full_name = name
        self.phone = "+77000000000"
        self.intake_year = 2028
        self.user_id = None


def _run(session, *, matches, created_names):
    """Прогнать promote_new_submissions с подменённым матчером и созданием.

    `matches` — очередь ответов fuzzy_match, по одному на анкету.
    Реальное создание студента подменено: оно уже покрыто e2e и тянет полсхемы.
    """
    def fake_create(_db, submission, actor_id):
        student = _FakeStudent(submission.full_name)
        submission.student_id = student.id
        submission.status = IntakeStatus.linked
        submission.linked_by = actor_id
        created_names.append(submission.full_name)

        async def _noop():
            return student

        return _noop()

    queue = list(matches)

    def fake_fuzzy(_name, _phone, _index):
        return queue.pop(0)

    with mock.patch.object(intake_promote, "create_student_from_intake", fake_create), \
         mock.patch("app.services.sheets_sync.load_students_index", new=_empty_index), \
         mock.patch("migration.transformers.match.fuzzy_match", fake_fuzzy):
        return asyncio.run(intake_promote.promote_new_submissions(session, actor_id=None))


async def _empty_index(_db):
    return []


def _noop_create(created: list[str]):
    """Подмена создания студента, записывающая только факт вызова."""

    def fake_create(_db, submission, actor_id):
        student = _FakeStudent(submission.full_name)
        submission.student_id = student.id
        submission.status = IntakeStatus.linked
        created.append(submission.full_name)

        async def _done():
            return student

        return _done()

    return fake_create


class PromoteNewSubmissionsTests(unittest.TestCase):
    def test_submission_without_candidate_becomes_a_student(self) -> None:
        submission = _Submission("Новый Человек")
        session = FakeSession([submission])
        created: list[str] = []

        counters = _run(session, matches=[_Match(None, 0.0)], created_names=created)

        self.assertEqual(counters, {"created": 1, "skipped": 0, "has_more": False})
        self.assertEqual(created, ["Новый Человек"])
        self.assertEqual(submission.status, IntakeStatus.linked)
        # Автоматический проход не подписывается пользователем — некому.
        self.assertIsNone(submission.linked_by)

    def test_confident_match_is_left_for_a_human(self) -> None:
        submission = _Submission("Уже Есть В Базе")
        session = FakeSession([submission])
        existing_id = uuid.uuid4()
        created: list[str] = []

        counters = _run(
            session, matches=[_Match(existing_id, 0.97)], created_names=created
        )

        self.assertEqual(counters, {"created": 0, "skipped": 1, "has_more": False})
        self.assertEqual(created, [], "дубль создавать нельзя")
        self.assertEqual(submission.suggested_student_id, existing_id)
        self.assertEqual(submission.suggested_confidence, 0.97)
        # Статус остаётся new: анкета ждёт ручной привязки, а не «обработана».
        self.assertEqual(submission.status, IntakeStatus.new)

    def test_match_just_below_threshold_still_creates(self) -> None:
        # Порог намеренно высокий: слабое совпадение — не повод объединять
        # двух разных людей, это дороже лишней карточки.
        submission = _Submission("Похож Но Не Он")
        session = FakeSession([submission])
        created: list[str] = []

        counters = _run(
            session,
            matches=[_Match(uuid.uuid4(), intake_promote.DUPLICATE_CONFIDENCE - 0.01)],
            created_names=created,
        )

        self.assertEqual(counters, {"created": 1, "skipped": 0, "has_more": False})
        self.assertEqual(created, ["Похож Но Не Он"])

    def test_second_form_of_same_person_in_one_run_is_not_duplicated(self) -> None:
        """Пакет и Кейс одного человека приходят двумя строками.

        Первая создаёт карточку, вторая обязана увидеть её в индексе — поэтому
        созданный студент дописывается в `students_index` прямо в цикле.
        """
        first = _Submission("Один Человек")
        second = _Submission("Один Человек")
        session = FakeSession([first, second])
        created: list[str] = []
        seen_index_sizes: list[int] = []

        def fake_fuzzy(_name, _phone, index):
            seen_index_sizes.append(len(index))
            # Второй вызов уже видит карточку, созданную первым.
            if index:
                return _Match(index[-1]["id"], 1.0)
            return _Match(None, 0.0)

        def fake_create(_db, submission, actor_id):
            student = _FakeStudent(submission.full_name)
            submission.student_id = student.id
            submission.status = IntakeStatus.linked
            created.append(submission.full_name)

            async def _noop():
                return student

            return _noop()

        with mock.patch.object(intake_promote, "create_student_from_intake", fake_create), \
             mock.patch("app.services.sheets_sync.load_students_index", new=_empty_index), \
             mock.patch("migration.transformers.match.fuzzy_match", fake_fuzzy):
            counters = asyncio.run(
                intake_promote.promote_new_submissions(session, actor_id=None)
            )

        self.assertEqual(counters, {"created": 1, "skipped": 1, "has_more": False})
        self.assertEqual(created, ["Один Человек"], "второй анкете дубль создавать нельзя")
        self.assertEqual(seen_index_sizes, [0, 1], "созданный студент не попал в индекс")

    def test_run_is_capped_and_says_there_is_more(self) -> None:
        """Проход ограничен потолком, и остаток не выдаётся за пустую очередь.

        Ради первого запуска: в staging лежит весь накопленный backlog, и без
        потолка первый же автоматический проход создал бы разом сотни студентов
        одной транзакцией, без человека рядом. `has_more` не даёт при этом
        показать «всё разобрано».
        """
        # limit=2 при трёх анкетах — фейковая сессия SQL-лимит не применяет,
        # поэтому отдаём ровно столько, сколько отдал бы настоящий запрос.
        session = FakeSession([_Submission("Раз"), _Submission("Два")])
        created: list[str] = []

        with mock.patch.object(intake_promote, "create_student_from_intake", _noop_create(created)), \
             mock.patch("app.services.sheets_sync.load_students_index", new=_empty_index), \
             mock.patch("migration.transformers.match.fuzzy_match", lambda *_: _Match(None, 0.0)):
            counters = asyncio.run(
                intake_promote.promote_new_submissions(session, actor_id=None, limit=2)
            )

        self.assertEqual(counters["created"], 2)
        self.assertTrue(counters["has_more"], "упёрлись в потолок, но очередь показана пустой")

    def test_default_cap_is_sane(self) -> None:
        # Синк идёт каждые SHEETS_SYNC_INTERVAL_SECONDS (по умолчанию 5 минут),
        # поэтому потолок не должен быть настолько мал, чтобы очередь не уходила.
        self.assertGreaterEqual(intake_promote.MAX_PER_RUN, 50)

    def test_commit_is_left_to_the_caller(self) -> None:
        # Синк коммитит вместе со своей работой, ручка — своей. Если бы функция
        # коммитила сама, откатить неудачный промоушен было бы нечем.
        session = FakeSession([_Submission("Кто-то")])
        _run(session, matches=[_Match(None, 0.0)], created_names=[])

        self.assertFalse(session.committed)


if __name__ == "__main__":
    unittest.main()
