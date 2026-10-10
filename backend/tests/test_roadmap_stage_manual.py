"""Staff can set a stage status without a complete team or completed tasks."""
import unittest
import uuid
from types import SimpleNamespace
from unittest import mock

from app.api.v1.endpoints import roadmaps
from app.models.roadmap import RoadmapItemStatus
from app.schemas.roadmap import StageUpdate


class ManualStageTests(unittest.IsolatedAsyncioTestCase):
    async def test_staff_can_start_and_close_stage_without_progress_queries(self):
        for target in (RoadmapItemStatus.in_progress, RoadmapItemStatus.done):
            with self.subTest(target=target):
                stage = SimpleNamespace(id=uuid.uuid4(), roadmap_id=uuid.uuid4(), status=RoadmapItemStatus.planned)
                db = mock.Mock(get=mock.AsyncMock(return_value=stage), commit=mock.AsyncMock())
                db.execute = mock.AsyncMock(side_effect=AssertionError('No team or task completion gate'))
                with mock.patch.object(roadmaps, '_student_of_roadmap', mock.AsyncMock(return_value=uuid.uuid4())), \
                     mock.patch.object(roadmaps, '_assert_staff', mock.AsyncMock()) as access, \
                     mock.patch.object(roadmaps, '_load_roadmap', mock.AsyncMock(return_value='updated')):
                    result = await roadmaps.update_stage(stage.id, StageUpdate(status=target), SimpleNamespace(), db)
                self.assertEqual(stage.status, target)
                self.assertEqual(result, 'updated')
                access.assert_awaited_once()
                db.commit.assert_awaited_once()

    async def test_staff_permission_still_required(self):
        stage = SimpleNamespace(id=uuid.uuid4(), roadmap_id=uuid.uuid4(), status=RoadmapItemStatus.planned)
        db = mock.Mock(get=mock.AsyncMock(return_value=stage), commit=mock.AsyncMock())
        with mock.patch.object(roadmaps, '_student_of_roadmap', mock.AsyncMock(return_value=uuid.uuid4())), \
             mock.patch.object(roadmaps, '_assert_staff', mock.AsyncMock(side_effect=roadmaps._FORBIDDEN)):
            with self.assertRaises(type(roadmaps._FORBIDDEN)):
                await roadmaps.update_stage(stage.id, StageUpdate(status='done'), SimpleNamespace(), db)
        db.commit.assert_not_awaited()
