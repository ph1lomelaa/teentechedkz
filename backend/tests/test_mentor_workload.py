"""Просрочки и SLA-нарушения в сводке «Работа команды» (хвост плана ОС, п.9).

Ради чего тест
--------------
Сводка по менторам на /statistics строилась только из нейтральных сигналов —
сколько студентов, задач, непрочитанного телеграма. Регламент ведёт цветовые
санкции ровно за просрочки и SLA-нарушения (task_sla.py), а руководитель по
этой сводке их не видел вовсе: приходилось открывать каждого студента
отдельно, чтобы понять, у кого на самом деле горит.

Арифметика вынесена в чистую функцию (тот же приём, что в task_sla.py и
task_urgency.py) — юнит-тест собирает `grouped`/`summary_by_student` руками, не
трогая БД. Походы за данными (какие два запроса, какое окно у SLA) не
покрыты юнитом — это `_workspace_workload`, тонкая обёртка вокруг этой функции.
"""
import unittest
import uuid

from app.api.v1.endpoints.workspace import _aggregate_mentor_workload

NO_TASKS = {"overdue_yellow": 0, "overdue_orange": 0, "overdue_red": 0, "critical": 0}


def _summary(student_id, *, open_tasks=0, tasks=None, telegram=0, docs=0, ai_drafts=0, warnings=None):
    return {
        "student": {"id": str(student_id)},
        "open_internal_tasks": open_tasks,
        "tasks": tasks or dict(NO_TASKS),
        "next_meeting": None,
        "telegram": {"pending_signals": telegram},
        "documents": {"unverified": docs},
        "notes": {"ai_drafts": ai_drafts},
        "warnings": warnings or [],
    }


def _grouped(mentor_id, *, students, roles=("mentor",)):
    return {
        mentor_id: {
            "mentor": {"id": str(mentor_id), "name": "Тестовый ментор", "role": "mentor"},
            "students": set(students),
            "roles": set(roles),
            "open_tasks": 0,
            "overdue_tasks": 0,
            "upcoming_meetings": 0,
            "telegram_signals": 0,
            "documents_unverified": 0,
            "ai_drafts": 0,
            "health_warnings": 0,
        }
    }


class OverdueAggregationTests(unittest.TestCase):
    def test_sums_all_four_urgency_colors(self):
        # Раньше здесь не было ничего: считать только critical означало бы
        # видеть просрочку на день позже, чем сам студент на своей карточке.
        mentor_id = uuid.uuid4()
        student_id = uuid.uuid4()
        tasks = {"overdue_yellow": 1, "overdue_orange": 2, "overdue_red": 3, "critical": 4}
        summary_by_student = {student_id: _summary(student_id, tasks=tasks)}

        out = _aggregate_mentor_workload(_grouped(mentor_id, students=[student_id]), summary_by_student, {})

        self.assertEqual(out[0]["overdue_tasks"], 10)

    def test_sums_across_several_students_of_the_same_mentor(self):
        mentor_id = uuid.uuid4()
        s1, s2 = uuid.uuid4(), uuid.uuid4()
        summary_by_student = {
            s1: _summary(s1, tasks={**NO_TASKS, "critical": 1}),
            s2: _summary(s2, tasks={**NO_TASKS, "overdue_red": 2}),
        }

        out = _aggregate_mentor_workload(_grouped(mentor_id, students=[s1, s2]), summary_by_student, {})

        self.assertEqual(out[0]["overdue_tasks"], 3)

    def test_student_without_a_summary_does_not_crash(self):
        # Назначение есть, а сводки для студента ещё нет (гонка обхода) —
        # раньше такого случая не было вовсе, стоит закрыть явно.
        mentor_id = uuid.uuid4()
        missing_student = uuid.uuid4()

        out = _aggregate_mentor_workload(_grouped(mentor_id, students=[missing_student]), {}, {})

        self.assertEqual(out[0]["overdue_tasks"], 0)


class SlaPenaltyAggregationTests(unittest.TestCase):
    def test_penalty_count_attaches_to_the_right_mentor(self):
        mentor_a, mentor_b = uuid.uuid4(), uuid.uuid4()
        grouped = {**_grouped(mentor_a, students=[]), **_grouped(mentor_b, students=[])}

        out = _aggregate_mentor_workload(grouped, {}, {mentor_a: 3})

        by_mentor = {row["mentor"]["id"]: row["sla_penalties_this_month"] for row in out}
        self.assertEqual(by_mentor[str(mentor_a)], 3)
        self.assertEqual(by_mentor[str(mentor_b)], 0)

    def test_mentor_without_penalties_this_month_shows_zero_not_missing(self):
        # dict.get(..., 0), а не KeyError — ментор без санкций обязан явно
        # видеть «0», а не выпасть из таблицы или уронить запрос.
        mentor_id = uuid.uuid4()

        out = _aggregate_mentor_workload(_grouped(mentor_id, students=[]), {}, {})

        self.assertEqual(out[0]["sla_penalties_this_month"], 0)


class LoadScoreUnaffectedTests(unittest.TestCase):
    def test_overdue_and_sla_do_not_change_load_score(self):
        # load_score — про распределение нагрузки (сколько всего на менторе),
        # а не про качество работы. Смешивать их значило бы наказывать
        # перегруженного ментора вторым числом за то же самое.
        mentor_id = uuid.uuid4()
        student_id = uuid.uuid4()
        summary_by_student = {student_id: _summary(student_id, tasks={**NO_TASKS, "critical": 5})}

        with_overdue = _aggregate_mentor_workload(
            _grouped(mentor_id, students=[student_id]), summary_by_student, {mentor_id: 7},
        )[0]
        without_overdue = _aggregate_mentor_workload(
            _grouped(mentor_id, students=[student_id]), {student_id: _summary(student_id)}, {},
        )[0]

        self.assertEqual(with_overdue["load_score"], without_overdue["load_score"])


if __name__ == "__main__":
    unittest.main()
