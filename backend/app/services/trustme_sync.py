"""Синхронизация договоров TrustMe с карточками платформы.

Каждый договор, который платформа прочитала, лежит в реестре `trustme_documents`
с решением и причиной. Проход:
  1. весь список TrustMe (≈20 запросов) — новые договоры и договоры со сменой
     статуса читаются из PDF, остальные не трогаются;
  2. непривязанные перепроверяются по сохранённым фактам без загрузки PDF:
     появился студент или в карточку дописали телефон/ИИН родителя — договор
     привяжется сам.
Привязка — только при однозначном совпадении (contract_matching.pick_student).
Связь, удалённую сотрудником, синхронизация обратно не восстанавливает.
"""
import asyncio
import json
import logging
import re
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from sqlalchemy import select
from sqlalchemy.exc import DBAPIError, IntegrityError

from app.core.audit import log_change
from app.core.config import settings
from app.core.encryption import decrypt, encrypt
from app.models.contract import Contract
from app.models.guardian import Guardian
from app.models.student import Student
from app.models.trustme_contract import TrustMeContractLink, TrustMeDocument
from app.services.contract_discovery import phones_in_pages, role_phones
from app.services.contract_documents import apply_document_signing_date, preserve_manual, read_pages
from app.services.contract_matching import pick_student, recover_student_identity
from app.services.contract_profile import cached_profile, extract_profile, store_profile
from app.services.trustme import TrustMeError

log = logging.getLogger(__name__)
ACTOR = 'trustme-sync'
LOCK = 'trustme-sync:lock'
# Нечитаемый PDF пробуем снова не чаще раза в сутки.
RETRY_UNREADABLE = timedelta(hours=24)
TRANSIENT = 'Не удалось прочитать PDF'
UNSIGNED_NOTE = 'Не подписан'
# Подряд столько сбоев TrustMe — проход прерывается, договоры не помечаются.
MAX_FAILURES = 5
PAUSE = 0.3
FACT_FIELDS = ('student_name', 'customer_name', 'customer_id', 'student_id_number', 'customer_email')


async def load_people(db):
    """Карточки и родители — простыми записями: откат после конфликта их не сбросит."""
    students = [SimpleNamespace(id=sid, full_name=name, phone=phone or '') for sid, name, phone in
                (await db.execute(select(Student.id, Student.full_name, Student.phone))).all()]
    guardians = defaultdict(list)
    for sid, name, phone, iin in (await db.execute(select(Guardian.student_id, Guardian.full_name, Guardian.phone, Guardian.iin_encrypted))).all():
        try:
            plain = re.sub(r'\D', '', decrypt(iin)) if iin else ''
        except Exception:
            plain = ''
        guardians[sid].append(SimpleNamespace(full_name=name or '', phone=phone or '', iin=plain))
    return SimpleNamespace(students=students, guardians=guardians, names=[s.full_name for s in students])


def facts_of(profile, pages):
    return {'fields': {k: profile['fields'].get(k) for k in FACT_FIELDS if profile['fields'].get(k)},
            'sources': {k: profile['sources'][k] for k in ('student_name', 'customer_name') if k in profile.get('sources', {})},
            'phones': sorted(phones_in_pages(pages)),
            'student_phones': sorted(role_phones(pages, 'student'))}


def decide_from_facts(facts, people, title):
    """То же решение, что по PDF, — по сохранённым фактам, без TrustMe."""
    pages = [{'text': ' '.join('8' + p for p in facts.get('phones', []))}]
    return pick_student({'fields': facts.get('fields', {}), 'sources': facts.get('sources', {}), 'student_phones': facts.get('student_phones', [])}, pages,
                        people.students, people.guardians, people.names, title)


def _decision(decision, found):
    if decision == 'review':
        return 'review', [str(s.id) for s in found]
    return ('unmatched', []) if decision == 'none' else ('review', [str(found.id)])


