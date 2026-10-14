import asyncio
from datetime import datetime, timezone, timedelta
from types import SimpleNamespace
import unittest
import uuid
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from pydantic import ValidationError
from app.api.v1.endpoints.students import update_student, _student_to_dict
from app.models.contract import Contract, PipelineStatus
from app.models.student import Student, DegreeLevel
from app.models.user import User, UserRole
from app.schemas.student import StudentUpdate


class Result:
    def __init__(self, value): self.value = value
    def scalar_one_or_none(self): return self.value
    def scalar_one(self): return self.value


class DB:
    def __init__(self, student, contract):
        self.student = student
        self.results = iter([student, contract, student])
        self.added = []
        self.committed = False
    async def execute(self, statement): return Result(next(self.results))
    def add(self, row): self.added.append(row)
    async def flush(self):
        for row in self.added: row.id = uuid.uuid4()
    async def commit(self): self.committed = True


class StudentProcessTests(unittest.TestCase):
    def test_patch_can_finish_work_and_change_year_without_archiving(self):
        for role in [UserRole.admin, UserRole.mzk_manager, UserRole.academic_head, UserRole.mentor]:
            with self.subTest(role=role):
                student = Student(id=uuid.uuid4(), intake_year=2026, is_archived=False)
                contract = Contract(id=uuid.uuid4(), student_id=student.id, pipeline_status=PipelineStatus.active_work)
                db = DB(student, contract)
                with patch('app.api.v1.endpoints.students.require_student_access', new_callable=AsyncMock), patch('app.api.v1.endpoints.students.log_change', new_callable=AsyncMock) as audit, patch('app.api.v1.endpoints.students._student_to_dict', return_value={}):
                    asyncio.run(update_student(student.id, StudentUpdate(intake_year=2027, pipeline_status='completed_admitted'), db, User(id=uuid.uuid4(), role=role)))
                self.assertEqual(student.intake_year, 2027)
                self.assertEqual(contract.pipeline_status, PipelineStatus.completed_admitted)
                self.assertFalse(student.is_archived)
                self.assertTrue(db.committed)
                self.assertEqual(audit.await_count, 2)

    def test_student_cannot_change_staff_work_status(self):
        with self.assertRaises(HTTPException) as caught:
            asyncio.run(update_student(uuid.uuid4(), StudentUpdate(pipeline_status='changed_mind'), None, User(role=UserRole.student)))
        self.assertEqual(caught.exception.status_code, 403)

    def test_no_contract_still_allows_work_status(self):
        student = Student(id=uuid.uuid4(), intake_year=2026, is_archived=False)
        db = DB(student, None)
        with patch('app.api.v1.endpoints.students.require_student_access', new_callable=AsyncMock), patch('app.api.v1.endpoints.students.log_change', new_callable=AsyncMock), patch('app.api.v1.endpoints.students._student_to_dict', return_value={}):
            asyncio.run(update_student(student.id, StudentUpdate(pipeline_status='changed_mind'), db, User(id=uuid.uuid4(), role=UserRole.mentor)))
        self.assertEqual(len(db.added), 1)
        self.assertEqual(db.added[0].pipeline_status, PipelineStatus.changed_mind)
        self.assertFalse(student.is_archived)

    def test_invalid_year_and_status_rejected(self):
        for body in [{'intake_year': None}, {'intake_year': 12}, {'pipeline_status': None}, {'pipeline_status': 'garbage'}]:
            with self.subTest(body=body), self.assertRaises(ValidationError): StudentUpdate(**body)
        self.assertEqual(StudentUpdate().model_dump(exclude_unset=True), {})

    def test_serializer_uses_latest_contract_even_when_relationship_is_unsorted(self):
        now = datetime.now(timezone.utc)
        base = dict(id=uuid.uuid4(), full_name='Test', phone='', city=None, age=None, degree_level=DegreeLevel.undergraduate, specialty=None, group_direction=None, additional_sphere=None, gpa=None, achievements_text=None, budget_per_year=None, transcript_resume_url=None, intake_year=2027, intake_season=None, work_folder_url=None, work_phone=None, is_archived=False, created_at=now, updated_at=now, applications=[], services=[], portfolio_progress=None, documents=[], student_tasks=[], mentor_assignments=[], communication_logs=[], pending_insights=[], notes=[])
        old = Contract(id=uuid.uuid4(), created_at=now-timedelta(days=1), pipeline_status=PipelineStatus.active_work)
        new = Contract(id=uuid.uuid4(), created_at=now, pipeline_status=PipelineStatus.completed_admitted)
        student = SimpleNamespace(**base, contracts=[old, new])
        self.assertEqual(_student_to_dict(student)['pipeline_status'], 'completed_admitted')
        student.contracts = []
        self.assertIsNone(_student_to_dict(student)['pipeline_status'])


class ArchivedIntakeTests(unittest.TestCase):
    def test_mass_creation_detects_archived_student_and_does_not_recreate(self):
        from app.services.intake_promote import promote_new_submissions
        from app.models.intake_submission import IntakeSource, IntakeStatus
        sid = uuid.uuid4()
        submission = SimpleNamespace(id=uuid.uuid4(), source=IntakeSource.cases, full_name='Anna Example', phone_normalized='+77001234567', status=IntakeStatus.new, suggested_student_id=None, suggested_confidence=None, match_candidate_ids=[], identity_review_required=False)
        archived = SimpleNamespace(id=sid, full_name='Anna Example', phone='+77001234567', intake_year=2026, user_id=None, city=None)
        class Rows:
            def __init__(self, rows): self.rows = rows
            def scalars(self): return self
            def all(self): return self.rows
        class Session:
            def __init__(self): self.calls=0
            async def execute(self, query):
                self.calls += 1
                if self.calls == 3:
                    # The actual index query must include archived cards.
                    self_query = str(query)
                    if 'is_archived' in self_query: raise AssertionError(self_query)
                    return Rows([archived])
                return Rows([submission])
        with patch('app.services.intake_promote.create_student_from_intake', new_callable=AsyncMock) as create:
            result = asyncio.run(promote_new_submissions(Session(), actor_id=None))
        self.assertEqual(result['created'], 0)
        self.assertEqual(result['skipped'], 1)
        self.assertEqual(submission.suggested_student_id, sid)
        create.assert_not_awaited()
