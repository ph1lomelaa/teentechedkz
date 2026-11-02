"""Проверка поиска договоров TrustMe без изменений: ничего не привязывает и не пишет.

    docker exec tte_backend_prod python scripts/contract_discovery_report.py --limit 20

Берёт студентов в «Активной работе», ищет их договоры так же, как автопоиск
(ФИО студента, ФИО родителей, варианты имени, телефоны), читает подписанные PDF
и показывает, что система сделала бы и почему. В выводе — инициалы и начало id,
полные ФИО и почты не печатаются.
"""
import argparse
import asyncio
import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402

from app.core.database import AsyncSessionLocal  # noqa: E402
from app.models.contract import Contract  # noqa: E402
from app.models.guardian import Guardian  # noqa: E402
from app.models.student import Student  # noqa: E402
from app.models.trustme_contract import TrustMeContractLink  # noqa: E402
from app.services.contract_discovery import match_student, name_key, phone_key, phones_in_pages  # noqa: E402
from app.services.contract_documents import read_pages  # noqa: E402
from app.services.contract_profile import extract_profile  # noqa: E402
from app.services.trustme import TrustMeClient, TrustMeError, name_queries  # noqa: E402

PER_STUDENT = 12


def initials(name):
    return ' '.join(part[0] + '.' for part in (name or '?').split()[:3])


def signer_names(row):
    names = []
    for signer in row.get('signers') or []:
        try:
            for field in json.loads(signer.get('jsonData') or '[]'):
                if isinstance(field, dict) and field.get('key') in ('fio', 'name') and field.get('value'):
                    names.append(field['value'])
        except (ValueError, TypeError):
            continue
    return names


def overlap(a, b):
    return len(set(name_key(a)) & set(name_key(b)))


async def students_in_work(db, limit):
    rows = (await db.execute(select(Contract.student_id, Contract.pipeline_status)
                             .order_by(Contract.created_at.desc()))).all()
    latest = {}
    for sid, status in rows:
        latest.setdefault(sid, getattr(status, 'value', status))
    ids = [sid for sid, status in latest.items() if status == 'active_work'][:limit]
    return (await db.execute(select(Student).where(Student.id.in_(ids)))).scalars().all()


async def check_student(db, client, student, all_names, stats):
    guardians = (await db.execute(select(Guardian).where(Guardian.student_id == student.id))).scalars().all()
    linked = (await db.execute(select(TrustMeContractLink).where(TrustMeContractLink.student_id == student.id))).scalars().all()
    await check_person(client, student, guardians, {l.external_id for l in linked}, all_names, stats)


async def check_person(client, student, guardians, linked_ids, all_names, stats):
    """student: .id/.full_name/.phone; guardians: .full_name/.phone — источник любой."""
    linked = linked_ids
    phones = [p for p in dict.fromkeys([student.phone, *[g.phone for g in guardians]]) if phone_key(p)]
    queries = [(student.full_name, 'ФИО студента')]
    queries += [(g.full_name, 'ФИО родителя') for g in guardians if g.full_name]
    queries += [(q, 'часть имени') for q in name_queries(student.full_name)[1:] if q not in {x for x, _ in queries}]
    queries += [(phone_key(p), 'телефон') for p in phones[:3]]
    found, by = {}, {}
    for query, kind in queries:
        try:
            result = await client.search(query, max_pages=2, exact=True)
        except (TrustMeError, ValueError):
            stats['ошибка поиска'] += 1
            continue
        for row in result.candidates:
            found[row['id']] = row
            by.setdefault(row['id'], []).append(kind)
    signed = [row for row in found.values() if row.get('contractStatus') == 3]
    # Сначала те, что найдены по точному ФИО или телефону, а не по части имени.
    signed.sort(key=lambda row: by[row['id']] == ['часть имени'])
    lines = [f"\n{initials(student.full_name)} · {str(student.id)[:8]} · родителей {len(guardians)} · уже привязано {len(linked)} · "
             f"найдено {len(found)}, подписанных {len(signed)}"]
    outcomes = []
    for row in signed[:PER_STUDENT]:
        tag = '/'.join(dict.fromkeys(by[row['id']]))
        try:
            info = await client.contract(row.get('shortUrl') or '')
            content = await client.pdf(row['shortUrl'])
            pages = await asyncio.to_thread(read_pages, content, ocr=False)
            profile = extract_profile(pages, info, content)
        except (TrustMeError, ValueError, OSError) as error:
            outcomes.append('ошибка PDF')
            lines.append(f"   ? {tag}: не удалось прочитать PDF ({type(error).__name__})")
            continue
        outcome, reason = match_student(student, profile, pages, all_names)
        fields = profile['fields']
        in_pdf = fields.get('student_name') or ''
        note = []
        if outcome == 'unrelated' and overlap(in_pdf, student.full_name) >= 2:
            note.append('ВОЗМОЖНО ЭТОТ ЖЕ СТУДЕНТ: ФИО совпадает частично')
            stats['отброшен, но ФИО совпадает частично'] += 1
        if not ''.join(p['text'] for p in pages).strip():
            note.append('скан без текста')
            stats['скан без текста'] += 1
        signers = signer_names(row)
        if signers and not any(name_key(s) == name_key(student.full_name) for s in signers):
            stats['подписал не студент'] += 1
            note.append('подписал другой человек')
        if outcome == 'confirmed':
            stats['email в договоре' if fields.get('customer_email') else 'нет email в договоре'] += 1
            stats['привязка по: ' + tag] += 1
        if any(phone_key(p) in phones_in_pages(pages) for p in phones):
            note.append('телефон из карточки есть в PDF')
        if row['id'] in linked_ids:
            note.append('уже привязан к этой карточке')
            stats['уже привязанный найден поиском'] += 1
        mark = {'confirmed': '✓', 'review': '~', 'unrelated': '✗'}[outcome]
        outcomes.append(outcome)
        stats[f'итог: {reason}'] += 1
        lines.append(f"   {mark} {tag}: {reason}" + (f" · студент в PDF: {initials(in_pdf)}" if in_pdf else '') + (' · ' + '; '.join(note) if note else ''))
    missing = linked_ids - set(found)
    if missing:
        stats['привязан вручную, но поиск не нашёл'] += len(missing)
        lines.append(f"   ! привязано вручную, но поиск не нашёл: {len(missing)}")
    if len(signed) > PER_STUDENT:
        lines.append(f"   ! проверены первые {PER_STUDENT} из {len(signed)} подписанных")
    stats['студентов: ' + ('есть автопривязка' if 'confirmed' in outcomes else 'только на проверку' if 'review' in outcomes
                           else 'договор не найден' if not signed else 'всё отброшено как чужое')] += 1
    print('\n'.join(lines), flush=True)


async def main(limit):
    stats = Counter()
    async with AsyncSessionLocal() as db:
        students = await students_in_work(db, limit)
        all_names = (await db.execute(select(Student.full_name))).scalars().all()
        print(f'Студентов в «Активной работе» для проверки: {len(students)} (ничего не привязывается)')
        async with TrustMeClient.from_settings() as client:
            for student in students:
                await check_student(db, client, student, all_names, stats)
    print('\nИТОГО')
    for key, value in sorted(stats.items(), key=lambda x: (x[0].split(':')[0], -x[1])):
        print(f'  {key}: {value}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--limit', type=int, default=20)
    asyncio.run(main(parser.parse_args().limit))
