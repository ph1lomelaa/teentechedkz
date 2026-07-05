from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.confidential_note import NoteVisibility


class ConfidentialNoteCreate(BaseModel):
    """
    Payload for creating a confidential note on a student.

    `note_text` is accepted as plaintext; the service layer must encrypt
    it before persisting to the database.
    """

    student_id: uuid.UUID
    note_text: str  # plaintext — encrypted before storing
    visible_to_role: NoteVisibility


class ConfidentialNoteResponse(BaseModel):
    """
    Decrypted confidential note.

    The service layer must decrypt `note_text_encrypted` from the database
    and populate `note_text` before constructing this response.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    student_id: uuid.UUID
    note_text: str  # decrypted at the service layer
    visible_to_role: NoteVisibility
    created_by: uuid.UUID
    created_by_name: str | None = None  # resolved from join / eager-loaded relation
    created_at: datetime
