"""Разбор назначений, где сотрудник оказался «Ментором по УП» не по своей воле.

Зачем
-----
До правки роль в команде ученика выводилась из учётной роли: всё, что не
`mzk_manager`, молча становилось `lead`. Сотрудник, заводивший студенту встречу
или роадмап, получал строку «Ментор по УП» — включая МЗК-менеджеров, у которых
в учётке стояла роль «Ментор». Код это больше не делает, но строки, записанные
раньше, остались в базе.

Скрипт их показывает. Он ничего не меняет по умолчанию, и это намеренно: какая
роль у человека правильная — знает человек, а не скрипт. У одного и того же
ментора часть `lead`-назначений может быть совершенно настоящей.

Использование
-------------
    python -m scripts.audit_lead_assignments                    # все подозрительные
    python -m scripts.audit_lead_assignments --email a@b.kz     # по одному сотруднику
    python -m scripts.audit_lead_assignments --email a@b.kz --fix-to mzk \\
        --reason "роль записана автоматически, сотрудник ведёт МЗК"

`--fix-to` гасит `lead`-назначения сотрудника и заводит вместо них указанную
роль, записывая замену в историю — так же, как это делает «Команда ученика».
Только вместе с `--email` и `--reason`: разбирать вслепую всю базу нельзя.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.database import AsyncSessionLocal
from app.models.mentor_assignment import ASSIGNABLE_ROLES, MentorAssignment, MentorRole
from app.models.mentor_assignment_history import MentorAssignmentHistory
from app.models.student import Student
from app.models.user import User


async def _lead_rows(session, email: str | None) -> list[tuple[MentorAssignment, User, Student]]:
    query = (
        select(MentorAssignment, User, Student)
        .join(User, User.id == MentorAssignment.mentor_id)
        .join(Student, Student.id == MentorAssignment.student_id)
        .where(
            MentorAssignment.role == MentorRole.lead,
            MentorAssignment.is_active == True,  # noqa: E712
        )
        .options(selectinload(MentorAssignment.mentor))
        .order_by(User.name, Student.full_name)
    )
    if email:
        query = query.where(User.email == email.strip().lower())
    return list((await session.execute(query)).all())


def _suspicion(user: User) -> str | None:
    """Почему эта строка выглядит записанной автоматически.

    `None` — «ничего подозрительного»: у человека либо заявлена роль ментора по
    УП, либо специализаций нет вовсе и судить не по чему.
    """
    declared = {s for s in (user.mentor_specialties or []) if s in {r.value for r in ASSIGNABLE_ROLES}}
    if not declared:
        return None
    if MentorRole.lead.value in declared:
        return None
    return "заявлен как " + ", ".join(sorted(declared))


async def audit(email: str | None) -> int:
    async with AsyncSessionLocal() as session:
        rows = await _lead_rows(session, email)

    if not rows:
        print("Активных назначений «Ментор по УП» не найдено.")
        return 0

    suspicious = 0
    current_mentor = None
    for assignment, user, student in rows:
        if user.id != current_mentor:
            current_mentor = user.id
            specialties = ", ".join(user.mentor_specialties or []) or "не заявлены"
            print(f"\n{user.name} <{user.email}> · учётная роль {user.role.value} · специализации: {specialties}")
        reason = _suspicion(user)
        mark = "  ⚠ " if reason else "    "
        suffix = f"  ← {reason}" if reason else ""
        print(f"{mark}{student.full_name}  (назначено {assignment.assigned_at:%d.%m.%Y}){suffix}")
        if reason:
            suspicious += 1

    print(f"\nВсего строк: {len(rows)}, подозрительных: {suspicious}.")
    if suspicious:
        print("Подозрительные — те, у кого заявлена другая специализация. Решение по каждому")
        print("студенту принимает человек: часть «Менторов по УП» здесь настоящие.")
    return 0


async def fix(email: str, target: MentorRole, reason: str, actor_email: str | None) -> int:
    async with AsyncSessionLocal() as session:
        actor = None
        if actor_email:
            actor = (
                await session.execute(select(User).where(User.email == actor_email.strip().lower()))
            ).scalar_one_or_none()
            if actor is None:
                print(f"Не найден сотрудник для --actor: {actor_email}", file=sys.stderr)
                return 1

        rows = await _lead_rows(session, email)
        if not rows:
            print("Нечего исправлять.")
            return 0

        moved = 0
        for assignment, user, student in rows:
            # Целевая роль занята другим — пропускаем. Замена чужого
            # ответственного идёт через «Команду ученика», с причиной и
            # подтверждением человека, а не пачкой из скрипта.
            occupied = (
                await session.execute(
                    select(MentorAssignment).where(
                        MentorAssignment.student_id == assignment.student_id,
                        MentorAssignment.role == target,
                        MentorAssignment.is_active == True,  # noqa: E712
                        MentorAssignment.mentor_id.is_not(None),
                        MentorAssignment.mentor_id != user.id,
                    ).limit(1)
                )
            ).scalar_one_or_none()
            if occupied is not None:
                print(f"  пропуск: у «{student.full_name}» роль {target.value} уже занята")
                continue

            assignment.is_active = False
            assignment.assignment_status = "replaced"
            session.add(
                MentorAssignmentHistory(
                    student_id=assignment.student_id,
                    role=MentorRole.lead.value,
                    previous_mentor_id=user.id,
                    replacement_mentor_id=user.id,
                    reason=reason,
                    changed_by=actor.id if actor else user.id,
                )
            )
            # Снятие должно дойти до БД раньше вставки: уникальный индекс на
            # (student_id, role) иначе отклонит новую строку (см. _assign_one).
            await session.flush()

            existing = (
                await session.execute(
                    select(MentorAssignment).where(
                        MentorAssignment.student_id == assignment.student_id,
                        MentorAssignment.role == target,
                        MentorAssignment.mentor_id == user.id,
                    ).limit(1)
                )
            ).scalar_one_or_none()
            if existing is not None:
                existing.is_active = True
                existing.assignment_status = "active"
            else:
                session.add(
                    MentorAssignment(
                        student_id=assignment.student_id,
                        mentor_id=user.id,
                        role=target,
                        is_active=True,
                        assignment_status="active",
                        assigned_at=datetime.now(timezone.utc),
                    )
                )
            await session.flush()
            moved += 1
            print(f"  «{student.full_name}»: lead → {target.value}")

        await session.commit()
        print(f"\nПеренесено назначений: {moved}.")
        if target == MentorRole.mzk:
            print("Зеркало в contracts.mzk_manager_id здесь не трогалось — проверьте договоры.")
        return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--email", help="разобрать назначения одного сотрудника")
    parser.add_argument(
        "--fix-to",
        choices=[r.value for r in ASSIGNABLE_ROLES if r != MentorRole.lead],
        help="перенести его lead-назначения в эту роль (только вместе с --email и --reason)",
    )
    parser.add_argument("--reason", help="причина замены — уйдёт в историю назначений")
    parser.add_argument("--actor", help="email того, от чьего имени записывается замена")
    args = parser.parse_args()

    if args.fix_to:
        if not args.email or not args.reason:
            parser.error("--fix-to требует --email и --reason: разбирать вслепую всю базу нельзя")
        return asyncio.run(fix(args.email, MentorRole(args.fix_to), args.reason.strip(), args.actor))

    return asyncio.run(audit(args.email))


if __name__ == "__main__":
    raise SystemExit(main())
