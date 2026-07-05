"""
Main migration runner.

Usage:
    python -m migration.runner --notion --cases path/to/file --package path/to/file --portfolio path/to/file --mzk path/to/file

Order: Notion → Cases → Package → Portfolio → MZK
"""
from __future__ import annotations
import argparse
import asyncio
import logging
import uuid
from datetime import datetime, timezone, date
from decimal import Decimal

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal
from app.core.encryption import encrypt
from migration.transformers.normalize import (
    normalize_phone, parse_degree, parse_pipeline_status
)
from migration.transformers.match import fuzzy_match

logger = logging.getLogger(__name__)


async def _get_all_students(db: AsyncSession) -> list[dict]:
    from app.models.student import Student
    result = await db.execute(select(Student))
    students = result.scalars().all()
    return [
        {"id": s.id, "full_name": s.full_name, "phone": s.phone, "intake_year": s.intake_year}
        for s in students
    ]


async def _get_or_create_student(
    db: AsyncSession,
    all_students: list[dict],
    full_name: str,
    phone: str,
    intake_year: int | None,
    extra_fields: dict,
    source: str,
) -> tuple[uuid.UUID, bool]:
    """Returns (student_id, created: bool)"""
    from app.models.student import Student, DegreeLevel
    from app.core.audit import log_change

    match = fuzzy_match(full_name, phone, all_students, intake_year)

    if match.student_id:
        # Update fields that are missing
        result = await db.execute(select(Student).where(Student.id == match.student_id))
        student = result.scalar_one_or_none()
        if student:
            updated = False
            for field, value in extra_fields.items():
                if value and not getattr(student, field, None):
                    setattr(student, field, value)
                    await log_change(db, "student", student.id, field, None, str(value), "migration_script", source)
                    updated = True
            if updated:
                student.updated_at = datetime.now(timezone.utc)
        return match.student_id, False

    # Create new student
    degree_raw = extra_fields.pop("degree_level_raw", "undergraduate")
    degree = DegreeLevel(parse_degree(degree_raw)) if degree_raw else DegreeLevel.undergraduate

    student = Student(
        full_name=full_name.strip(),
        phone=normalize_phone(phone) if phone else "",
        intake_year=intake_year or 2026,
        degree_level=degree,
        **{k: v for k, v in extra_fields.items() if hasattr(Student, k) and v},
    )
    db.add(student)
    await db.flush()

    await log_change(db, "student", student.id, "created", None, full_name, "migration_script", source)

    all_students.append({"id": student.id, "full_name": student.full_name, "phone": student.phone, "intake_year": student.intake_year})
    return student.id, True


