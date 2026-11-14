"""Команда ученика из Notion: только добавляем, портал не трогаем.

Решение владельца 13.11.2026 (заменяет «из Notion ничего» от 03.10): ментор,
вписанный в Notion (Lead-Mentor, Mentors, МЗК), сам появляется в команде ученика
на платформе. Но то, что уже есть на портале, — главное:

- никого не снимаем и не заменяем — роли мульти, добавление не гасит других;
- снятого на портале не возвращаем: есть любая строка «этот человек в этой роли
  у этого ученика» (активная или снятая) — пропуск;
- имя → аккаунт только однозначно: подтверждённая связь «Имена Notion ↔
  сотрудники», иначе единственный активный сотрудник с тем же именем;
- спорное (не найден, несколько, роль непонятна, «ментор по стране» без страны)
  не назначается, а показывается в сверке.

Пишет только при `ENABLE_NOTION_ASSIGNMENT_IMPORT`; сверка считается всегда.
"""
from __future__ import annotations

import logging
import re
import uuid
from collections import defaultdict
from dataclasses import dataclass, asdict

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_change
from app.core.config import settings
from app.models.mentor_assignment import MentorAssignment, MentorRole
from app.models.notion_person_link import NotionPersonLink
from app.models.notion_snapshot import NotionMatchStatus, NotionSnapshot
from app.models.status_history import StatusHistory
from app.models.student import Student
from app.models.user import User, UserRole
from app.services.agreements import has_pending_agreement_signature
from app.services.people_facets import canon_person

logger = logging.getLogger(__name__)

IMPORT_FIELD = "notion_import"
ASSIGNEE_ROLES = (UserRole.admin, UserRole.mentor, UserRole.mzk_manager, UserRole.academic_head)
# Роль из колонки Mentors определяется специализацией ментора. «Страна» требует
# указать страну — сами не угадываем.
MENTORS_ROLES = {"lead", "ielts", "career", "portfolio"}
_EMPTY = {"", "none", "nan", "-", "—", "n/a", "no", "нет", "не нужен", "не нужна"}
# «Aruzhan- МЗК» в колонке ментора — это МЗК, а не ментор по УП.
_MZK_MARK = re.compile(r"(мзк|mzk)", re.IGNORECASE)


@dataclass
class Row:
    student_id: str
    student_name: str
    intake_year: int | None
    role: str | None
    notion_name: str
    state: str           # will_add | added | present | removed | unmatched | ambiguous | platform_only
    user_id: str | None = None
    user_name: str | None = None
    detail: str = ""


def _names(value) -> list[str]:
    items = value if isinstance(value, list) else [value]
    out = []
    for item in items:
        text = str(item or "").strip()
        if text and text.casefold() not in _EMPTY:
            out.append(text)
    return out


class _People:
    def __init__(self, users: list[User], links: dict[str, uuid.UUID]):
        self.by_id = {u.id: u for u in users}
        self.by_key: dict[str, list[User]] = defaultdict(list)
        for user in users:
            key = canon_person(user.name)
            if key:
                self.by_key[key].append(user)
        self.links = links

    def resolve(self, name: str) -> tuple[User | None, str]:
        key = canon_person(name)
        if not key:
            return None, "пустое имя"
        linked = self.links.get(key)
        if linked is not None:
            user = self.by_id.get(linked)
            return (user, "") if user else (None, "связанный аккаунт неактивен")
        found = self.by_key.get(key, [])
        if len(found) == 1:
            return found[0], ""
        return None, "аккаунт не найден" if not found else f"найдено аккаунтов: {len(found)}"


