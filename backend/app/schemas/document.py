from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict

from app.models.document import DocType, DocSource


class DocumentResponse(BaseModel):
    """Full document metadata record including the resolved uploader name."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    student_id: uuid.UUID
    uploaded_by: uuid.UUID
    doc_type: DocType
    file_name: str
    file_size: int
    mime_type: str
    storage_path: str
    source: DocSource
    ai_description: str | None = None
    ai_doc_type_confidence: float | None = None
    is_verified: bool
    uploaded_at: datetime
    uploader_name: str | None = None  # resolved from join / eager-loaded relation


# Alias — upload endpoint returns the same shape as the standard response.
DocumentUploadResponse = DocumentResponse