async def run_notion(db: AsyncSession, all_students: list[dict]):
    from migration.sources.notion import fetch_all_pages, transform_notion_records
    from app.models.contract import Contract, PipelineStatus, PaymentPlan
    from app.models.application import Application
    from app.models.mentor_assignment import MentorAssignment, MentorRole
    from app.models.payment import Payment, PaymentType, PaymentStatus
    from app.models.sync_status import SyncStatus, SyncSource, SyncStatusEnum
    from app.models.user import User

    logger.info("Starting Notion import...")
    pages = fetch_all_pages()
    records = transform_notion_records(pages)

    users_result = await db.execute(select(User))
    all_users = {u.name.lower(): u.id for u in users_result.scalars().all()}

    for rec in records:
        try:
            intake_year = None
            if rec.get("intake_year_raw"):
                try:
                    intake_year = int(rec["intake_year_raw"])
                except (ValueError, TypeError):
                    pass

            student_id, created = await _get_or_create_student(
                db, all_students,
                full_name=rec["full_name"],
                phone=rec.get("phone", ""),
                intake_year=intake_year,
                extra_fields={"degree_level_raw": rec.get("degree_level_raw")},
                source="notion",
            )

            # Find or create contract
            existing_contract = await db.execute(
                select(Contract).where(Contract.student_id == student_id).limit(1)
            )
            contract = existing_contract.scalar_one_or_none()

            pipeline_status = PipelineStatus(parse_pipeline_status(rec.get("pipeline_status_raw", "")))
            mzk_id = _match_user(rec.get("mzk_name"), all_users)
            lead_mentor_id = _match_user(rec.get("lead_mentor_name"), all_users)

            if not contract:
                contract = Contract(
                    student_id=student_id,
                    pipeline_status=pipeline_status,
                    mzk_manager_id=mzk_id,
                    amount=Decimal(str(rec["amount"])) if rec.get("amount") else None,
                    english_sum=Decimal(str(rec["english_sum"])) if rec.get("english_sum") else None,
                    english_paid=Decimal(str(rec["english_paid"])) if rec.get("english_paid") else None,
                    client_remaining_amount=Decimal(str(rec["client_remaining_amount"])) if rec.get("client_remaining_amount") else None,
                    mentor_total_owed=Decimal(str(rec["mentor_total_owed"])) if rec.get("mentor_total_owed") else None,
                    client_remaining_date=_parse_date(rec.get("client_remaining_date")),
                    signed_date=_parse_date(rec.get("signed_date")),
                )
                db.add(contract)
                await db.flush()

                # Create payment records
                if rec.get("mentor_paid"):
                    db.add(Payment(contract_id=contract.id, type=PaymentType.mentor_payout,
                                   amount=Decimal(str(rec["mentor_paid"])), status=PaymentStatus.paid,
                                   recorded_by=mzk_id or student_id))
                if rec.get("mentor_tbp"):
                    db.add(Payment(contract_id=contract.id, type=PaymentType.mentor_payout,
                                   amount=Decimal(str(rec["mentor_tbp"])), status=PaymentStatus.to_be_paid,
                                   recorded_by=mzk_id or student_id))

            # Applications
            main_country = rec.get("main_country")
            if main_country:
                exists = await db.execute(
                    select(Application).where(
                        Application.student_id == student_id,
                        Application.country == main_country,
                    )
                )
                if not exists.scalar_one_or_none():
                    db.add(Application(
                        student_id=student_id,
                        contract_id=contract.id,
                        country=main_country,
                        is_primary=True,
                        lead_mentor_id=lead_mentor_id,
                    ))

            for country in rec.get("other_countries", []):
                exists = await db.execute(
                    select(Application).where(
                        Application.student_id == student_id, Application.country == country
                    )
                )
                if not exists.scalar_one_or_none():
                    db.add(Application(student_id=student_id, contract_id=contract.id, country=country))

            # Lead mentor assignment
            if lead_mentor_id:
                exists = await db.execute(
                    select(MentorAssignment).where(
                        MentorAssignment.student_id == student_id,
                        MentorAssignment.mentor_id == lead_mentor_id,
                        MentorAssignment.role == MentorRole.lead,
                    )
                )
                if not exists.scalar_one_or_none():
                    db.add(MentorAssignment(
                        student_id=student_id, mentor_id=lead_mentor_id,
                        role=MentorRole.lead, is_active=True,
                    ))

        except Exception as e:
            logger.error(f"Error importing Notion record '{rec.get('full_name')}': {e}")
            await db.rollback()
            continue

    db.add(SyncStatus(source=SyncSource.notion, status=SyncStatusEnum.ok))
    await db.commit()
    logger.info(f"Notion import complete: {len(records)} records processed.")