async def _load(db: AsyncSession):
    snaps = (await db.execute(
        select(NotionSnapshot.student_id, NotionSnapshot.normalized_data, Student.full_name, Student.intake_year)
        .join(Student, Student.id == NotionSnapshot.student_id)
        .where(NotionSnapshot.status == NotionMatchStatus.linked, NotionSnapshot.student_id.isnot(None),
               Student.is_archived == False,  # noqa: E712
               # Наборы, которые уже поступили, не трогаем (без года — берём).
               or_(Student.intake_year.is_(None), Student.intake_year >= settings.NOTION_ASSIGNMENT_MIN_INTAKE_YEAR))
    )).all()
    users = list((await db.execute(select(User).where(User.is_active == True, User.role.in_(ASSIGNEE_ROLES)))).scalars())  # noqa: E712
    links = {link.notion_key: link.user_id for link in (await db.execute(select(NotionPersonLink))).scalars()}
    student_ids = {sid for sid, _, _, _ in snaps}
    assignments: dict[uuid.UUID, list[MentorAssignment]] = defaultdict(list)
    if student_ids:
        for ma in (await db.execute(select(MentorAssignment).where(
                MentorAssignment.student_id.in_(student_ids), MentorAssignment.mentor_id.isnot(None)))).scalars():
            assignments[ma.student_id].append(ma)
    imported = set()
    ids = [ma.id for rows in assignments.values() for ma in rows]
    if ids:
        imported = set((await db.execute(select(StatusHistory.entity_id).where(
            StatusHistory.entity_type == "mentor_assignment", StatusHistory.field_changed == IMPORT_FIELD,
            StatusHistory.entity_id.in_(ids)))).scalars())
    return snaps, _People(users, links), assignments, imported


def _wanted(data: dict, people: _People) -> list[tuple[str, User | None, MentorRole | None, str]]:
    """(имя в Notion, аккаунт, роль, почему нельзя) по одному ученику."""
    out: list[tuple[str, User | None, MentorRole | None, str]] = []
    for name in _names(data.get("mzk")):
        user, why = people.resolve(name)
        out.append((name, user, MentorRole.mzk, why))
    for name in _names(data.get("lead_mentor")):
        user, why = people.resolve(name)
        if _MZK_MARK.search(name):
            out.append((name, user, None, why or "в колонке Lead-Mentor указан МЗК — назначьте вручную"))
        else:
            out.append((name, user, MentorRole.lead, why))
    lead_keys = {canon_person(n) for n in _names(data.get("lead_mentor"))}
    for name in _names(data.get("mentors")):
        if canon_person(name) in lead_keys:
            continue  # тот же человек, что в Lead-Mentor, — не дубль и не спор
        user, why = people.resolve(name)
        role = None
        if _MZK_MARK.search(name):
            why = why or "в колонке Mentors указан МЗК — назначьте вручную"
        elif user is not None:
            specialties = [s for s in (user.mentor_specialties or []) if s in MENTORS_ROLES | {"country"}]
            if len(specialties) == 1 and specialties[0] in MENTORS_ROLES:
                role = MentorRole(specialties[0])
            elif specialties == ["country"]:
                why = "ментор по стране — страну назначьте на платформе"
            elif not specialties:
                why = "роль непонятна: у сотрудника не указана специализация (Настройки → Пользователи)"
            else:
                why = "роль непонятна: у сотрудника несколько специализаций"
        out.append((name, user, role, why))
    return out


