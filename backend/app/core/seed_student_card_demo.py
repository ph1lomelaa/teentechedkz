"""Extra card examples, strictly limited to the isolated student_card preview DB."""
import asyncio
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from app.core.config import settings
from app.core.database import AsyncSessionLocal, engine
from app.models import Student, User, Contract, University, NotionSnapshot
from app.models.contract import PipelineStatus
from app.models.notion_snapshot import NotionMatchStatus
from app.models.student import DegreeLevel
from app.core.seed_demo import _seed_shortlist_and_applications
from app.models.roadmap import Roadmap, Stage, RoadmapTask, RoadmapSubtask


async def seed():
    if settings.ENVIRONMENT != 'development' or not settings.DATABASE_URL.endswith('/student_card'):
        raise RuntimeError('This fixture is only for the isolated student_card Docker preview')
    async with AsyncSessionLocal() as db:
        student=(await db.execute(select(Student).where(Student.full_name=='Асель Демо'))).scalar_one()
        mentor=(await db.execute(select(User).where(User.email=='demo.mentor@teenteched.kz'))).scalar_one()
        mzk=(await db.execute(select(User).where(User.email=='demo.mzk@teenteched.kz'))).scalar_one()
        for name,country,city in [('Демо University of Boston','США','Бостон'),('Демо Technical University','Германия','Мюнхен')]:
            if not (await db.execute(select(University).where(University.name==name))).scalar_one_or_none():
                db.add(University(name=name,country_name=country,city=city,description='Демонстрационный вуз для локального просмотра',degree_levels=['undergraduate']))
        if not (await db.execute(select(Student).where(Student.phone=='preview-card-empty'))).scalar_one_or_none():
            db.add(Student(full_name='Бекзат Демо — без Roadmap',phone='preview-card-empty',degree_level=DegreeLevel.undergraduate,intake_year=2027))
        contract=(await db.execute(select(Contract).where(Contract.student_id==student.id))).scalars().first()
        if not contract:
            contract=Contract(student_id=student.id,amount=Decimal('1200000'),currency='KZT',pipeline_status=PipelineStatus.active_work,signed_date=date.today()-timedelta(days=30),client_remaining_amount=Decimal('400000'),client_remaining_date=date.today()+timedelta(days=5),mzk_manager_id=mzk.id)
            db.add(contract)
        if not (await db.execute(select(NotionSnapshot).where(NotionSnapshot.notion_page_id=='local-student-card-demo'))).scalar_one_or_none():
            db.add(NotionSnapshot(notion_page_id='local-student-card-demo',student_id=student.id,status=NotionMatchStatus.linked,full_name=student.full_name,phone_normalized='+77000000001',raw_properties={'Name': student.full_name,'Статус выплат':'Активная работа','Intake':'2026'},normalized_data={'full_name':student.full_name,'phone':student.phone,'degree_raw':'Бакалавр','intake_raw':'2026','payment_status_raw':'Активная работа','client_fee':'1200000'},synced_baseline={'full_name':'асель демо','phone':'+77000000001','degree_level':'undergraduate','intake_year':'2026','pipeline_status':'active_work','client_fee':'1200000.00'},synced_at=datetime.now(timezone.utc)))
        await db.flush()
        await _seed_shortlist_and_applications(db,student,mentor)
        task = (await db.execute(
            select(RoadmapTask).join(Stage).join(Roadmap)
            .where(Roadmap.student_id == student.id, RoadmapTask.title == 'Составить шортлист из 5 вузов')
            .options(selectinload(RoadmapTask.subtasks))
        )).scalars().first()
        if task and not task.subtasks:
            # Populate once; later preview edits and deadlines remain untouched.
            if 'due_date' not in (task.manual_fields or []):
                task.due_date = date.today() + timedelta(days=7)
            if not task.description:
                task.description = 'Подобрать университеты под профиль студента и обсудить варианты с ментором.'
            if not task.expected_result:
                task.expected_result = 'Согласованный список из 5 университетов с требованиями и стоимостью.'
            for position, (title, days) in enumerate([
                ('Определить страны и направления', None),
                ('Проверить требования к поступлению', 2),
                ('Сравнить стоимость и стипендии', 4),
                ('Уточнить дедлайны университетов', 10),
                ('Согласовать шортлист с ментором', None),
            ]):
                db.add(RoadmapSubtask(task_id=task.id, title=title, position=position,
                                     due_date=date.today() + timedelta(days=days) if days is not None else None))
        await db.commit()
    await engine.dispose()
    print('Student card preview fixtures ready')


if __name__=='__main__':
    asyncio.run(seed())
