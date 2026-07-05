from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict

from app.models.pending_insight import InsightType, RiskLevel, InsightStatus


class PendingInsightResponse(BaseModel):
    """Full pending insight record returned to the review queue."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    student_id: uuid.UUID
    communication_log_id: uuid.UUID | None = None
    insight_type: InsightType
    proposed_changes: dict[str, Any]
    confidence: float
    risk_level: RiskLevel
    status: InsightStatus
    reviewed_by: uuid.UUID | None = None
    auto_applied: bool
    created_at: datetime
    reviewed_at: datetime | None = None


class InsightReviewRequest(BaseModel):
    """
    Body for POST /insights/{id}/review.

    The reviewer specifies whether to approve (apply the proposed changes
    to the student record) or reject (discard without changes).
    """

    action: Literal["approve", "reject"]