async def build_check(db: AsyncSession) -> dict:
    snaps, people, assignments, imported = await _load(db)
    by_student: dict[uuid.UUID, tuple[str, dict]] = {}
    years: dict[uuid.UUID, int | None] = {}
    for sid, data, name, year in snaps:
        years[sid] = year
        merged = by_student.setdefault(sid, (name, {"lead_mentor": [], "mzk": [], "mentors": []}))[1]
        for field in merged:
            merged[field] += _names((data or {}).get(field))

    rows: list[Row] = []
    for sid, (student_name, data) in by_student.items():
        seen: set[tuple[uuid.UUID, MentorRole]] = set()
        notion_pairs: set[tuple[uuid.UUID, MentorRole]] = set()
        for notion_name, user, role, why in _wanted(data, people):
            base = dict(student_id=str(sid), student_name=student_name, intake_year=years.get(sid), notion_name=notion_name)
            if user is None:
                rows.append(Row(**base, role=role.value if role else None, state="unmatched", detail=why))
                continue
            if role is None:
                rows.append(Row(**base, role=None, state="ambiguous", user_id=str(user.id), user_name=user.name, detail=why))
                continue
            if (user.id, role) in seen:
                continue
            seen.add((user.id, role))
            notion_pairs.add((user.id, role))
            same = [ma for ma in assignments[sid] if ma.mentor_id == user.id and ma.role == role]
            active = next((ma for ma in same if ma.is_active), None)
            if active is not None:
                state = "added" if active.id in imported else "present"
            elif same:
                state = "removed"
            else:
                state = "will_add"
            detail = ""
            if state == "will_add":
                # Решение 13.11.2026: другой человек в этой роли не мешает — добавляем вторым.
                others = [people.by_id.get(ma.mentor_id) for ma in assignments[sid]
                          if ma.is_active and ma.role == role and ma.mentor_id != user.id]
                if others:
                    detail = "вторым: на платформе уже " + ", ".join(u.name for u in others if u)
            rows.append(Row(**base, role=role.value, state=state, user_id=str(user.id), user_name=user.name, detail=detail.strip()))
        for ma in assignments[sid]:
            if ma.is_active and (ma.mentor_id, ma.role) not in notion_pairs and ma.role in (MentorRole.lead, MentorRole.mzk):
                user = people.by_id.get(ma.mentor_id)
                rows.append(Row(student_id=str(sid), student_name=student_name, intake_year=years.get(sid), role=ma.role.value, notion_name="",
                                state="platform_only", user_id=str(ma.mentor_id), user_name=user.name if user else None))
    counts: dict[str, int] = defaultdict(int)
    for row in rows:
        counts[row.state] += 1
    rows.sort(key=lambda r: (r.student_name or "", r.role or "", r.notion_name))
    return {"enabled": settings.ENABLE_NOTION_ASSIGNMENT_IMPORT, "min_intake_year": settings.NOTION_ASSIGNMENT_MIN_INTAKE_YEAR,
            "counts": dict(counts), "items": [asdict(r) for r in rows]}


async def _add(db: AsyncSession, *, student_id: uuid.UUID, user: User, role: MentorRole, notion_name: str) -> MentorAssignment:
    status = "awaiting_signature" if await has_pending_agreement_signature(db, user) else "active"
    placeholder = (await db.execute(select(MentorAssignment).where(
        MentorAssignment.student_id == student_id, MentorAssignment.role == role,
        MentorAssignment.assignment_status == "required", MentorAssignment.mentor_id.is_(None)).limit(1))).scalars().first()
    if placeholder is not None:
        placeholder.mentor_id, placeholder.assignment_status, placeholder.is_active = user.id, status, True
        ma = placeholder
    else:
        ma = MentorAssignment(student_id=student_id, mentor_id=user.id, role=role, assignment_status=status, is_active=True)
        db.add(ma)
    await db.flush()
    if role == MentorRole.mzk:
        from app.api.v1.endpoints.mentor_assignments import _mirror_mzk_to_contract
        await _mirror_mzk_to_contract(db, student_id, user.id)
    await log_change(db, "mentor_assignment", ma.id, IMPORT_FIELD, None, notion_name, "notion", source="notion")
    return ma


async def import_from_notion(db: AsyncSession) -> int:
    """Добавить в команды тех, кого вписали в Notion. Возвращает число добавленных."""
    if not settings.ENABLE_NOTION_ASSIGNMENT_IMPORT:
        return 0
    check = await build_check(db)
    pending = [r for r in check["items"] if r["state"] == "will_add"]
    if not pending:
        return 0
    users = {u.id: u for u in (await db.execute(select(User).where(
        User.id.in_({uuid.UUID(r["user_id"]) for r in pending})))).scalars()}
    for row in pending:
        await _add(db, student_id=uuid.UUID(row["student_id"]), user=users[uuid.UUID(row["user_id"])],
                   role=MentorRole(row["role"]), notion_name=row["notion_name"])
    await db.commit()
    logger.info("notion assignments: added %s", len(pending))
    return len(pending)
