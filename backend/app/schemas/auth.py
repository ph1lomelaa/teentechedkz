from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.schemas.user import UserResponse


class LoginRequest(BaseModel):
    """Credentials submitted at /auth/login."""

    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    """JWT access token returned after successful login or token refresh."""

    model_config = ConfigDict(from_attributes=True)

    access_token: str
    token_type: str = "bearer"
    expires_in: int  # seconds until the access token expires


class RefreshRequest(BaseModel):
    """
    Body for POST /auth/refresh.

    The refresh token itself is read from an httpOnly cookie
    (`refresh_token`), so this body is intentionally empty.
    """


class MeResponse(UserResponse):
    """
    Response for GET /auth/me.

    Inherits all fields from UserResponse; the separate class allows
    future divergence (e.g. adding last_login, permissions list).
    """


class ClientErrorReport(BaseModel):
    """Categorical diagnostics only; deliberately excludes URLs and error text."""
    model_config = ConfigDict(extra="forbid")
    kind: Literal["render", "unhandled"]
    error_type: Literal["Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError", "NotFoundError", "ChunkLoadError"]
    route: Literal["student_card", "workspace_student_card", "app"]
    components: list[Annotated[str, Field(pattern=r"^[A-Za-z][A-Za-z0-9_.$]{0,79}$")]] = Field(default_factory=list, max_length=30)
