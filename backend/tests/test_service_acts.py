import copy
from datetime import date, datetime, timezone
from decimal import Decimal
from io import BytesIO
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, MagicMock, patch
import uuid

from fastapi import HTTPException
from pydantic import ValidationError
from pypdf import PdfReader

from app.api.v1.endpoints import acts
from app.core.permissions import allows, Action, scope_for, Scope
from app.models.service_act import ServiceAct
from app.models.user import UserRole
from app.schemas.service_act import ActInput, ActMailInput, ActMailResolution
from app.services.act_pdf import render_act
from app.services import mailer
from scripts.sync_trustme import classify


def payload():
    return dict(contract_link_id=str(uuid.uuid4()), template="ielts", student_name="Тест Әлия Нұрланқызы",
        customer_name="Тест Заказчик", executor_name="ТОО Тестовая компания", executor_representative="Тест Директор",
        executor_basis="Устава", contract_number="TEST-671", contract_date="2026-07-28", act_date="2026-11-01",
        city="Алматы", period_start="2026-10-01", period_end="2026-10-31", include_amount=True, currency="KZT",
        lines=[dict(name="Подготовка IELTS", result="Проведены занятия по Writing и Speaking.",
            evidence="Внутренняя ссылка: материалы уроков", contract_source="Приложение 1, стр. 18", quantity="3", unit="занятия", unit_price="1200.15")],
        verified=True)


def user(role=UserRole.admin):
    return SimpleNamespace(id=uuid.uuid4(), name="Test", role=role, permission_grants=[])


def record(sid=None):
    return SimpleNamespace(id=uuid.uuid4(), student_id=sid or uuid.uuid4(), contract_link_id=uuid.uuid4(),
        snapshot=ActInput(**payload()).model_dump(mode="json"), status="ready", storage_path="test.pdf",
        file_name="Тест Әлия - Акт.pdf", shared_at=None, supersedes_id=None, created_at=datetime.now(timezone.utc))


class ActSchemaAndPdfTests(unittest.TestCase):
    def test_requires_name_and_surname_and_rejects_invalid_dates(self):
        for changes in ({"student_name": "Әлия"}, {"period_end": "2026-09-01"},
                        {"act_date": "2026-10-10"}, {"contract_date": "2027-01-01"}):
            with self.subTest(changes=changes), self.assertRaises(ValidationError):
                ActInput(**{**payload(), **changes})

    def test_amount_requires_every_price_and_uses_decimal(self):
        data = ActInput(**payload())
        self.assertEqual(data.total, Decimal("3600.45"))
        raw = payload(); raw["lines"][0]["unit_price"] = None
        with self.assertRaises(ValidationError):
            ActInput(**raw)
        raw["include_amount"] = False
        self.assertFalse(ActInput(**raw).include_amount)

    def test_contract_total_is_used_when_services_have_no_prices(self):
        raw = payload(); raw["lines"][0]["unit_price"] = None; raw["contract_total"] = "1800000"
        data = ActInput(**raw)
        self.assertEqual(data.total, Decimal("1800000"))
        text = "\n".join(p.extract_text() for p in PdfReader(BytesIO(render_act(data))).pages)
        self.assertIn("1 800 000 (один миллион восемьсот тысяч) тенге", " ".join(text.split()))
        raw["lines"][0]["unit_price"] = "100"
        with self.assertRaises(ValidationError):
            ActInput(**raw)

    def test_mixed_services_act_has_readable_file_name(self):
        data = ActInput(**{**payload(), "template": "stages"})
        self.assertIn("Акт оказанных услуг", data.filename())

    def test_final_requires_separate_confirmation(self):
        data = ActInput(**{**payload(), "template": "final"})
        with self.assertRaises(ValueError):
            data.require_verified()
        data.full_completion_confirmed = True
        data.require_verified()

    def test_pdf_preserves_kazakh_names_decimal_and_partial_scope(self):
        data = ActInput(**payload())
        content = render_act(data)
        self.assertTrue(content.startswith(b"%PDF-"))
        reader = PdfReader(BytesIO(content))
        text = "\n".join(p.extract_text() for p in reader.pages)
        for required in (data.student_name, "TEST-671", "3 600.45", "Writing", "в части перечисленных услуг"):
            self.assertIn(required, text)
        self.assertNotIn("полное исполнение", text)
        self.assertNotIn("Внутренняя ссылка", text)  # Internal evidence stays internal.
        self.assertTrue(data.filename().startswith(data.student_name))

    def test_preview_is_labelled_and_variable_text_is_escaped(self):
        data = ActInput(**{**payload(), "customer_name": "Заказчик <b>имя</b> & семья"})
        text = "".join(p.extract_text() for p in PdfReader(BytesIO(render_act(data, draft=True))).pages)
        self.assertIn("ПРЕДПРОСМОТР", text)
        self.assertIn("<b>имя</b>", text)

    def test_roles_and_scope(self):
        for role in UserRole:
            self.assertEqual(allows(resource="acts", action=Action.manage, role=role), role in (UserRole.admin, UserRole.mzk_manager, UserRole.academic_head))
        self.assertIs(scope_for(resource="acts", action=Action.view, role=UserRole.mentor), Scope.assigned)

    def test_sync_never_confuses_partial_search_with_no_match(self):
        self.assertEqual(classify([], True), "incomplete_or_error")
        self.assertEqual(classify([], False), "not_found")
        self.assertEqual(classify([{"contractStatus": 4}], False), "unsigned_only")
        self.assertEqual(classify([{"contractStatus": 3}], False), "one_candidate")
        self.assertEqual(classify([{"contractStatus": 3}] * 2, False), "multiple_candidates")

    def test_attachment_does_not_change_password_reset_message(self):
        with patch.object(mailer, '_from_address', return_value='test@example.test'):
            message = mailer.build_message(to='to@example.test', subject='Test', text='Text')
        self.assertEqual(list(message.iter_attachments()), [])


