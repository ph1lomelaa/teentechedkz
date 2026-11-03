"""Какие услуги договоров закрыты актами — для таблицы «Договоры и акты»,
кабинета финансиста и сводки. Одно правило на всех.

Услуга закрыта, если её пункт договора (contract_service_id) есть в готовом
акте, который не заменён новой версией. Черновики не закрывают.
Состояние ячейки: sent — акт отправлен по почте, ready — создан, не отправлен,
missing — услуга в договоре есть, акта нет, none — услуги в договоре нет.
"""
from collections import defaultdict

from sqlalchemy import select

from app.models.service_act import ActMailAttempt, ServiceAct
from app.models.trustme_contract import TrustMeContractLink
from app.services.contract_profile import cached_profile, services_summary
from app.services.contract_services import CATEGORIES, DEFAULT_SERVICES

# Порядок столбцов-услуг в таблице.
SERVICE_COLUMNS = ['ielts', 'career', 'csca', 'entrance', 'sat',
                   *(key for key in CATEGORIES if key not in {'career', 'csca', 'entrance', 'sat'}),
                   'english', 'other']
SERVICE_LABELS = {**{k: v[0] for k, v in CATEGORIES.items()}, 'ielts': 'Подготовка IELTS',
                  'english': 'Английский язык', 'other': 'Прочее'}
SENT = ('sent', 'confirmed_sent')


def link_services(link):
    """Состав услуг договора; для старых связей — из профиля один раз (вызывающий сохраняет).
    Там же номер из текста для договоров без номера TrustMe."""
    missing_defaults = not set(DEFAULT_SERVICES).issubset({s.get('category') for s in (link.services_summary or [])})
    if link.services_summary is None or link.number is None or missing_defaults:
        profile = cached_profile(link) or {}
        if link.services_summary is None or (missing_defaults and profile):
            link.services_summary = services_summary(profile)
        if link.number is None:
            link.number = (profile.get('fields', {}).get('contract_number') or '')[:200]
    return link.services_summary


async def coverage(db, student_ids):
    ids = list(student_ids)
    if not ids:
        return {}
    links = (await db.execute(select(TrustMeContractLink).where(TrustMeContractLink.student_id.in_(ids))
                              .order_by(TrustMeContractLink.linked_at))).scalars().all()
    acts = (await db.execute(select(ServiceAct).where(ServiceAct.student_id.in_(ids), ServiceAct.status == 'ready')
                             .order_by(ServiceAct.created_at.desc()))).scalars().all()
    sent = defaultdict(list)
    if acts:
        for act_id, at in (await db.execute(select(ActMailAttempt.act_id, ActMailAttempt.created_at).where(
                ActMailAttempt.act_id.in_([a.id for a in acts]), ActMailAttempt.status.in_(SENT)))).all():
            sent[act_id].append(at)
    return build_coverage(ids, links, acts, sent)


_RANK = {'none': 0, 'sent': 1, 'ready': 2, 'missing': 3}


def build_coverage(ids, links, acts, sent):
    """acts — готовые акты, новые первыми; sent — {act_id: [время отправки]}."""
    out = {sid: {'contracts': [], 'services_total': 0, 'services_closed': 0, 'percent': None,
                 'cells': {c: {'state': 'none'} for c in SERVICE_COLUMNS}} for sid in ids}
    replaced = {a.supersedes_id for a in acts if a.supersedes_id}
    # Пункт договора → последний актуальный акт, где он есть.
    closing = {}
    for act in acts:
        if act.id in replaced:
            continue
        for line in act.snapshot.get('lines', []):
            closing.setdefault((act.student_id, line.get('contract_service_id')), act)
    for link in links:
        row = out[link.student_id]
        services = link_services(link)  # до номера: заполняет его для старых договоров
        row['contracts'].append({'id': str(link.id), 'number': link.number, 'name': link.name, 'status': link.status,
                                 'source': link.source, 'financial_contract_id': str(link.financial_contract_id) if link.financial_contract_id else None})
        for service in services:
            category = service['category'] if service['category'] in SERVICE_LABELS else 'other'
            cell = row['cells'][category]
            act = closing.get((link.student_id, service['id']))
            row['services_total'] += 1
            row['services_closed'] += act is not None
            state = 'missing' if act is None else 'sent' if sent.get(act.id) else 'ready'
            # В одной категории может быть несколько пунктов: показываем худшее.
            if _RANK[state] >= _RANK[cell['state']]:
                cell.clear()
                cell['state'] = state
                if act is not None:
                    cell.update(act_id=str(act.id), file_name=act.file_name,
                                date=(max(sent[act.id]).date().isoformat() if state == 'sent' else act.snapshot.get('act_date')))
    for row in out.values():
        if row['services_total']:
            row['percent'] = round(100 * row['services_closed'] / row['services_total'])
    return out


async def financial_coverage(db, contract_ids):
    """То же по финансовым договорам. Договор TrustMe без сопоставления
    относится к финансовому, если тот у студента единственный."""
    from sqlalchemy import func, or_
    from app.models.contract import Contract
    ids = list(contract_ids)
    if not ids:
        return {}
    owners = dict((await db.execute(select(Contract.id, Contract.student_id).where(Contract.id.in_(ids)))).all())
    single = {sid for sid, n in (await db.execute(select(Contract.student_id, func.count()).where(
        Contract.student_id.in_(set(owners.values()))).group_by(Contract.student_id))).all() if n == 1}
    links = (await db.execute(select(TrustMeContractLink).where(or_(
        TrustMeContractLink.financial_contract_id.in_(ids),
        TrustMeContractLink.financial_contract_id.is_(None) & TrustMeContractLink.student_id.in_(single)))
        .order_by(TrustMeContractLink.linked_at))).scalars().all()
    by_student = {sid: cid for cid, sid in owners.items() if sid in single}
    grouped = defaultdict(list)
    for link in links:
        cid = link.financial_contract_id or by_student.get(link.student_id)
        if cid in owners:
            grouped[cid].append(link)
    students = set(owners.values())
    acts = (await db.execute(select(ServiceAct).where(ServiceAct.student_id.in_(students), ServiceAct.status == 'ready')
                             .order_by(ServiceAct.created_at.desc()))).scalars().all()
    sent = defaultdict(list)
    if acts:
        for act_id, at in (await db.execute(select(ActMailAttempt.act_id, ActMailAttempt.created_at).where(
                ActMailAttempt.act_id.in_([a.id for a in acts]), ActMailAttempt.status.in_(SENT)))).all():
            sent[act_id].append(at)
    return {cid: build_coverage([sid], grouped[cid], [a for a in acts if a.student_id == sid], sent)[sid]
            for cid, sid in owners.items()}
