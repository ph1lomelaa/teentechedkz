from __future__ import annotations

import uuid

from pydantic import BaseModel, ConfigDict, EmailStr

from app.models.guardian import GuardianRelation


class GuardianCreate(BaseModel):
    """
    Payload for adding a guardian to a student.

    `iin` is accepted as a plain string and must be encrypted by the
    service layer before persisting to the database.
    """

    student_id: uuid.UUID
    full_name: str
    iin: str | None = None  # plain IIN — encrypted before storing
    phone: str
    email: EmailStr | None = None
    relation: GuardianRelation
    is_primary: bool = True


class GuardianUpdate(BaseModel):
    """All fields optional; used for PATCH on an existing guardian."""

    full_name: str | None = None
    iin: str | None = None  # plain IIN — re-encrypted if provided
    phone: str | None = None
    email: EmailStr | None = None
    relation: GuardianRelation | None = None
    is_primary: bool | None = None


class GuardianResponse(BaseModel):
    """
    Standard guardian response.

    The IIN is always masked (e.g. ●●●●●●0512) to protect PII.
    Use `GuardianResponseFull` when the admin/mzk_manager explicitly
    requests the plaintext IIN.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    student_id: uuid.UUID
    full_name: str
    iin_masked: str | None = None  # e.g. "●●●●●●0512"
    phone: str
    email: str | None = None
    relation: GuardianRelation
    is_primary: bool


class GuardianResponseFull(GuardianResponse):
    """
    Extended guardian response that exposes the decrypted IIN.

    Only returned when an admin or mzk_manager explicitly requests it
    (e.g. via a dedicated endpoint). The service layer must decrypt the
    stored ciphertext before populating this field.
    """

    iin_plain: str | None = None
