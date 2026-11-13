"""Конспект из пометок ментора: с ИИ или «как написано»."""
import asyncio
import uuid
from types import SimpleNamespace
from unittest import mock

from app.models.note_session import NoteSessionStatus
from app.models.student_note import StudentNote
from app.services import note_session_finalize as fin


class _Db:
    def __init__(self):
        self.added = []

    def add(self, row):
        self.added.append(row)

    async def flush(self):
        for row in self.added:
            if getattr(row, "id", None) is None:
                row.id = uuid.uuid4()


def _session():
    return SimpleNamespace(student_id=uuid.uuid4(), title="Созвон: Activity List", note_id=None,
                           status=NoteSessionStatus.active, ended_at=None, last_heartbeat_at=None)


TEXT = "- Олимпиада по математике — оставляем\n- Курсы рисования — убираем"


def test_without_ai_saves_text_as_written():
    session, db = _session(), _Db()
    with mock.patch.object(fin, "generate_note_draft", mock.AsyncMock(side_effect=AssertionError("ИИ не нужен"))):
        note = asyncio.run(fin.build_note_for_session(db, session, source_text=TEXT, student=None,
                                                      student_name="Асель", actor_id=uuid.uuid4(), use_ai=False))
    assert isinstance(note, StudentNote)
    assert note.summary_markdown == TEXT and note.student_summary_markdown == TEXT
    assert note.title == "Созвон: Activity List" and note.suggested_changes == {}
    assert session.note_id == note.id and session.status == NoteSessionStatus.completed


def test_with_ai_goes_through_draft():
    session, db = _session(), _Db()
    draft = {"title": "Итоги", "summary_markdown": "## Итоги", "student_summary_markdown": "Итоги", "suggested_changes": {}}
    with mock.patch.object(fin, "generate_note_draft", mock.AsyncMock(return_value=draft)) as gen, \
         mock.patch.object(fin, "add_note_ai_run", mock.Mock()):
        note = asyncio.run(fin.build_note_for_session(db, session, source_text=TEXT, student=None,
                                                      student_name="Асель", actor_id=uuid.uuid4()))
    gen.assert_awaited_once()
    assert note.summary_markdown == "## Итоги"
