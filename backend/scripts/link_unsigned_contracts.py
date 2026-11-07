"""Привязать неподписанные договоры из реестра, у которых карточка определена однозначно.

Синхронизация такие договоры сама не привязывает, а кладёт «на проверку» с причиной
«Не подписан · <правило привязки>» и одной карточкой. Скрипт берёт только их:
ровно один кандидат и причина из правил, по которым подписанный договор привязался бы сам.
Договоры с несколькими карточками или с сомнительным ФИО не трогает.

python scripts/link_unsigned_contracts.py              # только список
python scripts/link_unsigned_contracts.py --apply      # привязать, пауза 5 с между договорами
"""
import argparse
import asyncio
from collections import Counter
from pathlib import Path
import sys
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from redis.asyncio import Redis  # noqa: E402
from sqlalchemy import select  # noqa: E402
from sqlalchemy.exc import IntegrityError  # noqa: E402
from app.api.v1.endpoints.trustme import _client  # noqa: E402
from app.core.config import settings  # noqa: E402
from app.core.database import AsyncSessionLocal  # noqa: E402
from app.models.student import Student  # noqa: E402
from app.models.trustme_contract import TrustMeContractLink, TrustMeDocument  # noqa: E402
from app.services.contract_documents import read_pages  # noqa: E402
from app.services.contract_profile import extract_profile  # noqa: E402
from app.services.trustme import TrustMeError  # noqa: E402
from app.services.trustme_sync import LOCK, MAX_FAILURES, UNSIGNED_NOTE, _link, _recover  # noqa: E402

# Причины из contract_matching.pick_student, при которых решение было 'link'.
SURE = ('Студент однозначно указан в договоре', 'ФИО в договоре + полное ФИО или название договора',
        'ФИО и отдельный телефон абитуриента совпадают с одной карточкой', 'В договоре ',
        'Заказчик — родитель')


def eligible(doc):
    prefix = f'{UNSIGNED_NOTE} · '
    reason = doc.reason or ''
    return (doc.link_id is None and doc.status != 4 and len(doc.candidate_ids or []) == 1
            and reason.startswith(prefix) and reason[len(prefix):].startswith(SURE))


async def main(args):
    token = 'link-unsigned:' + uuid.uuid4().hex
    async with Redis.from_url(settings.REDIS_URL, decode_responses=True) as redis:
        if args.apply and not await redis.set(LOCK, token, nx=True, ex=6 * 3600):
            raise RuntimeError('Идёт синхронизация TrustMe; повторите после её окончания')
        try:
            async with AsyncSessionLocal() as db:
                docs = [d for d in (await db.execute(select(TrustMeDocument).where(
                    TrustMeDocument.decision == 'review'))).scalars().all() if eligible(d)]
                if args.limit:
                    docs = docs[:args.limit]
                stats, failures = Counter(), 0
                async with _client() as client:
                    for i, doc in enumerate(docs, 1):
                        student = await db.get(Student, uuid.UUID(doc.candidate_ids[0]))
                        label = f'[{i}/{len(docs)}] №{doc.number or "—"} {doc.name[:60]} → {student.full_name if student else "карточка удалена"}'
                        if student is None or doc.company_id != client.company_id:
                            print(label, '— пропуск'); stats['пропуск'] += 1
                            continue
                        if not args.apply:
                            print(label); stats['будет привязано'] += 1
                            continue
                        existing = (await db.execute(select(TrustMeContractLink).where(
                            TrustMeContractLink.company_id == doc.company_id,
                            TrustMeContractLink.external_id == doc.external_id))).scalar_one_or_none()
                        if existing:
                            print(label, '— уже привязан'); stats['уже привязан'] += 1
                            continue
                        try:
                            info = await client.contract(doc.short_url)
                            if info.get('contract_status') == 4:
                                print(label, '— отозван'); stats['отозван'] += 1
                                continue
                            await asyncio.sleep(args.pause / 2)
                            content = await client.pdf(doc.short_url)
                            pages = await asyncio.to_thread(read_pages, content, ocr=False)
                            await _link(db, client, doc, student, info, extract_profile(pages, info, content), pages)
                            await db.commit()
                            print(label, '— привязан'); stats['привязано'] += 1
                            failures = 0
                        except TrustMeError as error:
                            await db.rollback()
                            failures += 1
                            print(label, f'— сбой TrustMe ({type(error).__name__})'); stats['сбой TrustMe'] += 1
                            if failures >= MAX_FAILURES:
                                print('TrustMe не отвечает несколько раз подряд — остановка, повторите позже')
                                break
                            await _recover(client, failures, error, stats)
                        except (ValueError, OSError, IntegrityError):
                            await db.rollback()
                            print(label, '— ошибка'); stats['ошибка'] += 1
                        await asyncio.sleep(args.pause)
                print(dict(stats))
        finally:
            if args.apply:
                await redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, LOCK, token)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--pause', type=float, default=5)
    parser.add_argument('--limit', type=int, default=0)
    asyncio.run(main(parser.parse_args()))
