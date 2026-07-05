from __future__ import annotations

import uuid
from datetime import datetime, date
from decimal import Decimal

from pydantic import BaseModel, ConfigDict

from app.models.contract import PipelineStatus, PaymentPlan


class ContractCreate(BaseModel):
    """Payload for creating a contract linked to a student."""

    student_id: uuid.UUID
    signed_date: date | None = None
    amount: Decimal | None = None
    currency: str = "KZT"
    payment_plan: PaymentPlan | None = None
    pipeline_status: PipelineStatus = PipelineStatus.no_status
    mzk_manager_id: uuid.UUID | None = None
    ielts_payment_included: bool = False
    english_sum: Decimal | None = None
    english_paid: Decimal | None = None
    client_remaining_amount: Decimal | None = None
    client_remaining_date: date | None = None
    mentor_total_owed: Decimal | None = None
    notes: str | None = None


class ContractUpdate(BaseModel):
    """All fields optional; used for PATCH on an existing contract."""

    signed_date: date | None = None
    amount: Decimal | None = None
    currency: str | None = None
    payment_plan: PaymentPlan | None = None
    pipeline_status: PipelineStatus | None = None
    mzk_manager_id: uuid.UUID | None = None
    ielts_payment_included: bool | None = None
    english_sum: Decimal | None = None
    english_paid: Decimal | None = None
    client_remaining_amount: Decimal | None = None
    client_remaining_date: date | None = None
    mentor_total_owed: Decimal | None = None
    notes: str | None = None


class ContractResponse(BaseModel):
    """Full contract data including the resolved manager name."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    student_id: uuid.UUID
    signed_date: date | None = None
    amount: Decimal | None = None
    currency: str
    payment_plan: PaymentPlan | None = None
    pipeline_status: PipelineStatus
    mzk_manager_id: uuid.UUID | None = None
    mzk_manager_name: str | None = None  # resolved from join / eager-loaded relation
    ielts_payment_included: bool
    english_sum: Decimal | None = None
    english_paid: Decimal | None = None
    client_remaining_amount: Decimal | None = None
    client_remaining_date: date | None = None
    mentor_total_owed: Decimal | None = None
    notes: str | None = None
    created_at: datetime
