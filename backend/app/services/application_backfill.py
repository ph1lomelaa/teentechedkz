"""Подбор вуза из справочника для заявок, где вуз записан свободным текстом.

Зачем: `applications.university` — строка, и до появления `university_id`
связать заявку со справочником было нечем. Этот модуль сопоставляет уже
накопленные строки с каталогом, переиспользуя `_similarity` из
university_import — тот же алгоритм, что развёл 200 вузов при импорте.

Почему не фильтруем по стране жёстко: `applications.country` тоже свободный
текст, и в реальных данных там встречается «сеул», «китай. гонконг»,
«south korea», «эмираты» — то есть город, две страны через точку, английское
название и разговорное сокращение. Совпадение по стране используется как
подтверждающий сигнал (бонус к порогу), но его отсутствие не отбраковывает
кандидата, иначе половина строк осталась бы без связи.

Ничего не пишет без явного `apply=True`: по умолчанию это отчёт, который
человек глазами проверяет перед тем, как трогать боевые данные.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.application import Application
from app.models.university import University
from app.services.university_import import _normalize_name, _similarity

# Выше порога — связываем автоматически. Значение то же, что у импорта
# каталога: там оно уже отсеяло TU Berlin от TU München.
MATCH_THRESHOLD = 0.8
# Ниже этого даже не показываем в отчёте — шум.
REPORT_THRESHOLD = 0.45
# Совпала страна — считаем совпадение чуть надёжнее. Небольшой бонус, а не
# фильтр: страна в заявке часто записана как город или по-английски.
COUNTRY_BONUS = 0.05


@dataclass
class BackfillCandidate:
    application_id: uuid.UUID
    raw_university: str
    raw_country: str
    university_id: uuid.UUID | None
    university_name: str | None
    score: float
    country_matched: bool


@dataclass
class BackfillReport:
    total: int = 0
    already_linked: int = 0
    no_text: int = 0
    matched: list[BackfillCandidate] = field(default_factory=list)
    ambiguous: list[BackfillCandidate] = field(default_factory=list)
    unmatched: list[BackfillCandidate] = field(default_factory=list)
    applied: int = 0


def _countries_agree(app_country: str | None, uni_country: str | None) -> bool:
    """Мягкое сравнение стран: вхождение в любую сторону.

    «китай. гонконг» ⊃ «Китай», «республика корея» ⊃ «Корея». Это намеренно
    щедро — сигнал вспомогательный, цена ложного срабатывания мала.
    """
    if not app_country or not uni_country:
        return False
    a, b = _normalize_name(app_country), _normalize_name(uni_country)
    if not a or not b:
        return False
    return a == b or a in b or b in a


def best_match(
    raw_name: str,
    raw_country: str | None,
    universities: list[University],
) -> tuple[University | None, float, bool]:
    """Лучший кандидат из каталога: (вуз, итоговый балл, совпала ли страна).

    Чистая функция — вся логика подбора тестируется без БД.
    """
    if not raw_name or not raw_name.strip():
        return None, 0.0, False

    best: University | None = None
    best_score = 0.0
    best_country = False
    for uni in universities:
        base = _similarity(raw_name, uni.name)
        country_ok = _countries_agree(raw_country, uni.country_name)
        score = min(base + COUNTRY_BONUS, 1.0) if country_ok else base
        if score > best_score:
            best, best_score, best_country = uni, score, country_ok
    return best, best_score, best_country


async def backfill_application_universities(
    db: AsyncSession, *, apply: bool = False
) -> BackfillReport:
    """Пройти по заявкам без university_id и подобрать вуз по названию."""
    report = BackfillReport()

    unis = (await db.execute(select(University))).scalars().all()
    apps = (await db.execute(select(Application))).scalars().unique().all()
    report.total = len(apps)

    for app in apps:
        if app.university_id is not None:
            report.already_linked += 1
            continue
        if not app.university or not app.university.strip():
            report.no_text += 1
            continue

        uni, score, country_ok = best_match(app.university, app.country, list(unis))
        cand = BackfillCandidate(
            application_id=app.id,
            raw_university=app.university,
            raw_country=app.country,
            university_id=uni.id if uni else None,
            university_name=uni.name if uni else None,
            score=round(score, 3),
            country_matched=country_ok,
        )

        if uni and score >= MATCH_THRESHOLD:
            report.matched.append(cand)
            if apply:
                app.university_id = uni.id
                report.applied += 1
        elif uni and score >= REPORT_THRESHOLD:
            report.ambiguous.append(cand)
        else:
            report.unmatched.append(cand)

    if apply and report.applied:
        await db.commit()
    return report
