"""Seed: creates first admin user and country_reference data."""
import asyncio
import logging

from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.core.security import hash_password
from app.core.config import settings
from app.models.user import User, UserRole
from app.models.country_reference import CountryReference
from app.core.country_flags_data import flag_for, code_for

logger = logging.getLogger(__name__)

# Union of countries actually present in the two real catalog sources
# (Google Sheets "TeenTechEd Uni List", 20 tabs + Tilda store, 18 countries —
# see app/services/university_import.py). "НУ" (Nazarbayev University) was
# previously seeded here by mistake — it's a specific university, not a
# country, and has been dropped.
INITIAL_COUNTRIES = [
    {"country_name": "Венгрия", "vpp_required": True, "submission_deadline_notes": "Ноябрь–Январь", "notes": "Требуется портфолио + VPP"},
    {"country_name": "Гонконг", "vpp_required": True, "submission_deadline_notes": "Ноябрь–Декабрь", "notes": "IELTS 6.5+ обязателен"},
    {"country_name": "США", "vpp_required": True, "submission_deadline_notes": "Ноябрь–Январь", "notes": "SAT/ACT рекомендован"},
    {"country_name": "Южная Корея", "vpp_required": True, "submission_deadline_notes": "Сентябрь–Октябрь", "notes": "GKS стипендия"},
    {"country_name": "Китай", "vpp_required": False, "submission_deadline_notes": "Март–Апрель", "notes": "HSK не обязателен при наличии IELTS"},
    {"country_name": "Италия", "vpp_required": False, "submission_deadline_notes": "Февраль–Апрель", "notes": ""},
    {"country_name": "Германия", "vpp_required": True, "submission_deadline_notes": "Ноябрь–Январь", "notes": "TestDaF / DSH для немецкоязычных программ"},
    {"country_name": "Канада", "vpp_required": True, "submission_deadline_notes": "Ноябрь–Январь", "notes": "IELTS 6.5+ обязателен"},
    {"country_name": "Австралия", "vpp_required": False, "submission_deadline_notes": "", "notes": ""},
    {"country_name": "Австрия", "vpp_required": False, "submission_deadline_notes": "", "notes": ""},
    {"country_name": "Великобритания", "vpp_required": True, "submission_deadline_notes": "Октябрь–Январь", "notes": "UCAS"},
    {"country_name": "Испания", "vpp_required": False, "submission_deadline_notes": "", "notes": ""},
    {"country_name": "Катар", "vpp_required": False, "submission_deadline_notes": "", "notes": ""},
    {"country_name": "Кипр", "vpp_required": False, "submission_deadline_notes": "", "notes": ""},
    {"country_name": "Малайзия", "vpp_required": False, "submission_deadline_notes": "", "notes": ""},
    {"country_name": "Нидерланды", "vpp_required": False, "submission_deadline_notes": "", "notes": ""},
    {"country_name": "ОАЭ", "vpp_required": False, "submission_deadline_notes": "", "notes": ""},
    {"country_name": "Польша", "vpp_required": False, "submission_deadline_notes": "", "notes": ""},
    {"country_name": "Сингапур", "vpp_required": False, "submission_deadline_notes": "", "notes": ""},
    {"country_name": "Турция", "vpp_required": False, "submission_deadline_notes": "", "notes": ""},
    {"country_name": "Финляндия", "vpp_required": False, "submission_deadline_notes": "", "notes": ""},
    {"country_name": "Чехия", "vpp_required": False, "submission_deadline_notes": "", "notes": ""},
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

        # Seed countries (+ flags). Also back-fill flags on existing rows that
        # predate the flag columns, so create_all-first local stacks get flags too.
        for country_data in INITIAL_COUNTRIES:
            name = country_data["country_name"]
            emoji, url = flag_for(name)
            existing = await db.execute(
                select(CountryReference).where(CountryReference.country_name == name)
            )
            row = existing.scalar_one_or_none()
            if row is None:
                db.add(CountryReference(
                    **country_data, code=code_for(name), flag_emoji=emoji, flag_url=url,
                ))
                logger.info(f"Seeded country: {name}")
            elif not row.flag_url:
                row.code = code_for(name)
                row.flag_emoji = emoji
                row.flag_url = url
                logger.info(f"Back-filled flag for country: {name}")

        await db.commit()
    logger.info("Seed completed.")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(run_seed())
