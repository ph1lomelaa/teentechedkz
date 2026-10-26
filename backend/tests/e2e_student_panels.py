"""Disposable PostgreSQL regression check. No production or Notion writes.

Run with TTE_PANELS_TEST_DATABASE pointing at a dedicated test database.
"""
import asyncio
from datetime import datetime, timedelta, timezone
import os
from pathlib import Path
import subprocess
import sys
from uuid import uuid4

URL = os.environ.get("TTE_PANELS_TEST_DATABASE", "")
if "127.0.0.1:55439/" not in URL:
    raise SystemExit("Use the dedicated temporary PostgreSQL on port 55439")
os.environ["DATABASE_URL"] = URL
os.environ["ENABLE_NOTION_FIELD_SYNC"] = "true"
os.environ["NOTION_FIELD_SYNC_DRY_RUN"] = "true"
ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "backend"), str(ROOT)]

# Historical migration 001 assumes the original schema already exists.
# Bootstrap that schema from current baseline models, excluding the new table,
# then exercise exactly the production transition 116 -> 118.
from sqlalchemy import inspect
from app.core.database import Base, engine as bootstrap_engine
import app.models
async def bootstrap():
    async with bootstrap_engine.begin() as connection:
        exists = await connection.run_sync(lambda conn: inspect(conn).has_table("students"))
        if not exists:
            tables = [table for table in Base.metadata.sorted_tables if table.name != "notion_person_links"]
            await connection.run_sync(lambda conn: Base.metadata.create_all(conn, tables=tables))
    await bootstrap_engine.dispose()
    return exists
if not asyncio.run(bootstrap()):
    subprocess.run([sys.executable, "-m", "alembic", "stamp", "116"], cwd=ROOT / "backend", check=True)

# Проверяется ровно переход 116 -> 118; более поздние миграции схема из моделей уже содержит.
for args in [("upgrade", "118"), ("stamp", "head")]:
    result = subprocess.run([sys.executable, "-m", "alembic", *args],
        cwd=ROOT / "backend", capture_output=True, text=True)
    if result.returncode:
        print(result.stderr[-7000:])
        raise SystemExit(result.returncode)
print("Migration 116 -> 118 passed")

from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from app.core.database import AsyncSessionLocal, engine
from app.core.deps import get_current_user
from app.models.user import User, UserRole
from app.models.student import Student, DegreeLevel
from app.models.contract import Contract, PipelineStatus
from app.models.mentor_assignment import MentorAssignment, MentorRole
from app.models.notion_snapshot import NotionSnapshot, NotionMatchStatus
from app.models.application import Application
from app.services.people_facets import canon_person
from app.api.v1.endpoints import students, mentor_assignments, tasks
from app.api.v1.endpoints import export as exports


