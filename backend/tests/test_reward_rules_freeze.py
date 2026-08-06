"""Начисленные суммы не переписываются при смене ставки.

Три из четырёх видов ставок раньше считались на лету при сериализации: карточка
брала процент из enum, а сумму — сохранённую, поэтому после правки ставки они
разъезжались, а штрафы и возвратные кейсы задним числом меняли суммы по всей
истории. Теперь применённая ставка лежит в самой строке начисления — тест
фиксирует, что сериализаторы читают именно её.

Модели создаются detached, без БД, — в этом репозитории тесты не поднимают
подключение (см. tests/test_mentor_rewards_scope.py).
"""
import unittest
import uuid
from datetime import datetime, timezone

from app.api.v1.endpoints.mentor_rewards import _penalty_to_dict, _reward_to_dict
from app.api.v1.endpoints.refund_cases import _require_approved_change_basis, _to_dict as _refund_to_dict
from app.models.mentor_stage_reward import MentorStageKind, MentorStageReward
from app.models.mentor_task_penalty import MentorTaskPenalty, PenaltyColor
from app.models.refund_case import RefundCase, RefundCaseStatus, RefundLevel

NOW = datetime(2026, 8, 6, tzinfo=timezone.utc)


class StageRewardFreezeTests(unittest.TestCase):
    def _reward(self, applied_pct: int) -> MentorStageReward:
        return MentorStageReward(
            id=uuid.uuid4(),
            student_id=uuid.uuid4(),
            mentor_id=uuid.uuid4(),
            stage=MentorStageKind.admission,
            total_contract_amount=1_000_000,
            # Посчитано по ставке, действовавшей в момент начисления.
            computed_amount=1_000_000 * applied_pct / 100,
            stage_pct_applied=applied_pct,
            accepted=False,
            created_at=NOW,
        )

    def test_serializer_reports_applied_rate_not_current_default(self):
        """Ставку этапа сменили на 25% — старая карточка обязана остаться на 40%."""
        reward = self._reward(40)
        payload = _reward_to_dict(reward)
        self.assertEqual(payload["stage_pct"], 40)
        self.assertEqual(payload["computed_amount"], 400_000.0)
        # Значение по умолчанию у enum осталось прежним, но сериализатор его не
        # использует — именно в этом и была рассинхронизация.
        self.assertNotEqual(payload["stage_pct"], 0)

    def test_percent_matches_stored_amount(self):
        """Инвариант карточки: показанный процент объясняет показанную сумму."""
        for pct in (0, 25, 30, 40, 100):
            with self.subTest(pct=pct):
                payload = _reward_to_dict(self._reward(pct))
                expected = payload["total_contract_amount"] * payload["stage_pct"] / 100
                self.assertEqual(payload["computed_amount"], expected)


class PenaltyFreezeTests(unittest.TestCase):
    def test_amount_comes_from_row(self):
        penalty = MentorTaskPenalty(
            id=uuid.uuid4(),
            mentor_id=uuid.uuid4(),
            task_id=None,
            color=PenaltyColor.yellow,
            # Зафиксировано по ставке 2500; в конструкторе её позже подняли.
            amount=2_500,
            recorded_at=NOW,
            contested=False,
        )
        self.assertEqual(_penalty_to_dict(penalty)["amount"], 2_500)

    def test_row_wins_over_enum_default(self):
        penalty = MentorTaskPenalty(
            id=uuid.uuid4(),
            mentor_id=uuid.uuid4(),
            color=PenaltyColor.red,
            amount=1_000,  # ставку с тех пор изменили
            recorded_at=NOW,
            contested=False,
        )
        self.assertEqual(_penalty_to_dict(penalty)["amount"], 1_000)
        self.assertNotEqual(_penalty_to_dict(penalty)["amount"], PenaltyColor.red.amount)


class RefundCaseFreezeTests(unittest.TestCase):
    def test_approved_change_requires_reason_and_written_approval(self):
        with self.assertRaises(Exception) as context:
            _require_approved_change_basis({})
        self.assertEqual(context.exception.status_code, 409)

    def test_approved_change_accepts_reason_and_written_approval(self):
        self.assertEqual(
            _require_approved_change_basis({"change_reason": "Ошибка расчёта", "written_approval": "Согласовано письмом №1"}),
            ("Ошибка расчёта", "Согласовано письмом №1"),
        )

    def _case(self, level, bonus) -> RefundCase:
        return RefundCase(
            id=uuid.uuid4(),
            contract_id=None,
            student_id=None,
            mzk_manager_id=uuid.uuid4(),
            amount=None,
            level=level,
            bonus_amount=bonus,
            status=RefundCaseStatus.open,
            opened_at=NOW,
        )

    def test_bonus_comes_from_row(self):
        payload = _refund_to_dict(self._case(RefundLevel.orange, 15_000))
        self.assertEqual(payload["bonus_amount"], 15_000)

    def test_unapproved_level_has_no_bonus(self):
        """До утверждения уровня суммы нет — раньше тут был бы None по другой причине."""
        payload = _refund_to_dict(self._case(None, None))
        self.assertIsNone(payload["bonus_amount"])
        self.assertIsNone(payload["level"])

    def test_row_wins_over_enum_default(self):
        payload = _refund_to_dict(self._case(RefundLevel.red, 5_000))
        self.assertEqual(payload["bonus_amount"], 5_000)
        self.assertNotEqual(payload["bonus_amount"], RefundLevel.red.bonus_amount)


if __name__ == "__main__":
    unittest.main()
