"""Привязать подписанные договоры TrustMe ко всем студентам платформы.

    docker exec tte_backend_prod python scripts/contract_bulk_link.py           # только отчёт
    docker exec tte_backend_prod python scripts/contract_bulk_link.py --apply   # привязать

Идёт от договора к студенту: читает каждый подписанный и ещё не привязанный
договор, находит в PDF абитуриента и телефоны и ищет его карточку. Привязывает
только однозначные случаи — по тем же правилам, что автопоиск в карточке.
Существующие связи не трогает. Спорные договоры перечисляет для проверки.
"""
import argparse
import asyncio
import sys
from collections import Counter, defaultdict
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402
from sqlalchemy.exc import DBAPIError, IntegrityError  # noqa: E402

from app.api.v1.endpoints.trustme import _candidate, new_document_link  # noqa: E402
from app.core.audit import log_change  # noqa: E402
from app.core.database import AsyncSessionLocal  # noqa: E402
from app.models.contract import Contract  # noqa: E402
from app.models.guardian import Guardian  # noqa: E402
from app.models.student import Student  # noqa: E402
from app.models.trustme_contract import TrustMeContractLink  # noqa: E402
from app.services.contract_discovery import match_student, phone_key, phones_in_pages, same_person  # noqa: E402
from app.services.contract_documents import read_pages  # noqa: E402
from app.services.contract_profile import extract_profile  # noqa: E402
from app.services.trustme import TrustMeClient, TrustMeError  # noqa: E402

ACTOR = 'contract-bulk-link'


def initials(name):
    return ' '.join(part[0] + '.' for part in (name or '?').split()[:3])


def pick_student(profile, pages, students, guardian_phones, all_names):
    """('link', student, причина) | ('review', [студенты], причина) | ('none', [], причина)."""
    fields = profile.get('fields', {})
    named = fields.get('student_name') or fields.get('customer_name') or ''
    in_pdf = phones_in_pages(pages)
    candidates = [s for s in students
                  if (named and same_person(named, s.full_name))
                  or in_pdf & ({phone_key(s.phone)} | {phone_key(p) for p in guardian_phones.get(s.id, ())}) - {''}]
    results = [(s, *match_student(s, profile, pages, all_names, guardian_phones.get(s.id, ()))) for s in candidates]
    confirmed = [s for s, outcome, _ in results if outcome == 'confirmed']
    if len(confirmed) == 1:
        return 'link', confirmed[0], 'Студент однозначно указан в договоре'
    if len(confirmed) > 1:
        return 'review', confirmed, 'Договору подходят несколько карточек'
    review = [(s, reason) for s, outcome, reason in results if outcome == 'review']
    if review:
        return 'review', [s for s, _ in review], review[0][1]
    if not named:
        return 'none', [], 'В PDF не найден абитуриент'
    return 'none', [], 'Студента из договора нет среди карточек платформы'


async def signed_contracts(client, known):
    rows, seen, page = [], set(), 1
    while True:
        batch = await client.contracts('', page)
        fresh = [row for row in batch if row['id'] not in seen]
        if not fresh:
            return rows
        seen.update(row['id'] for row in fresh)
        rows += [row for row in fresh if row.get('contractStatus') == 3 and row['id'] not in known]
        page += 1


async def main(apply, limit):
    stats, review = Counter(), []
    async with AsyncSessionLocal() as db:
        # Простые записи, а не объекты сессии: откат после конфликта не должен их сбрасывать.
        students = [SimpleNamespace(id=sid, full_name=name, phone=phone or '') for sid, name, phone in
                    (await db.execute(select(Student.id, Student.full_name, Student.phone))).all()]
        all_names = [s.full_name for s in students]
        guardian_phones = defaultdict(list)
        for sid, phone in (await db.execute(select(Guardian.student_id, Guardian.phone))).all():
            if phone:
                guardian_phones[sid].append(phone)
        async with TrustMeClient.from_settings() as client:
            await client.contracts('', 1)  # вход и определение компании
            known = set((await db.execute(select(TrustMeContractLink.external_id).where(
                TrustMeContractLink.company_id == client.company_id))).scalars())
            rows = await signed_contracts(client, known)
            print(f'Студентов на платформе: {len(students)} · уже привязано договоров: {len(known)} · '
                  f'подписанных без привязки: {len(rows)} · режим: {"ПРИВЯЗКА" if apply else "только отчёт"}', flush=True)
            for n, row in enumerate(rows[:limit] if limit else rows, 1):
                candidate = _candidate(row)
                if not candidate['short_url']:
                    stats['нет ссылки на договор'] += 1
                    continue
                try:
                    info = await client.contract(candidate['short_url'])
                    if info.get('contract_status') != 3:
                        stats['статус изменился'] += 1
                        continue
                    content = await client.pdf(candidate['short_url'])
                    pages = await asyncio.to_thread(read_pages, content, ocr=False)
                    profile = extract_profile(pages, info, content)
                except (TrustMeError, ValueError, OSError) as error:
                    stats['не удалось прочитать PDF'] += 1
                    print(f'  ? {candidate["number"] or row["id"][:8]}: {type(error).__name__}', flush=True)
                    continue
                if not ''.join(p['text'] for p in pages).strip():
                    stats['скан без текста (проверить вручную)'] += 1
                    continue
                decision, found, reason = pick_student(profile, pages, students, guardian_phones, all_names)
                stats[f'{decision}: {reason}'] += 1
                if decision == 'review':
                    review.append(f'  ~ №{candidate["number"] or "—"} «{candidate["name"]}» → '
                                  + ', '.join(f'{initials(s.full_name)} ({str(s.id)[:8]})' for s in found[:3]) + f': {reason}')
                if n % 20 == 0:
                    print(f'  … обработано {n} из {len(rows)} · привязано {stats["привязано"]}', flush=True)
                if decision != 'link' or not apply:
                    continue
                # Каждая привязка — своя короткая транзакция: карточки открывают
                # параллельно, и их автопоиск может привязывать тот же договор.
                try:
                    choices = (await db.execute(select(Contract).where(Contract.student_id == found.id))).scalars().all()
                    link = new_document_link(found.id, client.company_id, info, candidate, profile, pages, choices, None)
                    db.add(link)
                    await db.flush()
                    await log_change(db, 'student', found.id, 'contract_auto_linked', None, str(link.id), ACTOR, 'auto')
                    await db.commit()
                    stats['привязано'] += 1
                except IntegrityError:
                    await db.rollback()
                    stats['уже привязан параллельно'] += 1
                except DBAPIError as error:
                    await db.rollback()
                    stats['пропущен из-за блокировки БД (запустите ещё раз)'] += 1
                    print(f'  ! №{candidate["number"] or "—"}: {type(error.orig).__name__ if error.orig else "DBAPIError"}', flush=True)
            await db.commit()
    print('\nНА ПРОВЕРКУ (не привязано):')
    print('\n'.join(review) or '  —')
    print('\nИТОГО')
    for key, value in sorted(stats.items(), key=lambda x: -x[1]):
        print(f'  {key}: {value}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--apply', action='store_true', help='привязать однозначные договоры (без флага — только отчёт)')
    parser.add_argument('--limit', type=int, default=0, help='проверить только первые N договоров')
    args = parser.parse_args()
    asyncio.run(main(args.apply, args.limit))
