"""Optional real-Postgres save test. Use a disposable tte_roadmap_test_* database.

TTE_ROADMAP_TEST_DATABASE_URL=postgresql+asyncpg://... python -m unittest discover -s tests -p test_roadmap_template_postgres.py
"""
import os
import uuid
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase, skipUnless

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import app.models  # register all model tables
from app.api.v1.endpoints import roadmaps
from app.core.database import Base
from app.models.roadmap import RoadmapTemplate, TemplateTask
from app.models.user import UserRole
from app.schemas.roadmap import TemplateSave

URL = os.environ.get('TTE_ROADMAP_TEST_DATABASE_URL')


@skipUnless(URL, 'Requires a disposable PostgreSQL database')
class TemplatePostgresTests(IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        if not make_url(URL).database.startswith('tte_roadmap_test_'):
            raise ValueError('Only disposable tte_roadmap_test_* databases are allowed')
        self.engine = create_async_engine(URL)
        self.sessions = async_sessionmaker(self.engine, expire_on_commit=False)
        async with self.engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        self.user = SimpleNamespace(role=UserRole.admin, permission_overrides=None)
        self.template_id = uuid.uuid4()
        async with self.sessions() as db:
            db.add(RoadmapTemplate(id=self.template_id, name='Before', year=2027, stages=[]))
            await db.commit()

    async def asyncTearDown(self):
        await self.engine.dispose()

    async def test_repeated_saves_keep_unique_notion_ids_and_conflict_does_not_write(self):
        task_source, sub_source = str(uuid.uuid4()), str(uuid.uuid4())
        body = dict(name='After', year=2027, revision=1, stages=[{'name': 'Stage', 'tasks': [{
            'title': 'Task', 'source_notion_page_id': task_source, 'expected_result': 'Result',
            'needs_document': True, 'questionnaire_url': '/p/form', 'due_offset_days': 3,
            'subtasks': [{'title': 'Subtask', 'source_notion_page_id': sub_source, 'due_offset_days': 1}],
        }]}])
        async with self.sessions() as db:
            result = await roadmaps.save_template(self.template_id, TemplateSave.model_validate(body), self.user, db)
            self.assertEqual(result.revision, 2)
            self.assertTrue(result.locally_edited)
            original_task_id = result.stages[0].tasks[0].id
        # A stale editor gets a conflict even after a different transaction committed.
        async with self.sessions() as db:
            stale = dict(body, name='Stale')
            with self.assertRaises(HTTPException) as raised:
                await roadmaps.save_template(self.template_id, TemplateSave.model_validate(stale), self.user, db)
            self.assertEqual(raised.exception.status_code, 409)
            await db.rollback()
        # Replacing the structure must flush deletes before inserting the same unique source IDs.
        async with self.sessions() as db:
            result = await roadmaps.save_template(self.template_id, TemplateSave.model_validate(dict(body, revision=2, name='Final')), self.user, db)
            self.assertEqual(result.name, 'Final')
            self.assertEqual(result.revision, 3)
            task = result.stages[0].tasks[0]
            self.assertNotEqual(task.id, original_task_id)
            self.assertEqual(task.source_notion_page_id, task_source)
            self.assertEqual(task.subtasks[0].source_notion_page_id, sub_source)
            self.assertEqual(task.expected_result, 'Result')
            self.assertEqual(task.questionnaire_url, '/p/form')
            self.assertEqual(task.due_offset_days, 3)
            self.assertEqual(task.subtasks[0].due_offset_days, 1)
            self.assertEqual(len((await db.execute(select(TemplateTask).where(TemplateTask.source_notion_page_id == task_source))).scalars().all()), 1)
