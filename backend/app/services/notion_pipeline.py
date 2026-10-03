"""Preview and apply the deliberately small Notion-owned part of the CRM.

The Notion snapshot is the input. No contact, finance, application submission,
or portal data is changed here. Every planned change is visible before apply.
"""
from __future__ import annotations

from collections import Counter, defaultdict
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_change
from app.models import Application, Contract, MentorAssignment, NotionSnapshot, Student, User
from app.models.contract import PipelineStatus
from app.models.mentor_assignment import MentorRole
from app.models.notion_snapshot import NotionMatchStatus
from app.models.user import UserRole
from app.services.people_facets import canon_person
from migration.transformers.normalize import COUNTRY_ALIASES, parse_pipeline_status


# Поля распределения (кто ведёт ученика). Решение 03.10.2026: перенос из Notion
# их НЕ меняет — распределение живёт в CRM (назначения, «Взять в работу»,
# доска распределения), и Notion, отставший на день, не должен снимать
# ответственных. Расхождения по ним видны в отчёте сверки (`assignment_diffs`),
# но в `changes` и в apply не попадают.
ASSIGNMENT_FIELDS = frozenset({"lead_mentor", "mzk", "mzk_contract", "mentor"})


def _year(raw: object) -> int | None:
    for token in str(raw or "").replace(".", " ").split():
        if token.isdigit() and 2020 <= int(token) <= 2035:
            return int(token)
    return None


def _country(raw: str) -> str:
    value = " ".join(str(raw).split())
    return COUNTRY_ALIASES.get(value.lower(), value)


def _person(raw: str | None, users: dict[str, list[User]], role: MentorRole) -> tuple[User | None, str | None]:
    if not raw or str(raw).strip().lower() in {"none", "нет", "-"}:
        return None, None
    matches = users.get(canon_person(raw), [])
    matches = [u for u in matches if u.is_active and (u.role == UserRole.mzk_manager if role == MentorRole.mzk else u.role in {UserRole.mentor, UserRole.admin})]
    if len(matches) != 1:
        return None, f"{role.value}: «{raw}» — найдено аккаунтов: {len(matches)}"
    return matches[0], None


