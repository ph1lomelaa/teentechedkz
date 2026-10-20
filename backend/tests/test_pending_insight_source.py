from datetime import datetime, timezone
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch
import uuid
from app.api.v1.endpoints.communication import list_all_pending_insights
from app.models.pending_insight import InsightStatus, InsightType, RiskLevel

class Rows:
    def __init__(self, items): self.items = items
    def scalars(self): return self
    def all(self): return self.items
    def __iter__(self): return iter(self.items)

class PendingInsightSourceTests(IsolatedAsyncioTestCase):
    async def check_source(self, present):
        sid, mid = uuid.uuid4(), uuid.uuid4()
        now = datetime.now(timezone.utc)
        insight = SimpleNamespace(id=uuid.uuid4(), student_id=sid, source_telegram_message_id=mid,
            insight_type=InsightType.status_update, proposed_changes={'city': 'Астана'}, unmatched_fields={},
            confidence=.95, risk_level=RiskLevel.low, status=InsightStatus.approved,
            reviewed_by=None, auto_applied=False, created_at=now, reviewed_at=None)
        message = SimpleNamespace(id=mid, chat_id=uuid.uuid4(), raw_text='Астана ' * 100, sender_name='Анна', created_at=now)
        db = SimpleNamespace(execute=AsyncMock(side_effect=[Rows([insight]), Rows([SimpleNamespace(id=sid, full_name='Анна')]), Rows([]), Rows([message] if present else [])]))
        with patch('app.api.v1.endpoints.communication.require_access'):
            result = await list_all_pending_insights(db, SimpleNamespace(id=uuid.uuid4()), status='resolved')
        self.assertEqual(result[0]['source_message_id'], str(mid) if present else None)
        self.assertEqual(result[0]['source_excerpt'], message.raw_text[:300] if present else None)
        self.assertEqual(result[0]['source_chat_id'], str(message.chat_id) if present else None)
        self.assertEqual(result[0]['source_sender'], 'Анна' if present else None)
        self.assertEqual(result[0]['source_created_at'], now.isoformat() if present else None)
    async def test_links_to_actual_source_message(self): await self.check_source(True)
    async def test_deleted_source_does_not_produce_broken_link(self): await self.check_source(False)
