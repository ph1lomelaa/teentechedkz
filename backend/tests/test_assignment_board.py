"""Доска распределения: кто из сотрудников ведёт каких студентов.

Ради чего тест
--------------
Назначать ответственных умели, а видеть картину распределения — нет. Из-за
этого распределение выглядело так, будто система его забывает: чтобы понять,
кому достался студент, приходилось перебирать фильтр по одному человеку.

Доска отвечает на вопрос целиком, и у неё три требования, которые легко
потерять при правке:

* колонка сотрудника остаётся, даже когда студентов у него нет — это и ответ
  «кто свободен», и место, куда перетащить карточку;
* студент попадает ровно в одну колонку: доска показывает одну роль за раз,
  иначе человек с тремя ответственными размножился бы по доске и счётчики
  соврали;
* «без ответственного» считается от тех же данных, что и колонки, — иначе
  сумма колонок и «забытых» не сойдётся с базой, и доверия к доске не будет.

БД здесь нет (фикстур с ней в проекте нет): раскладка вынесена в чистую
`_build_board`, ORM остаётся в ручке. Тот же приём, что у
`_aggregate_mentor_workload` в workspace.py.
"""
import asyncio
import unittest
import uuid

from app.api.v1.endpoints.mentor_assignments import _build_board, _mirror_mzk_to_contract
from app.models.mentor_assignment import MentorAssignment, MentorRole
from app.models.user import User, UserRole


class _Student:
    """Минимальный дубль: доске от студента нужны только id и имя."""

    def __init__(self, name: str):
        self.id = uuid.uuid4()
        self.full_name = name
        self.is_archived = False


def _staff(name: str, role: UserRole = UserRole.mzk_manager) -> User:
    return User(id=uuid.uuid4(), name=name, email=f"{uuid.uuid4().hex[:6]}@example.kz", role=role)


def _assignment(student, person, role=MentorRole.mzk, status="active") -> MentorAssignment:
    return MentorAssignment(
        id=uuid.uuid4(),
        student_id=student.id,
        mentor_id=person.id,
        role=role,
        is_active=True,
        assignment_status=status,
    )


def _board(*, rows=(), staff=(), students=(), pipeline=None, role=MentorRole.mzk):
    return _build_board(
        role=role,
        assignment_rows=list(rows),
        staff=list(staff),
        students=list(students),
        pipeline_by_student=pipeline or {},
    )


