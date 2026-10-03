"""Тестовые данные для admission-доступов, заявок, roadmap и отметки «Я на месте».

Запуск (из корня репозитория, только локальная база tte_seed):

    DATABASE_URL=postgresql+asyncpg://$(whoami)@127.0.0.1:5432/tte_seed \\
    PYTHONPATH=.:backend .venv/bin/python backend/scripts/seed_admission_demo.py

Поверх app.core.seed_demo (аккаунты всех ролей, студентка, roadmap, задачи,
история отметок) добавляет то, чего в пустой базе нет: справочник стран, вузы
и набор заявок, на котором видно правило регламента admission:

* TUM — подана, доступ к порталу есть → можно перевести в «Оффер»;
* Charles University — подана, доступа нет → смена на «Оффер» блокируется;
* Politecnico di Milano — оффер отмечен до правила, доступа нет → бейдж;
* Boston University — доступ привязан к вузу, а не к заявке (Common App);
* University of Vienna — вуз текстом, без справочника.

Второй ментор (Дана) отмечается по Берлину — видно в сетке отметок у админа.

Защита: пишет только в базу tte_seed на localhost. Повторный запуск не
плодит дублей — обновляет то же самое.
"""
from __future__ import annotations

import asyncio
import os
import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
for p in (ROOT, ROOT / "backend"):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

from sqlalchemy import delete, select  # noqa: E402
from sqlalchemy.engine import make_url  # noqa: E402

DEMO_MARK = "[ТЕСТ] admission-демо"

UNIVERSITIES = [
    # name, country, city, website
    ("Technical University of Munich", "Германия", "Мюнхен", "https://www.tum.de"),
    ("Charles University", "Чехия", "Прага", "https://cuni.cz"),
    ("Politecnico di Milano", "Италия", "Милан", "https://www.polimi.it"),
    ("Boston University", "США", "Бостон", "https://www.bu.edu"),
]


def check_target() -> None:
    """Выйти, не записав ни байта, если база не локальная tte_seed."""
    if os.environ.get("ENVIRONMENT", "").lower() == "production":
        sys.exit("ОТКАЗ: ENVIRONMENT=production.")
    url = os.environ.get("DATABASE_URL", "")
    if not url:
        sys.exit("ОТКАЗ: задайте DATABASE_URL=postgresql+asyncpg://…@127.0.0.1:5432/tte_seed")
    parsed = make_url(url)
    if parsed.host not in {"localhost", "127.0.0.1", "::1"} or parsed.database != "tte_seed":
        sys.exit(f"ОТКАЗ: база должна быть tte_seed на localhost, а не {parsed.host}/{parsed.database}.")


async def _countries(db) -> dict[str, object]:
    from app.core.country_flags_data import code_for, flag_for
    from app.core.seed import INITIAL_COUNTRIES
    from app.models.country_reference import CountryReference

    out = {}
    for data in INITIAL_COUNTRIES:
        name = data["country_name"]
        row = (await db.execute(select(CountryReference).where(CountryReference.country_name == name))).scalar_one_or_none()
        if row is None:
            emoji, url = flag_for(name)
            row = CountryReference(**data, code=code_for(name), flag_emoji=emoji, flag_url=url)
            db.add(row)
            await db.flush()
        out[name] = row
    return out


async def _universities(db, countries) -> dict[str, object]:
    from app.models.university import University

    out = {}
    for name, country, city, website in UNIVERSITIES:
        uni = (await db.execute(select(University).where(University.name == name))).scalar_one_or_none()
        if uni is None:
            uni = University(name=name, description=DEMO_MARK)
            db.add(uni)
        uni.country_name = country
        uni.country_ref_id = countries[country].id
        uni.city = city
        uni.website = website
        uni.degree_levels = ["bachelors"]
        await db.flush()
        out[name] = uni
    return out


async def _application(db, student, mentor, *, country, status, uni=None, text=None, days=30):
    from app.models.application import Application

    name = uni.name if uni else text
    app = (
        await db.execute(select(Application).where(
            Application.student_id == student.id, Application.university == name,
        ))
    ).scalar_one_or_none()
    if app is None:
        app = Application(student_id=student.id, university=name)
        db.add(app)
    app.country = country
    app.university_id = uni.id if uni else None
    app.program = "Computer Science"
    # Статус пишется напрямую в базу, мимо API: так моделируем заявки,
    # отмеченные до появления правила регламента.
    app.submission_status = status
    app.deadline = date.today() + timedelta(days=days)
    app.lead_mentor_id = mentor.id
    await db.flush()
    return app


