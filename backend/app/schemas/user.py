from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, EmailStr, field_validator

from app.models.user import UserRole


class UserCreate(BaseModel):
    """Payload for creating a new user account."""

    name: str
    email: EmailStr
    password: str
    role: UserRole
    phone: str | None = None
    telegram_username: str | None = None


class UserUpdate(BaseModel):
    """All fields optional; used for PATCH operations."""

    name: str | None = None
    email: EmailStr | None = None
    role: UserRole | None = None
    phone: str | None = None
    telegram_id: str | None = None
    telegram_username: str | None = None
    is_active: bool | None = None
    must_change_password: bool | None = None


class UserResponse(BaseModel):
    """Full user profile returned to API consumers (no hashed_password)."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    email: str
    role: UserRole
    telegram_id: str | None = None
    telegram_username: str | None = None
    phone: str | None = None
    is_active: bool
    must_change_password: bool
    created_at: datetime


class UserList(BaseModel):
    """Paginated list of users."""

    model_config = ConfigDict(from_attributes=True)

    items: list[UserResponse]
    total: int
    page: int
    size: int
    pages: int