async def _document(db, company_id, row):
    doc = (await db.execute(select(TrustMeDocument).where(
        TrustMeDocument.company_id == company_id, TrustMeDocument.external_id == row['id']))).scalar_one_or_none()
    if doc is None:
        doc = TrustMeDocument(company_id=company_id, external_id=row['id'], status=row.get('contractStatus') or 0, decision='unsigned')
        db.add(doc)
    doc.short_url, doc.name, doc.number = row.get('shortUrl'), (row.get('contractName') or '')[:1000], row.get('numberDeal')
    doc.status, doc.contract_created_at = row.get('contractStatus') or 0, row.get('createdAt')
    doc.checked_at = datetime.now(timezone.utc)
    return doc


async def _link(db, client, doc, student, info, profile, pages, user_id=None):
    """user_id — сотрудник, выбравший карточку в реестре; без него привязка автоматическая."""
    from app.api.v1.endpoints.trustme import _candidate, new_document_link
    choices = (await db.execute(select(Contract).where(Contract.student_id == student.id))).scalars().all()
    link = new_document_link(student.id, client.company_id, info, _candidate({'id': doc.external_id, 'shortUrl': doc.short_url,
                             'contractName': doc.name, 'numberDeal': doc.number}), profile, pages, choices, user_id)
    db.add(link)
    await db.flush()
    if user_id:
        await log_change(db, 'student', student.id, 'trustme_contract_linked', None, str(link.id), str(user_id))
    else:
        await log_change(db, 'student', student.id, 'contract_auto_linked', None, str(link.id), ACTOR, 'auto')
    doc.decision, doc.reason, doc.link_id, doc.candidate_ids = 'linked', None, link.id, [str(student.id)]
    return link


async def read_and_decide(db, client, doc, people, *, apply, ocr_scans=False):
    """Скачать и прочитать договор, решить, при apply — сохранить и привязать.
    Возвращает (решение, студент или список, причина)."""
    info = await client.contract(doc.short_url)
    signed = info.get('contract_status') == 3
    if info.get('contract_status') == 4:
        doc.decision, doc.reason = 'unsigned', 'Договор отозван компанией'
        return 'unsigned', [], doc.reason
    content = await client.pdf(doc.short_url)
    pages = await asyncio.to_thread(read_pages, content, ocr=False)
    if ocr_scans and not ''.join(p['text'] for p in pages).strip():
        pages = await asyncio.to_thread(read_pages, content, ocr=True)
    if not ''.join(p['text'] for p in pages).strip():
        doc.decision, doc.reason = 'unreadable', 'Скан без текста — проверить вручную'
        return 'unreadable', [], doc.reason
    profile = recover_student_identity(extract_profile(pages, info, content), pages, people.students, people.guardians)
    doc.facts_encrypted = encrypt(json.dumps(facts_of(profile, pages), ensure_ascii=False))
    decision, found, reason = pick_student(profile, pages, people.students, people.guardians, people.names, doc.name)
    if not signed:
        # Неподписанный договор — только в очередь на проверку, сам не привязывается.
        if decision == 'link':
            decision, found = 'review', [found]
        reason = f'{UNSIGNED_NOTE} · {reason}'
    doc.decision, doc.candidate_ids = _decision(decision, found) if decision != 'link' else ('review', [str(found.id)])
    doc.reason = reason
    if decision == 'link' and apply:
        await _link(db, client, doc, found, info, profile, pages)
    return decision, found, reason


async def _list_all(client):
    rows, seen, page = [], set(), 1
    while True:
        batch = await client.contracts('', page)
        fresh = [row for row in batch if row['id'] not in seen]
        if not fresh:
            return rows
        seen.update(row['id'] for row in fresh)
        rows += fresh
        page += 1


async def _recover(client, failures, error, stats):
    """Сбой TrustMe посреди длинного прохода: часто истёк токен или сработал лимит.
    Обновляем сессию и ждём всё дольше, прежде чем идти дальше."""
    stats[f'сбой TrustMe: {type(error).__name__}'] += 1
    log.warning('trustme sync: %s (%s подряд)', type(error).__name__, failures)
    await asyncio.sleep(min(60 * failures, 300))
    try:
        await client.refresh_session()
    except Exception as refresh_error:  # повторный вход тоже может не пройти
        log.warning('trustme sync: refresh failed %s', type(refresh_error).__name__)