async def run_cases(db: AsyncSession, all_students: list[dict], filepath: str | None = None, df=None):
    from migration.sources.excel_cases import load
    from app.models.service import Service, ServiceType, ServiceStatus
    from app.models.application import Application
    from app.models.sync_status import SyncStatus, SyncSource, SyncStatusEnum

    logger.info("Starting Cases import...")
    records = load(filepath, df=df)

    ok, skipped = 0, 0
    for rec in records:
        try:
            async with db.begin_nested():
                student_id, _ = await _get_or_create_student(
                    db, all_students,
                    full_name=rec["full_name"],
                    phone=rec.get("phone", ""),
                    intake_year=rec.get("intake_year"),
                    extra_fields={
                        "city": rec.get("city"),
                        "age": rec.get("age"),
                        "specialty": rec.get("specialty"),
                        "gpa": rec.get("gpa"),
                        "achievements_text": rec.get("achievements_text"),
                        "budget_per_year": rec.get("budget_per_year"),
                        "transcript_resume_url": rec.get("transcript_resume_url"),
                    },
                    source="excel_cases",
                )

                # NB: intentionally not auto-marking ielts_mock as `included`
                # from the student's own case-form IELTS mention (mentioning
                # a current score/level, e.g. "уровень B1-B2, ещё не сдавал")
                # is not the same as the manager having actually sold/included
                # the IELTS Mock service — only the package (manager) form is
                # a source of truth for `included`. A prior version of this
                # importer conflated the two and incorrectly marked 25
                # students as having IELTS Mock included with no package
                # form to back it up (fixed via one-off DB cleanup 2026-07-05).

                if rec.get("sat_included"):
                    exists = await db.execute(
                        select(Service).where(
                            Service.student_id == student_id,
                            Service.service_type == ServiceType.sat_prep,
                        )
                    )
                    if not exists.scalar_one_or_none():
                        db.add(Service(student_id=student_id, service_type=ServiceType.sat_prep, included=True))

                if rec.get("country"):
                    exists = await db.execute(
                        select(Application).where(
                            Application.student_id == student_id,
                            Application.country == rec["country"],
                        )
                    )
                    if not exists.scalar_one_or_none():
                        db.add(Application(student_id=student_id, country=rec["country"], is_primary=True))

                if rec.get("confidential_note"):
                    from app.models.confidential_note import ConfidentialNote, NoteVisibility
                    from app.models.user import User
                    admin_result = await db.execute(select(User).limit(1))
                    admin = admin_result.scalar_one_or_none()
                    if admin:
                        db.add(ConfidentialNote(
                            student_id=student_id,
                            note_text_encrypted=encrypt(rec["confidential_note"]),
                            visible_to_role=NoteVisibility.admin_and_mzk,
                            created_by=admin.id,
                        ))
            ok += 1
        except Exception as e:
            skipped += 1
            logger.warning(f"Cases skip '{rec.get('full_name')}': {e}")

    await db.commit()
    logger.info(f"Cases import complete: {ok} ok, {skipped} skipped.")


async def run_portfolio(db: AsyncSession, all_students: list[dict], filepath: str | None = None, df=None, df_countries=None):
    from migration.sources.excel_portfolio import load_students, load_country_reference
    from app.models.portfolio_progress import PortfolioProgress, PortfolioStatus, FocusArea
    from app.models.application import Application
    from app.models.country_reference import CountryReference
    from app.models.sync_status import SyncStatus, SyncSource, SyncStatusEnum

    logger.info("Starting Portfolio import...")
    records = load_students(filepath, df=df)

    ok, skipped = 0, 0
    seen_student_ids: set = set()  # предотвращаем дубликаты в рамках одного запуска

    for rec in records:
        try:
            match = fuzzy_match(rec["full_name"], "", all_students)
            if not match.student_id:
                logger.warning(f"Portfolio: no match for '{rec['full_name']}'")
                skipped += 1
                continue

            if match.student_id in seen_student_ids:
                logger.warning(f"Portfolio: duplicate match for '{rec['full_name']}', skipping")
                skipped += 1
                continue
            seen_student_ids.add(match.student_id)

            async with db.begin_nested():
                from app.models.student import Student
                result = await db.execute(select(Student).where(Student.id == match.student_id))
                student = result.scalar_one_or_none()
                if student:
                    if rec.get("group_direction") and not student.group_direction:
                        student.group_direction = rec["group_direction"]
                    if rec.get("additional_sphere") and not student.additional_sphere:
                        student.additional_sphere = rec["additional_sphere"]
                    if rec.get("specialty") and not student.specialty:
                        student.specialty = rec["specialty"]
                    if rec.get("city") and not student.city:
                        student.city = rec["city"]

                existing = await db.execute(
                    select(PortfolioProgress).where(PortfolioProgress.student_id == match.student_id)
                )
                if not existing.scalar_one_or_none():
                    pp_data = rec["portfolio"]
                    try:
                        status = PortfolioStatus(pp_data["status"])
                    except ValueError:
                        status = PortfolioStatus.not_started

                    db.add(PortfolioProgress(
                        student_id=match.student_id,
                        vpp_group=pp_data.get("vpp_group"),
                        first_call_milestone=pp_data.get("first_call_milestone"),
                        deadline_text=pp_data.get("deadline_text"),
                        focus_areas=pp_data.get("focus_areas", []),
                        status=status,
                        achievements_count=pp_data.get("achievements_count", 0),
                        calls_count=pp_data.get("calls_count", 0),
                        special_notes=pp_data.get("special_notes"),
                    ))

                for country in rec.get("countries", []):
                    exists = await db.execute(
                        select(Application).where(
                            Application.student_id == match.student_id,
                            Application.country == country,
                        )
                    )
                    if not exists.scalar_one_or_none():
                        db.add(Application(student_id=match.student_id, country=country))

            ok += 1
        except Exception as e:
            skipped += 1
            logger.warning(f"Portfolio skip '{rec.get('full_name')}': {e}")

    # Country reference
    country_refs = load_country_reference(filepath, df=df_countries)
    for cr in country_refs:
        exists = await db.execute(
            select(CountryReference).where(CountryReference.country_name == cr["country_name"])
        )
        if not exists.scalar_one_or_none():
            db.add(CountryReference(**cr))

    db.add(SyncStatus(source=SyncSource.excel_portfolio, status=SyncStatusEnum.ok))
    await db.commit()
    logger.info("Portfolio import complete.")


