"""Optional demo data for the student portal: a few universities and one
roadmap template. Idempotent and NOT run automatically — invoke manually:

    docker compose exec backend python -m app.core.seed_portal_demo
"""
import asyncio
import logging

from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.models.university import University
from app.models.roadmap import (
    RoadmapTemplate, TemplateStage, TemplateTask, TemplateSubtask,
    TaskPriority, TaskAudience,
)

logger = logging.getLogger(__name__)

UNIVERSITIES = [
    {"name": "Tsinghua University", "country_name": "Китай", "city": "Пекин", "world_ranking": 12, "tuition_range": "$4–8k/год", "has_grants": True, "website": "https://www.tsinghua.edu.cn"},
    {"name": "Peking University", "country_name": "Китай", "city": "Пекин", "world_ranking": 14, "tuition_range": "$4–8k/год", "has_grants": True, "website": "https://www.pku.edu.cn"},
    {"name": "Fudan University", "country_name": "Китай", "city": "Шанхай", "world_ranking": 39, "tuition_range": "$5–9k/год", "has_grants": True, "website": "https://www.fudan.edu.cn"},
    {"name": "Technical University of Munich", "country_name": "Германия", "city": "Мюнхен", "world_ranking": 28, "tuition_range": "€0 + сборы", "has_grants": True, "website": "https://www.tum.de"},
    {"name": "Seoul National University", "country_name": "Корея", "city": "Сеул", "world_ranking": 31, "tuition_range": "$3–6k/семестр", "has_grants": True, "website": "https://www.snu.ac.kr"},
]

# stage → [(task_title, priority, [subtasks])]
TEMPLATE_NAME = "Китай · Бакалавриат · 2026"
STAGES = [
    ("Профориентация и выбор вузов", [
        ("Пройти профориентацию", "required", []),
        ("Составить список из 5–8 вузов", "required", ["Определить направление", "Сравнить требования"]),
    ]),
    ("Подготовка базовых документов", [
        ("Собрать транскрипт и аттестат", "required", []),
        ("Подготовить рекомендательные письма", "recommended", []),
    ]),
    ("Языковые экзамены — HSK & IELTS", [
        ("Записаться на HSK 4", "required", []),
        ("Пройти пробный IELTS", "recommended", ["Регистрация", "Секция Listening", "Разбор с ментором"]),
        ("Обновить мотивационное письмо", "optional", []),
    ]),
    ("Подача заявок и заявка CSC", [
        ("Заполнить онлайн-заявки", "required", []),
        ("Подать на стипендию CSC", "recommended", []),
    ]),
    ("Виза и подготовка к выезду", [
        ("Получить приглашение (JW202)", "required", []),
        ("Оформить студенческую визу X1/X2", "required", []),
    ]),
]

_PRIORITY = {"required": TaskPriority.required, "recommended": TaskPriority.recommended, "optional": TaskPriority.optional}


async def run():
    async with AsyncSessionLocal() as db:
        # universities
        for u in UNIVERSITIES:
            exists = await db.execute(select(University).where(University.name == u["name"]))
            if not exists.scalar_one_or_none():
                db.add(University(**u))
                logger.info("Seeded university: %s", u["name"])

        # roadmap template
        exists = await db.execute(select(RoadmapTemplate).where(RoadmapTemplate.name == TEMPLATE_NAME))
        if not exists.scalar_one_or_none():
            tpl = RoadmapTemplate(name=TEMPLATE_NAME, country_name="Китай", degree="bachelors", year=2026,
                                  description="Демо-шаблон дорожной карты поступления в Китай")
            for si, (stage_name, tasks) in enumerate(STAGES):
                stage = TemplateStage(name=stage_name, position=si)
                for ti, (title, prio, subs) in enumerate(tasks):
                    task = TemplateTask(
                        title=title, priority=_PRIORITY[prio], audience=TaskAudience.applicant, position=ti,
                    )
                    task.subtasks = [TemplateSubtask(title=st, position=i) for i, st in enumerate(subs)]
                    stage.tasks.append(task)
                tpl.stages.append(stage)
            db.add(tpl)
            logger.info("Seeded roadmap template: %s", TEMPLATE_NAME)

        await db.commit()
    logger.info("Portal demo seed completed.")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(run())
