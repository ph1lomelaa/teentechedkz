"""Read-only matching report, run explicitly after deployment. Never auto-link names."""
import argparse
import asyncio
from collections import Counter
from datetime import datetime, timezone
import json
from pathlib import Path
import uuid

from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.models.guardian import Guardian
from app.models.contract import Contract
from app.models.student import Student
from app.models.trustme_contract import TrustMeContractLink
from app.services.trustme import TrustMeClient, TrustMeError, TrustMeChallengeRequired, TrustMeSessionExpired

CATEGORIES = ("already_linked", "one_candidate", "multiple_candidates", "unsigned_only", "not_found", "incomplete_or_error")


def classify(candidates, truncated):
    if truncated:
        return "incomplete_or_error"
    signed = [c for c in candidates if c.get("contractStatus") == 3]
    if len(signed) == 1:
        return "one_candidate"
    if len(signed) > 1:
        return "multiple_candidates"
    return "unsigned_only" if candidates else "not_found"


def save_report(path, report):
    report["counts"] = {key: Counter(r["category"] for r in report["students"])[key] for key in CATEGORIES}
    report["financial_counts"] = {
        "total": sum(len(r.get("financial_contracts", [])) for r in report["students"]),
        "linked": sum(c["linked"] for r in report["students"] for c in r.get("financial_contracts", [])),
        "unlinked": sum(not c["linked"] for r in report["students"] for c in r.get("financial_contracts", [])),
    }
    report["processed"] = len(report["students"])
    temp = path.with_name(path.name + ".tmp")
    # Reports contain personal data. Create both files without broad read access.
    import os
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as stream:
        json.dump(report, stream, ensure_ascii=False, indent=2)
    os.replace(temp, path)


async def run(args):
    path = Path(args.output)
    if path.exists() and not args.resume:
        raise ValueError("Отчёт уже существует; используйте --resume либо другой путь")
    path.parent.mkdir(parents=True, exist_ok=True)
    report = json.loads(path.read_text()) if args.resume and path.exists() else {
        "created_at": datetime.now(timezone.utc).isoformat(), "read_only": True, "students": []}
    mode = "local_only" if getattr(args, "local_only", False) else "trustme_search"
    if args.resume and path.exists() and report.get("mode", "trustme_search") != mode:
        raise ValueError("Используйте отдельный файл для локального отчёта и живого поиска")
    report["mode"] = mode
    done = {row["student_id"] for row in report["students"]}
    async with AsyncSessionLocal() as db:
        stmt = select(Student).order_by(Student.id)
        if not args.include_archived:
            stmt = stmt.where(Student.is_archived.is_(False))
        if args.student_id:
            stmt = stmt.where(Student.id.in_(args.student_id))
        if done:
            stmt = stmt.where(Student.id.not_in([uuid.UUID(sid) for sid in done]))
        students = (await db.execute(stmt.limit(args.limit))).scalars().all()
        ids = [s.id for s in students]
        links = (await db.execute(select(TrustMeContractLink).where(TrustMeContractLink.student_id.in_(ids)))).scalars().all()
        financial = (await db.execute(select(Contract).where(Contract.student_id.in_(ids)))).scalars().all()
        guardians = (await db.execute(select(Guardian).where(Guardian.student_id.in_(ids)))).scalars().all()
        if getattr(args, "local_only", False):
            for student in students:
                own = [l for l in links if l.student_id == student.id]
                report["students"].append({"student_id": str(student.id), "student_name": student.full_name,
                    "queries": [], "candidates": [], "category": "already_linked" if own else "incomplete_or_error",
                    "reason": "Только локальные связи; поиск TrustMe не выполнялся",
                    "financial_contracts": [{"id": str(c.id), "linked": any(l.financial_contract_id == c.id for l in own),
                        "amount": str(c.amount) if c.amount is not None else None, "currency": c.currency,
                        "signed_date": str(c.signed_date) if c.signed_date else None}
                        for c in financial if c.student_id == student.id]})
            save_report(path, report)
            print(json.dumps({"processed": report["processed"], "counts": report["counts"], "financial_counts": report["financial_counts"], "mode": mode}, ensure_ascii=False))
            return
        async with TrustMeClient.from_settings() as client:
            if report.get("company_id") and report["company_id"] != client.company_id:
                raise ValueError("Отчёт относится к другой компании TrustMe")
            report["company_id"] = client.company_id
            for student in students:
                row = {"student_id": str(student.id), "student_name": student.full_name, "queries": [], "candidates": []}
                row["financial_contracts"] = [{"id": str(c.id), "amount": str(c.amount) if c.amount is not None else None,
                    "currency": c.currency, "signed_date": str(c.signed_date) if c.signed_date else None,
                    "linked": any(l.financial_contract_id == c.id and l.company_id == client.company_id for l in links)}
                    for c in financial if c.student_id == student.id]
                same_company = [c for c in links if c.student_id == student.id and c.company_id == client.company_id]
                if same_company:
                    row["category"] = "already_linked"
                else:
                    try:
                        aliases = tuple(dict.fromkeys(g.full_name for g in guardians if g.student_id == student.id))[:6]
                        result = await client.search(student.full_name, aliases, max_pages=2)
                        row["queries"] = result.queries
                        row["category"] = classify(result.candidates, result.truncated)
                        row["candidates"] = [{"id": c.get("id"), "short_url": c.get("shortUrl"),
                            "name": c.get("contractName"), "status": c.get("contractStatus"),
                            "registry_number": c.get("numberDeal")} for c in result.candidates]
                    except TrustMeError as error:
                        row["category"] = "incomplete_or_error"
                        row["reason"] = str(error)
                        report["students"].append(row)
                        save_report(path, report)
                        if isinstance(error, (TrustMeChallengeRequired, TrustMeSessionExpired)):
                            raise
                        await asyncio.sleep(1)
                        continue
                report["students"].append(row)
                save_report(path, report)
                await asyncio.sleep(0.5)
    save_report(path, report)
    print(json.dumps({"processed": report["processed"], "counts": report["counts"]}, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser(description="Отчёт сопоставления TrustMe без автоматической привязки")
    parser.add_argument("--output", required=True)
    parser.add_argument("--local-only", action="store_true", help="Проверить локальные связи без обращения к TrustMe")
    parser.add_argument("--resume", action="store_true", help="Продолжить по ещё не обработанным студентам")
    parser.add_argument("--limit", type=int, default=100, help="Максимум студентов за запуск")
    parser.add_argument("--include-archived", action="store_true")
    parser.add_argument("--student-id", type=uuid.UUID, action="append")
    args = parser.parse_args()
    if not 1 <= args.limit <= 1000:
        parser.error("--limit должен быть от 1 до 1000")
    try:
        asyncio.run(run(args))
    except (TrustMeError, ValueError, OSError):
        parser.exit(1, "Синхронизация остановлена. Проверьте подключение и сохранённый отчёт.\n")


if __name__ == "__main__":
    main()
