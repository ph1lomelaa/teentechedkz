"""Idempotent, synthetic Portfolio UP fixture for the isolated Docker QA project.

Три ученика одного ментора портфолио покрывают все состояния раздела:
- Алина — полное портфолио: шаг на правках, итог на проверке, два подтверждённых
  результата (один с сертификатом), рекомендация без ответа, отказ, фокус ментора;
- Бекзат — пустое портфолио и одна рекомендация (пустые состояния, «Подобрать»);
- Дана — просроченный шаг и шаг, ждущий проверки ментора.
"""
import asyncio
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select

from app.core.config import settings
from app.core.database import AsyncSessionLocal, engine
from app.core.security import hash_password
from app.models.activity import Activity, ActivityIntake, PortfolioFocus, StudentActivity
from app.models.document import Document, DocType, PortfolioDocumentLink
from app.models.mentor_assignment import MentorAssignment, MentorRole
from app.models.roadmap import RoadmapItemStatus, RoadmapSubtask, RoadmapTask, TaskAudience, TaskPriority, TaskReviewStatus
from app.models.student import DegreeLevel, Student
from app.models.user import User, UserRole
from app.services.minio_service import minio_upload

PASSWORD = 'PortfolioPreview2026!'

# key, title, kind (как в Excel), direction (группа из Excel), mode, deadline offset (дни) или None
ACTIVITIES = [
    ('research', 'Международный конкурс исследовательских проектов', 'Исследовательский проект', '№8 — Медицина / Биология', 'fixed', 40),
    ('math', 'Олимпиада по математике', 'Конкурс / олимпиада', '№3 — IT / Программирование', 'fixed', 25),
    ('volunteer', 'Волонтёрский проект «Помогаем вместе»', 'Волонтёрство', '№1 — Бизнес / Экономика', 'rolling', None),
    ('summer', 'Летняя школа по программированию', 'Академия / программа', '№3 — IT / Программирование', 'fixed', 60),
    ('ds-course', 'Онлайн-курс «Основы Data Science»', 'Курс', '№4 — AI / Data Science', 'self_paced', None),
    ('it-intern', 'Стажировка в IT-компании', 'Стажировка', '№3 — IT / Программирование', 'fixed', 35),
    ('ai-hack', 'Хакатон по искусственному интеллекту', 'Конкурс / олимпиада', '№4 — AI / Data Science', 'fixed', 20),
    ('design', 'Творческий конкурс дизайна', 'Творческий конкурс', '№2 — Дизайн / Творчество', 'fixed', 45),
    ('case', 'Чемпионат бизнес-кейсов', 'Конкурс / олимпиада', '№1 — Бизнес / Экономика', 'fixed', 30),
    ('eng-academy', 'Инженерная летняя академия', 'Академия / программа', '№7 — Инженерия / Технологии', 'fixed', 70),
    ('writing', 'Курс «Академическое письмо»', 'Курс', '№1 — Бизнес / Экономика', 'self_paced', None),
    ('clinic', 'Стажировка в медицинской клинике', 'Стажировка', '№8 — Медицина / Биология', 'rolling', None),
]


def certificate_pdf():
    content = b'BT /F1 24 Tf 50 740 Td (Portfolio UP - Test Certificate) Tj ET'
    objects = [b'<< /Type /Catalog /Pages 2 0 R >>', b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>', b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', b'<< /Length ' + str(len(content)).encode() + b' >>\nstream\n' + content + b'\nendstream']
    data = b'%PDF-1.4\n'
    offsets = [0]
    for number, obj in enumerate(objects, 1):
        offsets.append(len(data))
        data += f'{number} 0 obj\n'.encode() + obj + b'\nendobj\n'
    xref = len(data)
    data += b'xref\n0 6\n0000000000 65535 f \n'
    for offset in offsets[1:]: data += f'{offset:010d} 00000 n \n'.encode()
    data += f'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode()
    return data


async def ensure_user(db, email, name, role, specialties=()):
    user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if not user:
        user = User(name=name, email=email, hashed_password=hash_password(PASSWORD), role=UserRole(role), mentor_specialties=list(specialties))
        db.add(user)
        await db.flush()
    return user


async def ensure_student(db, user, full_name, phone, mentor):
    student = (await db.execute(select(Student).where(Student.user_id == user.id))).scalar_one_or_none()
    if not student:
        student = Student(full_name=full_name, phone=phone, degree_level=DegreeLevel.undergraduate, intake_year=2027, user_id=user.id)
        db.add(student)
        await db.flush()
        db.add(MentorAssignment(student_id=student.id, mentor_id=mentor.id, role=MentorRole.portfolio))
    return student


