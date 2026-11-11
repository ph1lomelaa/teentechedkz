"""Студент платформы → новая страница Notion.

Чистые проверки идут всегда. Сценарий с базой — только на одноразовой БД:
NOTION_CREATE_TEST_DATABASE_URL=postgresql+asyncpg://.../tte_notion_create_check_... pytest tests/test_notion_create.py
"""
import asyncio
import os
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.services import notion_create, notion_write

URL = os.getenv("NOTION_CREATE_TEST_DATABASE_URL", "")

SCHEMA = {
    "": {"id": "title", "type": "title"},
    "Номер тел": {"type": "phone_number"},
    "Degree": {"type": "select", "select": {"options": [{"name": "Undergraduate"}, {"name": "Master's"}]}},
    "Intake": {"type": "select", "select": {"options": [{"name": "2026"}, {"name": "2027"}]}},
    "Статус выплат": {"type": "select", "select": {"options": [
        {"name": "Активная работа"}, {"name": "На возврате"}, {"name": "Работа окончена- Поступил"}]}},
    "Client fee": {"type": "number"},
    "Date of Agreement": {"type": "date"},
    "Main country": {"type": "multi_select", "multi_select": {"options": [
        {"name": "🇰🇷 Korea"}, {"name": "🇮🇹 Italy"}, {"name": "🇭🇰 Hong Kong"}]}},
    "Other countries": {"type": "multi_select", "multi_select": {"options": [
        {"name": "🇰🇷 Korea"}, {"name": "🇭🇰 Hong Kong"}, {"name": "none"}]}},
    "МЗК": {"type": "select", "select": {"options": [{"name": "Амина"}, {"name": "Зере"}]}},
    "Mentors": {"type": "multi_select", "multi_select": {"options": [{"name": "Lana"}]}},
    "TOTAL (Company)": {"type": "formula"},
}


def test_country_options_match_flags_and_russian_names():
    opts = ["🇰🇷 Korea", "🇮🇹 Italy", "🇭🇰 Hong Kong"]
    assert notion_create.country_option("Южная Корея", opts) == "🇰🇷 Korea"
    assert notion_create.country_option("Италия", opts) == "🇮🇹 Italy"
    assert notion_create.country_option("Гонконг", opts) == "🇭🇰 Hong Kong"
    assert notion_create.country_option("Марс", opts) is None


def test_mzk_option_matches_any_name_word():
    opts = ["не передали", "Аружан", "Амина", "Зере", "Мерей"]
    assert notion_create.mzk_option_for("Тулегенова Зере", opts) == "Зере"
    assert notion_create.mzk_option_for("Амина Насирдинова", opts) == "Амина"
    assert notion_create.mzk_option_for("Иван Петров", opts) is None


def test_multi_select_payload():
    assert notion_write.build_property("multi_select", ["🇰🇷 Korea"]) == {"multi_select": [{"name": "🇰🇷 Korea"}]}


@pytest.mark.skipif(not URL, reason="Requires an isolated test database")
def test_create_link_and_duplicate_guards(monkeypatch):
    assert "_check_" in URL, "Refusing to run against a non-disposable database"
    asyncio.run(_run(monkeypatch))


def _page(page_id, title, props=None):
    properties = {"": {"id": "title", "type": "title", "title": [{"plain_text": title}]}}
    properties.update(props or {})
    return {"id": page_id, "url": f"https://notion.so/{page_id}", "last_edited_time": "2026-11-12T10:00:00.000Z",
            "properties": properties}


