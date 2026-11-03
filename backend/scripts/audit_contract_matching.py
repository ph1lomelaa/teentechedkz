"""Read every pending PDF, retain a private cache, explain and optionally apply matches.

python scripts/audit_contract_matching.py --cache-dir /audit
python scripts/audit_contract_matching.py --cache-dir /audit --apply

The report contains personal data. Keep the cache outside the repository and web root.
Completed downloads survive interruption; retries never recreate student cards or merge them.
"""
import argparse
import asyncio
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import sys
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from redis.asyncio import Redis  # noqa: E402
from sqlalchemy import select  # noqa: E402
from app.api.v1.endpoints.trustme import _client  # noqa: E402
from app.core.config import settings  # noqa: E402
from app.core.database import AsyncSessionLocal  # noqa: E402
from app.core.encryption import encrypt  # noqa: E402
from app.models.student import Student  # noqa: E402
from app.models.trustme_contract import TrustMeContractLink, TrustMeDocument  # noqa: E402
from app.services.contract_documents import read_pages  # noqa: E402
from app.services.contract_matching import pick_student, recover_student_identity  # noqa: E402
from app.services.contract_profile import extract_profile  # noqa: E402
from app.services.trustme_sync import LOCK, _decision, _link, facts_of, load_people  # noqa: E402


def save_json(path, value):
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2))
    os.chmod(temp, 0o600)
    temp.replace(path)


def folder_for(root, external_id):
    # TrustMe IDs can be UUIDs or hashes; never use unchecked upstream paths.
    name = external_id if external_id and all(c.isalnum() or c in '_-' for c in external_id) else hashlib.sha256(external_id.encode()).hexdigest()
    folder = root / name
    folder.mkdir(mode=0o700, exist_ok=True)
    return folder


async def collect(client, rows, root, concurrency):
    semaphore = asyncio.Semaphore(concurrency)
    counts = Counter()

    async def read(row):
        async with semaphore:
            folder = folder_for(root, row['external_id'])
            for attempt in range(3):
                try:
                    if not (folder / 'info.json').exists():
                        save_json(folder / 'info.json', await client.contract(row['short_url']))
                    pdf = folder / 'document.pdf'
                    if not pdf.exists():
                        content = await client.pdf(row['short_url'])
                        temporary = folder / 'document.pdf.tmp'
                        temporary.write_bytes(content)
                        os.chmod(temporary, 0o600)
                        temporary.replace(pdf)
                    if not (folder / 'pages.json').exists():
                        pages = await asyncio.to_thread(read_pages, pdf.read_bytes(), ocr=False)
                        if not any(p['text'].strip() for p in pages):
                            pages = await asyncio.to_thread(read_pages, pdf.read_bytes(), ocr=True)
                        save_json(folder / 'pages.json', pages)
                    (folder / 'error.json').unlink(missing_ok=True)
                    counts['read'] += 1
                    break
                except Exception as error:
                    save_json(folder / 'error.json', {'type': type(error).__name__, 'message': str(error)[:300]})
                    if attempt == 2:
                        counts['failed'] += 1
                    else:
                        await asyncio.sleep(2 * (attempt + 1))
            counts['done'] += 1
            save_json(root / 'progress.json', {'total': len(rows), **counts})
            if counts['done'] % 10 == 0:
                print(json.dumps({'total': len(rows), **counts}), flush=True)

    await asyncio.gather(*(read(row) for row in rows))
    return counts


