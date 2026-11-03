import re
import uuid
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator


class ActLine(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    contract_service_id: str = Field(default="", max_length=64)
    source_fingerprint: str = Field(default="", max_length=64)
    name: str = Field(min_length=3, max_length=300)
    result: str = Field(min_length=3)
    evidence: str = Field(default="", max_length=1500)
    contract_source: str = Field(min_length=2, max_length=300)
    quantity: Decimal = Field(default=Decimal("1"), gt=0, le=100000, max_digits=10, decimal_places=2)
    unit: str = Field(default="услуга", min_length=1, max_length=50)
    unit_price: Annotated[Decimal, Field(ge=0, le=1000000000, max_digits=12, decimal_places=2)] | None = None

    @property
    def amount(self) -> Decimal:
        return (self.quantity * (self.unit_price or Decimal("0"))).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


class ActInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    contract_link_id: uuid.UUID
    supersedes_id: uuid.UUID | None = None
    template: Literal["portfolio", "ielts", "profile", "stages", "final", "career", "applications", "offer", "admission"] = "stages"
    student_name: str = Field(min_length=3, max_length=300)
    customer_name: str = Field(min_length=3, max_length=300)
    customer_id: str = Field(default="", max_length=30)
    student_id_number: str = Field(default="", max_length=30)
    customer_email: str = Field(default="", max_length=255)
    executor_name: str = Field(min_length=3, max_length=500)
    executor_representative: str = Field(min_length=3, max_length=300)
    executor_basis: str = Field(min_length=3, max_length=300)
    executor_requisites: str = Field(default="", max_length=1500)
    contract_number: str = Field(min_length=1, max_length=100)
    contract_date: date
    act_date: date
    city: str = Field(min_length=2, max_length=100)
    period_start: date
    period_end: date
    calls_count: int | None = Field(default=None, ge=0, le=10000)
    include_amount: bool = False
    # Общая сумма из договора, как в образцах актов: используется, когда у
    # пунктов договора нет отдельных цен. Сверяет сотрудник (verified).
    contract_total: Annotated[Decimal, Field(gt=0, le=1000000000, max_digits=12, decimal_places=2)] | None = None
    currency: Literal["KZT", "RUB", "USD", "EUR"] = "KZT"
    lines: list[ActLine] = Field(min_length=1, max_length=30)
    verified: bool = False
    full_completion_confirmed: bool = False
    company_signature: bool = False
    application_ids: list[uuid.UUID] = Field(default_factory=list, max_length=30)
    verified_outcomes: list[str] = Field(default_factory=list, max_length=30)
    previous_act_references: list[str] = Field(default_factory=list, max_length=100)

    @field_validator("customer_email")
    @classmethod
    def valid_email(cls, value):
        if value:
            from pydantic import TypeAdapter
            return str(TypeAdapter(EmailStr).validate_python(value))
        return value

    @field_validator("student_name")
    @classmethod
    def full_name(cls, value):
        if len(value.split()) < 2 or not all(any(c.isalpha() for c in p) for p in value.split()):
            raise ValueError("Укажите имя и фамилию студента в написании договора")
        return value

    @model_validator(mode="after")
    def check_dates_and_prices(self):
        if self.period_end < self.period_start:
            raise ValueError("Конец периода раньше начала")
        if self.act_date < self.period_end or self.contract_date > self.period_end:
            raise ValueError("Проверьте дату акта, договора и период оказания услуг")
        if self.include_amount and self.contract_total is not None and any(line.unit_price is not None for line in self.lines):
            raise ValueError("Укажите либо общую сумму договора, либо цены услуг")
        if self.include_amount and self.contract_total is None and any(line.unit_price is None for line in self.lines):
            raise ValueError("Укажите общую стоимость по договору либо отключите стоимость")
        return self

    @property
    def total(self):
        if self.contract_total is not None:
            return self.contract_total
        return sum((line.amount for line in self.lines), Decimal("0.00"))

    def require_verified(self):
        if not self.verified:
            raise ValueError("Подтвердите реквизиты, состав и фактическое выполнение услуг по договору")
        if self.template in ("final", "admission") and not self.full_completion_confirmed:
            raise ValueError("Подтвердите исполнение всего договора для итогового акта")

    def filename(self):
        labels = {"portfolio": "Портфолио", "ielts": "IELTS", "profile": "Оценка профиля", "stages": "оказанных услуг", "final": "Итоговый", "career": "Профориентация", "applications": "Подачи", "offer": "Получение оффера", "admission": "Поступление"}
        name = f"{self.student_name} - Акт {labels[self.template]} - {self.act_date.isoformat()}.pdf"
        return re.sub(r'[\x00-\x1f\x7f/\\:*?"<>|]', "_", name)


class ActMailInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    request_id: uuid.UUID
    recipient: EmailStr
    subject: str = Field(default="Акт выполненных работ", max_length=300)
    body: str = Field(min_length=1, max_length=10000)

    @field_validator("subject", mode="before")
    @classmethod
    def default_subject(cls, value):
        return value.strip() if isinstance(value, str) and value.strip() else "Акт выполненных работ"

    @field_validator("subject")
    @classmethod
    def no_newlines(cls, value):
        if "\r" in value or "\n" in value:
            raise ValueError("Тема должна быть одной строкой")
        return value


class ActMailResolution(BaseModel):
    outcome: Literal["sent", "not_sent"]
    note: str = Field(min_length=10, max_length=1000)


class ActDraftLine(ActLine):
    name: str = Field(default="", max_length=300)
    result: str = Field(default="")
    contract_source: str = Field(default="", max_length=300)


class ActDraftInput(ActInput):
    """Incomplete work is saveable; strict ActInput is required for PDF creation."""
    student_name: str = Field(default="", max_length=300)
    customer_name: str = Field(default="", max_length=300)
    executor_name: str = Field(default="", max_length=500)
    executor_representative: str = Field(default="", max_length=300)
    executor_basis: str = Field(default="", max_length=300)
    contract_number: str = Field(default="", max_length=100)
    contract_date: date | None = None
    act_date: date | None = None
    period_start: date | None = None
    period_end: date | None = None
    city: str = Field(default="", max_length=100)
    lines: list[ActDraftLine] = Field(default_factory=list, max_length=30)

    @field_validator("student_name")
    @classmethod
    def full_name(cls, value):
        return value

    @field_validator("contract_date", "act_date", "period_start", "period_end", mode="before")
    @classmethod
    def empty_dates(cls, value):
        return value or None

    @model_validator(mode="after")
    def check_dates_and_prices(self):
        return self
