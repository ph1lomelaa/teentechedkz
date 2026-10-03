import json
from typing import Annotated
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from sqlalchemy import select, text
from app.api.v1.endpoints.activities import DB, require_catalog_admin
from app.core.deps import CurrentUser
from app.models.activity import Activity, ActivityIntake
from app.services.activity_import import MAX_BYTES, identity, preview_xlsx

router = APIRouter(prefix='/activity-import', tags=['activities'])

async def read_preview(file):
    if not (file.filename or '').lower().endswith('.xlsx'):
        raise HTTPException(422, 'Загрузите файл XLSX')
    content = await file.read(MAX_BYTES + 1)
    try:
        return preview_xlsx(content, (file.filename or '').replace('\\', '/').split('/')[-1])
    except Exception as exc:
        if isinstance(exc, ValueError):
            raise HTTPException(422, str(exc)) from exc
        raise HTTPException(422, 'Не удалось прочитать XLSX') from exc

async def mark_duplicates(db, preview):
    existing = (await db.execute(select(Activity))).scalars().all()
    keys = {a.import_key or identity(a.title, a.organizer, a.source_url) for a in existing}
    for row in preview['rows']:
        if row['key'] in keys:
            row['errors'].append('Уже есть в каталоге; существующая запись не изменена')
    return preview

@router.post('/preview')
async def preview(db: DB, user: CurrentUser, file: UploadFile = File(...)):
    require_catalog_admin(user)
    return await mark_duplicates(db, await read_preview(file))

@router.post('/commit')
async def commit(db: DB, user: CurrentUser, file: UploadFile = File(...), selected_rows: str = Form(...)):
    require_catalog_admin(user)
    try:
        selected = json.loads(selected_rows)
        if not isinstance(selected, list) or not selected or any(type(i) is not int for i in selected):
            raise ValueError()
    except (ValueError, TypeError):
        raise HTTPException(422, 'Выберите строки для импорта')
    preview = await read_preview(file)
    # Serialize imports, then recheck duplicate keys inside the same transaction.
    await db.execute(text('SELECT pg_advisory_xact_lock(10320261003)'))
    await mark_duplicates(db, preview)
    selected = set(selected)
    if not selected.issubset({r['row'] for r in preview['rows']}):
        raise HTTPException(422, 'Строки отсутствуют в файле')
    imported, skipped = [], []
    for row in preview['rows']:
        if row['row'] not in selected:
            continue
        if row['errors']:
            skipped.append(dict(row=row['row'], errors=row['errors']))
            continue
        activity = Activity(**row['activity'], import_key=row['key'], import_source=row['source'])
        db.add(activity)
        await db.flush()
        db.add(ActivityIntake(activity_id=activity.id, label='Из исходной базы', dates_text=row['dates_text'], mode='unknown', cost_state='unknown'))
        imported.append(row['row'])
    await db.commit()
    return dict(imported_rows=imported, skipped_rows=skipped)
