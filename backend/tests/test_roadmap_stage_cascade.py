"""Task priority and student visibility rules."""
import unittest

from app.models.roadmap import TaskAudience, TaskPriority
from app.services.roadmap_rules import (
    is_required,
    task_visible_to_student,
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
