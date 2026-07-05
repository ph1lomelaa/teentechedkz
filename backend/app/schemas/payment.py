from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from pydantic import BaseModel, ConfigDict

from app.models.payment import PaymentType, PaymentStatus


class PaymentCreate(BaseModel):
    """Payload for recording a payment against a contract."""

    contract_id: uuid.UUID
    type: PaymentType
    amount: Decimal
    currency: str = "KZT"
    status: PaymentStatus
    paid_at: date | None = None
    mentor_id: uuid.UUID | None = None
    note: str | None = None


class PaymentUpdate(BaseModel):
    """All fields optional; used for PATCH on an existing payment."""

    type: PaymentType | None = None
    amount: Decimal | None = None
    currency: str | None = None
    status: PaymentStatus | None = None
    paid_at: date | None = None
    mentor_id: uuid.UUID | None = None
    note: str | None = None


class PaymentResponse(BaseModel):
    """Full payment record including the resolved mentor name."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    contract_id: uuid.UUID
    type: PaymentType
    amount: Decimal
    currency: str
    status: PaymentStatus
    paid_at: date | None = None
    mentor_id: uuid.UUID | None = None
    mentor_name: str | None = None  # resolved from join / eager-loaded relation
    recorded_by: uuid.UUID
    note: str | None = None


class FinanceSummary(BaseModel):
    """Aggregate financial metrics across all contracts."""

    model_config = ConfigDict(from_attributes=True)

    total_contracts: int
    total_amount: Decimal
    total_paid: Decimal
    total_remaining: Decimal


class MentorPayoutRow(BaseModel):
    """Per-mentor payout breakdown for the finance dashboard."""

    model_config = ConfigDict(from_attributes=True)

    mentor_id: uuid.UUID
    mentor_name: str
    total_owed: Decimal
    paid: Decimal
    to_be_paid: Decimal