class ActApiTests(unittest.IsolatedAsyncioTestCase):
    async def test_mentor_cannot_create(self):
        db = SimpleNamespace(get=AsyncMock())
        with self.assertRaises(HTTPException) as error:
            await acts.create_draft(uuid.uuid4(), ActInput(**payload()), db, user(UserRole.mentor))
        self.assertEqual(error.exception.status_code, 403)
        db.get.assert_not_awaited()

    async def test_mentor_cannot_view_unassigned_student(self):
        db = SimpleNamespace(execute=AsyncMock(return_value=SimpleNamespace(first=lambda: None)), get=AsyncMock())
        with self.assertRaises(HTTPException) as error:
            await acts._student(db, uuid.uuid4(), user(UserRole.mentor))
        self.assertEqual(error.exception.status_code, 404)
        db.get.assert_not_awaited()

    async def test_generated_pdf_cannot_be_edited(self):
        with patch.object(acts, '_act', AsyncMock(return_value=record())):
            with self.assertRaises(HTTPException) as error:
                await acts.update_draft(uuid.uuid4(), ActInput(**payload()), object(), user())
        self.assertEqual(error.exception.status_code, 409)

    async def test_generation_checks_verification_before_calling_trustme(self):
        row = record(); row.status = 'draft'; row.snapshot['verified'] = False
        with patch.object(acts, '_act', AsyncMock(return_value=row)), patch.object(acts, '_verify_contract', AsyncMock()) as verify:
            with self.assertRaises(HTTPException) as error:
                await acts.generate(row.id, object(), user())
        self.assertEqual(error.exception.status_code, 422)
        verify.assert_not_awaited()

    async def test_repeated_generation_does_not_upload_again(self):
        row = record()
        with patch.object(acts, '_act', AsyncMock(return_value=row)), patch.object(acts, 'minio_upload', AsyncMock()) as upload:
            result = await acts.generate(row.id, object(), user())
        self.assertEqual(result['status'], 'ready'); upload.assert_not_awaited()

    async def test_storage_is_cleaned_up_after_database_failure(self):
        row = record(); row.status = 'draft'
        db = SimpleNamespace(commit=AsyncMock(side_effect=RuntimeError('db')), rollback=AsyncMock(), add=MagicMock())
        with patch.object(acts, '_act', AsyncMock(return_value=row)), patch.object(acts, '_validate_input', AsyncMock(return_value=object())), patch.object(acts, '_verify_contract', AsyncMock()), patch.object(acts, 'validate_service_lines'), patch.object(acts, 'validate_company_signature'), patch.object(acts, '_check_work_evidence', AsyncMock()), patch.object(acts, '_check_duplicate_work', AsyncMock()), patch.object(acts, 'minio_upload', AsyncMock(return_value='created.pdf')), patch.object(acts, 'minio_delete', AsyncMock()) as delete:
            with self.assertRaises(RuntimeError):
                await acts.generate(row.id, db, user())
        db.rollback.assert_awaited_once(); delete.assert_awaited_once_with('created.pdf')

    async def test_wrong_student_cannot_download_portal_pdf(self):
        db = SimpleNamespace(get=AsyncMock(return_value=record()))
        with patch.object(acts, 'minio_download', AsyncMock()) as download:
            with self.assertRaises(HTTPException) as error:
                await acts.portal_pdf(uuid.uuid4(), SimpleNamespace(id=uuid.uuid4()), db)
        self.assertEqual(error.exception.status_code, 404); download.assert_not_awaited()

    async def test_unshared_pdf_is_not_available_in_portal(self):
        row = record(); db = SimpleNamespace(get=AsyncMock(return_value=row))
        with self.assertRaises(HTTPException) as error:
            await acts.portal_pdf(row.id, SimpleNamespace(id=row.student_id), db)
        self.assertEqual(error.exception.status_code, 404)

    async def test_send_is_idempotent_and_does_not_resend(self):
        row = record(); body = ActMailInput(request_id=uuid.uuid4(), recipient='test@example.com', subject='Test', body='Text')
        existing = SimpleNamespace(id=body.request_id, act_id=row.id, recipient=str(body.recipient), subject=body.subject, body=body.body,
            status='sent', created_at=datetime.now(timezone.utc), finished_at=None)
        db = SimpleNamespace(get=AsyncMock(return_value=existing))
        with patch.object(acts, '_act', AsyncMock(return_value=row)), patch.object(mailer, 'send_pdf', AsyncMock()) as send:
            result = await acts.send(row.id, body, db, user())
        self.assertEqual(result['status'], 'sent'); send.assert_not_awaited()

    async def test_mail_resolution_records_manual_confirmation_without_sending(self):
        row = record()
        attempt = SimpleNamespace(id=uuid.uuid4(), act_id=row.id, status='unknown',
            recipient='test@example.com', subject='Test', body='Text',
            created_at=datetime.now(timezone.utc), finished_at=None)
        db = SimpleNamespace(get=AsyncMock(return_value=attempt), commit=AsyncMock())
        with patch.object(acts, '_act', AsyncMock(return_value=row)), patch.object(acts, 'log_change', AsyncMock()) as audit:
            result = await acts.resolve_mail(row.id, attempt.id,
                ActMailResolution(outcome='sent', note='Письмо проверено в отправленных'), db, user())
        self.assertEqual(result['status'], 'confirmed_sent')
        audit.assert_awaited_once(); db.commit.assert_awaited_once()

    async def test_active_mail_send_cannot_be_manually_unlocked(self):
        row = record()
        attempt = SimpleNamespace(id=uuid.uuid4(), act_id=row.id, status='sending',
            created_at=datetime.now(timezone.utc))
        db = SimpleNamespace(get=AsyncMock(return_value=attempt), commit=AsyncMock())
        with patch.object(acts, '_act', AsyncMock(return_value=row)):
            with self.assertRaises(HTTPException) as error:
                await acts.resolve_mail(row.id, attempt.id,
                    ActMailResolution(outcome='not_sent', note='Письмо проверено в отправленных'), db, user())
        self.assertEqual(error.exception.status_code, 409)
        db.commit.assert_not_awaited()

    async def test_mail_intent_is_committed_before_sending_and_timeout_is_unknown(self):
        row = record(); attempts = []
        db = SimpleNamespace(get=AsyncMock(return_value=None), execute=AsyncMock(return_value=SimpleNamespace(first=lambda: None)),
            add=lambda x: attempts.append(x), commit=AsyncMock())
        async def external(**kwargs):
            self.assertEqual(db.commit.await_count, 1)
            self.assertEqual(attempts[0].status, 'sending')
            raise TimeoutError('ambiguous')
        with patch.object(acts, '_act', AsyncMock(return_value=row)), patch.object(mailer, 'is_configured', return_value=True), patch.object(acts, 'minio_download', AsyncMock(return_value=b'%PDF-test')), patch.object(mailer, 'send_pdf', side_effect=external):
            # SQLAlchemy normally populates the insert timestamp during commit.
            async def commit():
                if attempts: attempts[0].created_at = datetime.now(timezone.utc)
            db.commit.side_effect = commit
            result = await acts.send(row.id, ActMailInput(request_id=uuid.uuid4(), recipient='test@example.com', subject='Test', body='Text'), db, user())
        self.assertEqual(result['status'], 'unknown')