def _match_user(name: str | None, users_map: dict[str, uuid.UUID]) -> uuid.UUID | None:
    if not name:
        return None
    key = name.strip().lower()
    if key in users_map:
        return users_map[key]
    # Partial match
    for u_name, u_id in users_map.items():
        if key in u_name or u_name in key:
            return u_id
    return None


def _parse_date(raw) -> date | None:
    if not raw or str(raw).strip().lower() in ("nan", "none", ""):
        return None
    try:
        from datetime import date
        return date.fromisoformat(str(raw)[:10])
    except (ValueError, TypeError):
        return None


async def run_package(db: AsyncSession, all_students: list[dict], filepath: str | None = None, df=None):
    from migration.sources.excel_package import load
    from app.models.contract import Contract, PipelineStatus
    from app.models.service import Service, ServiceType, ServiceStatus
    from app.models.application import Application
    from app.models.sync_status import SyncStatus, SyncSource, SyncStatusEnum
    from app.models.user import User

    logger.info("Starting Package import...")
    records = load(filepath, df=df)
    users_result = await db.execute(select(User))
    all_users = {u.name.lower(): u.id for u in users_result.scalars().all()}

    ok, skipped = 0, 0
    for rec in records:
        try:
            async with db.begin_nested():
                match = fuzzy_match(rec["full_name"], rec.get("phone", ""), all_students)
                if not match.student_id:
                    logger.warning(f"Package: no match for '{rec['full_name']}'")
                    skipped += 1
                    continue

                student_id = match.student_id
                mzk_id = _match_user(rec.get("mzk_name"), all_users)

                # Contract
                existing = await db.execute(
                    select(Contract).where(Contract.student_id == student_id).limit(1)
                )
                contract = existing.scalar_one_or_none()
                if not contract:
                    contract = Contract(
                        student_id=student_id,
                        pipeline_status=PipelineStatus.no_status,
                        mzk_manager_id=mzk_id,
                        amount=rec.get("amount"),
                    )
                    db.add(contract)
                    await db.flush()
                elif rec.get("amount") and not contract.amount:
                    contract.amount = rec["amount"]
                    if mzk_id and not contract.mzk_manager_id:
                        contract.mzk_manager_id = mzk_id

                # Services
                svc_map = {
                    ServiceType.proforientation: rec.get("proforientation_included", False),
                    ServiceType.ielts_mock: rec.get("ielts_mock_included", False),
                    ServiceType.ielts_prep: rec.get("ielts_prep_included", False),
                    ServiceType.sat_prep: rec.get("sat_prep_included", False),
                    ServiceType.portfolio_improvement: rec.get("portfolio_included", False),
                }
                for svc_type, included in svc_map.items():
                    exists = await db.execute(
                        select(Service).where(
                            Service.student_id == student_id,
                            Service.service_type == svc_type,
                        )
                    )
                    existing_svc = exists.scalar_one_or_none()
                    if existing_svc:
                        existing_svc.included = included
                    else:
                        extra = {}
                        if svc_type == ServiceType.portfolio_improvement:
                            extra["portfolio_directions_count"] = rec.get("portfolio_count")
                        db.add(Service(
                            student_id=student_id,
                            contract_id=contract.id if contract else None,
                            service_type=svc_type,
                            included=included,
                            status=ServiceStatus.not_started,
                            **extra,
                        ))

                # Countries
                for country, count in rec.get("countries", []):
                    exists = await db.execute(
                        select(Application).where(
                            Application.student_id == student_id,
                            Application.country == country,
                        )
                    )
                    if not exists.scalar_one_or_none():
                        db.add(Application(
                            student_id=student_id,
                            contract_id=contract.id if contract else None,
                            country=country,
                            submissions_planned=count,
                        ))

            ok += 1
        except Exception as e:
            skipped += 1
            logger.warning(f"Package skip '{rec.get('full_name')}': {e}")

    await db.commit()
    logger.info(f"Package import complete: {ok} ok, {skipped} skipped.")


