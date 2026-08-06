"""Разбор ставок вознаграждений: паритет с регламентом и поведение fallback.

Ставки переехали из литералов в enum-свойствах в таблицу `reward_rules`.
Главное требование к переезду — день первый должен считаться ровно так же, как
считался раньше, иначе миграция молча изменит суммы. Отсюда тест-паритет с
прежней bonus_for_score и проверки, что пустой/битый payload деградирует до
значений регламента, а не роняет расчёт.
"""
import unittest

from app.core.reward_defaults import (
    DEFAULT_MZK_BONUS_TIERS,
    DEFAULT_REFUND_BONUS,
    DEFAULT_STAGE_PCT,
    DEFAULT_TASK_PENALTY,
)
from app.models.mzk_quality_score import bonus_for_score
from app.services.reward_rules import (
    bonus_from_tiers,
    penalty_amount_from_payload,
    refund_amount_from_payload,
    stage_pct_from_payload,
)


class MzkBonusParityTests(unittest.TestCase):
    """Пороги ОКК: >=90 -> 20000, 80..89.99 -> 10000, ниже -> 0."""

    def test_matches_regulation_thresholds(self):
        cases = [(95, 20_000), (90, 20_000), (89.99, 10_000), (80, 10_000), (79.99, 0), (0, 0)]
        for score, expected in cases:
            with self.subTest(score=score):
                self.assertEqual(bonus_from_tiers(None, score, disqualified=False), expected)

    def test_parity_with_legacy_function(self):
        """Пока bonus_for_score жив как fallback, две реализации не должны разойтись."""
        for score in (100, 95, 90, 89.9, 85, 80, 79.9, 50, 0):
            with self.subTest(score=score):
                self.assertEqual(
                    bonus_from_tiers(None, score, disqualified=False),
                    bonus_for_score(score, disqualified=False),
                )

    def test_disqualified_gets_nothing(self):
        self.assertEqual(bonus_from_tiers(None, 100, disqualified=True), 0)
        tiers = [{"min_score_pct": 0, "amount": 5_000}]
        self.assertEqual(bonus_from_tiers(tiers, 100, disqualified=True), 0)

    def test_unsorted_tiers_still_resolve(self):
        """Админ может ввести пороги в любом порядке — сортируем сами.

        Без сортировки порог 80 перекрыл бы 90, и премия за отличный результат
        молча упала бы до нижней ступени.
        """
        tiers = [
            {"min_score_pct": 80, "amount": 10_000},
            {"min_score_pct": 90, "amount": 20_000},
        ]
        self.assertEqual(bonus_from_tiers(tiers, 95, disqualified=False), 20_000)
        self.assertEqual(bonus_from_tiers(tiers, 85, disqualified=False), 10_000)

    def test_custom_tiers_override_defaults(self):
        tiers = [{"min_score_pct": 70, "amount": 7_000}]
        self.assertEqual(bonus_from_tiers(tiers, 75, disqualified=False), 7_000)
        self.assertEqual(bonus_from_tiers(tiers, 69, disqualified=False), 0)

    def test_broken_tiers_fall_back_to_regulation(self):
        for broken in (None, [], "не список", [{"amount": 1}], [{"min_score_pct": "90"}], [42]):
            with self.subTest(payload=broken):
                self.assertEqual(bonus_from_tiers(broken, 95, disqualified=False), 20_000)


class StagePctTests(unittest.TestCase):
    def test_defaults_match_regulation(self):
        for stage, expected in DEFAULT_STAGE_PCT.items():
            with self.subTest(stage=stage):
                self.assertEqual(stage_pct_from_payload(None, stage), expected)

    def test_payload_wins(self):
        self.assertEqual(stage_pct_from_payload({"pct": 35}, "admission"), 35)

    def test_zero_is_a_real_rate(self):
        """0 — легитимная ставка, а не «значение не задано».

        Классическая ловушка fallback-кода: `payload.get("pct") or default`
        проглотил бы ноль и вернул 40, то есть админ выключил бы этап, а
        начисления продолжали бы идти.
        """
        self.assertEqual(stage_pct_from_payload({"pct": 0}, "admission"), 0)

    def test_out_of_range_and_garbage_fall_back(self):
        for payload in ({"pct": 300}, {"pct": -1}, {"pct": "40"}, {"pct": True}, {}, None, {"pct": None}):
            with self.subTest(payload=payload):
                self.assertEqual(stage_pct_from_payload(payload, "admission"), 40)


class FlatAmountTests(unittest.TestCase):
    def test_penalty_defaults(self):
        for color, expected in DEFAULT_TASK_PENALTY.items():
            with self.subTest(color=color):
                self.assertEqual(penalty_amount_from_payload(None, color), expected)

    def test_refund_defaults(self):
        for level, expected in DEFAULT_REFUND_BONUS.items():
            with self.subTest(level=level):
                self.assertEqual(refund_amount_from_payload(None, level), expected)

    def test_payload_wins_and_zero_survives(self):
        self.assertEqual(penalty_amount_from_payload({"amount": 3_000}, "yellow"), 3_000)
        self.assertEqual(penalty_amount_from_payload({"amount": 0}, "yellow"), 0)
        self.assertEqual(refund_amount_from_payload({"amount": 0}, "red"), 0)

    def test_garbage_falls_back(self):
        for payload in ({"amount": -5}, {"amount": "2500"}, {"amount": True}, {}, None):
            with self.subTest(payload=payload):
                self.assertEqual(penalty_amount_from_payload(payload, "orange"), 5_000)


class DefaultsShapeTests(unittest.TestCase):
    def test_mzk_tiers_are_descending(self):
        """Сид и UI полагаются на убывающий порядок — фиксируем его."""
        thresholds = [t["min_score_pct"] for t in DEFAULT_MZK_BONUS_TIERS]
        self.assertEqual(thresholds, sorted(thresholds, reverse=True))


if __name__ == "__main__":
    unittest.main()
