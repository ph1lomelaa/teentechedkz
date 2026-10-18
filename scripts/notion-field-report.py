#!/usr/bin/env python3
"""Read-only production audit. Prints aggregates; optional private full report.

Run inside the backend container (or with DATABASE_URL configured):
  python scripts/notion-field-report.py --output /tmp/notion-before.json
No queue, baseline or business values are changed by this script.
"""
import argparse
import asyncio
import json
import os
from pathlib import Path
import sys
from collections import Counter

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "backend"), str(ROOT)]
from sqlalchemy import text
from app.core.database import AsyncSessionLocal, engine
from app.core.config import settings
from app.services.notion_field_sync_report import build_report

async def main(path):
    async with AsyncSessionLocal() as db:
        await db.execute(text('SET TRANSACTION READ ONLY'))
        report = await build_report(db)
        result = {key: report[key] for key in ('revision', 'students', 'fresh', 'ready', 'review', 'directions', 'duplicate_students', 'archived_pages', 'last_read')}
        result['enabled'] = settings.ENABLE_NOTION_FIELD_SYNC
        result['dry_run'] = settings.NOTION_FIELD_SYNC_DRY_RUN
        counts = Counter()
        for row in report['rows']:
            for f in row['fields']:
                if f['decision'] != 'resolved':
                    counts[f"{f['field_key']}:{f['winner'] if f['eligible'] else 'review'}"] += 1
        result['fields'] = dict(counts)
        queue = (await db.execute(text('select status::text,count(*) from notion_field_sync_outbox group by status'))).all()
        result['queue'] = dict(queue)
        if path:
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, 'w') as file:
                json.dump(report, file, ensure_ascii=False, indent=2)
            result['private_report_saved'] = str(path)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    await engine.dispose()

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path)
    asyncio.run(main(parser.parse_args().output))