if __name__ == '__main__':
    unittest.main()


class ActDeletionTests(unittest.IsolatedAsyncioTestCase):
    async def test_removes_act_with_audit(self):
        act = record()
        db = SimpleNamespace(execute=AsyncMock(return_value=MagicMock()), delete=AsyncMock(), commit=AsyncMock())
        db.execute.return_value.scalars.return_value.all.return_value = []
        db.execute.return_value.first.return_value = None
        with patch.object(acts, '_act', AsyncMock(return_value=act)), patch.object(acts, 'log_change', AsyncMock()) as audit:
            response = await acts.delete_act(act.id, db, user())
        self.assertEqual(response.status_code, 204)
        db.delete.assert_awaited_once_with(act)
        db.commit.assert_awaited_once()
        self.assertEqual(audit.call_args.args[3], 'act_deleted')

    async def test_unresolved_send_prevents_deletion(self):
        act = record()
        db = SimpleNamespace(execute=AsyncMock(return_value=MagicMock()), delete=AsyncMock())
        db.execute.return_value.scalars.return_value.all.return_value = [SimpleNamespace(status='sending')]
        with patch.object(acts, '_act', AsyncMock(return_value=act)), self.assertRaises(HTTPException) as caught:
            await acts.delete_act(act.id, db, user())
        self.assertEqual(caught.exception.status_code, 409)
        db.delete.assert_not_awaited()

    async def test_replacement_prevents_deletion(self):
        act = record()
        db = SimpleNamespace(execute=AsyncMock(return_value=MagicMock()), delete=AsyncMock())
        db.execute.return_value.scalars.return_value.all.return_value = []
        db.execute.return_value.first.return_value = (uuid.uuid4(),)
        with patch.object(acts, '_act', AsyncMock(return_value=act)), self.assertRaises(HTTPException):
            await acts.delete_act(act.id, db, user())
        db.delete.assert_not_awaited()


