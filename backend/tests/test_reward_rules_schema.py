"""Валидация payload конструктора вознаграждений.

Значение ставки лежит в JSONB, поэтому граница API — единственное место, где
мусор ещё можно отсечь. Если сюда просочится процент 300 или пустой список
порогов, дальше это уже данные в базе, и чинить придётся миграцией.
"""
import unittest

from pydantic import BaseModel, ValidationError

from app.schemas.reward_rule import RewardRulePayload, RewardRuleUpdate


class _Wrapper(BaseModel):
    """Union нельзя валидировать напрямую — оборачиваем в модель."""

    payload: RewardRulePayload


def _parse(payload: dict):
    return _Wrapper(payload=payload).payload


class ValidPayloadTests(unittest.TestCase):
    def test_accepts_all_four_seed_shapes(self):
        cases = [
            {"kind": "mentor_stage_pct", "pct": 30},
            {"kind": "mentor_task_penalty", "amount": 2_500},
            {"kind": "refund_case_bonus", "amount": 10_000},
            {"kind": "mzk_quality_bonus", "tiers": [{"min_score_pct": 90, "amount": 20_000}]},
        ]
        for payload in cases:
            with self.subTest(kind=payload["kind"]):
                self.assertEqual(_parse(payload).kind, payload["kind"])

    def test_zero_rate_is_valid(self):
        """Обнулить ставку — законная операция, а не ошибка ввода."""
        self.assertEqual(_parse({"kind": "mentor_stage_pct", "pct": 0}).pct, 0)
        self.assertEqual(_parse({"kind": "mentor_task_penalty", "amount": 0}).amount, 0)


class RejectedPayloadTests(unittest.TestCase):
    def test_percent_out_of_range(self):
        for pct in (300, -1, 101):
            with self.subTest(pct=pct):
                with self.assertRaises(ValidationError):
                    _parse({"kind": "mentor_stage_pct", "pct": pct})

    def test_negative_amount(self):
        with self.assertRaises(ValidationError):
            _parse({"kind": "mentor_task_penalty", "amount": -1})

    def test_absurd_amount(self):
        """Потолок ловит опечатку в лишний ноль, а не бизнес-решение."""
        with self.assertRaises(ValidationError):
            _parse({"kind": "refund_case_bonus", "amount": 10_000_001})

    def test_empty_and_oversized_tier_list(self):
        with self.assertRaises(ValidationError):
            _parse({"kind": "mzk_quality_bonus", "tiers": []})
        too_many = [{"min_score_pct": i, "amount": 1_000} for i in range(11)]
        with self.assertRaises(ValidationError):
            _parse({"kind": "mzk_quality_bonus", "tiers": too_many})

    def test_duplicate_thresholds_rejected(self):
        """Два одинаковых порога — неоднозначность: какая сумма сработает?"""
        with self.assertRaises(ValidationError):
            _parse({
                "kind": "mzk_quality_bonus",
                "tiers": [
                    {"min_score_pct": 90, "amount": 20_000},
                    {"min_score_pct": 90, "amount": 10_000},
                ],
            })

    def test_unknown_kind_rejected(self):
        with self.assertRaises(ValidationError):
            _parse({"kind": "выдуманный_вид", "amount": 100})

    def test_wrong_field_for_kind(self):
        """Процент в теле штрафа — почти наверняка перепутанный вид ставки."""
        with self.assertRaises(ValidationError):
            _parse({"kind": "mentor_task_penalty", "pct": 30})


class UpdateEnvelopeTests(unittest.TestCase):
    def test_note_is_optional_and_bounded(self):
        body = RewardRuleUpdate(payload={"kind": "mentor_stage_pct", "pct": 35})
        self.assertIsNone(body.note)
        with self.assertRaises(ValidationError):
            RewardRuleUpdate(payload={"kind": "mentor_stage_pct", "pct": 35}, note="x" * 501)


if __name__ == "__main__":
    unittest.main()
