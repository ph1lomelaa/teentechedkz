"""Ментор двигает задачи в roadmap ученика (этапы — нет)."""
import unittest
import uuid
from types import SimpleNamespace
from unittest import mock

from fastapi import HTTPException

from app.api.v1.endpoints import roadmaps


def _rows(items):
    return SimpleNamespace(scalars=lambda: iter(items))


def _db(*results, get=None):
    db = mock.Mock(commit=mock.AsyncMock(), get=mock.AsyncMock(return_value=get))
    db.execute = mock.AsyncMock(side_effect=[_rows(r) for r in results])
    return db


class ReorderTests(unittest.IsolatedAsyncioTestCase):
    def patches(self):
        return (mock.patch.object(roadmaps, '_student_of_roadmap', mock.AsyncMock(return_value=uuid.uuid4())),
                mock.patch.object(roadmaps, '_assert_staff', mock.AsyncMock()),
                mock.patch.object(roadmaps, '_load_roadmap', mock.AsyncMock(return_value='roadmap')),
                mock.patch.object(roadmaps, 'log_change', mock.AsyncMock()))

    async def test_task_moves_between_stages(self):
        stage = SimpleNamespace(id=uuid.uuid4(), roadmap_id=uuid.uuid4())
        other = uuid.uuid4()
        t1 = SimpleNamespace(id=uuid.uuid4(), stage_id=stage.id, position=0)
        moved = SimpleNamespace(id=uuid.uuid4(), stage_id=other, position=4)
        db = _db([t1, moved], [t1.id], get=stage)
        p1, p2, p3, p4 = self.patches()
        with p1, p2, p3, p4:
            await roadmaps.reorder_tasks(stage.id, roadmaps.OrderIn(ids=[moved.id, t1.id]), SimpleNamespace(id=uuid.uuid4()), db)
        self.assertEqual((moved.stage_id, moved.position, t1.position), (stage.id, 0, 1))
        db.commit.assert_awaited_once()

    async def test_foreign_task_or_missing_task_rejected(self):
        stage = SimpleNamespace(id=uuid.uuid4(), roadmap_id=uuid.uuid4())
        t1 = SimpleNamespace(id=uuid.uuid4(), stage_id=stage.id, position=0)
        t2 = SimpleNamespace(id=uuid.uuid4(), stage_id=stage.id, position=1)
        cases = [
            ([t1.id, uuid.uuid4()], ([t1], [t1.id])),        # чужая задача
            ([t1.id], ([t1], [t1.id, t2.id])),              # потеряли задачу этапа
        ]
        for ids, results in cases:
            db = _db(*results, get=stage)
            p1, p2, p3, p4 = self.patches()
            with p1, p2, p3, p4, self.assertRaises(HTTPException):
                await roadmaps.reorder_tasks(stage.id, roadmaps.OrderIn(ids=ids), SimpleNamespace(id=uuid.uuid4()), db)
            db.commit.assert_not_awaited()



class StageMaterialsTests(unittest.IsolatedAsyncioTestCase):
    async def test_mentor_writes_list_into_stage(self):
        from app.schemas.roadmap import StageUpdate
        stage = SimpleNamespace(id=uuid.uuid4(), roadmap_id=uuid.uuid4(), materials_text=None)
        db = mock.Mock(get=mock.AsyncMock(return_value=stage), commit=mock.AsyncMock())
        text = '- Олимпиада по математике, 2 место\n- Волонтёрство в фонде, 6 месяцев'
        with mock.patch.object(roadmaps, '_student_of_roadmap', mock.AsyncMock(return_value=uuid.uuid4())), \
             mock.patch.object(roadmaps, '_assert_staff', mock.AsyncMock()), \
             mock.patch.object(roadmaps, '_load_roadmap', mock.AsyncMock(return_value='roadmap')):
            await roadmaps.update_stage(stage.id, StageUpdate(materials_text=text), SimpleNamespace(id=uuid.uuid4()), db)
        self.assertEqual(stage.materials_text, text)

    def test_materials_text_is_limited(self):
        from pydantic import ValidationError
        from app.schemas.roadmap import StageUpdate
        with self.assertRaises(ValidationError):
            StageUpdate(materials_text='x' * 20001)


def test_student_does_not_get_stage_materials():
    from app.models.roadmap import Roadmap, Stage
    stage = Stage(id=uuid.uuid4(), name='Портфолио', visible_to_student=True, materials_text='заметки команды')
    stage.tasks = []
    roadmap = Roadmap(id=uuid.uuid4(), name='США')
    roadmap.stages = [stage]
    out = roadmaps._strip_hidden_for_student([roadmap])
    assert out[0].stages[0].materials_text is None
