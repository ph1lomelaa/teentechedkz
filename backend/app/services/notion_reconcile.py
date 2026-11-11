"""Сверка «платформа ↔ Notion»: счётчики по статусам и списки расхождений.

Только чтение. Одно правило подсчёта для интерфейса и для ручных отчётов:
- платформа — активные (не в архиве) студенты, статус из их последнего договора;
- Notion — строки базы с ФИО, без скрытых (ignored) и без строк, привязанных
  к удалённой карточке; статус — «Статус выплат».
Студенты «Без статуса» в Notion не уходят, пока им не поставят статус, поэтому
они показываются отдельно: «ждут статуса».
"""
from __future__ import annotations

from collections import Counter

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from migration.transformers.normalize import (
    names_probably_same, normalize_phone, parse_degree_or_none, parse_pipeline_status,
)

STATUS_RU = {
    "active_work": "Активная работа", "on_visa": "На визе", "paused": "Пауза",
    "completed_admitted": "Работа окончена — Поступил", "changed_mind": "Работа окончена — Передумали",
    "lost_applicant": "Пропал абитуриент", "refund": "На возврате", "unpaid": "Не оплачено",
    "transferred_pipeline": "Перевели на другой продукт", "ielts_retake": "Пересдача IELTS",
    "reapplication": "Переподача", "problem": "Проблема", "suspended": "Подвешено",
    "no_status": "Без статуса",
}


def _status(raw) -> str:
    if not raw:
        return "no_status"
    try:
        return parse_pipeline_status(raw)
    except ValueError:
        return "unknown"


def _year(raw):
    for token in str(raw or "").replace(".", " ").split():
        if token.isdigit() and 2018 <= int(token) <= 2035:
            return int(token)
    return None


def _stem_name(value) -> str:
    """«Рақашевой Медеи» ≈ «Рақашева Медея»: первые 4 буквы двух первых слов."""
    from migration.transformers.normalize import squash_name
    words = squash_name(value or "").split()[:2]
    return " ".join(sorted(w[:4] for w in words)) if len(words) == 2 and min(map(len, words)) >= 4 else ""


def _same_name(a, b) -> bool:
    return " ".join(str(a or "").casefold().split()) == " ".join(str(b or "").casefold().split())