async def build_report(db: AsyncSession) -> dict:
    snapshots = list((await db.execute(select(NotionSnapshot).order_by(NotionSnapshot.full_name, NotionSnapshot.notion_page_id))).scalars())
    students = {s.id: s for s in (await db.execute(select(Student))).scalars()}
    contracts: dict = {}
    for c in (await db.execute(select(Contract).order_by(Contract.created_at.desc(), Contract.id.desc()))).scalars():
        contracts.setdefault(c.student_id, c)
    applications: dict = defaultdict(list)
    for app in (await db.execute(select(Application))).scalars():
        applications[app.student_id].append(app)
    assignments: dict = defaultdict(list)
    for assignment in (await db.execute(select(MentorAssignment).where(MentorAssignment.is_active.is_(True)))).scalars():
        assignments[assignment.student_id].append(assignment)
    user_index: dict[str, list[User]] = defaultdict(list)
    for user in (await db.execute(select(User))).scalars():
        user_index[canon_person(user.name)].append(user)

    linked_counts = Counter(s.student_id for s in snapshots if s.status == NotionMatchStatus.linked and s.student_id)
    name_counts = Counter((s.full_name or "").strip().casefold() for s in snapshots if s.full_name)
    rows = []
    known_student_ids = set()
    verified_student_ids = set()
    for snap in snapshots:
        d = snap.normalized_data or {}
        student = students.get(snap.student_id)
        issues: list[str] = []
        changes: list[dict] = []
        comparison: dict = {}
        raw_status = d.get("payment_status_raw")
        parsed_status = None
        try:
            parsed_status = parse_pipeline_status(raw_status or "")
        except ValueError as exc:
            issues.append(str(exc))
        if not snap.full_name:
            issues.append("Пустое название страницы Notion")
        if snap.full_name and name_counts[snap.full_name.strip().casefold()] > 1:
            issues.append("ФИО повторяется в Notion")
        if student:
            current_contract = contracts.get(student.id)
            current_assignments = assignments[student.id]
            comparison = {
                "pipeline_status": {"notion": raw_status, "crm": current_contract.pipeline_status.value if current_contract and current_contract.pipeline_status else None},
                "intake": {"notion": d.get("intake_raw"), "crm": student.intake_year},
                "main_country": {"notion": d.get("main_countries") or [], "crm": [a.country for a in applications[student.id] if a.is_primary]},
                "other_countries": {"notion": d.get("other_countries") or [], "crm": [a.country for a in applications[student.id] if not a.is_primary]},
                "lead_mentor": {"notion": d.get("lead_mentor"), "crm": [str(a.mentor_id) for a in current_assignments if a.role == MentorRole.lead]},
                "mentors": {"notion": d.get("mentors") or [], "crm": [str(a.mentor_id) for a in current_assignments if a.role not in {MentorRole.lead, MentorRole.mzk}]},
                "mzk": {"notion": d.get("mzk"), "crm": [str(a.mentor_id) for a in current_assignments if a.role == MentorRole.mzk]},
            }
        if not student or snap.status != NotionMatchStatus.linked:
            issues.append("Нет проверенной связи с карточкой CRM")
        elif not snap.linked_by:
            known_student_ids.add(student.id)
            issues.append("Автоматическая связь не подтверждена сотрудником")
        else:
            known_student_ids.add(student.id)
            verified_student_ids.add(student.id)
            if linked_counts[student.id] > 1:
                issues.append("Несколько страниц Notion связаны с одной карточкой")
            else:
                contract = contracts.get(student.id)
                if parsed_status:
                    before = contract.pipeline_status.value if contract and contract.pipeline_status else None
                    if parsed_status != before:
                        changes.append({"field": "pipeline_status", "old": before, "new": parsed_status})
                year = _year(d.get("intake_raw"))
                if d.get("intake_raw") and year is None:
                    issues.append(f"Неизвестный Intake: {d['intake_raw']}")
                elif year is not None and year != student.intake_year:
                    changes.append({"field": "intake_year", "old": student.intake_year, "new": year})

                main = [_country(v) for v in d.get("main_countries") or [] if v]
                other = [_country(v) for v in d.get("other_countries") or [] if v]
                wanted = list(dict.fromkeys(main + other))
                current = applications[student.id]
                existing = {_country(a.country).casefold() for a in current}
                for country in wanted:
                    if country.casefold() not in existing:
                        changes.append({"field": "country_add", "old": None, "new": country, "primary": country == (main[0] if main else None)})
                if main and not any(a.is_primary and _country(a.country).casefold() == main[0].casefold() for a in current):
                    changes.append({"field": "primary_country", "old": next((a.country for a in current if a.is_primary), None), "new": main[0]})
                extras = sorted(existing - {v.casefold() for v in wanted}) if wanted else []
                if extras:
                    issues.append(f"Страны CRM вне Notion сохранены: {', '.join(extras)}")

                for field, raw, role in (("lead_mentor", d.get("lead_mentor"), MentorRole.lead), ("mzk", d.get("mzk"), MentorRole.mzk)):
                    user, error = _person(raw, user_index, role)
                    if error:
                        issues.append(error)
                    elif user:
                        active = [a for a in assignments[student.id] if a.role == role]
                        if len(active) != 1 or active[0].mentor_id != user.id:
                            changes.append({"field": field, "old": [str(a.mentor_id) for a in active], "new": str(user.id), "label": user.name})
                        elif role == MentorRole.mzk and (not contract or contract.mzk_manager_id != user.id):
                            changes.append({"field": "mzk_contract", "old": str(contract.mzk_manager_id) if contract and contract.mzk_manager_id else None,
                                            "new": str(user.id), "label": user.name})
                for raw in d.get("mentors") or []:
                    user, error = _person(raw, user_index, MentorRole.lead)
                    if error:
                        issues.append(f"Mentors: {error}")
                    elif user:
                        specialties = [s for s in (user.mentor_specialties or []) if s in {"lead", "ielts", "career", "country"}]
                        if len(specialties) != 1:
                            issues.append(f"Mentors: роль «{raw}» неоднозначна")
                        elif specialties[0] == "country":
                            issues.append(f"Mentors: для «{raw}» не указана страна назначения")
                        elif specialties[0] == "lead" and d.get("lead_mentor"):
                            if canon_person(raw) != canon_person(d["lead_mentor"]):
                                issues.append(f"Mentors: «{raw}» и Lead-Mentor занимают одну роль")
                        else:
                            occupying = [a for a in assignments[student.id] if a.role.value == specialties[0]]
                            if occupying and not any(a.mentor_id == user.id for a in occupying):
                                issues.append(f"Mentors: роль {specialties[0]} уже назначена другому")
                            elif not occupying:
                                changes.append({"field": "mentor", "role": specialties[0], "old": None, "new": str(user.id), "label": user.name})
        assignment_diffs = [c for c in changes if c["field"] in ASSIGNMENT_FIELDS]
        changes = [c for c in changes if c["field"] not in ASSIGNMENT_FIELDS]
        rows.append({"notion_page_id": snap.notion_page_id, "student_id": str(student.id) if student else None,
                     "full_name": snap.full_name, "status": snap.status.value, "comparison": comparison,
                     "changes": changes, "assignment_diffs": assignment_diffs, "issues": issues})
    bibinur_key = canon_person("Bibinur")
    bibinur_users = [u for users in user_index.values() for u in users if canon_person(u.name) == bibinur_key]
    bibinur_ids = {u.id for u in bibinur_users}
    notion_bibinur = [s for s in snapshots if canon_person((s.normalized_data or {}).get("lead_mentor")) == bibinur_key]
    notion_filtered = [s for s in notion_bibinur if _year((s.normalized_data or {}).get("intake_raw")) in {2026, 2027, 2028}
                       and _safe_status((s.normalized_data or {}).get("payment_status_raw")) == "active_work"]
    assigned_bibinur = {a.student_id for assignments_for_student in assignments.values() for a in assignments_for_student
                        if a.mentor_id in bibinur_ids}
    assigned_bibinur_lead = {a.student_id for assignments_for_student in assignments.values() for a in assignments_for_student
                             if a.mentor_id in bibinur_ids and a.role == MentorRole.lead}
    notion_linked = {s.student_id for s in notion_filtered if s.status == NotionMatchStatus.linked and s.student_id}
    bibinur_comparison = {
        "notion_lead_all": len(notion_bibinur),
        "notion_lead_filtered": len(notion_filtered),
        "platform_assigned_any_role": len(assigned_bibinur),
        "platform_assigned_lead": len(assigned_bibinur_lead),
        "notion_rows": [{"notion_page_id": s.notion_page_id, "student_id": str(s.student_id) if s.student_id else None,
                         "full_name": s.full_name} for s in notion_filtered],
        "platform_only_student_ids": [str(sid) for sid in sorted(assigned_bibinur - notion_linked, key=str)],
        "notion_only_student_ids": [str(sid) for sid in sorted(notion_linked - assigned_bibinur, key=str)],
    }
    return {"source_total": len(snapshots), "linked": len(known_student_ids), "verified": len(verified_student_ids),
            "crm_only": len(set(students) - known_student_ids), "changes": sum(len(r["changes"]) for r in rows),
            "assignment_diffs": sum(len(r["assignment_diffs"]) for r in rows),
            "review": sum(bool(r["issues"]) for r in rows), "bibinur_comparison": bibinur_comparison, "rows": rows}