async def _run(monkeypatch):
    from app.models.application import Application
    from app.models.contract import Contract, PipelineStatus
    from app.models.notion_snapshot import NotionMatchStatus, NotionSnapshot
    from app.models.student import DegreeLevel, Student
    from app.models.user import User, UserRole
    from app.core.config import settings

    engine = create_async_engine(URL)
    sessions = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
    suffix = uuid.uuid4().hex[:6]
    created_payloads = []
    remote_titles: dict[str, list] = {}

    monkeypatch.setattr(notion_write, "get_schema", lambda force=False: SCHEMA)
    monkeypatch.setattr(notion_write, "find_pages_by_title", lambda title: remote_titles.get(title, []))

    def fake_create(properties, template_id=None):
        created_payloads.append(properties)
        page_id = uuid.uuid4().hex
        flat = {
            "Статус выплат": {"type": "select", "select": properties["Статус выплат"]["select"]},
            "Intake": {"type": "select", "select": properties["Intake"]["select"]},
        }
        return _page(page_id, properties["title"]["title"][0]["text"]["content"]
                     if "title" in properties else properties[""]["title"][0]["text"]["content"], flat)

    monkeypatch.setattr(notion_write, "create_page", fake_create)
    monkeypatch.setattr(settings, "ENABLE_NOTION_CREATE_PAGES", True)
    monkeypatch.setattr(settings, "ENABLE_NOTION_FIELD_SYNC", True)
    monkeypatch.setattr(settings, "NOTION_CREATE_PAGES_SINCE", (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat())
    monkeypatch.setattr(settings, "NOTION_CREATE_PAGES_STUDENT_IDS", [])

    async with sessions() as db:
        mzk = User(name=f"Амина Тест{suffix}", email=f"mzk-{suffix}@example.test", hashed_password="x",
                   role=UserRole.mzk_manager, is_active=True)
        db.add(mzk)
        await db.flush()
        new = Student(full_name=f"Новый Студент{suffix}", phone="87001112233",
                      degree_level=DegreeLevel.undergraduate, intake_year=2027)
        nostatus = Student(full_name=f"Без Статуса{suffix}", phone="87001112234",
                           degree_level=DegreeLevel.undergraduate, intake_year=2027)
        similar = Student(full_name=f"Похожий Человек{suffix}", phone="87001112235",
                          degree_level=DegreeLevel.masters, intake_year=2027)
        remote = Student(full_name=f"Уже Внесён{suffix}", phone="87001112236",
                         degree_level=DegreeLevel.undergraduate, intake_year=2026)
        old = Student(full_name=f"Старый Студент{suffix}", phone="87001112237",
                      degree_level=DegreeLevel.undergraduate, intake_year=2026,
                      created_at=datetime.now(timezone.utc) - timedelta(days=30))
        trustme = Student(full_name=f"Договор Без Менеджера{suffix}", phone="87001112238",
                          degree_level=DegreeLevel.undergraduate, intake_year=2027)
        db.add_all([new, nostatus, similar, remote, old, trustme])
        await db.flush()
        contracts = {
            "new": Contract(student_id=new.id, pipeline_status=PipelineStatus.active_work, amount=Decimal("1200000"),
                            currency="KZT", mzk_manager_id=mzk.id),
            "nostatus": Contract(student_id=nostatus.id, pipeline_status=PipelineStatus.no_status),
            "similar": Contract(student_id=similar.id, pipeline_status=PipelineStatus.active_work),
            "remote": Contract(student_id=remote.id, pipeline_status=PipelineStatus.refund),
            "old": Contract(student_id=old.id, pipeline_status=PipelineStatus.active_work),
            # Статус пришёл из договора (TrustMe/скрипт), сотрудник его не ставил.
            "trustme": Contract(student_id=trustme.id, pipeline_status=PipelineStatus.active_work),
        }
        db.add_all(contracts.values())
        await db.flush()
        from app.models.status_history import StatusHistory
        for key in ("new", "nostatus", "similar", "remote"):
            c = contracts[key]
            db.add(StatusHistory(entity_type="contract", entity_id=c.id,
                                 field_changed="created" if key == "new" else "pipeline_status",
                                 old_value=None, new_value=c.pipeline_status.value, changed_by=str(mzk.id)))
        db.add(StatusHistory(entity_type="contract", entity_id=contracts["trustme"].id, field_changed="pipeline_status",
                             old_value=None, new_value="active_work", changed_by="trustme_sync"))
        db.add_all([
            Application(student_id=new.id, country="Южная Корея", is_primary=True),
            Application(student_id=new.id, country="Гонконг", is_primary=False),
            NotionSnapshot(notion_page_id=f"ignored-{suffix}", full_name=f"Похожий Человек{suffix}",
                           raw_properties={}, normalized_data={}, status=NotionMatchStatus.ignored),
        ])
        await db.commit()
        remote_titles[remote.full_name] = [_page(f"remote{suffix}", remote.full_name)]

        counts = await notion_create.process_pending(db, limit=50)
        # The test DB may hold rows from other runs; only check our students.
        states = {}
        for s in (new, nostatus, similar, remote, old, trustme):
            snap = (await db.execute(select(NotionSnapshot).where(
                NotionSnapshot.student_id == s.id, NotionSnapshot.status == NotionMatchStatus.linked))).scalars().all()
            states[s.full_name.replace(suffix, "")] = len(snap)
        assert states == {"Новый Студент": 1, "Без Статуса": 0, "Похожий Человек": 0, "Уже Внесён": 1,
                          "Старый Студент": 0, "Договор Без Менеджера": 0}, (states, counts)

        mine = [p for p in created_payloads if p["title"]["title"][0]["text"]["content"] == new.full_name]
        assert len(mine) == 1
        payload = mine[0]
        assert payload["Статус выплат"] == {"select": {"name": "Активная работа"}}
        assert payload["Intake"] == {"select": {"name": "2027"}}
        assert payload["Degree"] == {"select": {"name": "Undergraduate"}}
        assert payload["Main country"] == {"multi_select": [{"name": "🇰🇷 Korea"}]}
        assert payload["Other countries"] == {"multi_select": [{"name": "🇭🇰 Hong Kong"}]}
        assert payload["МЗК"] == {"select": {"name": "Амина"}}
        assert payload["Client fee"] == {"number": 1200000.0}
        assert "Mentors" not in payload and "TOTAL (Company)" not in payload
        assert not any(p["title"]["title"][0]["text"]["content"] == remote.full_name for p in created_payloads)

        # Повторный проход ничего не создаёт.
        before = len(created_payloads)
        await notion_create.process_pending(db, limit=50)
        assert len([p for p in created_payloads[before:] if suffix in p["title"]["title"][0]["text"]["content"]]) == 0

        # Старый студент — только по явному списку.
        monkeypatch.setattr(settings, "NOTION_CREATE_PAGES_STUDENT_IDS", [old.id])
        await notion_create.process_pending(db, limit=50)
        linked_old = (await db.execute(select(NotionSnapshot).where(NotionSnapshot.student_id == old.id))).scalars().all()
        assert len(linked_old) == 1

        # Назначение МЗК после NOTION_CREATE_PAGES_SINCE уходит в колонку «МЗК».
        from app.models.mentor_assignment import MentorAssignment, MentorRole
        pushed = []
        monkeypatch.setattr(notion_write, "update_page", lambda page_id, props, verify=True: pushed.append((page_id, props)))
        snap_new = (await db.execute(select(NotionSnapshot).where(NotionSnapshot.student_id == new.id))).scalar_one()
        db.add(MentorAssignment(student_id=new.id, mentor_id=mzk.id, role=MentorRole.mzk, is_active=True))
        await db.commit()
        result = await notion_create.sync_mzk_assignments(db)
        mine = [p for p in pushed if p[0] == snap_new.notion_page_id]
        assert mine and mine[0][1] == {"МЗК": {"select": {"name": "Амина"}}}, (result, pushed)
        before = len(pushed)
        await notion_create.sync_mzk_assignments(db)
        assert not [p for p in pushed[before:] if p[0] == snap_new.notion_page_id]
    await engine.dispose()
