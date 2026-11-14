"""Договор — только в тенге: доллары в форме застревали в обмене с Notion."""
import uuid

import pytest
from pydantic import ValidationError

from app.schemas.contract import ContractCreate, ContractUpdate


def test_create_defaults_to_kzt_and_normalizes():
    assert ContractCreate(student_id=uuid.uuid4()).currency == "KZT"
    assert ContractCreate(student_id=uuid.uuid4(), currency=" kzt ").currency == "KZT"


@pytest.mark.parametrize("currency", ["USD", "EUR", "rub"])
def test_other_currencies_rejected(currency):
    with pytest.raises(ValidationError):
        ContractCreate(student_id=uuid.uuid4(), currency=currency)
    with pytest.raises(ValidationError):
        ContractUpdate(currency=currency)


def test_update_without_currency_is_fine():
    assert ContractUpdate(amount=100).currency is None
