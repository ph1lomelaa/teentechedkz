"""Template saves preserve imported fields and protect concurrent/local edits."""
import uuid
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase, TestCase, mock

from fastapi import HTTPException
from pydantic import ValidationError

from app.api.v1.endpoints import roadmaps
from app.core import import_notion_root_roadmaps as importer
from app.models.roadmap import RoadmapTemplate, TemplateStage
from app.models.user import UserRole
from app.schemas.roadmap import TemplateSave


def payload(**overrides):
    return dict(name="USA", country_name="США", degree="bachelors", year=2027,
                description="Поступление", revision=3, stages=[{
                    "name": "Подготовка", "description": "Этап", "tasks": [{
                        "title": "Документы", "description": "Переводы", "expected_result": "Паспорт",
                        "needs_document": True, "needs_zoom": True,
                        "questionnaire_url": "https://example.com/form", "source_notion_page_id": "notion-task",
                        "audience": "coordinator", "priority": "required", "due_offset_days": 14,
                        "subtasks": [{"title": "Перевод", "source_notion_page_id": "notion-sub", "due_offset_days": 7}],
                    }],
                }], **overrides)


class TemplateValidationTests(TestCase):
    def test_blank_names_negative_offsets_and_duplicate_sources_rejected(self):
        for field, value in [("name", "  "), ("year", 0), ("revision", 0)]:
            body = payload(); body[field] = value
            with self.subTest(field=field), self.assertRaises(ValidationError):
                TemplateSave.model_validate(body)
        for kind in ("negative", "duplicate", "blank_task", "blank_subtask"):
            body = payload(); task = body["stages"][0]["tasks"][0]
            if kind == "negative":
                task["due_offset_days"] = -1
            elif kind == "duplicate":
                body["stages"][0]["tasks"].append(task.copy())
            elif kind == "blank_task":
                task["title"] = " "
            else:
                task["subtasks"][0]["title"] = " "
            with self.subTest(kind=kind), self.assertRaises(ValidationError):
                TemplateSave.model_validate(body)


class TemplateSaveTests(IsolatedAsyncioTestCase):
    async def test_saves_metadata_and_structure_in_one_commit_preserving_source_links(self):
        tpl = RoadmapTemplate(id=uuid.uuid4(), name="Old", year=2026, revision=3, locally_edited=False,
                              stages=[TemplateStage(name="Old", tasks=[])])
        db = mock.MagicMock()
        db.delete = mock.AsyncMock(); db.flush = mock.AsyncMock(); db.commit = mock.AsyncMock()
        with mock.patch.object(roadmaps, "_lock_template", mock.AsyncMock()) as lock, \
             mock.patch.object(roadmaps, "_get_template_or_404", mock.AsyncMock(return_value=tpl)), \
             mock.patch.object(roadmaps, "require_access"):
            result = await roadmaps.save_template(tpl.id, TemplateSave.model_validate(payload()), SimpleNamespace(id=uuid.uuid4()), db)
        lock.assert_awaited_once_with(db, tpl.id)
        self.assertIs(result, tpl)
        self.assertEqual(tpl.name, "USA")
        self.assertEqual(tpl.year, 2027)
        self.assertEqual(tpl.revision, 4)
        self.assertTrue(tpl.locally_edited)
        task = tpl.stages[0].tasks[0]
        self.assertEqual(task.expected_result, "Паспорт")
        self.assertTrue(task.needs_document and task.needs_zoom)
        self.assertEqual(task.questionnaire_url, "https://example.com/form")
        self.assertEqual(task.source_notion_page_id, "notion-task")
        self.assertEqual(task.subtasks[0].source_notion_page_id, "notion-sub")
        self.assertEqual(task.due_offset_days, 14)
        self.assertEqual(task.subtasks[0].due_offset_days, 7)
        db.commit.assert_awaited_once()
        db.delete.assert_awaited_once()

    async def test_conflicting_version_changes_nothing(self):
        tpl = RoadmapTemplate(id=uuid.uuid4(), name="Other version", year=2026, revision=4, stages=[])
        db = mock.MagicMock(); db.commit = mock.AsyncMock(); db.delete = mock.AsyncMock()
        with mock.patch.object(roadmaps, "_lock_template", mock.AsyncMock()), \
             mock.patch.object(roadmaps, "_get_template_or_404", mock.AsyncMock(return_value=tpl)), \
             mock.patch.object(roadmaps, "require_access"):
            with self.assertRaises(HTTPException) as raised:
                await roadmaps.save_template(tpl.id, TemplateSave.model_validate(payload()), SimpleNamespace(), db)
        self.assertEqual(raised.exception.status_code, 409)
        self.assertEqual(tpl.name, "Other version")
        db.commit.assert_not_awaited(); db.delete.assert_not_awaited()

    async def test_student_cannot_save_template(self):
        db = mock.MagicMock()
        user = SimpleNamespace(role=UserRole.student, permission_overrides=None)
        with self.assertRaises(HTTPException) as raised:
            await roadmaps.save_template(uuid.uuid4(), TemplateSave.model_validate(payload()), user, db)
        self.assertEqual(raised.exception.status_code, 403)
        db.execute.assert_not_called()

    async def test_import_skips_edited_template_in_apply_and_dry_run(self):
        tpl = RoadmapTemplate(id=uuid.uuid4(), name="Правки CRM", year=2027, locally_edited=True, revision=4, stages=[])
        db = mock.MagicMock()
        db.execute = mock.AsyncMock(return_value=SimpleNamespace(scalar_one_or_none=lambda: tpl))
        db.delete = mock.AsyncMock(); db.flush = mock.AsyncMock()
        candidate = SimpleNamespace(id="notion-db", key=SimpleNamespace(track=None, country="США", degree="bachelors"))
        for dry_run in (False, True):
            with mock.patch.object(importer, "_ensure_country", mock.AsyncMock()) as country, \
                 mock.patch.object(importer, "_append_new_live_tasks", mock.AsyncMock()) as append:
                action = await importer.upsert_template(db, candidate, [TemplateStage(name="Notion", tasks=[])], dry_run)
            self.assertEqual(action, "skipped_local_edits")
            country.assert_not_awaited(); append.assert_not_awaited()
        self.assertEqual(tpl.name, "Правки CRM")
        self.assertEqual(tpl.revision, 4)
        db.delete.assert_not_awaited(); db.flush.assert_not_awaited(); db.add.assert_not_called()

    async def test_unedited_import_updates_version_and_structure(self):
        tpl = RoadmapTemplate(id=uuid.uuid4(), name="Old", year=2026, locally_edited=False, revision=3, stages=[])
        db = mock.MagicMock()
        db.execute = mock.AsyncMock(side_effect=[SimpleNamespace(scalar_one_or_none=lambda: tpl), SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: []))])
        db.flush = mock.AsyncMock()
        candidate = SimpleNamespace(id="notion-db", title="Notion", last_edited_time=None,
                                    key=SimpleNamespace(track=None, country="США", degree="bachelors", year=2027))
        with mock.patch.object(importer, "_ensure_country", mock.AsyncMock(return_value=None)), \
             mock.patch.object(importer, "_link_legacy_live_sources", mock.AsyncMock()), \
             mock.patch.object(importer, "_append_new_live_tasks", mock.AsyncMock()):
            action = await importer.upsert_template(db, candidate, [TemplateStage(name="New", tasks=[])], False)
        self.assertEqual(action, "updated")
        self.assertEqual(tpl.revision, 4)
        self.assertFalse(tpl.locally_edited)
        db.add.assert_called_once()