async def run_mzk(db: AsyncSession, all_students: list[dict], filepath: str | None = None, sheets=None):
    from migration.sources.excel_mzk import load
    from app.models.service import Service, ServiceType, ServiceStatus
    from app.models.student_task import StudentTask, TaskStatus
    from app.models.mentor_assignment import MentorAssignment, MentorRole
    from app.models.contract import Contract, PipelineStatus
    from app.models.user import User
    from app.models.sync_status import SyncStatus, SyncSource, SyncStatusEnum

    logger.info("Starting MZK import...")
    data = load(filepath, sheets=sheets)
    users_result = await db.execute(select(User))
    all_users = {u.name.lower(): u.id for u in users_result.scalars().all()}

    # Get admin for task creator
    admin_result = await db.execute(select(User).limit(1))
    admin = admin_result.scalar_one_or_none()
    creator_id = admin.id if admin else None

    ok, skipped = 0, 0
    for rec in data.get("students", []):
        try:
            async with db.begin_nested():
                match = fuzzy_match(rec["full_name"], rec.get("phone", ""), all_students)
                if not match.student_id:
                    logger.warning(f"MZK: no match for '{rec['full_name']}'")
                    skipped += 1
                    continue

                student_id = match.student_id

                # Update services
                for svc_type_str, svc_data in rec.get("services", {}).items():
                    try:
                        svc_type = ServiceType(svc_type_str)
                    except ValueError:
                        continue
                    status_str = svc_data.get("status", "not_applicable")
                    try:
                        status = ServiceStatus(status_str)
                    except ValueError:
                        status = ServiceStatus.not_applicable

                    exists = await db.execute(
                        select(Service).where(
                            Service.student_id == student_id,
                            Service.service_type == svc_type,
                        )
                    )
                    existing_svc = exists.scalar_one_or_none()
                    if existing_svc:
                        if status != ServiceStatus.not_applicable:
                            existing_svc.status = status
                        if svc_data.get("result"):
                            existing_svc.result = svc_data["result"]
                    else:
                        db.add(Service(
                            student_id=student_id,
                            service_type=svc_type,
                            included=status not in (ServiceStatus.not_applicable,),
                            status=status,
                            result=svc_data.get("result"),
                        ))

                # Tasks
                for task_text in rec.get("tasks", []):
                    if task_text and creator_id:
                        db.add(StudentTask(
                            student_id=student_id,
                            task_text=task_text[:1000],
                            created_by=creator_id,
                            status=TaskStatus.open,
                        ))

                # Contract notes
                if rec.get("notes"):
                    existing_c = await db.execute(
                        select(Contract).where(Contract.student_id == student_id).limit(1)
                    )
                    contract = existing_c.scalar_one_or_none()
                    if contract and not contract.notes:
                        contract.notes = rec["notes"][:500]

            ok += 1
        except Exception as e:
            skipped += 1
            logger.warning(f"MZK skip '{rec.get('full_name')}': {e}")

    # Import tasks from "статусы по студентам" (210 rows)
    task_ok, task_skip = 0, 0
    all_tasks = data.get("tasks", [])
    logger.info(f"Importing {len(all_tasks)} status-tasks from 'статусы по студентам'...")

    for task_rec in all_tasks:
        try:
            match = fuzzy_match(task_rec["full_name"], "", all_students)
            if not match.student_id:
                task_skip += 1
                continue
            if not creator_id or not task_rec.get("task_text"):
                task_skip += 1
                continue

            # Не дублируем — проверяем, нет ли уже такой задачи
            exists = await db.execute(
                select(StudentTask).where(
                    StudentTask.student_id == match.student_id,
                    StudentTask.task_text == task_rec["task_text"][:1000],
                )
            )
            if exists.scalar_one_or_none():
                task_skip += 1
                continue

            async with db.begin_nested():
                db.add(StudentTask(
                    student_id=match.student_id,
                    task_text=task_rec["task_text"][:1000],
                    created_by=creator_id,
                    status=TaskStatus.open,
                ))
            task_ok += 1
        except Exception as e:
            task_skip += 1
            logger.debug(f"Task skip '{task_rec.get('full_name')}': {e}")

    await db.commit()
    logger.info(
        f"MZK import complete: {ok} students ok, {skipped} skipped | "
        f"{task_ok} tasks imported, {task_skip} tasks skipped"
    )


