"""Материалы этапа: файл привязывается к этапу, видит только команда — ученик нет.

FINANCE_TEST_DATABASE_URL=postgresql+asyncpg://.../tte_finance_check_... pytest tests/test_stage_materials.py
"""
import asyncio
import os
import random
import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1.endpoints import portfolio_workflow as pw
from app.models.document import Document, DocType
from app.models.roadmap import Roadmap, Stage
from app.models.student import DegreeLevel, Student
from app.models.user import User, UserRole

URL = os.getenv('FINANCE_TEST_DATABASE_URL', '')


@pytest.mark.skipif(not URL, reason='Requires an isolated test database')
def test_stage_files():
    assert '/tte_finance_check_' in URL, 'Refusing to run against a non-disposable database'
    asyncio.run(run())


async def run():
    engine = create_async_engine(URL)
    sessions = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
    tag = uuid.uuid4().hex[:6]
    async with sessions() as db:
        admin = User(name=f'Админ {tag}', email=f'adm-{tag}@example.test', hashed_password='x', role=UserRole.admin, is_active=True)
        pupil = User(name=f'Ученик {tag}', email=f'st-{tag}@example.test', hashed_password='x', role=UserRole.student, is_active=True)
        db.add_all([admin, pupil])
        await db.flush()
        student = Student(full_name=f'Асель {tag}', phone=f'+77{random.randint(100000000, 999999999)}', degree_level=DegreeLevel.undergraduate,
                          intake_year=2027, user_id=pupil.id)
        db.add(student)
        await db.flush()
        roadmap = Roadmap(student_id=student.id, name='США 2027', year=2027)
        db.add(roadmap)
        await db.flush()
        open_stage = Stage(roadmap_id=roadmap.id, name='Портфолио', position=0, visible_to_student=True)
        hidden = Stage(roadmap_id=roadmap.id, name='Внутреннее', position=1, visible_to_student=False)
        # Документ скрыт от ученика — для материалов этапа это норма.
        doc = Document(student_id=student.id, uploaded_by=admin.id, doc_type=DocType.other, file_name='MAL.pdf',
                       file_size=10, mime_type='application/pdf', storage_path=f'test/{tag}.pdf', visible_to_student=False)
        db.add_all([open_stage, hidden, doc])
        await db.commit()

    async with sessions() as db:
        await pw.link_document(db, admin, pw.LinkInput(document_id=doc.id, stage_id=open_stage.id))
    async with sessions() as db:
        await pw.link_document(db, admin, pw.LinkInput(document_id=doc.id, stage_id=open_stage.id))  # повтор без дубля
    async with sessions() as db:
        listed = await pw.files(db, admin, stage_id=open_stage.id)
        assert [d['file_name'] for d in listed] == ['MAL.pdf']
        assert await pw.files(db, admin, stage_id=hidden.id) == []
        for stage in (open_stage, hidden):  # ученик не видит материалы ни одного этапа
            with pytest.raises(HTTPException) as pupil_err:
                await pw.files(db, pupil, stage_id=stage.id)
            assert pupil_err.value.status_code == 404
        with pytest.raises(HTTPException) as write_err:
            await pw.link_document(db, pupil, pw.LinkInput(document_id=doc.id, stage_id=open_stage.id))
        assert write_err.value.status_code == 404
        with pytest.raises(HTTPException):
            await pw.files(db, admin, task_id=uuid.uuid4(), stage_id=open_stage.id)
    await engine.dispose()
