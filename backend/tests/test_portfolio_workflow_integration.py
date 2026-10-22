"""Run only against an explicitly named disposable PostgreSQL database.

PORTFOLIO_TEST_DATABASE_URL=postgresql+asyncpg://.../tte_portfolio_check_... pytest ...
MinIO is stubbed; database constraints, HTTP contracts and both roles are real.
"""
import asyncio
import os
import uuid
from datetime import date, timedelta
import pytest
from fastapi import FastAPI, Request
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User, UserRole
from app.models.student import Student, DegreeLevel
from app.models.activity import Activity, ActivityIntake, StudentActivity
from app.models.roadmap import RoadmapTask
from app.models.document import Document, DocType
from app.models.mentor_assignment import MentorAssignment, MentorRole
from app.api.v1.endpoints import activities, learner_tasks, portfolio_workflow, roadmaps, documents, workspace

URL = os.getenv('PORTFOLIO_TEST_DATABASE_URL', '')
pytestmark = pytest.mark.skipif(not URL, reason='Requires an isolated Portfolio UP test database')


def test_two_role_portfolio_workflow(monkeypatch):
    assert '/tte_portfolio_check_' in URL, 'Refusing to run against a non-disposable database'
    asyncio.run(run_workflow(monkeypatch))


async def run_workflow(monkeypatch):
    engine = create_async_engine(URL)
    sessions = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
    suffix = uuid.uuid4().hex[:10]
    async with sessions() as db:
        admin = User(name='Portfolio Test Mentor', email=f'p-admin-{suffix}@example.test', hashed_password='test', role=UserRole.mentor)
        learner = User(name='Portfolio Test Learner', email=f'p-student-{suffix}@example.test', hashed_password='test', role=UserRole.student)
        other = User(name='Portfolio Test Other', email=f'p-other-{suffix}@example.test', hashed_password='test', role=UserRole.student)
        db.add_all([admin, learner, other]); await db.flush()
        student = Student(full_name='Portfolio Workflow Student', phone=suffix, degree_level=DegreeLevel.undergraduate, intake_year=2027, user_id=learner.id)
        stranger = Student(full_name='Portfolio Other Student', phone=suffix+'2', degree_level=DegreeLevel.undergraduate, intake_year=2027, user_id=other.id)
        db.add_all([student, stranger]); await db.flush()
        db.add(MentorAssignment(student_id=student.id, mentor_id=admin.id, role=MentorRole.portfolio))
        activity = Activity(title='Portfolio Integration Olympiad', publication='published')
        db.add(activity); await db.flush()
        intake = ActivityIntake(activity_id=activity.id, label='Integration', mode='fixed', deadline=date.today()+timedelta(days=60))
        db.add(intake)
        await db.commit()
        ids = dict(admin=admin.id, learner=learner.id, other=other.id, student=student.id, stranger=stranger.id, intake=intake.id)
    app = FastAPI()
    for module in (activities, learner_tasks, portfolio_workflow, roadmaps, documents, workspace): app.include_router(module.router, prefix='/api/v1')
    async def database():
        async with sessions() as db: yield db
    async def actor(request: Request):
        async with sessions() as db: return await db.get(User, ids[request.headers.get('x-test-role', 'admin')])
    app.dependency_overrides[get_db] = database
    app.dependency_overrides[get_current_user] = actor
    async def store(**kwargs): return f"portfolio-test/{uuid.uuid4()}/{kwargs.get('filename', 'file')}"
    monkeypatch.setattr(documents, 'minio_upload', store)
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
        async def call(method, path, *, role='admin', expected=200, **kwargs):
            response = await client.request(method, '/api/v1'+path, headers={'x-test-role':role}, **kwargs)
            assert response.status_code == expected, (path, response.status_code, response.text[:1500])
            return response.json() if response.content else None
        # No roadmap: a normal task is visible in the portal and workspace.
        normal = await call('POST','/learner-tasks', expected=201, json={'student_id':str(student.id),'title':'Independent task','requires_review':False})
        assert normal['roadmap_id'] is None
        assert any(t['id']==normal['id'] for t in await call('GET','/portal/tasks',role='learner'))
        queue = await call('GET','/workspace/roadmap-tasks')
        assert any(t['id']==normal['id'] for t in queue['items'])
        await call('GET',f"/learner-tasks/{normal['id']}",role='other',expected=404)
        await call('POST',f"/portal/tasks/{normal['id']}/complete",role='learner')
        done = await call('GET',f"/learner-tasks/{normal['id']}",role='learner')
        assert done['status']=='done' and done['review_status']=='none'
        # Common queue mutations still work for standalone tasks.
        await call('PATCH',f"/roadmap-tasks/{normal['id']}",json={'status':'planned'})
        await call('POST',f"/roadmap-tasks/{normal['id']}/subtasks",expected=201,json={'title':'Check email'})
        normal = await call('GET',f"/learner-tasks/{normal['id']}",role='learner')
        await call('PATCH',f"/roadmap-subtasks/{normal['subtasks'][0]['id']}",role='learner',json={'is_done':True})
        # Bulk issuance: one recipient fails, the other receives an atomic plan.
        payload={'intake_id':str(intake.id),'request_key':str(uuid.uuid4()),'decision':'selected','recipients':[
            {'student_id':str(student.id),'steps':[{'title':'Register','requires_review':False,'requires_evidence':True,'subtasks':['Check email']},{'title':'Draft essay','requires_review':True}]},
            {'student_id':str(uuid.uuid4()),'steps':[]}]}
        issuance = await call('POST','/activities/assignments',json=payload)
        assert [r['status'] for r in issuance['results']]==['created','error']
        pid=issuance['results'][0]['participation_id']
        replay=await call('POST','/activities/assignments',json=payload)
        assert replay['results'][0]['status']=='existing'
        plan=await call('GET',f'/activities/participations/{pid}',role='learner')
        assert plan['steps']['total']==2
        steps=await call('GET',f'/activities/participations/{pid}/tasks',role='learner')
        register, essay=steps
        await call('POST',f"/learner-tasks/{register['id']}/complete",role='learner',json={},expected=422)
        # Upload, reuse, visibility and evidence validation.
        doc=await call('POST','/portfolio-documents/upload',role='learner',files={'file':('proof.txt',b'fixture proof','text/plain')},data={'task_id':register['id']})
        await call('POST','/portfolio-documents/link',role='other',expected=404,json={'document_id':doc['id'],'participation_id':pid})
        await call('POST','/portfolio-documents/link',role='learner',json={'document_id':doc['id'],'participation_id':pid})
        linked=await call('GET',f'/portfolio-documents?participation_id={pid}',role='learner')
        assert len(linked)==1 and linked[0]['id']==doc['id']
        await call('POST',f"/learner-tasks/{register['id']}/complete",role='learner',json={})
        await call('DELETE',f"/documents/portal/{doc['id']}",role='learner',expected=409)
        await call('POST',f'/activities/participations/{pid}/result',role='learner',json={'text':'Olympiad finished'},expected=409)
        # A mentor cannot tick a reviewed step done without the learner's submission.
        await call('PATCH',f"/roadmap-tasks/{essay['id']}",json={'status':'done'},expected=409)
        await call('POST',f"/learner-tasks/{essay['id']}/start",role='learner')
        await call('POST',f"/learner-tasks/{essay['id']}/complete",role='learner',json={'result_text':'First draft'})
        await call('POST',f"/learner-tasks/{essay['id']}/review",expected=422,json={'action':'return'})
        await call('POST',f"/learner-tasks/{essay['id']}/review",json={'action':'return','comment':'Add examples'})
        await call('POST',f"/learner-tasks/{essay['id']}/complete",role='learner',json={'result_text':'Revised essay'})
        await call('POST',f"/roadmap-tasks/{essay['id']}/review",json={'action':'approve'})
        await call('POST',f"/learner-tasks/{essay['id']}/review",expected=409,json={'action':'approve'})
        plan=await call('GET',f'/activities/participations/{pid}',role='learner')
        assert plan['steps']['done']==2 and plan['status']!='completed'
        await call('POST',f'/activities/participations/{pid}/result',role='learner',json={'text':'Participation finished'})
        board=await call('GET','/activities/staff/participations?view=waiting')
        assert any(t['id']==pid and t['column']=='review' for t in board['items'])
        await call('POST',f'/activities/participations/{pid}/result/review',json={'action':'return','comment':'Add the final result'})
        await call('POST',f'/activities/participations/{pid}/result',role='learner',json={'text':'Received participation certificate'})
        await call('POST',f'/activities/participations/{pid}/result/review',json={'action':'approve'})
        plan=await call('GET',f'/activities/participations/{pid}',role='learner')
        assert plan['status']=='completed' and plan['result_review_status']=='approved'
        # Late certificate upload remains possible after final acceptance.
        await call('POST','/portfolio-documents/upload',role='learner',files={'file':('certificate.pdf',b'fixture certificate','application/pdf')},data={'participation_id':pid,'doc_type':'certificate'})
        # A second activity tests recommendation, refusal and mentor resumption.
        async with sessions() as db:
            second = ActivityIntake(activity_id=activity.id,label='Another intake',mode='rolling'); db.add(second); await db.commit()
        next_payload={**payload,'intake_id':str(second.id),'decision':'suggested','recipients':[{'student_id':str(student.id),'steps':[{'title':'Another step'}]}]}
        issued=await call('POST','/activities/assignments',json=next_payload)
        next_pid=issued['results'][0]['participation_id']
        await call('PATCH',f'/activities/my/participations/{next_pid}',role='learner',json={'decision':'selected'})
        await call('PATCH',f'/activities/my/participations/{next_pid}',role='learner',json={'decision':'not_interested','decline_reason':'No time'})
        active=await call('GET','/portal/tasks',role='learner')
        assert not any(t['activity_participation_id']==next_pid for t in active)
        await call('POST',f'/activities/participations/{next_pid}/resume')
        active=await call('GET','/portal/tasks',role='learner')
        assert any(t['activity_participation_id']==next_pid for t in active)
        # Adding a task can be retried after a lost response without duplication.
        extra={'student_id':str(student.id),'title':'Idempotent step','activity_participation_id':next_pid,'creation_key':str(uuid.uuid4())}
        one=await call('POST','/learner-tasks',expected=201,json=extra)
        two=await call('POST','/learner-tasks',expected=201,json=extra)
        assert one['id']==two['id']
    async with sessions() as db:
        orphan_count=(await db.execute(select(func.count()).select_from(RoadmapTask).where(RoadmapTask.student_id.is_(None)))).scalar_one()
        assert orphan_count==0
    await engine.dispose()
