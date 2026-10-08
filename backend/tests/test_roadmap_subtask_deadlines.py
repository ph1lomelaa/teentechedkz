"""Independent deadlines for template and live roadmap subtasks."""
import unittest
import uuid
from datetime import date, datetime, timedelta
from types import SimpleNamespace
from unittest import mock
from unittest.mock import patch
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from pydantic import ValidationError

from app.api.v1.endpoints import roadmaps
from app.models.roadmap import RoadmapStatus, TaskAudience
from app.models.user import UserRole

from app.api.v1.endpoints.roadmaps import _apply_template_structure, _deadline_from_offset
from app.models.roadmap import RoadmapSubtask, RoadmapTemplate, TemplateSubtask
from app.schemas.roadmap import RoadmapSubtaskOut, RoadmapTaskOut, StructureIn, SubtaskCreate, SubtaskUpdate
from app.services.task_urgency import company_today, overdue_days


class RoadmapSubtaskDeadlineTests(unittest.TestCase):
    def test_offset_zero_means_assignment_day(self) -> None:
        assigned_on = date(2026, 10, 2)
        self.assertEqual(_deadline_from_offset(assigned_on, 0), assigned_on)
        self.assertEqual(_deadline_from_offset(assigned_on, 14), date(2026, 10, 16))
        self.assertIsNone(_deadline_from_offset(assigned_on, None))

    def test_template_structure_keeps_subtask_offset(self) -> None:
        structure = StructureIn.model_validate({
            "stages": [{
                "name": "Подача",
                "tasks": [{
                    "title": "Документы",
                    "subtasks": [{"title": "Перевод", "due_offset_days": 7}],
                }],
            }],
        })
        template = RoadmapTemplate(name="Test", year=2026)

        _apply_template_structure(template, structure.stages)

        self.assertEqual(template.stages[0].tasks[0].subtasks[0].due_offset_days, 7)

    def test_negative_template_offset_is_rejected(self) -> None:
        with self.assertRaises(ValidationError):
            StructureIn.model_validate({
                "stages": [{
                    "name": "Подача",
                    "tasks": [{
                        "title": "Документы",
                        "subtasks": [{"title": "Перевод", "due_offset_days": -1}],
                    }],
                }],
            })

    def test_live_create_and_update_accept_calendar_deadline(self) -> None:
        deadline = date(2026, 10, 12)
        self.assertEqual(SubtaskCreate(title="Перевод", due_date=deadline).due_date, deadline)
        update = SubtaskUpdate.model_validate({"due_date": None})
        self.assertEqual(update.model_dump(exclude_unset=True), {"due_date": None})

    def test_orm_models_expose_separate_deadline_columns(self) -> None:
        self.assertIn("due_offset_days", TemplateSubtask.__table__.columns)
        self.assertIn("due_date", RoadmapSubtask.__table__.columns)


class RoadmapOverdueRulesTests(unittest.TestCase):
    today = date(2026, 10, 10)

    def test_overdue_counts_days_only_when_not_done(self) -> None:
        self.assertEqual(overdue_days(date(2026, 10, 7), done=False, today=self.today), 3)
        self.assertEqual(overdue_days(date(2026, 10, 7), done=True, today=self.today), 0)

    def test_due_today_future_and_missing_are_not_overdue(self) -> None:
        self.assertEqual(overdue_days(self.today, done=False, today=self.today), 0)
        self.assertEqual(overdue_days(date(2026, 10, 20), done=False, today=self.today), 0)
        self.assertEqual(overdue_days(None, done=False, today=self.today), 0)

    def test_today_follows_company_timezone(self) -> None:
        # 20:30 UTC 10 окт — в Алматы (UTC+5) уже 11 окт: вчерашний срок просрочен.
        with patch("app.services.task_urgency.datetime") as fake:
            fake.now.return_value = datetime(2026, 10, 11, 1, 30, tzinfo=ZoneInfo("Asia/Almaty"))
            self.assertEqual(company_today(), date(2026, 10, 11))
            self.assertEqual(overdue_days(date(2026, 10, 10), done=False), 1)
            fake.now.assert_called_with(ZoneInfo("Asia/Almaty"))

    def test_task_output_marks_overdue_and_keeps_manual_order(self) -> None:
        def sub(title: str, due: date | None, pos: int, done: bool = False) -> RoadmapSubtaskOut:
            return RoadmapSubtaskOut(id=uuid.uuid4(), title=title, is_done=done, due_date=due, position=pos)

        past = date.today() - timedelta(days=5)
        task = RoadmapTaskOut(
            id=uuid.uuid4(), stage_id=uuid.uuid4(), roadmap_id=uuid.uuid4(), title="T", description="",
            priority="required", audience="applicant", status="in_progress", due_date=past, position=0,
            subtasks=[sub("без срока", None, 0), sub("поздно", date(2099, 1, 1), 1),
                      sub("давно", past, 2), sub("сделана", past, 3, done=True)],
        )
        self.assertGreaterEqual(task.overdue_days, 5)
        self.assertEqual([s.title for s in task.subtasks], ["без срока", "поздно", "давно", "сделана"])
        by_title = {s.title: s for s in task.subtasks}
        self.assertGreaterEqual(by_title["давно"].overdue_days, 5)
        self.assertEqual(by_title["сделана"].overdue_days, 0)
        self.assertEqual(by_title["поздно"].overdue_days, 0)

    def test_done_task_is_not_overdue(self) -> None:
        task = RoadmapTaskOut(
            id=uuid.uuid4(), stage_id=uuid.uuid4(), roadmap_id=uuid.uuid4(), title="T", description="",
            priority="required", audience="applicant", status="done", due_date=date(2020, 1, 1), position=0,
        )
        self.assertEqual(task.overdue_days, 0)
        self.assertEqual(task.urgency, "none")

    def test_deadline_range_is_validated(self) -> None:
        for bad in (date(1999, 12, 31), date(2101, 1, 1)):
            with self.assertRaises(ValidationError):
                SubtaskUpdate(due_date=bad)
            with self.assertRaises(ValidationError):
                SubtaskCreate(title="x", due_date=bad)
        with self.assertRaises(ValidationError):
            SubtaskUpdate.model_validate({"due_date": "не дата"})


