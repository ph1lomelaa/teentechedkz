"""Pipeline titles must not hide a known student's name behind a Notion placeholder."""
import uuid
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase, TestCase, mock

from app.api.v1.endpoints import notion
from app.api.v1.endpoints.notion import _pipeline_display_name
from app.models.user import UserRole
from app.models.notion_snapshot import NotionMatchStatus, NotionSnapshot


class PipelineNameTests(TestCase):
    def snapshot(self, **kwargs):
        return NotionSnapshot(student_id=uuid.uuid4(), status=NotionMatchStatus.linked,
                              full_name=kwargs.get('full_name'), raw_properties=kwargs.get('raw', {'е': '='}),
                              normalized_data=kwargs.get('normalized', {}))

    def test_real_title_survives_placeholder_in_old_column(self):
        snapshot = self.snapshot(full_name='Улжан Зиядина')
        self.assertEqual(_pipeline_display_name(snapshot, {}), 'Улжан Зиядина')
        self.assertEqual(snapshot.raw_properties['е'], '=')

    def test_renamed_title_column_uses_extracted_name(self):
        snapshot = self.snapshot(full_name='Дүйсенбай Исмаил', raw={'Имя студента': 'Дүйсенбай Исмаил'})
        self.assertEqual(_pipeline_display_name(snapshot, {}), 'Дүйсенбай Исмаил')

    def test_linked_crm_name_replaces_empty_or_placeholder_titles(self):
        for value in ('=', '', '   ', '-', '—', None):
            snapshot = self.snapshot(full_name=value, normalized={'full_name': value})
            with self.subTest(value=value):
                self.assertEqual(_pipeline_display_name(snapshot, {snapshot.student_id: 'Улжан Зиядина'}), 'Улжан Зиядина')

    def test_normalized_name_and_original_column_are_fallbacks(self):
        self.assertEqual(_pipeline_display_name(self.snapshot(normalized={'full_name': 'Аян'}), {}), 'Аян')
        self.assertEqual(_pipeline_display_name(self.snapshot(raw={'е': 'Дана'}), {}), 'Дана')

    def test_unconfirmed_student_link_cannot_supply_name(self):
        snapshot = self.snapshot()
        snapshot.status = NotionMatchStatus.new
        self.assertEqual(_pipeline_display_name(snapshot, {snapshot.student_id: 'Чужое имя'}), 'Без имени')

    def test_existing_meaningful_notion_name_is_preserved(self):
        snapshot = self.snapshot(full_name='Имя в Notion')
        self.assertEqual(_pipeline_display_name(snapshot, {snapshot.student_id: 'Имя CRM'}), 'Имя в Notion')


class PipelineTableNameTests(IsolatedAsyncioTestCase):
    async def test_response_resolves_linked_names_without_writing_mirror(self):
        student_id = uuid.uuid4()
        snapshot = NotionSnapshot(id=uuid.uuid4(), notion_page_id='page', student_id=student_id,
                                 status=NotionMatchStatus.linked, full_name='=',
                                 raw_properties={'е': '=', 'Intake': 2026, 'Lead-Mentor': 'Улжан'},
                                 normalized_data={'full_name': '='})
        def scalars(items):
            return SimpleNamespace(scalars=lambda: items)
        db = mock.MagicMock()
        db.execute = mock.AsyncMock(side_effect=[
            scalars([snapshot]),
            SimpleNamespace(all=lambda: [(student_id, 'Улжан Зиядина')]),
            scalars([]), scalars([]), scalars([]),
        ])
        user = SimpleNamespace(role=UserRole.admin, permission_overrides=None)
        with mock.patch.object(notion.notion_sync, 'is_configured', return_value=False):
            response = await notion.pipeline_table(db, user, source_only=True)
        self.assertEqual(response['items'][0]['values']['е'], 'Улжан Зиядина')
        self.assertEqual(response['items'][0]['values']['Lead-Mentor'], 'Улжан')
        self.assertEqual(response['items'][0]['student_id'], str(student_id))
        self.assertEqual(snapshot.raw_properties['е'], '=')
        db.add.assert_not_called(); db.commit.assert_not_called()