async def analyze(db, client, rows, root, apply):
    people = await load_people(db)
    await db.rollback()
    results, counts = [], Counter()
    for row in rows:
        folder = folder_for(root, row['external_id'])
        item = {**row}
        if not (folder / 'pages.json').exists():
            item.update(result='download_failed', reason='Не удалось получить PDF после повторных попыток')
        else:
            try:
                pages = json.loads((folder / 'pages.json').read_text())
                info = json.loads((folder / 'info.json').read_text())
                if not any(p['text'].strip() for p in pages):
                    item.update(result='unreadable', reason='После OCR не найден текст')
                else:
                    profile = recover_student_identity(extract_profile(pages, info, (folder / 'document.pdf').read_bytes()), pages, people.students, people.guardians)
                    decision, found, reason = pick_student(profile, pages, people.students, people.guardians, people.names, row['name'])
                    candidates = found if isinstance(found, list) else [found]
                    item.update(result=decision, reason=reason, student_name=profile['fields'].get('student_name'), customer_name=profile['fields'].get('customer_name'),
                                candidates=[{'id': str(s.id), 'name': s.full_name} for s in candidates],
                                source_page=profile.get('sources', {}).get('student_name', {}).get('page'))
                    save_json(folder / 'profile.json', profile)
                    if apply:
                        doc = (await db.execute(select(TrustMeDocument).where(TrustMeDocument.id == uuid.UUID(row['id'])).with_for_update())).scalar_one_or_none()
                        existing = (await db.execute(select(TrustMeContractLink.id).where(TrustMeContractLink.company_id == row['company_id'], TrustMeContractLink.external_id == row['external_id']))).first()
                        if not doc or existing or doc.decision in ('linked', 'detached'):
                            item['applied'] = 'skipped_existing_or_manual'
                        else:
                            doc.facts_encrypted = encrypt(json.dumps(facts_of(profile, pages), ensure_ascii=False))
                            doc.checked_at = datetime.now(timezone.utc)
                            if decision == 'link':
                                fresh = await client.contract(doc.short_url)
                                if fresh.get('contract_status') != 3:
                                    doc.status = fresh.get('contract_status') or 0
                                    doc.decision, doc.reason = 'unsigned', 'Актуальный договор не подписан'
                                    item['applied'] = 'not_signed'
                                else:
                                    await _link(db, client, doc, await db.get(Student, found.id), fresh, profile, pages)
                                    item['applied'] = 'linked'
                            else:
                                doc.decision, doc.candidate_ids = _decision(decision, found)
                                doc.reason = reason
                                item['applied'] = 'registry_updated'
                        await db.commit()
            except Exception as error:
                await db.rollback()
                item.update(result='processing_error', reason=type(error).__name__)
        counts[item['result']] += 1
        if item.get('applied'):
            counts['applied:' + item['applied']] += 1
        results.append(item)
        save_json(root / 'report.json', {'summary': dict(counts), 'items': results})
    print('AUDIT COMPLETE', json.dumps(dict(counts), ensure_ascii=False), flush=True)
    return counts


async def main(args):
    root = Path(args.cache_dir).resolve()
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(root, 0o700)
    token = 'contract-audit:' + uuid.uuid4().hex
    async with Redis.from_url(settings.REDIS_URL, decode_responses=True) as redis:
        if args.apply and not await redis.set(LOCK, token, nx=True, ex=6 * 3600):
            raise RuntimeError('Другой проход привязки ещё выполняется; повторите после его окончания')
        try:
            async with AsyncSessionLocal() as db:
                docs = (await db.execute(select(TrustMeDocument).where(TrustMeDocument.decision.in_(['review', 'unmatched', 'unreadable'])))).scalars().all()
                inventory_path = root / 'inventory.json'
                prior = json.loads(inventory_path.read_text()) if inventory_path.exists() else []
                inventory = {row['id']: row for row in prior}
                for d in docs:
                    inventory[str(d.id)] = dict(id=str(d.id), external_id=d.external_id, short_url=d.short_url, number=d.number, name=d.name, company_id=d.company_id)
                rows = list(inventory.values())
                save_json(inventory_path, rows)
                await db.rollback()  # Release the inventory read transaction before network I/O.
                async with _client() as client:
                    await client.contracts('', 1)
                    if any(row['company_id'] != client.company_id for row in rows):
                        raise RuntimeError('В кеше есть договор другой компании')
                    if not args.cached_only:
                        await collect(client, rows, root, args.concurrency)
                    await analyze(db, client, rows, root, args.apply)
        finally:
            if args.apply:
                await redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, LOCK, token)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache-dir', required=True)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--cached-only', action='store_true')
    parser.add_argument('--concurrency', type=int, choices=range(1, 5), default=4)
    asyncio.run(main(parser.parse_args()))