class UpdateSubtaskEndpointTests(unittest.IsolatedAsyncioTestCase):
    """update_subtask без БД: журнал due_date и запрет студенту."""

    def setUp(self) -> None:
        self.student_id = uuid.uuid4()
        self.sub = SimpleNamespace(
            id=uuid.uuid4(), task_id=uuid.uuid4(), is_done=False, title="Перевод", due_date=date(2026, 10, 1),
        )
        self.task = SimpleNamespace(id=self.sub.task_id, roadmap_id=uuid.uuid4(), audience=TaskAudience.applicant)
        self.db = mock.MagicMock()
        self.db.get = mock.AsyncMock(side_effect=lambda model, _id: self.sub if model is RoadmapSubtask else self.task)
        self.db.commit = mock.AsyncMock()
        patches = {
            "_student_of_roadmap": mock.AsyncMock(return_value=self.student_id),
            "_assert_staff": mock.AsyncMock(),
            "_my_student_id": mock.AsyncMock(return_value=self.student_id),
            "_load_roadmap": mock.AsyncMock(return_value="roadmap"),
            "log_change": mock.AsyncMock(),
        }
        self.mocks = {}
        for name, m in patches.items():
            p = mock.patch.object(roadmaps, name, m)
            p.start()
            self.addCleanup(p.stop)
            self.mocks[name] = m

    async def _patch(self, role: UserRole, body: dict):
        user = SimpleNamespace(id=uuid.uuid4(), role=role)
        return await roadmaps.update_subtask(self.sub.id, SubtaskUpdate.model_validate(body), user, self.db)

    async def test_staff_deadline_change_is_logged(self) -> None:
        await self._patch(UserRole.admin, {"due_date": "2026-10-15"})
        self.assertEqual(self.sub.due_date, date(2026, 10, 15))
        self.mocks["log_change"].assert_awaited_once()
        args = self.mocks["log_change"].await_args
        self.assertEqual(args.args[1:6], ("roadmap_subtask", self.sub.id, "due_date", "2026-10-01", "2026-10-15"))
        self.assertEqual(args.kwargs["source"], "workspace")

    async def test_clearing_deadline_is_logged_as_empty(self) -> None:
        await self._patch(UserRole.admin, {"due_date": None})
        self.assertIsNone(self.sub.due_date)
        self.assertEqual(self.mocks["log_change"].await_args.args[4:6], ("2026-10-01", ""))

    async def test_same_deadline_is_not_logged(self) -> None:
        await self._patch(UserRole.admin, {"due_date": "2026-10-01"})
        self.mocks["log_change"].assert_not_awaited()

    async def test_student_cannot_change_deadline(self) -> None:
        self.db.execute = mock.AsyncMock(return_value=mock.MagicMock(
            scalar_one_or_none=mock.MagicMock(return_value=RoadmapStatus.active)))
        with self.assertRaises(HTTPException) as ctx:
            await self._patch(UserRole.student, {"due_date": "2027-01-01"})
        self.assertEqual(ctx.exception.status_code, 403)
        self.assertEqual(ctx.exception.headers["X-Error-Code"], "FIELD_FORBIDDEN")
        self.assertEqual(self.sub.due_date, date(2026, 10, 1))
        self.mocks["log_change"].assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
