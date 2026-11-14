"""Менторы из Notion добавляются в команду, но портал главнее.

FINANCE_TEST_DATABASE_URL=postgresql+asyncpg://.../tte_finance_check_... pytest tests/test_notion_assignments.py
"""
import asyncio
import os
import random
import string
import uuid

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import settings
from app.models.mentor_assignment import MentorAssignment, MentorRole
from app.models.notion_person_link import NotionPersonLink
from app.models.notion_snapshot import NotionMatchStatus, NotionSnapshot
from app.models.student import DegreeLevel, Student
from app.models.user import User, UserRole
from app.services import notion_assignments
from app.services.people_facets import canon_person

URL = os.getenv('FINANCE_TEST_DATABASE_URL', '')


@pytest.mark.skipif(not URL, reason='Requires an isolated test database')
def test_notion_mentors_are_added_without_touching_portal(monkeypatch):
    assert '/tte_finance_check_' in URL, 'Refusing to run against a non-disposable database'
    asyncio.run(run(monkeypatch))


async def run(monkeypatch):
    engine = create_async_engine(URL)
    sessions = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
    tag = ''.join(random.choices(string.ascii_lowercase, k=6))
    name = lambda first: f'{first} {tag}'  # noqa: E731
    async with sessions() as db:
        def staff(first, role=UserRole.mentor, specialties=None):
            return User(name=name(first), email=f'{first.lower()}-{tag}-{uuid.uuid4().hex[:4]}@example.test', hashed_password='x',
                        role=role, is_active=True, mentor_specialties=specialties or [])
        lead = staff('Bibinur', specialties=['lead'])
        ielts = staff('Daria', specialties=['ielts'])
        mzk = staff('Aruzhan', role=UserRole.mzk_manager)
        twin_a, twin_b = staff('Timur', specialties=['lead']), staff('Timur', specialties=['career'])
        many = staff('Madina', specialties=['lead', 'career'])
        country = staff('Saule', specialties=['country'])
        linked = staff('Aigerim Linked', specialties=['portfolio'])
        old_lead = staff('Kamila', specialties=['lead'])
        head = staff('Nurai', role=UserRole.academic_head)
        removed = staff('Zarina', specialties=['ielts'])
        db.add_all([lead, ielts, mzk, twin_a, twin_b, many, country, linked, old_lead, removed, head])
        await db.flush()
        db.add(NotionPersonLink(notion_key=canon_person(f'Айгерим {tag}'), user_id=linked.id))
        a, b, old = (Student(full_name=f'{n} {tag}', phone=f'+77{i}{random.randint(1000000, 9999999)}', degree_level=DegreeLevel.undergraduate,
                             intake_year=y) for i, (n, y) in enumerate((('Asel', 2027), ('Bota', 2027), ('Alumni', 2025))))
        db.add_all([a, b, old])
        await db.flush()
        # На портале у A уже есть другой ментор по УП, а Зарину сняли вручную.
        db.add_all([
            MentorAssignment(student_id=a.id, mentor_id=old_lead.id, role=MentorRole.lead, is_active=True),
            MentorAssignment(student_id=a.id, mentor_id=removed.id, role=MentorRole.ielts, is_active=False, assignment_status='removed'),
        ])
        db.add_all([
            NotionSnapshot(notion_page_id=f'p-a-{tag}', raw_properties={}, status=NotionMatchStatus.linked, student_id=a.id,
                           normalized_data={'lead_mentor': name('Bibinur'), 'mzk': name('Аружан'),
                                            'mentors': [name('Daria'), name('Zarina'), name('Timur'), name('Madina'), name('Saule'),
                                                        f'Айгерим {tag}', 'none', name('Nobody')]}),
            # Набор 2025 уже поступил — его команду из Notion не трогаем.
            NotionSnapshot(notion_page_id=f'p-old-{tag}', raw_properties={}, status=NotionMatchStatus.linked, student_id=old.id,
                           normalized_data={'lead_mentor': name('Bibinur'), 'mzk': name('Аружан'), 'mentors': []}),
            NotionSnapshot(notion_page_id=f'p-b-{tag}', raw_properties={}, status=NotionMatchStatus.linked, student_id=b.id,
                           normalized_data={'lead_mentor': [name('Bibinur'), f"{name('Aruzhan')}- МЗК", 'No'], 'mentors': ['none'], 'mzk': name('Nurai')}),
        ])
        await db.commit()

    def mine(items, sid):
        return {(r['notion_name'], r['state']) for r in items if r['student_id'] == str(sid)}

    # Флаг выключен: сверка считается, ничего не пишется.
    monkeypatch.setattr(settings, 'ENABLE_NOTION_ASSIGNMENT_IMPORT', False)
    async with sessions() as db:
        check = await notion_assignments.build_check(db)
        assert await notion_assignments.import_from_notion(db) == 0
    rows = mine(check['items'], a.id)
    assert (name('Bibinur'), 'will_add') in rows
    assert (name('Аружан'), 'will_add') in rows
    assert (name('Daria'), 'will_add') in rows
    assert (f'Айгерим {tag}', 'will_add') in rows           # через «Имена Notion ↔ сотрудники»
    assert (name('Zarina'), 'removed') in rows              # снята на портале — не возвращаем
    assert (name('Timur'), 'unmatched') in rows             # два аккаунта с таким именем
    assert (name('Nobody'), 'unmatched') in rows
    assert (name('Madina'), 'ambiguous') in rows            # две специализации
    assert (name('Saule'), 'ambiguous') in rows             # ментор по стране без страны
    assert not any(r['notion_name'] in ('none', 'No') for r in check['items'])
    assert not any(r['student_id'] == str(old.id) for r in check['items'])   # 2025 не показываем и не добавляем
    assert check['min_intake_year'] == 2026 and all(r['intake_year'] == 2027 for r in check['items'] if r['student_id'] == str(a.id))
    lead_a = next(r for r in check['items'] if r['student_id'] == str(a.id) and r['notion_name'] == name('Bibinur'))
    assert lead_a['detail'].startswith('вторым: на платформе уже')        # конфликт добавляем вторым
    rows_b = mine(check['items'], b.id)
    assert (f"{name('Aruzhan')}- МЗК", 'ambiguous') in rows_b               # МЗК в колонке Lead-Mentor
    assert (name('Nurai'), 'will_add') in rows_b                            # академ-хед назначаема как МЗК
    assert any(r['state'] == 'platform_only' and r['user_id'] == str(old_lead.id) for r in check['items'])

    # Флаг включён: добавлены, старое не тронуто, повтор ничего не дублирует.
    monkeypatch.setattr(settings, 'ENABLE_NOTION_ASSIGNMENT_IMPORT', True)
    async with sessions() as db:
        added = await notion_assignments.import_from_notion(db)
    assert added == 6  # A: Бибинур, Аружан, Дарья, Айгерим; B: Бибинур, Нурай (академ-хед, МЗК)
    async with sessions() as db:
        assert await notion_assignments.import_from_notion(db) == 0
        active = {(ma.student_id, ma.mentor_id, ma.role) for ma in (await db.execute(
            select(MentorAssignment).where(MentorAssignment.student_id.in_([a.id, b.id]), MentorAssignment.is_active == True))).scalars()}  # noqa: E712
        assert (a.id, old_lead.id, MentorRole.lead) in active       # портал не тронут
        assert (a.id, lead.id, MentorRole.lead) in active
        assert (a.id, mzk.id, MentorRole.mzk) in active
        assert (a.id, ielts.id, MentorRole.ielts) in active
        assert (a.id, linked.id, MentorRole.portfolio) in active
        assert (b.id, lead.id, MentorRole.lead) in active
        assert (b.id, head.id, MentorRole.mzk) in active
        assert (a.id, removed.id, MentorRole.ielts) not in active   # снятая не вернулась
        count = (await db.execute(select(func.count()).select_from(MentorAssignment).where(
            MentorAssignment.student_id == a.id, MentorAssignment.mentor_id == lead.id))).scalar_one()
        assert count == 1
        check = await notion_assignments.build_check(db)
    assert (name('Bibinur'), 'added') in mine(check['items'], a.id)
    await engine.dispose()