class BoardShapeTests(unittest.TestCase):
    def test_staff_without_students_still_gets_a_column(self) -> None:
        # Пустая колонка — не мусор: без неё нового сотрудника некуда
        # перетащить, и «кто свободен» не виден.
        free = _staff("Алия")
        board = _board(staff=[free])

        self.assertEqual([c["name"] for c in board["columns"]], ["Алия"])
        self.assertEqual(board["columns"][0]["students"], [])

    def test_student_lands_in_the_column_of_their_responsible(self) -> None:
        zira = _staff("Зира")
        merey = _Student("Мерей А.")
        board = _board(
            rows=[(_assignment(merey, zira), merey, zira)],
            staff=[zira],
            students=[merey],
        )

        column = board["columns"][0]
        self.assertEqual([s["full_name"] for s in column["students"]], ["Мерей А."])
        self.assertEqual(board["unassigned"], [])
        self.assertEqual(board["totals"], {"students": 1, "assigned": 1, "unassigned": 0})

    def test_student_without_this_role_is_reported_as_unassigned(self) -> None:
        zira = _staff("Зира")
        assigned = _Student("Мерей А.")
        forgotten = _Student("Дана К.")
        board = _board(
            rows=[(_assignment(assigned, zira), assigned, zira)],
            staff=[zira],
            students=[assigned, forgotten],
        )

        self.assertEqual([s["full_name"] for s in board["unassigned"]], ["Дана К."])
        self.assertEqual(board["totals"], {"students": 2, "assigned": 1, "unassigned": 1})

    def test_columns_and_unassigned_together_cover_every_student(self) -> None:
        # Главное свойство доски: сумма колонок и «забытых» равна базе. Если оно
        # не держится, доске нельзя верить именно в том вопросе, ради которого
        # её открывают.
        zira, alia = _staff("Зира"), _staff("Алия")
        students = [_Student(f"Студент {i}") for i in range(5)]
        rows = [
            (_assignment(students[0], zira), students[0], zira),
            (_assignment(students[1], zira), students[1], zira),
            (_assignment(students[2], alia), students[2], alia),
        ]
        board = _board(rows=rows, staff=[zira, alia], students=students)

        in_columns = {s["id"] for c in board["columns"] for s in c["students"]}
        in_unassigned = {s["id"] for s in board["unassigned"]}

        self.assertEqual(in_columns & in_unassigned, set(), "студент попал и в колонку, и в забытых")
        self.assertEqual(in_columns | in_unassigned, {str(s.id) for s in students})

    def test_columns_are_sorted_by_name(self) -> None:
        # Порядок обязан быть стабильным: доска перерисовывается после каждого
        # перетаскивания, и прыгающие колонки делают её непригодной.
        board = _board(staff=[_staff("Яна"), _staff("Алия"), _staff("Зира")])

        self.assertEqual([c["name"] for c in board["columns"]], ["Алия", "Зира", "Яна"])

    def test_idle_admin_does_not_take_a_column(self) -> None:
        # Админ назначаем наравне с менторами (_load_assignable_mentor), но
        # студентов постоянно не ведёт: пустая админская колонка висела бы на
        # каждой доске и раздвигала полезные.
        board = _board(staff=[_staff("Амина", UserRole.admin), _staff("Зира")])

        self.assertEqual([c["name"] for c in board["columns"]], ["Зира"])

    def test_admin_with_students_keeps_their_column(self) -> None:
        amina = _staff("Амина", UserRole.admin)
        student = _Student("Мерей А.")
        board = _board(
            rows=[(_assignment(student, amina), student, amina)],
            staff=[amina],
            students=[student],
        )

        self.assertEqual([c["name"] for c in board["columns"]], ["Амина"])

    def test_pipeline_status_reaches_the_card(self) -> None:
        zira = _staff("Зира")
        student = _Student("Мерей А.")
        board = _board(
            rows=[(_assignment(student, zira), student, zira)],
            staff=[zira],
            students=[student],
            pipeline={student.id: "in_progress"},
        )

        self.assertEqual(board["columns"][0]["students"][0]["pipeline_status"], "in_progress")

    def test_card_carries_assignment_id_for_the_drag(self) -> None:
        # Перетаскивание меняет конкретное назначение — без его id фронту
        # пришлось бы искать назначение по (студент, роль) вторым запросом.
        zira = _staff("Зира")
        student = _Student("Мерей А.")
        assignment = _assignment(student, zira)
        board = _board(rows=[(assignment, student, zira)], staff=[zira], students=[student])

        card = board["columns"][0]["students"][0]
        self.assertEqual(card["assignment_id"], str(assignment.id))
        self.assertEqual(card["assignment_status"], "active")

    def test_unassigned_card_has_no_assignment(self) -> None:
        student = _Student("Дана К.")
        board = _board(students=[student])

        self.assertIsNone(board["unassigned"][0]["assignment_id"])
        self.assertIsNone(board["unassigned"][0]["assignment_status"])


class _FakeContractSession:
    """Отдаёт один договор на любой SELECT — в _mirror_mzk_to_contract он один."""

    def __init__(self, contract):
        self._contract = contract

    async def execute(self, _query):
        contract = self._contract

        class _Result:
            def scalar_one_or_none(self):
                return contract

        return _Result()


class _Contract:
    def __init__(self):
        self.mzk_manager_id = None


class MzkMirrorTests(unittest.TestCase):
    """Назначение МЗК обязано доезжать до contracts.mzk_manager_id.

    Источник истины — назначение, но это поле до сих пор читают задачи,
    платежи, telegram и оба нотификатора. Без зеркала назначенный на доске МЗК
    не увидел бы своих студентов там, и распределение снова выглядело бы
    «забытым» — ровно та жалоба, из-за которой доска и появилась.
    """

    def test_assignment_reaches_the_contract(self) -> None:
        contract = _Contract()
        manager_id = uuid.uuid4()

        asyncio.run(_mirror_mzk_to_contract(_FakeContractSession(contract), uuid.uuid4(), manager_id))

        self.assertEqual(contract.mzk_manager_id, manager_id)

    def test_student_without_a_contract_is_not_an_error(self) -> None:
        # Студента заводят до подписания договора — зеркалить некуда, и это
        # обычный случай, а не сбой: доска работает от назначения.
        asyncio.run(_mirror_mzk_to_contract(_FakeContractSession(None), uuid.uuid4(), uuid.uuid4()))


if __name__ == "__main__":
    unittest.main()
