"""Read-only diagnostics. No transcript text, participant names, URLs or secrets.
Run from backend: python scripts/diagnose_meeting_session.py SESSION_UUID
Uses DATABASE_URL of the selected environment; never contacts the provider.
"""
import argparse
import asyncio
import json
import uuid
from sqlalchemy import text
from app.core.database import AsyncSessionLocal, engine

async def diagnose(session_id):
    async with AsyncSessionLocal() as db:
        row = (await db.execute(text('''SELECT id, status, capture_mode, language,
            bot_provider, bot_status, bot_status_reason, started_at, ended_at,
            bot_joined_at, bot_last_event_at, quality, quality_reasons,
            quality_warnings, quality_metrics, note_id IS NOT NULL AS has_note,
            audio_storage_path IS NOT NULL AS has_audio
            FROM note_sessions WHERE id = :id'''), {'id': session_id})).mappings().first()
        if row is None:
            raise SystemExit('Session not found')
        counts = (await db.execute(text('''SELECT count(*) AS fragments,
            count(DISTINCT speaker) AS speakers, max(created_at) AS last_fragment_at
            FROM note_transcripts WHERE session_id = :id'''), {'id': session_id})).mappings().one()
        events = (await db.execute(text('''SELECT created_at, trigger,
            CASE WHEN trigger = 'bot.state_change' THEN payload->'data'->>'new_state' END AS state,
            CASE WHEN trigger = 'bot.state_change' THEN payload->'data'->>'event_sub_type' END AS reason
            FROM meeting_bot_events WHERE session_id = :id ORDER BY created_at DESC LIMIT 50'''), {'id': session_id})).mappings().all()
        print(json.dumps({'session': dict(row), 'transcript': dict(counts),
                          'events': [dict(event) for event in reversed(events)]}, default=str, ensure_ascii=False, indent=2))
    await engine.dispose()

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('session_id', type=uuid.UUID)
    asyncio.run(diagnose(parser.parse_args().session_id))
