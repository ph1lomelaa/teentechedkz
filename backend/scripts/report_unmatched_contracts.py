"""Отчёт по договорам реестра «студент не найден» и «скан без текста». Ничего не меняет.

Делит договоры на группы:
  1. ФИО студента прочитано, похожей карточки нет — скорее всего, студента нет на платформе;
  2. ФИО прочитано, есть похожие карточки — возможно, опечатка или другое написание;
  3. ФИО студента не прочитано (только заказчик или ничего) — проверить PDF вручную;
  4. скан без текста.

python scripts/report_unmatched_contracts.py
"""
import asyncio
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402
from app.api.v1.endpoints.trustme_registry import _facts  # noqa: E402
from app.core.database import AsyncSessionLocal  # noqa: E402
from app.models.trustme_contract import TrustMeDocument  # noqa: E402
from app.services.contract_discovery import fuzzy_overlap, name_overlap, transliterated_person  # noqa: E402
from app.services.trustme_sync import load_people  # noqa: E402


def similar(name, people):
    if not name:
        return []
    found = [s.full_name for s in people.students if name_overlap(name, s.full_name) >= 2
             or fuzzy_overlap(name, s.full_name) >= 2 or transliterated_person(name, s.full_name)]
    return found[:3]


def line(doc, facts, hint=()):
    text = f'  №{doc.number or "—"} · {doc.name[:70]} · студент: {facts.get("student_name") or "—"} · заказчик: {facts.get("customer_name") or "—"}'
    return text + (f'\n      похожие карточки: {"; ".join(hint)}' if hint else '') + (f'\n      причина: {doc.reason}' if doc.reason else '')


async def main():
    async with AsyncSessionLocal() as db:
        people = await load_people(db)
        docs = (await db.execute(select(TrustMeDocument).where(
            TrustMeDocument.decision.in_(('unmatched', 'unreadable')), TrustMeDocument.link_id.is_(None),
            TrustMeDocument.status != 4))).scalars().all()
        groups = {1: [], 2: [], 3: [], 4: []}
        for doc in sorted(docs, key=lambda d: d.contract_created_at or ''):
            facts = _facts(doc)
            student = facts.get('student_name') or ''
            if doc.decision == 'unreadable':
                groups[4].append(line(doc, facts))
            elif not student:
                groups[3].append(line(doc, facts, similar(facts.get('customer_name'), people)))
            elif hint := similar(student, people):
                groups[2].append(line(doc, facts, hint))
            else:
                groups[1].append(line(doc, facts))
        titles = {1: 'Студента нет на платформе (похожих карточек нет)', 2: 'Есть похожие карточки — проверить',
                  3: 'ФИО студента не прочитано — открыть PDF', 4: 'Скан без текста'}
        for key, title in titles.items():
            print(f'\n=== {title}: {len(groups[key])} ===')
            print('\n'.join(groups[key]))


if __name__ == '__main__':
    asyncio.run(main())
