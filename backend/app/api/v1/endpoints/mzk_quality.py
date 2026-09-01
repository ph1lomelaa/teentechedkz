"""ОКК МЗК — ручные оценки, ежемесячный агрегат (регламент МЗК, раздел 7).

Формула (п.7.4): положительные действительные оценки / все действительные
оценки × 100%. Бонус фиксирован (п.7.5): >=90% -> 20000₸, 80-89.99% -> 10000₸,
<80% -> без бонуса. Ввод оценок — вручную admin/mzk_manager руководителем,
регламент не уточняет технический источник сбора оценок.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.deps import CurrentUser
from app.core.permissions import Action, require_access
from app.models.mzk_review import MzkReview
from app.models.mzk_quality_score import MzkQualityScore
from app.models.user import UserRole
from app.models.reward_rule import RewardRuleKind
from app.services.reward_rules import active_rules, bonus_from_tiers

router = APIRouter(prefix="/mzk-quality", tags=["mzk_quality"])
ALLOWED_REVIEW_SOURCE_KINDS = {"manual", "meeting", "telegram"}


def resolve_score_scope(*, viewer_role, viewer_id, requested_manager_id: str | None):
    """Чьи помесячные баллы показывать (None = всех).

    Оценки ОКК — чувствительные данные о работе сотрудника, поэтому
    МЗК-менеджер видит только собственный балл и бонус: параметр запроса для
    него игнорируется, а не проверяется, иначе достаточно было бы подставить
    чужой id. Ленту отдельных оценок ему не показываем вовсе (см. list_reviews)
    — по датам вычисляется, кто именно поставил минус.
    """
    if viewer_role == UserRole.admin:
        return _parse_uuid(requested_manager_id, field="mzk_manager_id")
    if viewer_role == UserRole.mzk_manager:
        return viewer_id
    raise HTTPException(status_code=403, detail="Access denied")


def _parse_uuid(raw: str | None, *, field: str):
    if raw is None:
        return None
    try:
        return uuid.UUID(raw)
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(status_code=422, detail=f"Неверный {field}")


def validate_period(year: int, month: int, *, now: datetime) -> None:
    """Период оценки не может быть в будущем.

    Раньше фронт всегда слал текущий месяц, поэтому проверка была не нужна;
    теперь месяц выбирается вручную, и «оценка за ещё не наступивший период»
    стала достижимой.
    """
    if not 1 <= month <= 12:
        raise HTTPException(status_code=422, detail="Неверный месяц")
    if (year, month) > (now.year, now.month):
        raise HTTPException(status_code=422, detail="Период ещё не наступил")


def validate_review_source(source_kind: str, source_user_id: uuid.UUID | None, manager_id: uuid.UUID, current_user_id: uuid.UUID) -> None:
    if source_kind not in ALLOWED_REVIEW_SOURCE_KINDS:
        raise HTTPException(status_code=422, detail="Неизвестный источник оценки")
    if source_user_id == manager_id or current_user_id == manager_id:
        raise HTTPException(status_code=422, detail="Нельзя учитывать отзыв от самого МЗК")


def _review_to_dict(r: MzkReview) -> dict:
    return {
        "id": str(r.id),
        "mzk_manager_id": str(r.mzk_manager_id),
        # Без имени карточки разных менеджеров неотличимы — в них только месяц.
        "mzk_manager_name": r.mzk_manager.name if getattr(r, "mzk_manager", None) else None,
        "period_year": r.period_year,
        "period_month": r.period_month,
        "is_positive": r.is_positive,
        "is_valid": r.is_valid,
        "invalidated_reason": r.invalidated_reason,
        "source_kind": r.source_kind,
        "source_key": r.source_key,
        "source_user_id": str(r.source_user_id) if r.source_user_id else None,
        "created_at": r.created_at.isoformat(),
    }


def _score_to_dict(s: MzkQualityScore) -> dict:
    return {
        "id": str(s.id),
        "mzk_manager_id": str(s.mzk_manager_id),
        "mzk_manager_name": s.mzk_manager.name if getattr(s, "mzk_manager", None) else None,
        "period_year": s.period_year,
        "period_month": s.period_month,
        "valid_reviews_count": s.valid_reviews_count,
        "positive_reviews_count": s.positive_reviews_count,
        "score_pct": float(s.score_pct),
        "bonus_amount": s.bonus_amount,
        "disqualified": s.disqualified,
        "disqualified_reason": s.disqualified_reason,
        "approved_by": str(s.approved_by) if s.approved_by else None,
        "approved_at": s.approved_at.isoformat() if s.approved_at else None,
        "objection_text": s.objection_text,
        "objection_deadline": s.objection_deadline.isoformat() if s.objection_deadline else None,
        "computed_at": s.computed_at.isoformat(),
    }


@router.post("/reviews")
async def create_review(
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    """Поставить оценку МЗК за отчётный период — вручную руководителем."""
    require_access(current_user, "mzk_quality", Action.manage)
    try:
        year = int(body["period_year"])
        month = int(body["period_month"])
    except (KeyError, TypeError, ValueError):
        raise HTTPException(status_code=422, detail="Неверный период")
    validate_period(year, month, now=datetime.now(timezone.utc))

    manager_id = _parse_uuid(body.get("mzk_manager_id"), field="mzk_manager_id")
    if manager_id is None:
        raise HTTPException(status_code=422, detail="Не указан менеджер МЗК")

    if manager_id == current_user.id:
        raise HTTPException(status_code=422, detail="Нельзя оценивать себя")
    source_kind = str(body.get("source_kind") or "manual").strip()
    source_user_id = _parse_uuid(body.get("source_user_id"), field="source_user_id") if body.get("source_user_id") else current_user.id
    validate_review_source(source_kind, source_user_id, manager_id, current_user.id)
    source_key = str(body.get("source_key") or "").strip()
    if not source_key:
        raise HTTPException(status_code=422, detail="Нужен идентификатор источника оценки")
    existing = await db.scalar(select(MzkReview.id).where(
        MzkReview.mzk_manager_id == manager_id,
        MzkReview.period_year == year,
        MzkReview.period_month == month,
        MzkReview.source_key == source_key,
    ))
    if existing:
        raise HTTPException(status_code=409, detail="Оценка из этого источника за период уже существует")
    review = MzkReview(
        mzk_manager_id=manager_id,
        period_year=year,
        period_month=month,
        is_positive=bool(body["is_positive"]),
        source_user_id=source_user_id,
        created_at=datetime.now(timezone.utc),
        source_kind=source_kind,
        source_key=source_key,
    )
    db.add(review)
    await db.commit()
    result = await db.execute(
        select(MzkReview).options(selectinload(MzkReview.mzk_manager)).where(MzkReview.id == review.id)
    )
    return _review_to_dict(result.scalar_one())


@router.post("/scores/compute")
async def compute_score(body: dict, db: Annotated[AsyncSession, Depends(get_db)], current_user: CurrentUser):
    require_access(current_user, "mzk_quality", Action.manage)
    manager_id = _parse_uuid(body.get("mzk_manager_id"), field="mzk_manager_id")
    try:
        year, month = int(body["period_year"]), int(body["period_month"])
    except (KeyError, TypeError, ValueError):
        raise HTTPException(status_code=422, detail="Неверный период")
    validate_period(year, month, now=datetime.now(timezone.utc))
    existing = await db.scalar(select(MzkQualityScore).where(
        MzkQualityScore.mzk_manager_id == manager_id,
        MzkQualityScore.period_year == year,
        MzkQualityScore.period_month == month,
    ))
    if existing:
        raise HTTPException(status_code=409, detail="Итог за период уже рассчитан")
    count, positive = (await db.execute(select(
        func.count(MzkReview.id), func.count(MzkReview.id).filter(MzkReview.is_positive == True),  # noqa: E712
    ).where(
        MzkReview.mzk_manager_id == manager_id,
        MzkReview.period_year == year,
        MzkReview.period_month == month,
        MzkReview.is_valid == True,  # noqa: E712
    ))).one()
    score_pct = positive / count * 100 if count else 0
    rules = await active_rules(db, RewardRuleKind.mzk_quality_bonus)
    tiers = (rules.get("default") or {}).get("tiers")
    score = MzkQualityScore(
        mzk_manager_id=manager_id, period_year=year, period_month=month,
        valid_reviews_count=count, positive_reviews_count=positive,
        score_pct=score_pct, bonus_amount=bonus_from_tiers(tiers, score_pct, disqualified=False),
        objection_deadline=datetime.now(timezone.utc) + timedelta(days=2),
    )
    db.add(score)
    await db.commit()
    return _score_to_dict(score)


@router.patch("/scores/{score_id}/disqualify")
async def disqualify_score(score_id: uuid.UUID, body: dict, db: Annotated[AsyncSession, Depends(get_db)], current_user: CurrentUser):
    require_access(current_user, "mzk_quality", Action.manage)
    score = await db.get(MzkQualityScore, score_id)
    if not score:
        raise HTTPException(status_code=404, detail="Итог ОКК не найден")
    reason = (body.get("reason") or "").strip()
    if not reason:
        raise HTTPException(status_code=422, detail="Нужна причина дисквалификации")
    score.disqualified = True
    score.disqualified_reason = reason
    score.bonus_amount = 0
    await db.commit()
    return _score_to_dict(score)


@router.patch("/scores/{score_id}/approve")
async def approve_score(score_id: uuid.UUID, db: Annotated[AsyncSession, Depends(get_db)], current_user: CurrentUser):
    require_access(current_user, "mzk_quality", Action.manage)
    score = await db.get(MzkQualityScore, score_id)
    if not score:
        raise HTTPException(status_code=404, detail="Итог ОКК не найден")
    if score.approved_at:
        raise HTTPException(status_code=409, detail="Итог уже утверждён")
    score.approved_by = current_user.id
    score.approved_at = datetime.now(timezone.utc)
    await db.commit()
    return _score_to_dict(score)


@router.post("/scores/{score_id}/objection")
async def create_objection(score_id: uuid.UUID, body: dict, db: Annotated[AsyncSession, Depends(get_db)], current_user: CurrentUser):
    if current_user.role != UserRole.mzk_manager:
        raise HTTPException(status_code=403, detail="Возражение доступно менеджеру МЗК")
    score = await db.get(MzkQualityScore, score_id)
    if not score or score.mzk_manager_id != current_user.id:
        raise HTTPException(status_code=404, detail="Итог ОКК не найден")
    if score.approved_at:
        raise HTTPException(status_code=409, detail="После утверждения возражение недоступно")
    if score.objection_deadline and datetime.now(timezone.utc) > score.objection_deadline:
        raise HTTPException(status_code=409, detail="Срок возражения истёк")
    text = (body.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=422, detail="Текст возражения обязателен")
    score.objection_text = text
    await db.commit()
    return _score_to_dict(score)


@router.get("/reviews")
async def list_reviews(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    mzk_manager_id: str | None = None,
):
    # Намеренно остаётся строго админским: по датам отдельных оценок
    # вычисляется, кто именно поставил минус. МЗК видит только помесячный итог.
    require_access(current_user, "mzk_quality", Action.manage)
    query = (
        select(MzkReview)
        .options(selectinload(MzkReview.mzk_manager))
        .order_by(MzkReview.created_at.desc())
    )
    scoped = _parse_uuid(mzk_manager_id, field="mzk_manager_id")
    if scoped is not None:
        query = query.where(MzkReview.mzk_manager_id == scoped)
    result = await db.execute(query)
    return {"items": [_review_to_dict(r) for r in result.scalars().all()]}


@router.patch("/reviews/{review_id}/invalidate")
async def invalidate_review(
    review_id: uuid.UUID,
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    """п.7.8 — недействительные оценки (повтор, самооценка, давление и т.п.)."""
    require_access(current_user, "mzk_quality", Action.manage)
    result = await db.execute(select(MzkReview).where(MzkReview.id == review_id))
    review = result.scalar_one_or_none()
    if not review:
        raise HTTPException(status_code=404, detail="Оценка не найдена")
    # п.7.8 требует основания: аннулирование без причины неотличимо от
    # «передумал», а раньше фронт слал одну и ту же захардкоженную строку.
    reason = (body.get("reason") or "").strip()
    if not reason:
        raise HTTPException(status_code=422, detail="Нужна причина аннулирования")
    review.is_valid = False
    review.invalidated_reason = reason
    await db.commit()
    result = await db.execute(
        select(MzkReview).options(selectinload(MzkReview.mzk_manager)).where(MzkReview.id == review.id)
    )
    return _review_to_dict(result.scalar_one())


@router.get("/scores")
async def list_scores(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    mzk_manager_id: str | None = None,
):
    # «Кому можно» — реестр; «чьи баллы» — resolve_score_scope ниже. До этой
    # строки решение о доступе принимал сам резолвер, мимо реестра, и правило
    # `mzk_quality:view` разошлось с поведением незамеченным.
    require_access(current_user, "mzk_quality", Action.view)

    scoped = resolve_score_scope(
        viewer_role=current_user.role,
        viewer_id=current_user.id,
        requested_manager_id=mzk_manager_id,
    )
    query = (
        select(MzkQualityScore)
        .options(selectinload(MzkQualityScore.mzk_manager))
        .order_by(MzkQualityScore.period_year.desc(), MzkQualityScore.period_month.desc())
    )
    if scoped is not None:
        query = query.where(MzkQualityScore.mzk_manager_id == scoped)
    result = await db.execute(query)
    return {"items": [_score_to_dict(s) for s in result.scalars().all()]}
