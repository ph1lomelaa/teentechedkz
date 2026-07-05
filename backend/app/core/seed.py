"""Seed: creates first admin user and country_reference data."""
import asyncio
import logging

from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.core.security import hash_password
from app.core.config import settings
from app.models.user import User, UserRole
from app.models.country_reference import CountryReference

logger = logging.getLogger(__name__)

INITIAL_COUNTRIES = [
    {"country_name": "Венгрия", "vpp_required": True, "submission_deadline_notes": "Ноябрь–Январь", "notes": "Требуется портфолио + VPP"},
    {"country_name": "НУ", "vpp_required": True, "submission_deadline_notes": "Октябрь–Ноябрь", "notes": "Назарбаев Университет"},
    {"country_name": "Гонконг", "vpp_required": True, "submission_deadline_notes": "Ноябрь–Декабрь", "notes": "IELTS 6.5+ обязателен"},
    {"country_name": "США", "vpp_required": True, "submission_deadline_notes": "Ноябрь–Январь", "notes": "SAT/ACT рекомендован"},
    {"country_name": "Корея", "vpp_required": True, "submission_deadline_notes": "Сентябрь–Октябрь", "notes": "GKS стипендия"},
    {"country_name": "Китай", "vpp_required": False, "submission_deadline_notes": "Март–Апрель", "notes": "HSK не обязателен при наличии IELTS"},
    {"country_name": "Италия", "vpp_required": False, "submission_deadline_notes": "Февраль–Апрель", "notes": ""},
    {"country_name": "Германия", "vpp_required": True, "submission_deadline_notes": "Ноябрь–Январь", "notes": "TestDaF / DSH для немецкоязычных программ"},
    {"country_name": "Канада", "vpp_required": True, "submission_deadline_notes": "Ноябрь–Январь", "notes": "IELTS 6.5+ обязателен"},
]


async def run_seed():
    async with AsyncSessionLocal() as db:
        # Create first admin
        result = await db.execute(select(User).where(User.email == settings.FIRST_ADMIN_EMAIL))
        if not result.scalar_one_or_none():
            admin = User(
                name="Администратор",
                email=settings.FIRST_ADMIN_EMAIL,
                hashed_password=hash_password(settings.FIRST_ADMIN_PASSWORD),
                role=UserRole.admin,
                is_active=True,
                must_change_password=False,
            )
            db.add(admin)
            logger.info(f"Created admin user: {settings.FIRST_ADMIN_EMAIL}")

        # Seed countries
        for country_data in INITIAL_COUNTRIES:
            existing = await db.execute(
                select(CountryReference).where(CountryReference.country_name == country_data["country_name"])
            )
            if not existing.scalar_one_or_none():
                db.add(CountryReference(**country_data))
                logger.info(f"Seeded country: {country_data['country_name']}")

        await db.commit()
    logger.info("Seed completed.")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(run_seed())