async def build_reconcile(db: AsyncSession) -> dict:
    students = (await db.execute(text("""
        select s.id, s.full_name, s.phone, s.degree_level::text deg, s.intake_year, s.created_at,
               (select c.pipeline_status::text from contracts c where c.student_id = s.id
                  order by c.created_at desc, c.id desc limit 1) crm_status,
               (select string_agg(distinct i.source::text, '+') from intake_submissions i
                  where i.student_id = s.id) forms
        from students s where not s.is_archived"""))).mappings().all()
    snaps = (await db.execute(text("""
        select n.id, n.notion_url, n.full_name, n.phone_normalized, n.status::text st, n.student_id,
               n.normalized_data nd, n.synced_at, s.id as alive
        from notion_snapshots n left join students s on s.id = n.student_id and not s.is_archived"""))).mappings().all()

    by_student: dict = {}
    for n in snaps:
        if n["st"] == "linked" and n["alive"]:
            by_student.setdefault(n["alive"], []).append(n)

    platform_counts: Counter = Counter()
    notion_counts: Counter = Counter()
    platform_only, mismatched, multi_linked = [], [], []
    unlinked_snaps = [n for n in snaps if not (n["st"] == "linked" and n["alive"]) and n["full_name"]]

    for s in students:
        crm = s["crm_status"] or "no_status"
        platform_counts[crm] += 1
        links = by_student.get(s["id"], [])
        base = {
            "student_id": str(s["id"]), "full_name": s["full_name"], "status": crm,
            "intake_year": s["intake_year"], "degree_level": s["deg"], "phone": s["phone"],
            "created_at": s["created_at"].isoformat() if s["created_at"] else None, "forms": s["forms"] or "",
        }
        if not links:
            hints = [
                {"name": n["full_name"], "state": n["st"], "url": n["notion_url"]}
                for n in unlinked_snaps
                if names_probably_same(n["full_name"], s["full_name"]) or _same_name(n["full_name"], s["full_name"])
                or (normalize_phone(s["phone"] or "") and n["phone_normalized"] == normalize_phone(s["phone"] or ""))
            ][:3]
            # Похожая строка Notion уже привязана к ДРУГОЙ карточке — значит, на
            # платформе две карточки одного человека (другое написание/падеж).
            twins = [
                {"name": n["full_name"], "state": "дубль карточки", "url": n["notion_url"]}
                for n in snaps
                if n["st"] == "linked" and n["alive"] and n["alive"] != s["id"] and n["full_name"]
                and (names_probably_same(n["full_name"], s["full_name"]) or _same_name(n["full_name"], s["full_name"])
                     or _stem_name(n["full_name"]) == _stem_name(s["full_name"]))
            ][:3]
            hints = hints + twins
            reason = (
                "ждёт статуса" if crm == "no_status"
                else "дубль карточки на платформе — объединить" if twins
                else "похожая строка в Notion — привязать вручную" if hints
                else "проверить и подтвердить статус — тогда уйдёт в Notion"
            )
            platform_only.append({**base, "similar": hints, "reason": reason})
            continue
        if len(links) > 1:
            multi_linked.append({**base, "pages": [n["notion_url"] for n in links]})
        n = links[0]
        nd = n["nd"] or {}
        ns = _status(nd.get("payment_status_raw"))
        diffs = []
        if not _same_name(n["full_name"], s["full_name"]):
            diffs.append({"field": "ФИО", "platform": s["full_name"], "notion": n["full_name"]})
        if ns != crm:
            diffs.append({"field": "Статус", "platform": STATUS_RU.get(crm, crm), "notion": STATUS_RU.get(ns, nd.get("payment_status_raw"))})
        ny = _year(nd.get("intake_raw"))
        if ny and ny != s["intake_year"]:
            diffs.append({"field": "Год поступления", "platform": s["intake_year"], "notion": ny})
        nd_deg = parse_degree_or_none(nd.get("degree_raw") or "")
        if nd_deg and nd_deg != s["deg"]:
            diffs.append({"field": "Ступень", "platform": s["deg"], "notion": nd.get("degree_raw")})
        if diffs:
            mismatched.append({**base, "notion_url": n["notion_url"], "diffs": diffs})

    notion_only, notion_hidden = [], []
    for n in snaps:
        if n["st"] == "linked" and n["alive"]:
            notion_counts[_status((n["nd"] or {}).get("payment_status_raw"))] += 1
            continue
        if not n["full_name"]:
            continue
        nd = n["nd"] or {}
        row = {"name": n["full_name"], "status": _status(nd.get("payment_status_raw")), "url": n["notion_url"],
               "phone": n["phone_normalized"], "intake_year": _year(nd.get("intake_raw")),
               "state": "linked_to_deleted" if n["st"] == "linked" else n["st"]}
        if n["st"] == "new":
            notion_counts[row["status"]] += 1
            notion_only.append(row)
        else:
            notion_hidden.append(row)

    keys = sorted(set(platform_counts) | set(notion_counts), key=lambda k: -(platform_counts[k] + notion_counts[k]))
    by_status = [
        {"status": k, "label": STATUS_RU.get(k, k), "platform": platform_counts[k], "notion": notion_counts[k],
         "difference": platform_counts[k] - notion_counts[k]}
        for k in keys
    ]
    waiting = platform_counts["no_status"]
    return {
        "platform_total": sum(platform_counts.values()),
        "notion_total": sum(notion_counts.values()),
        "waiting_status": waiting,
        # Должно быть 0: всё со статусом на платформе есть в Notion и наоборот.
        "unmatched": sum(1 for r in platform_only if r["status"] != "no_status") + len(notion_only),
        "by_status": by_status,
        "platform_only": sorted(platform_only, key=lambda r: r["created_at"] or "", reverse=True),
        "notion_only": notion_only,
        "notion_hidden": notion_hidden,
        "mismatched": mismatched,
        "multi_linked": multi_linked,
    }