async def ensure_catalog(db):
    intakes = {}
    for key, title, kind, direction, mode, offset in ACTIVITIES:
        activity = (await db.execute(select(Activity).where(Activity.import_key == f'demo:{key}'))).scalar_one_or_none()
        if not activity:
            # Ранняя версия сида создавала активности без ключа — переиспользуем их по названию.
            activity = (await db.execute(select(Activity).where(Activity.title == title, Activity.import_key.is_(None)))).scalars().first()
        if not activity:
            activity = Activity(title=title, publication='published', organizer='Учебный организатор', source_url='https://example.com',
                description='Возможность получить практический опыт, развить навыки и добавить результат в портфолио.',
                eligibility='Ученики 9–11 классов.', conditions_checked_at=date.today())
            db.add(activity)
        activity.import_key, activity.kind, activity.direction = f'demo:{key}', kind, direction
        await db.flush()
        intake = (await db.execute(select(ActivityIntake).where(ActivityIntake.activity_id == activity.id))).scalars().first()
        if not intake:
            intake = ActivityIntake(activity_id=activity.id, label='Осень 2026', mode=mode, cost_state='free',
                deadline=date.today() + timedelta(days=offset) if offset else None)
            db.add(intake)
            await db.flush()
        intakes[key] = intake
    return intakes


def step(title, *, done=False, review=False, state='planned', review_status='none', evidence=False, due=3, comment=None, optional=False):
    return dict(title=title, done=done, review=review, state=state, review_status=review_status, evidence=evidence, due=due, comment=comment, optional=optional)


async def ensure_participation(db, student, mentor, intake, *, decision='selected', status='in_progress', note=None, steps=(),
                               result_text=None, result_review='none', decline=None, personal=None):
    existing = (await db.execute(select(StudentActivity).where(StudentActivity.student_id == student.id, StudentActivity.intake_id == intake.id))).scalar_one_or_none()
    if existing:
        return existing, False
    now = datetime.now(timezone.utc)
    item = StudentActivity(student_id=student.id, intake_id=intake.id, mentor_id=mentor.id, decision=decision, status=status,
        selection_source='staff', selected_by_id=mentor.id, recommendation_note=note, decline_reason=decline,
        personal_deadline=date.today() + timedelta(days=personal) if personal is not None else None,
        result_text=result_text, result_review_status=result_review,
        result_submitted_at=now - timedelta(days=1) if result_review != 'none' else None,
        result_reviewed_at=now - timedelta(days=3) if result_review == 'approved' else None,
        result_reviewed_by=mentor.id if result_review == 'approved' else None)
    db.add(item)
    await db.flush()
    for n, s in enumerate(steps):
        task = RoadmapTask(student_id=student.id, activity_participation_id=item.id, title=s['title'], position=n, created_by=mentor.id,
            description='Подготовьте материал и приложите его к шагу. Если возникнут вопросы, обсудите их с ментором.',
            expected_result='Готовый документ или подтверждение',
            priority=TaskPriority.optional if s['optional'] else TaskPriority.required, audience=TaskAudience.applicant,
            status=RoadmapItemStatus.done if s['done'] else RoadmapItemStatus(s['state']),
            review_status=TaskReviewStatus(s['review_status']), requires_review=s['review'], requires_evidence=s['evidence'],
            due_date=date.today() + timedelta(days=s['due']), review_comment=s['comment'],
            completed_at=now - timedelta(hours=5) if s['done'] or s['review_status'] == 'pending' else None)
        task.subtasks = [RoadmapSubtask(title='Проверить условия участия', position=0, is_done=s['done']),
                         RoadmapSubtask(title='Сохранить итоговый файл', position=1, is_done=s['done'])]
        db.add(task)
    await db.flush()
    return item, True


async def attach_certificate(db, student, learner, item):
    pdf = certificate_pdf()
    path = await minio_upload(content=pdf, student_id=student.id, filename='certificate.pdf', mime_type='application/pdf')
    doc = Document(student_id=student.id, uploaded_by=learner.id, doc_type=DocType.certificate, file_name='Сертификат волонтёра.pdf',
        file_size=len(pdf), mime_type='application/pdf', storage_path=path, visible_to_student=True)
    db.add(doc)
    await db.flush()
    db.add(PortfolioDocumentLink(document_id=doc.id, participation_id=item.id, purpose='result'))


