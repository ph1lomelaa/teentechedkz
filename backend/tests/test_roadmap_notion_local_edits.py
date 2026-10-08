import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase, mock

from app.core.import_notion_root_roadmaps import _append_new_live_tasks
from app.models.roadmap import Roadmap, RoadmapTask, Stage, TemplateStage, TemplateTask


class LiveRoadmapImportTests(IsolatedAsyncioTestCase):
    async def test_reimport_preserves_edits_and_deleted_tasks_but_adds_new_page(self):
        roadmap_id = uuid.uuid4()
        stage_id = uuid.uuid4()
        edited = RoadmapTask(id=uuid.uuid4(), roadmap_id=roadmap_id, stage_id=stage_id,
                             source_notion_page_id="notion-old", title="IELTS 6.5",
                             description="Платформенная правка", manual_fields=["title", "description"],
                             subtasks=[])
        deleted = RoadmapTask(id=uuid.uuid4(), roadmap_id=roadmap_id, stage_id=stage_id,
                              source_notion_page_id="notion-deleted", title="Удалённая",
                              deleted_at=datetime.now(timezone.utc), subtasks=[])
        live_stage = Stage(id=stage_id, roadmap_id=roadmap_id, name="Подготовка", position=0,
                           tasks=[edited, deleted])
        roadmap = Roadmap(id=roadmap_id, student_id=uuid.uuid4(), name="Тест",
                          year=2026, stages=[live_stage])
        incoming = TemplateStage(name="Подготовка", position=0, tasks=[
            TemplateTask(title="IELTS 7", source_notion_page_id="notion-old", position=0, subtasks=[]),
            TemplateTask(title="Удалённая", source_notion_page_id="notion-deleted", position=1, subtasks=[]),
            TemplateTask(title="Ранее удалённая", source_notion_page_id="old-missing", position=3, subtasks=[]),
            TemplateTask(title="Новая задача", source_notion_page_id="notion-new", position=2, subtasks=[]),
        ])
        db = mock.MagicMock()
        db.execute = mock.AsyncMock(return_value=SimpleNamespace(
            scalars=lambda: SimpleNamespace(all=lambda: [roadmap])))
        db.flush = mock.AsyncMock()

        await _append_new_live_tasks(db, uuid.uuid4(), [incoming], old_task_ids={"notion-old", "notion-deleted", "old-missing"})

        self.assertEqual(edited.title, "IELTS 6.5")
        self.assertEqual(edited.description, "Платформенная правка")
        self.assertIsNotNone(deleted.deleted_at)
        added = [call.args[0] for call in db.add.call_args_list]
        self.assertEqual(len(added), 1)
        self.assertEqual(added[0].source_notion_page_id, "notion-new")
        self.assertEqual(added[0].title, "Новая задача")