async def sync(db, client, *, apply=True, limit=0, force_read=False, on_progress=None, pause=PAUSE):
    """Один проход. apply=False — только посчитать, ничего не записывая.
    Возвращает (счётчики, [(документ-строка TrustMe, решение, кандидаты, причина)])."""
    stats, review = Counter(), []
    people = await load_people(db)
    await client.contracts('', 1)  # вход и определение компании
    company = client.company_id
    linked = dict((await db.execute(select(TrustMeContractLink.external_id, TrustMeContractLink.id)
                                    .where(TrustMeContractLink.company_id == company))).all())
    known = {d.external_id: d for d in (await db.execute(select(TrustMeDocument)
             .where(TrustMeDocument.company_id == company))).scalars()}
    rows = await _list_all(client)
    stats['договоров в TrustMe'] = len(rows)
    now = datetime.now(timezone.utc)
    todo, refresh_linked = [], []
    for row in rows:
        doc = known.get(row['id'])
        if row['id'] in linked:
            if apply and (doc is None or doc.link_id != linked[row['id']]):
                doc = await _document(db, company, row)
                doc.decision, doc.reason, doc.link_id = 'linked', None, linked[row['id']]
            stats['уже привязан'] += 1
            if force_read and row.get('contractStatus') == 3 and row.get('shortUrl'):
                refresh_linked.append(row)
            continue
        if doc is not None and doc.decision == 'linked':
            # Связь удалил сотрудник — не возвращаем её автоматически.
            if apply:
                doc.decision, doc.reason, doc.link_id = 'detached', 'Связь удалена вручную — автопривязка отключена', None
            stats['связь удалена вручную'] += 1
            continue
        if doc is not None and doc.decision == 'detached':
            continue
        changed = doc is None or doc.status != (row.get('contractStatus') or 0)
        # Сбой TrustMe — снова на следующем проходе; скан без текста — раз в сутки.
        retry = doc is not None and doc.decision == 'unreadable' and (
            (doc.reason or '').startswith(TRANSIENT) or now - doc.checked_at > RETRY_UNREADABLE)
        if row.get('contractStatus') == 4:
            if apply and changed:
                doc = await _document(db, company, row)
                doc.decision, doc.reason = 'unsigned', 'Договор отозван компанией'
            stats['отозван'] += 1
            continue
        if row.get('contractStatus') != 3:
            stats['не подписан (читаем для проверки)'] += 1
        if force_read or changed or retry or (doc is not None and doc.facts_encrypted is None and doc.decision != 'unreadable'):
            todo.append(row)
    stats['PDF к чтению'] = len(todo[:limit] if limit else todo)
    stats['привязанных PDF к повторному чтению'] = len(refresh_linked[:limit] if limit else refresh_linked)
    if apply:
        await db.commit()
    failures = 0
    for n, row in enumerate(todo[:limit] if limit else todo, 1):
        if failures >= MAX_FAILURES:
            stats['TrustMe не отвечает — проход прерван, продолжит следующий'] += 1
            break
        await asyncio.sleep(pause)
        if not row.get('shortUrl'):
            stats['нет ссылки на договор'] += 1
            continue
        doc = await _document(db, company, row) if apply else SimpleNamespace(
            external_id=row['id'], short_url=row['shortUrl'], name=row.get('contractName') or '', number=row.get('numberDeal'))
        try:
            decision, found, reason = await read_and_decide(db, client, doc, people, apply=apply, ocr_scans=force_read)
            if apply:
                await db.commit()
        except (IntegrityError, DBAPIError) as error:
            await db.rollback()
            stats['конфликт с параллельной привязкой'] += 1
            log.warning('trustme sync: %s %s', row.get('numberDeal'), type(error).__name__)
            continue
        except (TrustMeError, ValueError, OSError) as error:
            await db.rollback()
            failures += isinstance(error, TrustMeError)
            if isinstance(error, TrustMeError) and failures < MAX_FAILURES:
                await _recover(client, failures, error, stats)
            if apply:
                doc = await _document(db, company, row)
                doc.decision, doc.reason = 'unreadable', f'{TRANSIENT} ({type(error).__name__})'
                await db.commit()
            stats['не удалось прочитать PDF'] += 1
            continue
        failures = 0
        stats['привязано' if decision == 'link' and apply else f'{decision}: {reason}'] += 1
        if decision == 'review':
            review.append((row, found, reason))
        if on_progress and n % 20 == 0:
            on_progress(n, len(todo), stats['привязано'])
    for row in refresh_linked[:limit] if limit else refresh_linked:
        if failures >= MAX_FAILURES:
            stats['TrustMe не отвечает — проход прерван, продолжит следующий'] += 1
            break
        try:
            await asyncio.sleep(pause)
            info = await client.contract(row['shortUrl'])
            content = await client.pdf(row['shortUrl'])
            pages = await asyncio.to_thread(read_pages, content, ocr=True)
            if apply:
                link = await db.get(TrustMeContractLink, linked[row['id']])
                if link:
                    profile = preserve_manual(extract_profile(pages, info, content), cached_profile(link))
                    store_profile(link, profile)
                    apply_document_signing_date(link, pages)
                    link.profile_checked_at = datetime.now(timezone.utc)
                    await db.commit()
            stats['привязанных PDF перечитано'] += 1
            failures = 0
        except (TrustMeError, ValueError, OSError) as error:
            await db.rollback()
            failures += isinstance(error, TrustMeError)
            if isinstance(error, TrustMeError) and failures < MAX_FAILURES:
                await _recover(client, failures, error, stats)
            stats['не удалось перечитать привязанный PDF'] += 1
        except (IntegrityError, DBAPIError):
            await db.rollback()
            stats['ошибка сохранения профиля привязанного PDF'] += 1
    # Перепроверка непривязанных по сохранённым фактам.
    pending = (await db.execute(select(TrustMeDocument).where(
        TrustMeDocument.company_id == company, TrustMeDocument.decision.in_(('review', 'unmatched')),
        TrustMeDocument.link_id.is_(None), TrustMeDocument.facts_encrypted.is_not(None)))).scalars().all()
    for doc in pending:
        try:
            facts = json.loads(decrypt(doc.facts_encrypted))
        except Exception:
            continue
        decision, found, reason = decide_from_facts(facts, people, doc.name)
        if decision == 'link' and doc.status != 3:
            decision, found, reason = 'review', [found], f'{UNSIGNED_NOTE} · {reason}'
        if decision == 'link':
            if not apply:
                stats['привяжется при перепроверке'] += 1
                continue
            try:
                decision, found, reason = await read_and_decide(db, client, doc, people, apply=True)
                await db.commit()
                stats['привязано при перепроверке' if decision == 'link' else f'{decision}: {reason}'] += 1
            except (IntegrityError, DBAPIError, TrustMeError, ValueError, OSError):
                await db.rollback()
                stats['перепроверка отложена'] += 1
            continue
        state = _decision(decision, found)
        if apply and (doc.decision, doc.candidate_ids, doc.reason) != (*state, reason):
            doc.decision, doc.candidate_ids, doc.reason = *state, reason
            doc.checked_at = datetime.now(timezone.utc)
    if apply:
        await db.commit()
    # Состояние реестра после прохода (для режима отчёта — текущее состояние БД).
    registry = (await db.execute(select(TrustMeDocument).where(
        TrustMeDocument.company_id == company))).scalars().all()
    for decision, label in (('review', 'на проверку'), ('unmatched', 'студент не найден'),
                            ('unreadable', 'скан без текста')):
        stats[f'в реестре: {label}'] = sum(d.decision == decision and d.link_id is None for d in registry)
    return stats, review


async def trustme_sync_loop():
    """Фоновая синхронизация в воркере. Один проход за раз — общий с ручной
    командой замок в Redis."""
    from redis.asyncio import Redis
    from app.api.v1.endpoints.trustme import _client
    from app.core.database import AsyncSessionLocal

    await asyncio.sleep(120)
    while True:
        try:
            async with Redis.from_url(settings.REDIS_URL, decode_responses=True) as redis:
                if await redis.set(LOCK, ACTOR, nx=True, ex=3 * 3600):
                    try:
                        async with AsyncSessionLocal() as db:
                            async with _client() as client:
                                stats, _ = await sync(db, client, apply=True)
                        log.info('TrustMe sync: %s', dict(stats))
                    finally:
                        await redis.delete(LOCK)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception('TrustMe sync failed; will retry')
        await asyncio.sleep(settings.TRUSTME_SYNC_MINUTES * 60)
