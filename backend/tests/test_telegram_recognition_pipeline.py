import json
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, Mock, patch

from app.models.student import Student
from app.models.pending_insight import PendingInsight
from app.models.ai_analysis_run import AiAnalysisRun
from app.models.user import UserRole
from app.services import telegram_extraction as extraction
from app.services.telegram_recognition_context import message_roles, preceding_context

class Rows:
    def __init__(self, rows): self.rows=rows
    def scalars(self): return self
    def all(self): return self.rows


def message(**overrides):
    return SimpleNamespace(**(dict(id=uuid.uuid4(),chat_id=uuid.uuid4(),session_id=uuid.uuid4(),
        created_at=datetime.now(timezone.utc),raw_text='Я переехала в Алматы.',raw_payload={},
        sent_by_user_id=None,sender_tg_id=None,sender_name='Участник')|overrides))

class TelegramRecognitionPipelineTests(IsolatedAsyncioTestCase):
    async def test_valid_fact_is_audited_and_proposed_without_changing_student(self):
        m=message();student=Student(id=uuid.uuid4(),full_name='Тестовый Студент',city='Астана')
        db=SimpleNamespace(get=AsyncMock(side_effect=[SimpleNamespace(student_id=student.id),student]),add=Mock())
        payload={'proposed_changes':{'city':'Алматы'},'change_evidence':{'city':{'quote':m.raw_text,'kind':'confirmed_fact','subject':'student','confidence':.99,'operation':'set'}},'confidence':.99}
        with patch.object(extraction,'_sent_by_staff',new_callable=AsyncMock,return_value=False),patch.object(extraction,'_is_broadcast',new_callable=AsyncMock,return_value=False),patch.object(extraction,'provider_chain',return_value=['test']),patch.object(extraction,'preceding_context',new_callable=AsyncMock,return_value='[]'),patch.object(extraction,'_same_change_pending',new_callable=AsyncMock,return_value=False),patch.object(extraction,'complete_with_fallback',new_callable=AsyncMock,return_value=json.dumps(payload)) as ai:
            insight=await extraction.extract_insight_from_message(db,m)
        assert isinstance(insight,PendingInsight) and insight.proposed_changes=={'city':'Алматы'}
        assert student.city=='Астана' and insight.reviewed_by is None
        assert any(isinstance(call.args[0],AiAnalysisRun) for call in db.add.call_args_list)
        assert json.loads(ai.call_args.args[1])['new_message']['text']==m.raw_text

    async def test_old_context_cannot_become_a_change_from_a_new_thank_you_message(self):
        m=message(raw_text='Спасибо!');student=Student(id=uuid.uuid4(),full_name='Тестовый Студент')
        db=SimpleNamespace(get=AsyncMock(side_effect=[SimpleNamespace(student_id=student.id),student]),add=Mock())
        payload={'proposed_changes':{'city':'Алматы'},'change_evidence':{'city':{'quote':'Я переехала в Алматы.','kind':'confirmed_fact','subject':'student','confidence':.99,'operation':'set'}},'confidence':.99}
        with patch.object(extraction,'_sent_by_staff',new_callable=AsyncMock,return_value=False),patch.object(extraction,'_is_broadcast',new_callable=AsyncMock,return_value=False),patch.object(extraction,'provider_chain',return_value=['test']),patch.object(extraction,'preceding_context',new_callable=AsyncMock,return_value='[{"text":"Я переехала в Алматы."}]'),patch.object(extraction,'complete_with_fallback',new_callable=AsyncMock,return_value=json.dumps(payload)):
            assert await extraction.extract_insight_from_message(db,m) is None
        audit=db.add.call_args.args[0]
        assert audit.filter_reasons=={'city':'quote_not_in_source'} and audit.status=='filtered'

    async def test_known_staff_role_overrides_an_incorrect_participant_label(self):
        m=message(sender_tg_id=123)
        identity=SimpleNamespace(chat_id=m.chat_id,telegram_user_id=123,user_id=uuid.uuid4(),student_id=None,role='student')
        user=SimpleNamespace(id=identity.user_id,telegram_id='123',role=UserRole.mzk_manager)
        db=SimpleNamespace(execute=AsyncMock(side_effect=[Rows([identity]),Rows([user])]))
        assert (await message_roles(db,[m]))[m.id]=='staff'

    async def test_display_name_never_invents_a_role(self):
        m=message(sender_name='Ментор')
        db=SimpleNamespace(execute=AsyncMock())
        assert (await message_roles(db,[m]))[m.id]=='unknown'
        db.execute.assert_not_awaited()

    async def test_history_is_scoped_to_binding_and_does_not_include_future_messages(self):
        m=message();db=SimpleNamespace(execute=AsyncMock(return_value=Rows([m])))
        with patch('app.services.telegram_recognition_context.format_context',new_callable=AsyncMock,return_value='[]'):
            await preceding_context(db,m)
        statement=db.execute.call_args.args[0]
        params=statement.compile().params.values()
        assert m.chat_id in params and m.session_id in params and m.created_at in params
        assert '<=' in str(statement) and 'LIMIT' in str(statement)

    async def test_another_known_student_in_a_group_is_not_the_profile_subject(self):
        m=message(sender_tg_id=123)
        user=SimpleNamespace(id=uuid.uuid4(),telegram_id='123',role=UserRole.student)
        other_student=SimpleNamespace(id=uuid.uuid4(),user_id=user.id)
        db=SimpleNamespace(execute=AsyncMock(side_effect=[Rows([]),Rows([user]),Rows([other_student])]))
        assert (await message_roles(db,[m],student_id=uuid.uuid4()))[m.id]=='other_student'

    async def test_confirmed_staff_identity_also_prevents_profile_extraction(self):
        m=message(sender_tg_id=123)
        user=SimpleNamespace(id=uuid.uuid4(),telegram_id='123',role=UserRole.student)
        identity=SimpleNamespace(chat_id=m.chat_id,telegram_user_id=123,user_id=user.id,student_id=None,role='mentor')
        db=SimpleNamespace(execute=AsyncMock(side_effect=[Rows([identity]),Rows([user])]))
        assert (await message_roles(db,[m]))[m.id]=='staff'
