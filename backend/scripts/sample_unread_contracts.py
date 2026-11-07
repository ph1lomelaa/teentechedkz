"""Образцы текста договоров «студент не найден», где ФИО студента не прочитано. Ничего не меняет.

Берёт по одному договору на шаблон (по началу названия), скачивает PDF из TrustMe
и печатает начало текста — чтобы понять, как в шаблоне записан студент.

python scripts/sample_unread_contracts.py --limit 8
"""
import argparse
import asyncio
from pathlib import Path
import re
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402
from app.api.v1.endpoints.trustme import _client  # noqa: E402
from app.api.v1.endpoints.trustme_registry import _facts  # noqa: E402
from app.core.database import AsyncSessionLocal  # noqa: E402
from app.models.trustme_contract import TrustMeDocument  # noqa: E402
from app.services.contract_documents import read_pages  # noqa: E402
from app.services.trustme import TrustMeError  # noqa: E402


def template(name):
    # «Договор_и_приложение_ТТЭ_Стажировк» и «00015057_Договор…» — один шаблон.
    words = re.sub(r'[\W\d_]+', ' ', name or '').split()
    return ' '.join(words[:4]).casefold()


async def main(args):
    async with AsyncSessionLocal() as db:
        docs = (await db.execute(select(TrustMeDocument).where(
            TrustMeDocument.decision == 'unmatched', TrustMeDocument.link_id.is_(None),
            TrustMeDocument.status != 4))).scalars().all()
        await db.rollback()
    picked, seen = [], set()
    for doc in docs:
        facts = _facts(doc)
        kind = 'пусто' if not facts.get('customer_name') else 'только заказчик'
        key = (kind, template(doc.name))
        if not facts.get('student_name') and doc.short_url and key not in seen:
            seen.add(key)
            picked.append((kind, doc))
    print(f'шаблонов: {len(picked)}, показываю {min(len(picked), args.limit)}')
    async with _client() as client:
        for kind, doc in picked[:args.limit]:
            print(f'\n######## [{kind}] №{doc.number} · {doc.name}')
            try:
                pages = await asyncio.to_thread(read_pages, await client.pdf(doc.short_url), ocr=False)
            except (TrustMeError, ValueError, OSError) as error:
                print('не скачался:', type(error).__name__)
                continue
            text = re.sub(r'\s+', ' ', ' '.join(p['text'] for p in pages))
            print(f'страниц: {len(pages)}, символов: {len(text)}')
            print(text[:args.chars])
            await asyncio.sleep(args.pause)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--limit', type=int, default=8)
    parser.add_argument('--chars', type=int, default=1500)
    parser.add_argument('--pause', type=float, default=5)
    asyncio.run(main(parser.parse_args()))
