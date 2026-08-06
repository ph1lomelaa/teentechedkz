"""Откат задачи внутри завершённого этапа.

Регрессия: ментор, случайно отметивший задачу выполненной, не мог снять
отметку. Инвариант «этап done => все обязательные задачи приняты» проверялся
только при завершении этапа, а обратный переход не рассматривался: этап
оставался `done` с незакрытой обязательной задачей.
"""
import unittest

from app.models.roadmap import RoadmapItemStatus, TaskAudience, TaskPriority
from app.services.roadmap_rules import (
    is_required,
    stage_status_after_task_change,
    task_visible_to_student,
)


class StageCascadeTests(unittest.TestCase):
    def test_unchecking_task_reopens_completed_stage(self):
        """Главная регрессия: снятие отметки возвращает этап в работу."""
        self.assertEqual(
            stage_status_after_task_change(
                stage_status=RoadmapItemStatus.done,
                required_total=3,
                required_done=2,
            ),
            RoadmapItemStatus.in_progress,
        )

    def test_completed_stage_stays_done_while_all_required_are_done(self):
        self.assertEqual(
            stage_status_after_task_change(
                stage_status=RoadmapItemStatus.done,
                required_total=3,
                required_done=3,
            ),
            RoadmapItemStatus.done,
        )

    def test_finishing_last_task_does_not_auto_complete_stage(self):
        """Завершение этапа — решение ментора: там висит проверка на команду."""
        self.assertEqual(
            stage_status_after_task_change(
                stage_status=RoadmapItemStatus.in_progress,
                required_total=2,
                required_done=2,
            ),
            RoadmapItemStatus.in_progress,
        )

    def test_planned_stage_is_untouched(self):
        self.assertEqual(
            stage_status_after_task_change(
                stage_status=RoadmapItemStatus.planned,
                required_total=1,
                required_done=0,
            ),
            RoadmapItemStatus.planned,
        )

    def test_stage_without_required_tasks_stays_done(self):
        """Этап из одних recommended/optional задач не должен переоткрываться."""
        self.assertEqual(
            stage_status_after_task_change(
                stage_status=RoadmapItemStatus.done,
                required_total=0,
                required_done=0,
            ),
            RoadmapItemStatus.done,
        )


class RequiredPriorityTests(unittest.TestCase):
    def test_only_required_counts(self):
        self.assertTrue(is_required(TaskPriority.required))
        self.assertFalse(is_required(TaskPriority.recommended))
        self.assertFalse(is_required(TaskPriority.optional))


class StudentVisibilityTests(unittest.TestCase):
    """Скрытие задач от студента: три независимых условия."""

    def test_plain_applicant_task_is_visible(self):
        self.assertTrue(
            task_visible_to_student(
                audience=TaskAudience.applicant, task_visible=True, stage_visible=True
            )
        )

    def test_hidden_task_is_invisible(self):
        self.assertFalse(
            task_visible_to_student(
                audience=TaskAudience.applicant, task_visible=False, stage_visible=True
            )
        )

    def test_hidden_stage_hides_its_visible_task(self):
        """Скрытый этап прячет всё внутри, даже задачи со своим флагом true."""
        self.assertFalse(
            task_visible_to_student(
                audience=TaskAudience.applicant, task_visible=True, stage_visible=False
            )
        )

    def test_coordinator_task_stays_internal(self):
        """Прежнее правило не сломано: внутренние задачи студенту не видны."""
        self.assertFalse(
            task_visible_to_student(
                audience=TaskAudience.coordinator, task_visible=True, stage_visible=True
            )
        )


if __name__ == "__main__":
    unittest.main()