async def main(args: argparse.Namespace):
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logger.info("Migration runner started")

    # --- Google Sheets auto-discovery ---
    gsheet_dfs: dict = {}
    from migration.sources.google_sheets import is_configured, GoogleSheetsClient
    if is_configured():
        logger.info("Google Sheets credentials found — auto-discovering spreadsheets...")
        client = GoogleSheetsClient()
        spreadsheets = client.discover()

        if "cases" in spreadsheets:
            gsheet_dfs["cases"] = client.get_df(spreadsheets["cases"], "Form Responses 1")

        if "package" in spreadsheets:
            gsheet_dfs["package"] = client.get_df(spreadsheets["package"], "Form Responses 1")

        if "portfolio" in spreadsheets:
            gsheet_dfs["portfolio_students"] = client.get_df(spreadsheets["portfolio"], "Студенты")
            # Try both sheet name variants for country reference
            try:
                gsheet_dfs["portfolio_countries"] = client.get_df(spreadsheets["portfolio"], "📌 Справочник стран")
            except Exception:
                try:
                    gsheet_dfs["portfolio_countries"] = client.get_df(spreadsheets["portfolio"], "Справочник стран")
                except Exception:
                    logger.warning("Country reference sheet not found in portfolio spreadsheet")

        if "mzk" in spreadsheets:
            all_dfs = client.get_all_dfs(spreadsheets["mzk"])
            # Re-read the special sheet with header on row 2
            if "студенты" in all_dfs:
                all_dfs["студенты"] = client.get_zere_usa_df(spreadsheets["mzk"], "студенты")
            gsheet_dfs["mzk"] = all_dfs

        logger.info(f"Loaded from Google Sheets: {list(gsheet_dfs.keys())}")
    else:
        logger.info("No Google Sheets credentials — using local Excel files")

    # --- Run imports ---
    async with AsyncSessionLocal() as db:
        all_students = await _get_all_students(db)
        logger.info(f"Found {len(all_students)} existing students in DB")

        if args.notion:
            await run_notion(db, all_students)

        # Cases
        if "cases" in gsheet_dfs:
            await run_cases(db, all_students, df=gsheet_dfs["cases"])
        elif args.cases:
            await run_cases(db, all_students, filepath=args.cases)

        # Package
        if "package" in gsheet_dfs:
            await run_package(db, all_students, df=gsheet_dfs["package"])
        elif args.package:
            await run_package(db, all_students, filepath=args.package)

        # Portfolio
        if "portfolio_students" in gsheet_dfs:
            await run_portfolio(
                db, all_students,
                df=gsheet_dfs["portfolio_students"],
                df_countries=gsheet_dfs.get("portfolio_countries"),
            )
        elif args.portfolio:
            await run_portfolio(db, all_students, filepath=args.portfolio)

        # MZK
        if "mzk" in gsheet_dfs:
            await run_mzk(db, all_students, sheets=gsheet_dfs["mzk"])
        elif args.mzk:
            await run_mzk(db, all_students, filepath=args.mzk)

    logger.info("Migration runner complete.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="TeenTechEd CRM migration runner")
    parser.add_argument("--notion", action="store_true", help="Import from Notion")
    parser.add_argument("--cases", type=str, help="Path to Кейсы_студентов.xlsx (если не Google Sheets)")
    parser.add_argument("--package", type=str, help="Path to Пакет_сопровождения.xlsx (если не Google Sheets)")
    parser.add_argument("--portfolio", type=str, help="Path to NEW_портфолио_студенты_УП_финал.xlsx (если не Google Sheets)")
    parser.add_argument("--mzk", type=str, help="Path to МЗК_таблица.xlsx (если не Google Sheets)")
    parsed = parser.parse_args()
    asyncio.run(main(parsed))
