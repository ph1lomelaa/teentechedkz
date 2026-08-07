"""Демо-данные для записи видео: аккаунты всех ролей и состояния под сценарий.

Отдельно от app.core.seed: тот наполняет систему тем, без чего она не работает
(первый админ, справочник стран), и гоняется при каждом старте. Этот модуль —
разовая подготовка стенда под демонстрацию, запускается руками:

    docker exec tte_backend python -m app.core.seed_demo

Идемпотентен: повторный запуск обновляет уже созданное, а не плодит дубли —
опознаём демо-объекты по e-mail и по префиксу DEMO_PREFIX в имени.

Реальных студентов не трогает: всё создаётся заново под своими именами, чтобы
в кадр не попали настоящие ФИО клиентов.
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal
from app.core.security import hash_password
from app.models.application import Application, SubmissionStatus
from app.models.complaint import (
    ApplicantType,
    Complaint,
    ComplaintCategory,
    ComplaintKind,
    ComplaintStatus,
)
from app.models.mentor_assignment import MentorAssignment, MentorRole
from app.models.mzk_review import MzkReview
from app.models.refund_case import RefundCase, RefundCaseStatus, RefundLevel
from app.models.roadmap import (
    Roadmap,
    RoadmapItemStatus,
    RoadmapStatus,
    RoadmapTask,
    Stage,
    TaskAudience,
    TaskPriority,
)
from app.models.student import Student
from app.models.student_task import StudentTask, TaskStatus
from app.models.student_university import StudentUniversity
from app.models.university import University
from app.models.user import User, UserRole

logger = logging.getLogger(__name__)

DEMO_PASSWORD = "demo12345"
DEMO_PREFIX = "Демо"

ACCOUNTS = [
    ("demo.admin@teenteched.kz", "Демо Администратор", UserRole.admin),
    ("demo.mzk@teenteched.kz", "Демо МЗК-менеджер", UserRole.mzk_manager),
    ("demo.mentor@teenteched.kz", "Айгерим Демо", UserRole.mentor),
    ("demo.student@teenteched.kz", "Асель Демо", UserRole.student),
]

# Этапы демо-роадмапа. Первый уже закрыт целиком — на нём показывается откат
# отметки (снятие галочки с обязательной задачи возвращает этап в работу).
STAGES = [
    ("Подготовка документов", RoadmapItemStatus.done, True, [
        ("Собрать транскрипт", TaskPriority.required, RoadmapItemStatus.done),
        ("Загрузить паспорт", TaskPriority.required, RoadmapItemStatus.done),
    ]),
    ("Выбор университетов", RoadmapItemStatus.in_progress, True, [
        ("Составить шортлист из 5 вузов", TaskPriority.required, RoadmapItemStatus.in_progress),
        ("Сравнить стоимость обучения", TaskPriority.recommended, RoadmapItemStatus.planned),
    ]),
    # Скрытый этап — для демонстрации видимости: студент его не видит целиком.
    ("Подача заявок", RoadmapItemStatus.planned, False, [
        ("Заполнить Common App", TaskPriority.required, RoadmapItemStatus.planned),
    ]),
]


async def _upsert_user(db: AsyncSession, email: str, name: str, role: UserRole) -> User:
    user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if user:
        user.name, user.role, user.is_active = name, role, True
        user.must_change_password = False
        user.hashed_password = hash_password(DEMO_PASSWORD)
        return user
    user = User(
        name=name,
        email=email,
        hashed_password=hash_password(DEMO_PASSWORD),
        role=role,
        is_active=True,
        must_change_password=False,
    )
    db.add(user)
    await db.flush()
    return user


async def _upsert_student(db: AsyncSession, portal_user: User) -> Student:
    name = f"Асель {DEMO_PREFIX}"
    student = (await db.execute(select(Student).where(Student.full_name == name))).scalar_one_or_none()
    if not student:
        student = Student(full_name=name, phone="+7 700 000 00 01", city="Алматы", intake_year=2026)
        db.add(student)
    student.user_id = portal_user.id
    student.specialty = "Computer Science"
    student.degree_level = "undergraduate"
    await db.flush()
    return student


async def _assign_mentor(db: AsyncSession, student: Student, mentor: User) -> None:
    existing = (
        await db.execute(
            select(MentorAssignment).where(
                MentorAssignment.student_id == student.id,
                MentorAssignment.mentor_id == mentor.id,
            )
        )
    ).scalar_one_or_none()
    if existing:
        existing.is_active = True
        return
    db.add(
        MentorAssignment(
            student_id=student.id,
            mentor_id=mentor.id,
            role=MentorRole.lead,
            is_active=True,
        )
    )


async def _build_roadmap(db: AsyncSession, student: Student, mentor: User) -> Roadmap:
    name = f"Roadmap {DEMO_PREFIX} — США 2026"
    roadmap = (await db.execute(select(Roadmap).where(Roadmap.name == name))).scalar_one_or_none()
    if roadmap:
        # Пересобираем этапы, чтобы повторный запуск возвращал стенд в исходное
        # состояние: прошлый прогон демо мог оставить снятые галочки.
        for stage in (await db.execute(select(Stage).where(Stage.roadmap_id == roadmap.id))).scalars():
            await db.delete(stage)
        await db.flush()
    else:
        roadmap = Roadmap(
            student_id=student.id,
            mentor_id=mentor.id,
            name=name,
            country_name="США",
            degree="bachelors",
            year=2026,
            status=RoadmapStatus.active,
        )
        db.add(roadmap)
        await db.flush()

    today = date.today()
    for position, (stage_name, stage_status, visible, tasks) in enumerate(STAGES):
        stage = Stage(
            roadmap_id=roadmap.id,
            name=stage_name,
            position=position,
            status=stage_status,
            visible_to_student=visible,
        )
        db.add(stage)
        await db.flush()
        for task_position, (title, priority, status) in enumerate(tasks):
            db.add(
                RoadmapTask(
                    stage_id=stage.id,
                    roadmap_id=roadmap.id,
                    title=title,
                    position=task_position,
                    priority=priority,
                    audience=TaskAudience.applicant,
                    status=status,
                    visible_to_student=True,
                    assignee_id=mentor.id,
                    created_by=mentor.id,
                    # Задача во втором этапе просрочена на 3 дня — красный бейдж
                    # срочности, который показывается в блоке 3.3 сценария.
                    due_date=today - timedelta(days=3) if position == 1 and task_position == 0 else None,
                )
            )
    return roadmap


async def _seed_tasks(db: AsyncSession, student: Student, mentor: User) -> None:
    """Задачи ментора с разной степенью просрочки — вся шкала срочности в одном списке."""
    today = date.today()
    now = datetime.now(timezone.utc)
    wanted = [
        ("Демо: связаться с приёмной комиссией", 1, TaskStatus.open),
        ("Демо: проверить пакет документов", 2, TaskStatus.in_progress),
        ("Демо: согласовать эссе со студентом", 4, TaskStatus.open),
        ("Демо: назначить встречу с родителями", None, TaskStatus.open),
    ]
    for text, overdue_days, status in wanted:
        task = (
            await db.execute(select(StudentTask).where(StudentTask.task_text == text))
        ).scalar_one_or_none()
        if not task:
            task = StudentTask(task_text=text, created_by=mentor.id)
            db.add(task)
        task.student_id = student.id
        task.assignee_id = mentor.id
        task.status = status
        task.due_date = today - timedelta(days=overdue_days) if overdue_days else today + timedelta(days=5)
        task.sla_hours = 48
        task.sla_due_at = now - timedelta(days=overdue_days) if overdue_days else now + timedelta(days=5)


async def _seed_complaint(db: AsyncSession, student: Student, portal_user: User, mentor: User) -> None:
    """Обращение без ответа — на нём показывается SLA книги жалоб (24 часа)."""
    subject = "Демо: не получил ответ по документам"
    complaint = (
        await db.execute(select(Complaint).where(Complaint.subject == subject))
    ).scalar_one_or_none()
    body = "Отправила документы три дня назад, статус не изменился. Прошу уточнить сроки проверки."
    if not complaint:
        complaint = Complaint(
            author_user_id=portal_user.id,
            subject=subject,
            body=body,
            original_body=body,
            kind=ComplaintKind.complaint,
            applicant_type=ApplicantType.student,
            category=ComplaintCategory.other,
        )
        db.add(complaint)
    complaint.student_id = student.id
    complaint.assigned_to = mentor.id
    complaint.status = ComplaintStatus.new
    # Создано 26 часов назад: SLA в 24 часа уже нарушен — видно в списке.
    complaint.created_at = datetime.now(timezone.utc) - timedelta(hours=26)
    complaint.first_response_at = None
    complaint.is_sla_breached = True


async def _seed_refund_cases(db: AsyncSession, student: Student, mzk: User) -> None:
    """Возвратные кейсы: один в работе, один закрытый с утверждённым бонусом."""
    now = datetime.now(timezone.utc)
    wanted = [
        ("Демо: возврат по договору №1042", RefundCaseStatus.under_review, RefundLevel.yellow, None),
        ("Демо: возврат по договору №1108", RefundCaseStatus.closed, RefundLevel.orange, now - timedelta(days=2)),
    ]
    for reason, status, level, resolved_at in wanted:
        case = (
            await db.execute(select(RefundCase).where(RefundCase.reason == reason))
        ).scalar_one_or_none()
        if not case:
            case = RefundCase(mzk_manager_id=mzk.id, reason=reason)
            db.add(case)
        case.student_id = student.id
        case.mzk_manager_id = mzk.id
        case.status = status
        case.level = level
        case.bonus_amount = level.bonus_amount
        case.amount = 450000
        case.applicant_name = f"Асель {DEMO_PREFIX}"
        case.resolved_at = resolved_at
        if resolved_at:
            case.level_approved_by = mzk.id
            case.level_approved_at = resolved_at


async def _seed_shortlist_and_applications(db: AsyncSession, student: Student, mentor: User) -> None:
    """Шортлист и заявки: без них разделы портала показывают пустую заглушку."""
    universities = (await db.execute(select(University).limit(3))).scalars().all()
    if not universities:
        logger.warning("Справочник университетов пуст — шортлист и заявки пропущены")
        return

    for priority, university in enumerate(universities, start=1):
        existing = (
            await db.execute(
                select(StudentUniversity).where(
                    StudentUniversity.student_id == student.id,
                    StudentUniversity.university_id == university.id,
                )
            )
        ).scalar_one_or_none()
        if existing:
            continue
        db.add(
            StudentUniversity(
                student_id=student.id,
                university_id=university.id,
                added_by_user_id=mentor.id,
                added_by_role="mentor",
                priority=priority,
                note="Демо: добавлено для показа шортлиста",
            )
        )

    # Две заявки на разных стадиях — видно, что статус у каждой свой.
    stages = [
        (universities[0], SubmissionStatus.submitted),
        (universities[1] if len(universities) > 1 else universities[0], SubmissionStatus.documents_prep),
    ]
    for university, status in stages:
        name = university.name
        existing = (
            await db.execute(
                select(Application).where(
                    Application.student_id == student.id,
                    Application.university == name,
                )
            )
        ).scalar_one_or_none()
        if existing:
            existing.submission_status = status
            continue
        db.add(
            Application(
                student_id=student.id,
                country=university.country_name or "США",
                university=name,
                university_id=university.id,
                program="Computer Science",
                submission_status=status,
                deadline=date.today() + timedelta(days=45),
                lead_mentor_id=mentor.id,
            )
        )


async def _seed_mzk_reviews(db: AsyncSession, mzk: User) -> None:
    """Оценки МЗК за прошлый месяц: 8 из 10 положительных → ОКК 80%."""
    today = date.today()
    year, month = (today.year - 1, 12) if today.month == 1 else (today.year, today.month - 1)
    for index in range(10):
        source_key = f"demo-{index}"
        existing = (
            await db.execute(
                select(MzkReview).where(
                    MzkReview.mzk_manager_id == mzk.id,
                    MzkReview.period_year == year,
                    MzkReview.period_month == month,
                    MzkReview.source_key == source_key,
                )
            )
        ).scalar_one_or_none()
        if existing:
            existing.is_positive = index < 8
            continue
        db.add(
            MzkReview(
                mzk_manager_id=mzk.id,
                period_year=year,
                period_month=month,
                is_positive=index < 8,
                is_valid=True,
                source_key=source_key,
                source_kind="demo",
            )
        )


async def run_demo_seed() -> None:
    async with AsyncSessionLocal() as db:
        users = {}
        for email, name, role in ACCOUNTS:
            users[role if role != UserRole.admin else "admin"] = await _upsert_user(db, email, name, role)
        mentor = users[UserRole.mentor]
        mzk = users[UserRole.mzk_manager]
        portal_user = users[UserRole.student]

        student = await _upsert_student(db, portal_user)
        await _assign_mentor(db, student, mentor)
        await _build_roadmap(db, student, mentor)
        await _seed_tasks(db, student, mentor)
        await _seed_complaint(db, student, portal_user, mentor)
        await _seed_shortlist_and_applications(db, student, mentor)
        await _seed_refund_cases(db, student, mzk)
        await _seed_mzk_reviews(db, mzk)

        await db.commit()

    print("Демо-стенд готов. Аккаунты (пароль у всех — %s):" % DEMO_PASSWORD)
    for email, name, role in ACCOUNTS:
        print(f"  {role.value:<12} {email:<32} {name}")


if __name__ == "__main__":
    asyncio.run(run_demo_seed())
