"""Ежемесячный агрегатор ОКК МЗК (регламент МЗК, раздел 7).

Проверяет раз в час, наступил ли новый календарный месяц и есть ли уже
рассчитанный MzkQualityScore за предыдущий период — если нет, считает по
формуле п.7.4: положительные действительные оценки / все действительные × 100%.
Пороги бонуса настраиваются админом в конструкторе вознаграждений
(`reward_rules`); сумма замораживается в строке ОКК при расчёте.
"""
import asyncio
import logging
from datetime import date, datetime, timezone

from sqlalchemy import select, func

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.mzk_review import MzkReview
from app.models.mzk_quality_score import MzkQualityScore
from app.models.reward_rule import RewardRuleKind
from app.services.reward_rules import active_rules, bonus_from_tiers

logger = logging.getLogger(__name__)


def _previous_period(today: date) -> tuple[int, int]:
    if today.month == 1:
        return today.year - 1, 12
    return today.year, today.month - 1


async def compute_missing_mzk_quality_scores() -> None:
    db = AsyncSessionLocal()
    try:
        year, month = _previous_period(datetime.now(timezone.utc).date())

        managers_result = await db.execute(
            select(MzkReview.mzk_manager_id)
            .where(MzkReview.period_year == year, MzkReview.period_month == month)
            .distinct()
        )
        manager_ids = [row[0] for row in managers_result.all()]
        if not manager_ids:
            return

        existing_result = await db.execute(
            select(MzkQualityScore.mzk_manager_id).where(
                MzkQualityScore.period_year == year, MzkQualityScore.period_month == month
            )
        )
        already_computed = {row[0] for row in existing_result.all()}

        computed = 0
        # Пороги читаем один раз до цикла: они общие для всех менеджеров.
        bonus_rules = await active_rules(db, RewardRuleKind.mzk_quality_bonus)
        tiers = (bonus_rules.get("default") or {}).get("tiers")

        for mzk_manager_id in manager_ids:
            if mzk_manager_id in already_computed:
                continue

            counts_result = await db.execute(
                select(
                    func.count(MzkReview.id),
                    func.count(MzkReview.id).filter(MzkReview.is_positive == True),  # noqa: E712
                ).where(
                    MzkReview.mzk_manager_id == mzk_manager_id,
                    MzkReview.period_year == year,
                    MzkReview.period_month == month,
                    MzkReview.is_valid == True,  # noqa: E712
                )
            )
            valid_count, positive_count = counts_result.one()
            score_pct = (positive_count / valid_count * 100) if valid_count else 0

            score = MzkQualityScore(
                mzk_manager_id=mzk_manager_id,
                period_year=year,
                period_month=month,
                valid_reviews_count=valid_count,
                positive_reviews_count=positive_count,
                score_pct=score_pct,
                bonus_amount=bonus_from_tiers(tiers, score_pct, disqualified=False),
                computed_at=datetime.now(timezone.utc),
            )
            db.add(score)
            computed += 1

        if computed:
            await db.commit()
            logger.info(f"MZK quality scores computed for {computed} managers ({year}-{month:02d})")
    except Exception:
        await db.rollback()
        raise
    finally:
        await db.close()


async def mzk_quality_score_loop() -> None:
    interval_seconds = 3600
    logger.info("MZK quality score loop starting (hourly check for new month)")

    while True:
        try:
            await compute_missing_mzk_quality_scores()
        except Exception as e:
            logger.error(f"MZK quality score job failed: {e}", exc_info=True)

        await asyncio.sleep(interval_seconds)