class InspectionFallbackTests(unittest.TestCase):
    def test_unavailable_pdf_still_offers_five_standard_services_without_invented_fields(self):
        link=SimpleNamespace(id=uuid.uuid4())
        profile, warning=acts._inspection_fallback(None,link)
        self.assertEqual({s['category'] for s in profile['services']},{'ielts','career','csca','entrance','sat','portfolio'})
        self.assertTrue(all(s['source_kind']=='standard' for s in profile['services']))
        self.assertEqual(profile['fields'],{})
        self.assertEqual(profile['extractor'],0)
        self.assertEqual(profile['source_pages'],[])
        self.assertEqual(profile['fingerprint_kind'],'document_reference')
        self.assertIn('Не удалось прочитать PDF',warning)
        self.assertEqual(profile['fingerprint'],acts._inspection_fallback(None,link)[0]['fingerprint'])

    def test_upstream_failure_preserves_cached_descriptions_and_manual_requisites(self):
        previous={'fields':{'contract_number':'MANUAL-123'},'services':[{'text':'Сохранённое описание'}]}
        profile, warning=acts._inspection_fallback(previous,SimpleNamespace(id=uuid.uuid4()))
        self.assertEqual(profile,previous)
        self.assertIn('сохранённые данные',warning)

class InspectionApiFallbackTests(unittest.IsolatedAsyncioTestCase):
    async def test_inspection_returns_standard_services_when_trustme_is_unavailable(self):
        from app.services.trustme import TrustMeError
        link=SimpleNamespace(id=uuid.uuid4(),status=3,financial_contract_id=None,signers=[])
        db=SimpleNamespace(execute=AsyncMock(return_value=MagicMock()),commit=AsyncMock())
        db.execute.return_value.scalars.return_value.all.return_value=[]
        with patch.object(acts,'_student',AsyncMock(return_value=SimpleNamespace(full_name='Тест Студент'))), patch.object(acts,'_link',AsyncMock(return_value=link)), patch.object(acts,'cached_profile',return_value=None), patch.object(acts,'_refresh_contract',AsyncMock(side_effect=TrustMeError('Unavailable'))), patch.object(acts,'store_profile') as store:
            result=await acts.inspect_contract(uuid.uuid4(),link.id,db,user())
        self.assertEqual(len(result['services']),6)
        self.assertTrue(result['warning'])
        self.assertEqual(result['fields'],{})
        self.assertTrue(result['missing'])
        store.assert_called_once()
        db.commit.assert_awaited_once()