async def _credential(db, student, *, portal_name, portal_url, login, password, notes,
                      application=None, university=None):
    from app.core.encryption import encrypt
    from app.models.credential import UniversityCredential

    cred = (
        await db.execute(select(UniversityCredential).where(
            UniversityCredential.student_id == student.id,
            UniversityCredential.portal_name == portal_name,
        ))
    ).scalar_one_or_none()
    if cred is None:
        cred = UniversityCredential(student_id=student.id, portal_name=portal_name,
                                    login_enc="", password_enc="")
        db.add(cred)
    cred.portal_url = portal_url
    cred.login_enc = encrypt(login)
    cred.password_enc = encrypt(password)
    cred.notes = notes
    cred.application_id = application.id if application else None
    cred.university_id = university.id if university else (application.university_id if application else None)


async def main() -> None:
    check_target()

    from app.core.database import AsyncSessionLocal
    from app.core.seed_demo import ACCOUNTS, DEMO_PASSWORD, run_demo_seed
    from app.models.application import Application, SubmissionStatus as S
    from app.models.credential import UniversityCredential
    from app.models.student import Student
    from app.models.user import User
    from app.models.user_checkin import UserCheckin
    from app.services.checkins import CHECKIN_TIMEZONES, local_now

    # Справочник нужен до seed_demo: он строит шортлист из первых вузов каталога.
    async with AsyncSessionLocal() as db:
        countries = await _countries(db)
        await _universities(db, countries)
        await db.commit()

    await run_demo_seed()

    async with AsyncSessionLocal() as db:
        countries = await _countries(db)
        unis = await _universities(db, countries)
        mentor = (await db.execute(select(User).where(User.email == "demo.mentor@teenteched.kz"))).scalar_one()
        mentor2 = (await db.execute(select(User).where(User.email == "demo.mentor2@teenteched.kz"))).scalar_one()
        student = (await db.execute(select(Student).where(Student.full_name == "Асель Демо"))).scalar_one()

        # Чистый лист по заявкам и доступам студентки: seed_demo добавляет свои
        # две заявки на случайные вузы, а здесь нужен определённый набор.
        for model in (UniversityCredential, Application):
            for row in (await db.execute(select(model).where(model.student_id == student.id))).scalars():
                await db.delete(row)
        await db.flush()

        tum = await _application(db, student, mentor, country="Германия", status=S.submitted,
                                 uni=unis["Technical University of Munich"], days=20)
        await _application(db, student, mentor, country="Чехия", status=S.submitted,
                           uni=unis["Charles University"], days=35)
        await _application(db, student, mentor, country="Италия", status=S.offer_received,
                           uni=unis["Politecnico di Milano"], days=10)
        boston = await _application(db, student, mentor, country="США", status=S.documents_prep,
                                    uni=unis["Boston University"], days=60)
        boston.is_primary = True
        await _application(db, student, mentor, country="Австрия", status=S.documents_prep,
                           text="University of Vienna", days=75)

        await _credential(db, student, portal_name="TUMonline", portal_url="https://campus.tum.de",
                          login="asel.demo@example.com", password="Demo-TUM-2026!",
                          notes="Заявка подана 20.09", application=tum)
        await _credential(db, student, portal_name="Common App", portal_url="https://apply.commonapp.org",
                          login="asel.demo.us@example.com", password="Demo-CommonApp-2026",
                          notes="Общий портал для вузов США", university=unis["Boston University"])

        # Регламент п.2.1: ментор в Европе отмечается в 10:00 по своему времени.
        mentor.checkin_timezone = None
        mentor2.checkin_timezone = "Europe/Berlin"

        # «Сегодня» у разных поясов — разные даты: ночью в Алматы уже суббота,
        # а в Европе ещё пятница, за которую seed_demo проставил историю. Чистим
        # отметки за сегодняшнюю дату любого пояса из списка, чтобы кнопку
        # «Я на месте» можно было нажать вживую, выбрав пояс в профиле.
        todays = {local_now(tz).date() for tz, _ in CHECKIN_TIMEZONES}
        await db.execute(delete(UserCheckin).where(
            UserCheckin.user_id.in_([mentor.id, mentor2.id]),
            UserCheckin.checkin_date.in_(todays),
        ))
        await db.commit()

    print("\nAdmission-демо готово. Пароль у всех демо-аккаунтов:", DEMO_PASSWORD)
    for email, name, role in ACCOUNTS:
        print(f"  {role.value:<12} {email:<32} {name}")
    print("\nЗаявки студентки «Асель Демо»:")
    print("  TUM                — подана, доступ есть: можно перевести в «Оффер»")
    print("  Charles University — подана, доступа нет: «Оффер» блокируется")
    print("  Politecnico Milano — оффер до правила, доступа нет: бейдж")
    print("  Boston University  — доступ Common App привязан к вузу")
    print("  University of Vienna — вуз текстом, без доступа")
    print("Дана Демо (mentor2) отмечается по Берлину.")


if __name__ == "__main__":
    asyncio.run(main())
