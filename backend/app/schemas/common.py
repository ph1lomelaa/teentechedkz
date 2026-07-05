from __future__ import annotations

from typing import Generic, TypeVar

from pydantic import BaseModel, ConfigDict

T = TypeVar("T")


class PaginatedResponse(BaseModel, Generic[T]):
    """Generic paginated wrapper for list endpoints."""

    model_config = ConfigDict(from_attributes=True)

    items: list[T]
    total: int
    page: int
    size: int
    pages: int