class LinkLockTests(unittest.IsolatedAsyncioTestCase):
    async def _statement(self, **kwargs):
        from unittest.mock import AsyncMock, MagicMock
        from app.api.v1.endpoints import acts
        sid = uuid.uuid4()
        result = MagicMock(); result.scalar_one_or_none.return_value = SimpleNamespace(student_id=sid)
        db = SimpleNamespace(execute=AsyncMock(return_value=result))
        await acts._link(db, sid, uuid.uuid4(), **kwargs)
        return str(db.execute.await_args.args[0].compile(compile_kwargs={'literal_binds': False}))

    async def test_reading_does_not_lock_the_contract(self):
        self.assertNotIn('FOR UPDATE', await self._statement(lock=False))

    async def test_changes_still_lock_the_contract(self):
        self.assertIn('FOR UPDATE', await self._statement())


class TrustMeFallbackTests(unittest.IsolatedAsyncioTestCase):
    def _client(self):
        from unittest.mock import AsyncMock, MagicMock
        from app.services.trustme import TrustMeError
        client = MagicMock()
        client.__aenter__ = AsyncMock(side_effect=TrustMeError('Unavailable'))
        client.__aexit__ = AsyncMock(return_value=False)
        return client

    async def test_generate_uses_last_known_status_when_trustme_is_down(self):
        from unittest.mock import patch
        from app.api.v1.endpoints import acts
        link = SimpleNamespace(id=uuid.uuid4(), source='trustme', status=1, short_url='abc', company_id='c', external_id='e')
        with patch.object(acts, '_client', return_value=self._client()):
            await acts._verify_contract(link)
            link.status = 4
            with self.assertRaises(acts.HTTPException) as error:
                await acts._verify_contract(link)
        self.assertEqual(error.exception.status_code, 409)

    async def test_status_check_returns_cached_status_instead_of_error(self):
        from unittest.mock import AsyncMock, patch
        from app.api.v1.endpoints import acts
        from app.services.trustme import TrustMeError
        link = SimpleNamespace(id=uuid.uuid4(), status=3, profile_checked_at=None)
        db = SimpleNamespace(rollback=AsyncMock(), commit=AsyncMock())
        with patch.object(acts, '_student', AsyncMock()), patch.object(acts, '_link', AsyncMock(return_value=link)), \
             patch.object(acts, '_refresh_contract', AsyncMock(side_effect=TrustMeError('Unavailable'))):
            result = await acts.check_contract(uuid.uuid4(), link.id, db, SimpleNamespace())
        self.assertEqual((result['status'], result['stale']), (3, True))
        db.commit.assert_not_awaited()