async def main():
    suffix = uuid4().hex[:10]
    async with AsyncSessionLocal() as db:
        users = {role: User(name=f"{role} {suffix}", email=f"{role}.{suffix}@example.test",
            hashed_password="unused", role=UserRole(role), is_active=True) for role in
            ("admin", "mzk_manager", "academic_head", "mentor", "student")}
        db.add_all(users.values())
        await db.flush()
        pupils = [Student(full_name=f"Panels {suffix} {i}", phone=f"test-{suffix}-{i}",
            degree_level=DegreeLevel.undergraduate, intake_year=year) for i, year in enumerate([2026, 2027, 2025, 2027, 2027])]
        db.add_all(pupils)
        await db.flush()
        a, b, c, d, e = pupils
        # У b два договора: статус берётся из последнего, старый «Возврат» не влияет.
        db.add_all([Contract(student_id=b.id, pipeline_status=PipelineStatus.active_work),
                    Contract(student_id=b.id, pipeline_status=PipelineStatus.refund, created_at=datetime.now(timezone.utc) - timedelta(days=30)),
                    Contract(student_id=c.id, pipeline_status=PipelineStatus.on_visa)])
        alias = f"Notion Alias {suffix}"
        for pupil, raw in [(a, "Активная работа"), (b, ""), (c, "Работа окончена- Поступил"), (e, "Активная работа")]:
            db.add(NotionSnapshot(notion_page_id=uuid4().hex, student_id=pupil.id,
                status=NotionMatchStatus.linked, full_name=pupil.full_name, raw_properties={},
                normalized_data={"payment_status_raw": raw, "mentors": [alias] if pupil is e else []}, synced_baseline={}))
        db.add_all([MentorAssignment(student_id=a.id, mentor_id=users["mentor"].id, role=MentorRole.lead, is_active=True, assignment_status="active"),
                    MentorAssignment(student_id=b.id, mentor_id=users["mentor"].id, role=MentorRole.country, is_active=True, assignment_status="active")])
        db.add(Application(student_id=a.id, country="США", is_primary=True))
        db.add(Application(student_id=a.id, country="Канада", is_primary=False))
        await db.commit()
        ids = {str(pupil.id) for pupil in pupils}
        before = [(str(row.id), str(row.student_id), str(row.mentor_id), row.role, row.is_active)
                  for row in (await db.execute(select(MentorAssignment).where(MentorAssignment.student_id.in_([p.id for p in pupils])))).scalars()]

    app = FastAPI()
    for router in [students.router, mentor_assignments.router, tasks.router, exports.router]:
        app.include_router(router, prefix="/api/v1")
    actor = [users["admin"]]
    app.dependency_overrides[get_current_user] = lambda: actor[0]
    checks = 0
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async def request(method, path, **kwargs):
            response = await client.request(method, "/api/v1" + path, **kwargs)
            assert response.status_code < 400, (path, response.status_code, response.text[:1500])
            return response

        async def listed(**params):
            data = (await request("GET", "/students", params={"search": suffix, **params})).json()
            return {row["id"]: row for row in data["items"]}

        rows = await listed()
        assert set(rows) == ids
        assert rows[str(a.id)]["pipeline_status"] == "active_work"
        assert rows[str(b.id)]["pipeline_status"] == "active_work"
        assert rows[str(c.id)]["pipeline_status"] == "completed_admitted"
        assert rows[str(d.id)]["pipeline_status"] == "no_status"
        checks += 5
        assert set(await listed(responsible_ids=str(users["mentor"].id))) == {str(a.id), str(b.id)}
        assert set(await listed(lead_mentor_id=str(users["mentor"].id))) == {str(a.id)}
        assert set(await listed(lead_mentor_id=str(users["mentor"].id), countries="США,Германия")) == {str(a.id)}
        assert set(await listed(intake_years="2026,2027", pipeline_statuses="active_work")) == {str(a.id), str(b.id), str(e.id)}
        assert set(await listed(pipeline_statuses="no_status")) == {str(d.id)}
        assert set(await listed(pipeline_statuses="refund")) == set()
        assert set(await listed(pipeline_statuses="active_work", pipeline_status_operator="is_not")) == {str(c.id), str(d.id)}
        assert set(await listed(pipeline_statuses="no_status", pipeline_status_operator="is_not")) == ids - {str(d.id)}
        checks += 8
        for role, target in [("mzk_manager", "paused"), ("academic_head", "on_visa"), ("admin", "active_work")]:
            actor[0] = users[role]
            saved = (await request("PATCH", f"/students/{b.id}", json={"pipeline_status": target})).json()
            assert saved["pipeline_status"] == target
            reread = (await request("GET", f"/students/{b.id}")).json()
            assert reread["pipeline_status"] == target
            checks += 2
        actor[0] = users["student"]
        denied = await client.patch(f"/api/v1/students/{a.id}", json={"pipeline_status": "paused"})
        assert denied.status_code == 403
        checks += 1
        actor[0] = users["admin"]
        await request("PUT", "/students/people-links", json={"notion_key": canon_person(alias), "user_id": str(users["mentor"].id)})
        assert set(await listed(responsible_ids=str(users["mentor"].id))) == {str(a.id), str(b.id), str(e.id)}
        assert set(await listed(responsible_ids=str(users["mentor"].id), assignment_roles="lead")) == {str(a.id)}
        checks += 2
        board = (await request("GET", "/mentor-assignments/board", params={"role": "lead"})).json()
        board_rows = {row["id"]: row for row in board["unassigned"]}
        board_rows.update({row["id"]: row for column in board["columns"] for row in column["students"]})
        assert board_rows[str(b.id)]["pipeline_status"] == "active_work"
        assert board_rows[str(c.id)]["pipeline_status"] == "completed_admitted"
        assert board_rows[str(d.id)]["pipeline_status"] == "no_status"
        assert board_rows[str(a.id)]["countries"] == ["Канада", "США"]
        checks += 4
        task = (await request("POST", "/tasks", json={"student_id": str(b.id), "task_text": "Test deadline", "due_date": "2030-10-15"})).json()
        assert task["due_date"] == "2030-10-15"
        changed = (await request("PATCH", f"/tasks/{task['id']}", json={"due_date": "2030-10-20"})).json()
        assert changed["due_date"] == "2030-10-20"
        checks += 2
        preview = (await request("GET", "/export/students/preview", params=[("limit_to_ids", "true"), ("student_ids", str(a.id)), ("student_ids", str(b.id)), ("columns", "student_id"), ("columns", "effective_status"), ("columns", "crm_status")])).json()
        assert preview["count"] == 2
        assert {row["ID ученика"] for row in preview["rows"]} == {str(a.id), str(b.id)}
        assert all(row["Текущий статус"] == "Активная работа" for row in preview["rows"])
        checks += 3
    async with AsyncSessionLocal() as db:
        after = [(str(row.id), str(row.student_id), str(row.mentor_id), row.role, row.is_active)
                 for row in (await db.execute(select(MentorAssignment).where(MentorAssignment.student_id.in_([p.id for p in pupils])))).scalars()]
        assert sorted(before) == sorted(after)
        checks += 1
    await engine.dispose()
    print(f"PASS: {checks} PostgreSQL/API checks; assignments unchanged")


if __name__ == "__main__":
    asyncio.run(main())
