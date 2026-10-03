"""Тестовые данные для страницы «Заявки на доступ» — по сценарию на строку.

Запуск (из корня репозитория, адрес БД обязателен):

    SEED_DATABASE_URL=postgresql+asyncpg://$(whoami)@127.0.0.1:5432/tte_seed \\
    PYTHONPATH=. .venv/bin/python backend/scripts/seed_access_requests.py [--reset]

Защита
------
* Пишет только в БД на localhost / 127.0.0.1. Адрес берётся из --db-url или
  SEED_DATABASE_URL, а не из .env: там стоит ENVIRONMENT=production и хост
  `postgres` (docker), и молчаливый запуск «по умолчанию» был бы опасен.
* Всё созданное помечено: email @seed.teenteched.test, имена с «[ТЕСТ]».
  Остальное не читается на запись и не удаляется.
* Повторный запуск не создаёт дублей; --reset сносит только помеченное и
  создаёт заново.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
for p in (ROOT, ROOT / "backend"):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

from sqlalchemy import delete, select  # noqa: E402
from sqlalchemy.engine import make_url  # noqa: E402
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine  # noqa: E402

DOMAIN = "seed.teenteched.test"
PREFIX = "[ТЕСТ]"
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}
ADMIN_EMAIL = f"admin@{DOMAIN}"
MANAGER_EMAIL = f"manager@{DOMAIN}"
ADMIN_PASSWORD = "SeedAdmin#2026"
MANAGER_PASSWORD = "SeedManager#2026"


def check_target(url: str) -> None:
    """Выйти, не записав ни байта, если база не явно локальная."""
    if os.environ.get("ENVIRONMENT", "").lower() == "production":
        sys.exit("ОТКАЗ: в окружении процесса ENVIRONMENT=production.")
    try:
        parsed = make_url(url)
    except Exception as exc:  # noqa: BLE001
        sys.exit(f"ОТКАЗ: не разобрать адрес БД ({exc}).")
    if (parsed.host or "") not in LOCAL_HOSTS:
        sys.exit(
            f"ОТКАЗ: хост БД «{parsed.host}» не локальный (разрешены {sorted(LOCAL_HOSTS)}). "
            "Передайте --db-url или SEED_DATABASE_URL с 127.0.0.1."
        )


@dataclass
class Scenario:
    n: int
    title: str
    expected: str  # прикрепить / кабинет занят / проверить / создать / ментор
    request_name: str
    request_phone: str
    request_email: str | None = None  # по умолчанию s{n}@...
    role: str = "student"
    # Карточки: (имя, телефон, владелец-кабинета: None | "other" | "same", last_login: timedelta|None|"never")
    cards: tuple = ()


def _cards_for(sc: Scenario) -> tuple:
    return sc.cards


SCENARIOS: list[Scenario] = [
    Scenario(1, "идеальный", "прикрепить",
             f"{PREFIX} С1 Алимов Бекзат", "+7 701 000 00 01",
             cards=((f"{PREFIX} Алимов Бекзат Нурланович", "+77010000001", None, None),)),
    Scenario(2, "другой формат телефона", "прикрепить",
             f"{PREFIX} С2 Сарсенова Мадина", "8 701 000 00 02",
             cards=((f"{PREFIX} Сарсенова Мадина Ермековна", "+7 (701) 000-00-02", None, None),)),
    Scenario(3, "длинное ФИО и email", "прикрепить",
             f"{PREFIX} С3 Абдрахманов-Жумабеков Нурсултан Ерболатулы Кайратович-Оглы Третий",
             "+7 701 000 00 03",
             request_email=("s3." + "очень-длинный-адрес-" * 3).replace("очень-длинный-адрес-", "very-long-address-")
             + f"@{DOMAIN}",
             cards=((f"{PREFIX} С3 карточка длинного ФИО", "+77010000003", None, None),)),
    Scenario(4, "тот же аккаунт", "кабинет занят",
             f"{PREFIX} С4 Жаксылыков Данияр", "+7 701 000 00 04",
             cards=((f"{PREFIX} Жаксылыков Данияр Асханович", "+77010000004", "same", "never"),)),
    Scenario(5, "чужой кабинет, не входил", "кабинет занят",
             f"{PREFIX} С5 Тулегенова Алия", "+7 701 000 00 05",
             cards=((f"{PREFIX} Тулегенова Алия Мухтаровна", "+77010000005", "other", "never"),)),
    Scenario(6, "чужой кабинет, входил 3 дня назад", "кабинет занят",
             f"{PREFIX} С6 Оспанов Ержан", "+7 701 000 00 06",
             cards=((f"{PREFIX} Оспанов Ержан Талгатович", "+77010000006", "other", timedelta(days=3)),)),
    Scenario(7, "совпало только ФИО, кабинет есть", "проверить",
             f"{PREFIX} Касымова Томирис Данияровна", "+7 701 000 00 77",
             cards=((f"{PREFIX} Касымова Томирис Данияровна", "+77010000007", "other", timedelta(days=1)),)),
    Scenario(8, "два кандидата с одним телефоном", "проверить",
             f"{PREFIX} С8 Нурмагамбетов Айдар", "+7 701 000 00 08",
             cards=((f"{PREFIX} Нурмагамбетов Айдар Серикович", "+77010000008", None, None),
                    (f"{PREFIX} Нурмагамбетова Айгерим Сериковна", "+7 701 000 00 08", None, None))),
    Scenario(9, "совпадений нет", "создать",
             f"{PREFIX} С9 Уникальный Незнакомец", "+7 701 000 00 09"),
    Scenario(10, "нет телефона", "создать",
             f"{PREFIX} С10 Безномеров Человек", ""),
    Scenario(11, "ментор", "ментор",
             f"{PREFIX} С11 Ментор Тестовый", "+7 701 000 00 11", role="mentor"),
    Scenario(12, "каз. буквы в заявке, латиница в карточке", "проверить",
             f"{PREFIX} Қайрат Әлиханұлы Өтеп", "+7 701 000 00 88",
             cards=((f"{PREFIX} Kairat Alikhanuly Utep", "+77010000012", None, None),)),
    Scenario(13, "латиница в заявке, каз. буквы в карточке", "проверить",
             f"{PREFIX} Zhanar Bekenova Saken", "+7 701 000 00 89",
             cards=((f"{PREFIX} Жанар Бекенова Сәкен", "+77010000013", None, None),)),
]


def _req_email(sc: Scenario) -> str:
    return sc.request_email or f"s{sc.n}@{DOMAIN}"


def _owner_email(sc: Scenario, i: int) -> str:
    return f"owner{sc.n}-{i}@{DOMAIN}"


async def reset(db) -> None:
    from app.models.access_request import AccessRequest
    from app.models.student import Student
    from app.models.user import User

    seed_users = select(User.id).where(User.email.like(f"%@{DOMAIN}"))
    await db.execute(delete(AccessRequest).where(AccessRequest.user_id.in_(seed_users)))
    await db.execute(delete(Student).where(Student.full_name.like(f"{PREFIX}%")))
    await db.execute(delete(User).where(User.email.like(f"%@{DOMAIN}")))
    await db.flush()


async def _get_user(db, email):
    from app.models.user import User

    return (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()


async def seed(db) -> None:
    from app.core.security import GOOGLE_ONLY_PASSWORD, hash_password
    from app.models.access_request import STATUS_NEW, AccessRequest
    from app.models.student import DegreeLevel, Student
    from app.models.user import User, UserRole
    from migration.transformers.normalize import normalize_phone

    now = datetime.now(timezone.utc)

    for email, name, role, pwd in (
        (ADMIN_EMAIL, f"{PREFIX} Админ", UserRole.admin, ADMIN_PASSWORD),
        (MANAGER_EMAIL, f"{PREFIX} Менеджер МЗК", UserRole.mzk_manager, MANAGER_PASSWORD),
    ):
        if await _get_user(db, email) is None:
            db.add(User(name=name, email=email, hashed_password=hash_password(pwd), role=role, is_active=True))

    for sc in SCENARIOS:
        email = _req_email(sc)
        user = await _get_user(db, email)
        if user is not None:
            continue  # сценарий уже есть

        same_owner = any(c[2] == "same" for c in sc.cards)
        user = User(
            name=sc.request_name,
            email=email,
            phone=sc.request_phone,
            hashed_password=GOOGLE_ONLY_PASSWORD,
            # Как в /join: ждущий аккаунт — роль-заглушка и is_active=False.
            role=UserRole.student if same_owner else UserRole.mentor,
            is_active=same_owner,
        )
        db.add(user)
        await db.flush()
        db.add(AccessRequest(
            user_id=user.id,
            requested_role=sc.role,
            full_name=sc.request_name,
            phone_raw=sc.request_phone,
            phone_normalized=normalize_phone(sc.request_phone),
            city="Алматы",
            direction="Тестовое направление",
            status=STATUS_NEW,
        ))

        for i, (cname, cphone, owner, login) in enumerate(sc.cards):
            owner_id = None
            if owner == "same":
                owner_id = user.id
                user.last_login_at = None
            elif owner == "other":
                ou = User(
                    name=f"{PREFIX} Старый кабинет С{sc.n}",
                    email=_owner_email(sc, i),
                    hashed_password=GOOGLE_ONLY_PASSWORD,
                    role=UserRole.student,
                    is_active=True,
                    last_login_at=None if login == "never" else now - login,
                )
                db.add(ou)
                await db.flush()
                owner_id = ou.id
            db.add(Student(
                full_name=cname, phone=cphone, degree_level=DegreeLevel.undergraduate,
                intake_year=2026, user_id=owner_id,
                # Для сравнения «заявка ↔ карточка»: город заявки везде «Алматы».
                city={1: "Алматы", 2: "Астана"}.get(sc.n),
            ))
    await db.flush()


async def report(db) -> list[tuple]:
    """Фактическая группа — по тем же функциям и тому же правилу, что в UI."""
    from app.models.access_request import AccessRequest
    from app.services.access_requests import (
        find_student_candidates,
        prepare_candidate_index,
    )
    from app.services.sheets_sync import load_students_index

    prepared = prepare_candidate_index(await load_students_index(db))
    rows = []
    for sc in SCENARIOS:
        user = await _get_user(db, _req_email(sc))
        if user is None:
            continue
        req = (await db.execute(select(AccessRequest).where(AccessRequest.user_id == user.id))).scalar_one()
        if req.requested_role != "student":
            actual = "ментор (карточек нет)"
        else:
            cands = find_student_candidates(req.full_name, req.phone_raw, prepared)
            by_phone = [c for c, r in cands if r == "phone"]
            if len(by_phone) == 1 and by_phone[0].get("user_id") is None:
                actual = "прикрепить"          # isAutoApprovable
            elif by_phone and all(c.get("user_id") is not None for c in by_phone):
                actual = "кабинет занят"
            elif cands:
                actual = "проверить"
            else:
                actual = "создать"
        rows.append((sc.n, sc.request_name[:48], sc.expected, actual, len(cands) if req.requested_role == "student" else 0))
    return rows


async def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db-url", default=os.environ.get("SEED_DATABASE_URL"))
    ap.add_argument("--reset", action="store_true", help="удалить только помеченные тестовые записи и создать заново")
    args = ap.parse_args()

    if not args.db_url:
        sys.exit("ОТКАЗ: не задан адрес БД. Укажите --db-url или SEED_DATABASE_URL (локальный, 127.0.0.1).")
    check_target(args.db_url)

    engine = create_async_engine(args.db_url)
    Session = async_sessionmaker(engine, expire_on_commit=False)
    async with Session() as db:
        if args.reset:
            await reset(db)
        await seed(db)
        await db.commit()
        rows = await report(db)
    await engine.dispose()

    print("\nЛогины (пароль / роль):")
    print(f"  {ADMIN_EMAIL} / {ADMIN_PASSWORD}  — admin (может одобрять)")
    print(f"  {MANAGER_EMAIL} / {MANAGER_PASSWORD}  — mzk_manager (видит очередь, одобрять не может)")
    print("\n№   Сценарий                                          Ожидание        Факт            Канд.")
    bad = []
    for n, name, exp, act, k in rows:
        flag = "" if act.startswith(exp) else "  <-- РАСХОЖДЕНИЕ"
        if flag:
            bad.append(n)
        print(f"{n:<3} {name:<48} {exp:<15} {act:<15} {k}{flag}")
    print("\nРасхождения:", bad or "нет")


if __name__ == "__main__":
    asyncio.run(main())
