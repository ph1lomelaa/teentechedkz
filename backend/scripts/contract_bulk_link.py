"""Синхронизировать договоры TrustMe с карточками платформы вручную.

    docker exec tte_backend_prod python scripts/contract_bulk_link.py           # только отчёт
    docker exec tte_backend_prod python scripts/contract_bulk_link.py --apply   # записать и привязать

То же, что фоновая синхронизация (app/services/trustme_sync.py): каждый
прочитанный договор попадает в реестр trustme_documents с решением и причиной,
однозначные совпадения привязываются, непривязанные перепроверяются по
сохранённым фактам. Существующие связи не трогает.
"""
import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from redis.asyncio import Redis  # noqa: E402

from app.api.v1.endpoints.trustme import _client  # noqa: E402
from app.core.config import settings  # noqa: E402
from app.core.database import AsyncSessionLocal  # noqa: E402
from app.services.trustme_sync import LOCK, sync  # noqa: E402


def initials(name):
    return ' '.join(part[0] + '.' for part in (name or '?').split()[:3])


def progress(done, total, linked):
    print(f'  … обработано {done} из {total} · привязано {linked}', flush=True)


async def main(apply, limit, full_scan=False, pause=0.3):
    async with Redis.from_url(settings.REDIS_URL, decode_responses=True) as redis:
        if apply and not await redis.set(LOCK, 'contract-bulk-link', nx=True, ex=6 * 3600):
            print('Синхронизация уже идёт (в фоне или другой командой). Попробуйте позже.')
            return
        try:
            print(f'Режим: {"ПРИВЯЗКА" if apply else "только отчёт"}', flush=True)
            async with AsyncSessionLocal() as db:
                async with _client() as client:
                    stats, review = await sync(db, client, apply=apply, limit=limit, force_read=full_scan, on_progress=progress, pause=pause)
        finally:
            if apply:
                await redis.delete(LOCK)
    print('\nНА ПРОВЕРКУ (не привязано):')
    for row, found, reason in review:
        people = ', '.join(f'{initials(s.full_name)} ({str(s.id)[:8]})' for s in (found if isinstance(found, list) else [found])[:3])
        print(f'  ~ №{row.get("numberDeal") or "—"} «{row.get("contractName")}» → {people}: {reason}')
    if not review:
        print('  —')
    print('\nИТОГО')
    for key, value in sorted(stats.items(), key=lambda x: -x[1]):
        print(f'  {key}: {value}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--apply', action='store_true', help='записать в реестр и привязать однозначные договоры')
    parser.add_argument('--limit', type=int, default=0, help='прочитать не больше N новых договоров')
    parser.add_argument('--full-scan', action='store_true', help='заново прочитать каждый непривязанный PDF (неподписанные — только на проверку)')
    parser.add_argument('--pause', type=float, default=0.3, help='пауза между договорами, секунд (больше — бережнее к TrustMe)')
    args = parser.parse_args()
    asyncio.run(main(args.apply, args.limit, args.full_scan, args.pause))