def _safe_status(raw: str | None) -> str | None:
    try:
        return parse_pipeline_status(raw) if raw else None
    except ValueError:
        return None


async def apply_report(db: AsyncSession, *, actor: str = "notion_pipeline") -> dict:
    report = await build_report(db)
    # A newly introduced Notion status or duplicate link stops the whole run;
    # applying other rows would make the source only partially authoritative.
    fatal = [r for r in report["rows"] if any(
        "Неизвестный статус" in issue or "Несколько страниц" in issue for issue in r["issues"]
    )]
    if fatal:
        raise ValueError(f"Сверка остановлена: {len(fatal)} строк с неизвестным статусом или дублированной связью")
    applied = 0
    for row in report["rows"]:
        if not row["student_id"] or not row["changes"]:
            continue
        sid = uuid.UUID(row["student_id"])
        student = await db.get(Student, sid)
        contract = (await db.execute(select(Contract).where(Contract.student_id == sid)
                    .order_by(Contract.created_at.desc(), Contract.id.desc()).limit(1))).scalar_one_or_none()
        if any(c["field"] in {"pipeline_status", "mzk", "mzk_contract"} for c in row["changes"]) and not contract:
            contract = Contract(student_id=sid)
            db.add(contract)
            await db.flush()
        for change in row["changes"]:
            field, new, old = change["field"], change["new"], change["old"]
            if field == "pipeline_status":
                contract.pipeline_status = PipelineStatus(new)
                entity, eid = "contract", contract.id
            elif field == "intake_year":
                student.intake_year = new
                entity, eid = "student", sid
            elif field == "mzk_contract":
                contract.mzk_manager_id = uuid.UUID(new)
                entity, eid = "contract", contract.id
            elif field in {"country_add", "primary_country"}:
                apps = list((await db.execute(select(Application).where(Application.student_id == sid))).scalars())
                if field == "country_add":
                    db.add(Application(student_id=sid, contract_id=contract.id if contract else None,
                                       country=new, is_primary=False))
                    await db.flush()
                else:
                    for app in apps:
                        app.is_primary = _country(app.country).casefold() == new.casefold()
                entity, eid = "student", sid
            else:
                role = MentorRole.lead if field == "lead_mentor" else MentorRole.mzk if field == "mzk" else MentorRole(change["role"])
                active = list((await db.execute(select(MentorAssignment).where(
                    MentorAssignment.student_id == sid, MentorAssignment.role == role,
                    MentorAssignment.is_active.is_(True)))).scalars())
                if field != "mentor":
                    for assignment in active:
                        assignment.is_active = False
                    await db.flush()
                db.add(MentorAssignment(student_id=sid, mentor_id=uuid.UUID(new), role=role,
                                        is_active=True, assignment_status="active"))
                if field == "mzk":
                    contract.mzk_manager_id = uuid.UUID(new)
                entity, eid = "student", sid
            await log_change(db, entity, eid, f"notion_pipeline:{field}", str(old), str(new), actor, "notion_sync")
            applied += 1
        if applied and applied % 50 == 0:
            await db.commit()
    await db.commit()
    return {"applied": applied, "review": report["review"], "source_total": report["source_total"]}