async def seed():
    if settings.ENVIRONMENT == 'production' or not settings.DATABASE_URL.endswith('/tte_portfolio_check_docker'):
        raise RuntimeError('Portfolio fixtures require the isolated Docker QA database')
    async with AsyncSessionLocal() as db:
        mentor = await ensure_user(db, 'portfolio.preview.mentor@example.test', 'Айгерим · ментор портфолио', 'mentor', ['portfolio'])
        alina_user = await ensure_user(db, 'portfolio.preview.student@example.test', 'Алина · ученица', 'student')
        bekzat_user = await ensure_user(db, 'portfolio.preview.student2@example.test', 'Бекзат · ученик', 'student')
        dana_user = await ensure_user(db, 'portfolio.preview.student3@example.test', 'Дана · ученица', 'student')
        alina = await ensure_student(db, alina_user, 'Алина Тестовая', 'portfolio-preview', mentor)
        bekzat = await ensure_student(db, bekzat_user, 'Бекзат Тестовый', 'portfolio-preview-2', mentor)
        dana = await ensure_student(db, dana_user, 'Дана Тестовая', 'portfolio-preview-3', mentor)
        intakes = await ensure_catalog(db)

        # ---- Алина: полное портфолио
        await ensure_participation(db, alina, mentor, intakes['research'], personal=20,
            note='Подходит для развития вашего исследовательского проекта.', steps=[
                step('Зарегистрироваться на конкурс', done=True, due=-2),
                step('Подготовить черновик мотивационного письма', review=True, state='in_progress', review_status='returned', evidence=True, due=1,
                     comment='Добавьте конкретные примеры вашего опыта и объясните выбор проекта.'),
                step('Отправить заявку организатору', due=5),
            ])
        await ensure_participation(db, alina, mentor, intakes['ai-hack'], result_text='Команда заняла 3 место, проект — бот для подготовки к экзаменам.',
            result_review='pending', steps=[step('Собрать команду', done=True, due=-10), step('Сдать прототип', done=True, review=True, review_status='approved', due=-4)])
        volunteer, created = await ensure_participation(db, alina, mentor, intakes['volunteer'], status='completed',
            result_text='Организовала сбор учебных материалов для школьников.', result_review='approved',
            steps=[step('Провести первую акцию', done=True, due=-30)])
        if created:
            await attach_certificate(db, alina, alina_user, volunteer)
        await ensure_participation(db, alina, mentor, intakes['ds-course'], status='completed', result_text='Прошла курс, итоговый проект — анализ данных школьной олимпиады.',
            result_review='approved', steps=[step('Пройти модули 1–4', done=True, due=-40), step('Сдать итоговый проект', done=True, due=-35)])
        await ensure_participation(db, alina, mentor, intakes['math'], decision='suggested', status='not_started', personal=15,
            note='Хорошо закроет пробел по олимпиадам — у вас сильная математика.')
        await ensure_participation(db, alina, mentor, intakes['design'], decision='not_interested', status='not_started',
            decline='Не успеваю совмещать с подготовкой к SAT.')
        if not await db.get(PortfolioFocus, alina.id):
            db.add(PortfolioFocus(student_id=alina.id, text='Не хватает стажировки и олимпиады. Летом стоит попасть на IT-стажировку, а осенью — на олимпиаду по математике.', updated_by=mentor.id))

        # ---- Бекзат: пусто + одна рекомендация
        await ensure_participation(db, bekzat, mentor, intakes['summer'], decision='suggested', status='not_started',
            note='Хороший старт: летняя школа даст первый проект для портфолио.')

        # ---- Дана: просрочка и шаг на проверке
        await ensure_participation(db, dana, mentor, intakes['it-intern'], personal=10, steps=[
            step('Обновить резюме', done=True, due=-8),
            step('Отправить отклик на стажировку', due=-3),
            step('Пройти собеседование', due=12),
        ])
        await ensure_participation(db, dana, mentor, intakes['case'], steps=[
            step('Разобрать прошлогодний кейс', review=True, state='in_progress', review_status='pending', evidence=False, due=2),
            step('Подать заявку команды', due=9),
        ])

        # Repair only the known placeholder from an earlier local preview.
        placeholders = (await db.execute(select(Document).where(Document.student_id == alina.id, Document.storage_path == 'portfolio-preview/certificate.pdf'))).scalars().all()
        for doc in placeholders:
            pdf = certificate_pdf()
            doc.storage_path = await minio_upload(content=pdf, student_id=alina.id, filename='certificate.pdf', mime_type='application/pdf')
            doc.file_size = len(pdf)
        await db.commit()
        print('Portfolio UP demo ready: mentor and three student preview accounts')
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(seed())
