"""Правила SLA задач менторов: дедлайн, просрочка, ступени санкций.

Ключевое, что здесь зафиксировано: ожидание подписи регламента не тратит часы
SLA (исполнитель физически заперт гейтом и работать не может), а ступень
санкции «залипает» на последней — четвёртое нарушение остаётся красным, а не
уходит за границу списка.
"""
import unittest
from datetime import datetime, timedelta, timezone

from app.models.student_task import TaskStatus
from app.services.task_sla import (
    compute_sla_due_at,
    is_overdue,
    is_sla_tracked,
    month_bounds,
    needs_reminder,
    parse_ladder,
    penalty_color_for_offence,
)

NOW = datetime(2026, 8, 6, 12, 0, tzinfo=timezone.utc)


class DueDateTests(unittest.TestCase):
    def test_24h_default(self):
        self.assertEqual(
            compute_sla_due_at(created_at=NOW, sla_hours=24), NOW + timedelta(hours=24)
        )

    def test_no_sla_means_no_deadline(self):
        self.assertIsNone(compute_sla_due_at(created_at=NOW, sla_hours=None))
        self.assertIsNone(compute_sla_due_at(created_at=NOW, sla_hours=0))


class TrackingTests(unittest.TestCase):
    def test_open_task_is_tracked(self):
        self.assertTrue(is_sla_tracked(TaskStatus.open))
        self.assertTrue(is_sla_tracked(TaskStatus.in_progress))

    def test_finished_task_is_not_tracked(self):
        for status in (TaskStatus.accepted, TaskStatus.done, TaskStatus.cancelled):
            with self.subTest(status=status):
                self.assertFalse(is_sla_tracked(status))

    def test_agreement_block_pauses_sla(self):
        """Гейт регламента запирает исполнителя — часы капать не должны."""
        self.assertFalse(is_sla_tracked(TaskStatus.awaiting_signature))
        self.assertFalse(is_sla_tracked(TaskStatus.blocked_by_agreement))


class OverdueTests(unittest.TestCase):
    def test_overdue_after_deadline(self):
        self.assertTrue(
            is_overdue(sla_due_at=NOW - timedelta(minutes=1), status=TaskStatus.open, now=NOW)
        )

    def test_not_overdue_before_deadline(self):
        self.assertFalse(
            is_overdue(sla_due_at=NOW + timedelta(hours=1), status=TaskStatus.open, now=NOW)
        )

    def test_done_task_never_overdue(self):
        self.assertFalse(
            is_overdue(sla_due_at=NOW - timedelta(days=3), status=TaskStatus.done, now=NOW)
        )

    def test_task_without_sla_never_overdue(self):
        self.assertFalse(is_overdue(sla_due_at=None, status=TaskStatus.open, now=NOW))


class ReminderTests(unittest.TestCase):
    def test_reminder_inside_window(self):
        self.assertTrue(
            needs_reminder(
                sla_due_at=NOW + timedelta(hours=3), status=TaskStatus.open,
                now=NOW, hours_before=4, already_reminded=False,
            )
        )

    def test_no_reminder_too_early(self):
        self.assertFalse(
            needs_reminder(
                sla_due_at=NOW + timedelta(hours=10), status=TaskStatus.open,
                now=NOW, hours_before=4, already_reminded=False,
            )
        )

    def test_reminder_sent_once(self):
        self.assertFalse(
            needs_reminder(
                sla_due_at=NOW + timedelta(hours=3), status=TaskStatus.open,
                now=NOW, hours_before=4, already_reminded=True,
            )
        )

    def test_no_reminder_when_already_overdue(self):
        self.assertFalse(
            needs_reminder(
                sla_due_at=NOW - timedelta(hours=1), status=TaskStatus.open,
                now=NOW, hours_before=4, already_reminded=False,
            )
        )


class PenaltyLadderTests(unittest.TestCase):
    LADDER = ["yellow", "orange", "red"]

    def test_ladder_progression(self):
        self.assertEqual(penalty_color_for_offence(self.LADDER, 1), "yellow")
        self.assertEqual(penalty_color_for_offence(self.LADDER, 2), "orange")
        self.assertEqual(penalty_color_for_offence(self.LADDER, 3), "red")

    def test_last_step_sticks(self):
        """Четвёртое нарушение не должно уходить за границу списка."""
        self.assertEqual(penalty_color_for_offence(self.LADDER, 4), "red")
        self.assertEqual(penalty_color_for_offence(self.LADDER, 99), "red")

    def test_zero_and_negative_clamp_to_first(self):
        self.assertEqual(penalty_color_for_offence(self.LADDER, 0), "yellow")
        self.assertEqual(penalty_color_for_offence(self.LADDER, -3), "yellow")

    def test_empty_ladder_rejected(self):
        with self.assertRaises(ValueError):
            penalty_color_for_offence([], 1)

    def test_parse_ladder_trims_and_drops_blanks(self):
        self.assertEqual(parse_ladder("yellow, orange ,red"), ["yellow", "orange", "red"])
        self.assertEqual(parse_ladder("yellow,,red"), ["yellow", "red"])


class MonthBoundsTests(unittest.TestCase):
    def test_bounds_cover_the_month(self):
        start, end = month_bounds(NOW)
        self.assertEqual(start, datetime(2026, 8, 1, tzinfo=timezone.utc))
        self.assertEqual(end, datetime(2026, 9, 1, tzinfo=timezone.utc))

    def test_december_rolls_into_next_year(self):
        start, end = month_bounds(datetime(2026, 12, 15, tzinfo=timezone.utc))
        self.assertEqual(start, datetime(2026, 12, 1, tzinfo=timezone.utc))
        self.assertEqual(end, datetime(2027, 1, 1, tzinfo=timezone.utc))


if __name__ == "__main__":
    unittest.main()
