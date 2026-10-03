import asyncio
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from app.api.v1.endpoints import activities as api
from app.models.activity import StudentActivity
from app.models.roadmap import RoadmapTask, TaskAudience, RoadmapStatus
from app.models.user import UserRole
from app.schemas.activity import MyParticipationEdit, ActivityTaskLink, ParticipationEdit
from app.services.activity_tasks import validate_activity_task


def test_task_cannot_link_other_students_participation():
    db=SimpleNamespace(get=AsyncMock(return_value=StudentActivity(student_id=uuid.uuid4())))
    with pytest.raises(HTTPException) as exc:
        asyncio.run(validate_activity_task(db,uuid.uuid4(),uuid.uuid4()))
    assert exc.value.status_code==404

@pytest.mark.parametrize('status,decision', [('completed','selected'),('cancelled','selected'),('in_progress','not_interested')])
def test_closed_participation_cannot_receive_tasks(status,decision):
    sid=uuid.uuid4(); db=SimpleNamespace(get=AsyncMock(return_value=StudentActivity(student_id=sid,status=status,decision=decision)))
    with pytest.raises(HTTPException) as exc: asyncio.run(validate_activity_task(db,uuid.uuid4(),sid))
    assert exc.value.status_code==409


def test_student_cannot_change_status_or_mentor():
    for payload in ({'status':'completed'},{'mentor_id':str(uuid.uuid4())}):
        with pytest.raises(ValidationError): MyParticipationEdit(**payload)


def test_student_cannot_open_other_students_plan():
    db=SimpleNamespace(get=AsyncMock(return_value=StudentActivity(student_id=uuid.uuid4())),execute=AsyncMock(return_value=SimpleNamespace(scalar_one_or_none=lambda:uuid.uuid4())))
    with pytest.raises(HTTPException) as exc: asyncio.run(api.participation_access(db,uuid.uuid4(),SimpleNamespace(role=UserRole.student,id=uuid.uuid4())))
    assert exc.value.status_code==404


def test_student_tasks_respect_all_existing_visibility_rules(monkeypatch):
    async def access(*args): return None
    monkeypatch.setattr(api,'participation_access',access)
    tasks=[RoadmapTask(audience=TaskAudience.applicant,visible_to_student=True),RoadmapTask(audience=TaskAudience.coordinator,visible_to_student=True),RoadmapTask(audience=TaskAudience.applicant,visible_to_student=False),RoadmapTask(audience=TaskAudience.applicant,visible_to_student=True),RoadmapTask(audience=TaskAudience.applicant,visible_to_student=True)]
    rows=[(tasks[0],True,RoadmapStatus.active),(tasks[1],True,RoadmapStatus.active),(tasks[2],True,RoadmapStatus.active),(tasks[3],False,RoadmapStatus.active),(tasks[4],True,RoadmapStatus.archived)]
    db=SimpleNamespace(execute=AsyncMock(return_value=SimpleNamespace(all=lambda:rows)))
    result=asyncio.run(api.participation_tasks(uuid.uuid4(),db,SimpleNamespace(role=UserRole.student)))
    assert result==[tasks[0]]


def test_staff_cannot_assign_unrelated_mentor(monkeypatch):
    async def access(*args): return StudentActivity(student_id=uuid.uuid4())
    monkeypatch.setattr(api,'participation_access',access)
    monkeypatch.setattr(api,'require_access',lambda *args: None)
    monkeypatch.setattr(api,'mentor_options',AsyncMock(return_value=[]))
    db=SimpleNamespace(commit=AsyncMock())
    with pytest.raises(HTTPException) as exc: asyncio.run(api.update_participation(uuid.uuid4(),ParticipationEdit(mentor_id=uuid.uuid4()),db,SimpleNamespace(role=UserRole.mentor)))
    assert exc.value.status_code==422
    db.commit.assert_not_awaited()


def test_existing_task_of_another_student_cannot_be_attached(monkeypatch):
    sid=uuid.uuid4(); item=StudentActivity(id=uuid.uuid4(),student_id=sid)
    monkeypatch.setattr(api,'require_access',lambda *args:None)
    monkeypatch.setattr(api,'participation_access',AsyncMock(return_value=item))
    monkeypatch.setattr(api,'validate_activity_task',AsyncMock(return_value=item))
    db=SimpleNamespace(get=AsyncMock(side_effect=[RoadmapTask(roadmap_id=uuid.uuid4()),SimpleNamespace(student_id=uuid.uuid4())]),commit=AsyncMock())
    with pytest.raises(HTTPException) as exc: asyncio.run(api.link_task(item.id,ActivityTaskLink(task_id=uuid.uuid4()),db,SimpleNamespace(id=uuid.uuid4())))
    assert exc.value.status_code==404
    db.commit.assert_not_awaited()


def test_link_does_not_move_task_from_another_activity(monkeypatch):
    sid=uuid.uuid4(); item=StudentActivity(id=uuid.uuid4(),student_id=sid)
    monkeypatch.setattr(api,'require_access',lambda *args:None)
    monkeypatch.setattr(api,'participation_access',AsyncMock(return_value=item))
    monkeypatch.setattr(api,'validate_activity_task',AsyncMock(return_value=item))
    db=SimpleNamespace(get=AsyncMock(side_effect=[RoadmapTask(roadmap_id=uuid.uuid4(),activity_participation_id=uuid.uuid4()),SimpleNamespace(student_id=sid)]),commit=AsyncMock())
    with pytest.raises(HTTPException) as exc: asyncio.run(api.link_task(item.id,ActivityTaskLink(task_id=uuid.uuid4()),db,SimpleNamespace(id=uuid.uuid4())))
    assert exc.value.status_code==409
    db.commit.assert_not_awaited()
