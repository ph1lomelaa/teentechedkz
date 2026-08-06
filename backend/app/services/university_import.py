"""Импорт каталога университетов из двух реальных источников (не dev-заглушка):

1. Tilda Store API (teenteched.com/alluni) — 331 запись, фото, описание, степени.
2. Google Sheets ("TeenTechEd Uni List") — стоимость, дедлайны, требования, ссылки.

Названия университетов НЕ совпадают побуквенно между источниками (например
"KAIST" в Sheets vs "Korea Advanced Institute of Science & Technology (KAIST)"
в Tilda) — поэтому слияние идёт через fuzzy-match с порогом, а не точное
сравнение строк. Пары ниже порога НЕ сливаются автоматически — попадают в
`ambiguous_matches` отчёта для ручной проверки администратором.
"""
from __future__ import annotations

import html as _html_module
import logging
import re
import unicodedata
from dataclasses import dataclass, field
from difflib import SequenceMatcher

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.university import University
from app.services.tilda_text_parser import parse_tilda_text

logger = logging.getLogger(__name__)

TILDA_API_URL = "https://store.tildaapi.pro/api/getproductslist/"
TILDA_STOREPARTUID = 948866616981
TILDA_RECID = 747685524

# Tilda's country taxonomy (partuid -> Russian country name), read from the
# "Страны" filter in the store API response. The product's `url` slug is NOT
# reliable for this (some products only carry the generic /alluni/ path) —
# `partuids` is the stable per-product link to this taxonomy.
TILDA_COUNTRY_BY_PARTUID: dict[int, str] = {
    939880783962: "Италия",
    649792554462: "Австралия",
    398383304392: "Великобритания",
    946007378692: "Венгрия",
    116823566012: "Кипр",
    314031102942: "Испания",
    859509135902: "Чехия",
    956886035282: "Нидерланды",
    357699932642: "Германия",
    636408111062: "Турция",
    414139300472: "Канада",
    412608462732: "США",
    937248081642: "Южная Корея",
    844177931282: "ОАЭ",
    854945238602: "Катар",
    731558040422: "Малайзия",
    944461026292: "Китай",
    955830502172: "Гонконг",
}

SHEET_ID = "1QsEEyB2iyK_SqWFVpwON_00SqNqwxTDYc2tACFoKUu8"

# English sheet-tab name -> Russian country name used across the platform
# (CountryReference.country_name, University.country_name).
SHEET_COUNTRY_NAME_RU = {
    "USA": "США",
    "South Korea": "Южная Корея",
    "Hong Kong": "Гонконг",
    "Canada": "Канада",
    "Austria": "Австрия",
    "Turkey": "Турция",
    "Qatar": "Катар",
    "Italy": "Италия",
    "Australia": "Австралия",
    "Netherlands": "Нидерланды",
    "Finland": "Финляндия",
    "Czech Republic": "Чехия",
    "Germany": "Германия",
    "China": "Китай",
    "Hungary": "Венгрия",
    "Poland": "Польша",
    "Singapore": "Сингапур",
    "Spain": "Испания",
    "UAE": "ОАЭ",
    "UK": "Великобритания",
}

TILDA_DEGREE_MAP = {
    "Бакалавриат": "undergraduate",
    "Магистратура": "masters",
    "Докторантура": "doctorate",
}

# Below this ratio, a Tilda/Sheets name pair is not auto-merged.
FUZZY_MATCH_THRESHOLD = 0.8

GRANTS_COLUMN = (
    "Дают полный грант (обучение, проживание, перелет, питание) международным студентам?"
)

_GRANTS_YES = {"true", "да", "yes", "1", "+", "✓"}
_GRANTS_NO = {"false", "нет", "no", "0", "-", "—", ""}


def format_tuition(raw: str) -> str:
    """Normalise the spreadsheet's tuition cell for display.

    The cell is free text: bare numbers ("18235"), already-formatted amounts
    ("$72,462", "€10,000.00"), and Russian prose ("платное(3000EUR/год)",
    "бесплатное"). Blindly prefixing "$" produced "$$72,462" and "$бесплатное",
    so only add a currency sign to a bare number.
    """
    value = (raw or "").strip()
    if not value:
        return ""
    if re.fullmatch(r"[\d\s.,]+", value):
        return f"${value}"
    # Already carries a currency symbol or is descriptive prose — leave as is,
    # just tidy up the missing space before a parenthesis.
    return re.sub(r"\s*\(\s*", " (", value)


# Placeholders that carry no actual "how much aid" information. Kept out of
# grant_note so the UI doesn't show "Финансовая помощь: N/A" to a student.
_AID_PLACEHOLDERS = {
    "", "0", "-", "—", "n/a", "na", "нет", "no", "none", "tuition fee", "--",
}


def format_grant_note(raw: str) -> str:
    value = (raw or "").strip()
    if value.lower() in _AID_PLACEHOLDERS:
        return ""
    if re.fullmatch(r"[\d\s.,]+", value):
        return f"До ${value}"
    return value


def parse_grants_status(raw: str) -> tuple[str, str | None]:
    """Map the spreadsheet's grant column to "yes"/"no"/"unknown".

    Deliberately a strict whitelist rather than a truthiness check: the Germany
    tab has URLs and prose pasted into this boolean column. A URL there most
    likely means "yes, and here's the link", but guessing either way is how you
    tell a student that a fully funded programme has no funding — so anything
    unrecognised becomes "unknown" and is reported for a human to fix at source.

    Returns (status, unrecognised_raw_value_or_None).
    """
    value = (raw or "").strip()
    lowered = value.lower()
    if lowered in _GRANTS_YES:
        return "yes", None
    if lowered in _GRANTS_NO:
        return "no", None
    return "unknown", value


@dataclass
class TildaUniversity:
    title: str
    descr: str
    text: str
    # Raw, unstripped HTML. The <strong>Город:</strong> / <ul><li> structure in
    # here is what tilda_text_parser reads — stripping it at fetch time (as this
    # used to do) silently leaves the parser nothing to work with.
    text_html: str
    photo_url: str | None
    degree_levels: list[str]
    url: str
    country_name: str


@dataclass
class SheetUniversityRow:
    name: str
    country_name: str
    city: str
    tuition: str
    acceptance_rate: str
    world_ranking: int | None
    country_ranking: int | None
    application_link: str
    website: str
    row_ref: str
    grants_raw: str = ""
    max_financial_aid: str = ""


@dataclass
class ImportReport:
    created: int = 0
    updated: int = 0
    tilda_total: int = 0
    sheet_total: int = 0
    matched: int = 0
    ambiguous_matches: list[dict] = field(default_factory=list)
    # Labels in the Tilda body the parser did not recognise, and grant-column
    # values that were not TRUE/FALSE — surfaced so a human can fix the source
    # rather than having them silently dropped or guessed at.
    unclassified_labels: dict[str, int] = field(default_factory=dict)
    unparsed_grant_values: list[dict] = field(default_factory=list)
    grants_yes: int = 0
    grants_no: int = 0
    grants_unknown: int = 0


def _strip_html(html: str) -> str:
    text = re.sub(r"<[^>]+>", " ", html or "")
    # The source is hand-written HTML full of &nbsp;/&amp;/&quot; — without
    # unescaping, those leak into the UI as literal "&nbsp;" in the text.
    text = _html_module.unescape(text)
    # \xa0 (the non-breaking space &nbsp; decodes to) is not matched by \s in
    # some contexts and renders as a stray gap — fold it into a normal space.
    text = text.replace("\xa0", " ")
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _first_sentences(text: str, limit: int = 400) -> str:
    """Card blurb fallback — cut on a sentence boundary, not mid-word."""
    text = (text or "").strip()
    if len(text) <= limit:
        return text
    window = text[:limit]
    cut = max(window.rfind(". "), window.rfind("! "), window.rfind("? "))
    if cut > limit // 3:
        return window[: cut + 1].strip()
    cut = window.rfind(" ")
    return (window[:cut] if cut > 0 else window).strip() + "…"


# Words too common across university names to carry any matching signal —
# stripping them before comparison is what avoids false positives like
# "Pusan University" <-> "Pohang University" (both share "University").
_STOPWORDS = {
    "university", "institute", "college", "school", "of", "the", "and", "for",
    "national", "international", "technology", "technical", "state", "royal",
    "institution", "academy", "polytechnic", "science", "sciences",
    # Non-English forms of "university" (and the connectives that travel with
    # them). Without these the token "universitat" counts as *content*, which
    # breaks matching in both directions: it drags "Humboldt-Universität zu
    # Berlin" away from "Humboldt University of Berlin" (0.58, missed), while
    # letting "Technische Universität Berlin" score 0.76 against "Technische
    # Universität München" — two shared noise tokens outvoting the one token
    # that actually differs.
    "universitat", "universität", "universitats",
    "universitesi", "üniversitesi", "universite", "université",
    "universidad", "universita", "università", "universiteit",
    "uniwersytet", "univerzita", "universitas", "universidade",
    "technische", "politecnico", "politecnica",
    "in", "zu", "de", "di", "du", "der", "voor",
}


def _acronym(name: str) -> str | None:
    match = re.search(r"\(([A-Z]{2,6})\)", name)
    return match.group(1).lower() if match else None


def _strip_accents(text: str) -> str:
    # "Université de Montréal" vs "Universite de Montreal" — diacritics alone
    # must not count as a real difference.
    return "".join(c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c))


def _normalize_name(name: str) -> str:
    name = re.sub(r"\([^)]*\)", "", name)
    name = _strip_accents(name)
    name = re.sub(r"[^\w\s]", " ", name, flags=re.UNICODE)
    return re.sub(r"\s+", " ", name).strip().lower()


def _content_tokens(name: str) -> set[str]:
    return {t for t in _normalize_name(name).split() if t not in _STOPWORDS and len(t) > 1}


def _similarity(a: str, b: str) -> float:
    # An explicit acronym match ("KAIST" == "(KAIST)") is the strongest,
    # unambiguous signal available — short-circuit on it before anything fuzzy.
    acronym_a, acronym_b = _acronym(a), _acronym(b)
    norm_a_bare = _normalize_name(a)
    norm_b_bare = _normalize_name(b)
    if acronym_b and norm_a_bare == acronym_b:
        return 1.0
    if acronym_a and norm_b_bare == acronym_a:
        return 1.0

    tokens_a, tokens_b = _content_tokens(a), _content_tokens(b)
    if not tokens_a or not tokens_b:
        # Nothing but stopwords left (e.g. name IS just "KAIST") — fall back
        # to a plain sequence ratio on the untouched normalized strings.
        return SequenceMatcher(None, norm_a_bare, norm_b_bare).ratio()

    overlap = len(tokens_a & tokens_b) / max(len(tokens_a), len(tokens_b))
    seq = SequenceMatcher(None, " ".join(sorted(tokens_a)), " ".join(sorted(tokens_b))).ratio()
    # Require agreement from both signals — a single shared content word
    # ("Barcelona" in two different Barcelona universities) inflating overlap
    # alone must not be enough on its own.
    return min(overlap, 1.0) * 0.5 + seq * 0.5


async def fetch_tilda_universities() -> list[TildaUniversity]:
    """Page through the Tilda Store API, following `nextslice` until exhausted."""
    results: list[TildaUniversity] = []
    slice_num: int | None = 1
    async with httpx.AsyncClient(timeout=20.0) as client:
        while slice_num is not None:
            resp = await client.get(
                TILDA_API_URL,
                params={"storepartuid": TILDA_STOREPARTUID, "recid": TILDA_RECID, "slice": slice_num},
            )
            resp.raise_for_status()
            data = resp.json()
            for p in data.get("products", []):
                gallery_raw = p.get("gallery") or "[]"
                import json as _json
                try:
                    gallery = _json.loads(gallery_raw) if isinstance(gallery_raw, str) else gallery_raw
                except (ValueError, TypeError):
                    gallery = []
                photo_url = gallery[0]["img"] if gallery else None

                degree_levels: list[str] = []
                options_raw = p.get("json_options") or "[]"
                try:
                    options = _json.loads(options_raw) if isinstance(options_raw, str) else options_raw
                except (ValueError, TypeError):
                    options = []
                for opt in options:
                    if opt.get("title") == "Степени":
                        for v in opt.get("values", []):
                            mapped = TILDA_DEGREE_MAP.get(v)
                            if mapped and mapped not in degree_levels:
                                degree_levels.append(mapped)

                url = p.get("url", "")
                # The same Tilda store also holds "student success stories"
                # (/students/tproduct/...) with fabricated first names as
                # titles and no degree-level options — not universities.
                if "/students/tproduct/" in url or not degree_levels:
                    continue

                partuids_raw = p.get("partuids") or "[]"
                try:
                    partuids = _json.loads(partuids_raw) if isinstance(partuids_raw, str) else partuids_raw
                except (ValueError, TypeError):
                    partuids = []
                country_name = next(
                    (TILDA_COUNTRY_BY_PARTUID[pid] for pid in partuids if pid in TILDA_COUNTRY_BY_PARTUID),
                    "",
                )
                if not country_name:
                    logger.warning(f"Could not resolve country for '{p.get('title')}' (partuids={partuids}), skipping")
                    continue

                text_html = p.get("text", "") or ""
                results.append(TildaUniversity(
                    title=p.get("title", "").strip(),
                    # Also entity-decoded: the short blurb is hand-written HTML
                    # too and carries &nbsp; just like the long body does.
                    descr=_strip_html(p.get("descr", "")),
                    text=_strip_html(text_html),
                    text_html=text_html,
                    photo_url=photo_url,
                    degree_levels=degree_levels,
                    url=url,
                    country_name=country_name,
                ))
            slice_num = data.get("nextslice")
    return results


async def _with_retry(fn, *, description: str, max_retries: int = 4):
    """The sheet has 20 tabs and Sheets API allows ~60 reads/min per user —
    a full pass can trip the per-minute quota partway through. Back off and
    retry on 429 rather than silently skipping tabs."""
    import asyncio as _asyncio
    from gspread.exceptions import APIError

    for attempt in range(max_retries):
        try:
            return fn()
        except APIError as e:
            if "429" in str(e) and attempt < max_retries - 1:
                delay = 20 * (attempt + 1)
                logger.warning(f"Sheets API rate-limited on {description}, retrying in {delay}s")
                await _asyncio.sleep(delay)
                continue
            raise


async def fetch_sheet_universities() -> list[SheetUniversityRow]:
    from migration.sources.google_sheets import GoogleSheetsClient

    client = GoogleSheetsClient()
    sh = client.gc.open_by_key(SHEET_ID)

    rows: list[SheetUniversityRow] = []
    for tab_name, country_ru in SHEET_COUNTRY_NAME_RU.items():
        try:
            ws = await _with_retry(lambda: sh.worksheet(tab_name), description=f"open tab '{tab_name}'")
            values = await _with_retry(ws.get_all_values, description=f"read tab '{tab_name}'")
        except Exception as e:
            logger.warning(f"University sheet tab '{tab_name}' unreadable, skipping: {e}")
            continue
        # Row 0 is a merged section header ("Локация", "Основное", ...), the
        # real column labels are on row 1 (confirmed identical across all tabs).
        if len(values) < 3:
            continue
        header = values[1]
        for i, row in enumerate(values[2:], start=3):
            if not row or not row[0].strip():
                continue
            row = row + [""] * (len(header) - len(row))
            name = row[0].strip()
            if not name:
                continue

            def col(label: str) -> str:
                try:
                    idx = header.index(label)
                    return row[idx].strip()
                except (ValueError, IndexError):
                    return ""

            world_rank_raw = col("Рейтинг в Мире")
            country_rank_raw = col("Рейтинг по Стране")
            rows.append(SheetUniversityRow(
                name=name,
                country_name=country_ru,
                city=col("Город"),
                tuition=col("Стоимость обучения (USD/год)"),
                acceptance_rate=col("Процент Поступления"),
                world_ranking=int(world_rank_raw) if world_rank_raw.isdigit() else None,
                country_ranking=int(country_rank_raw) if country_rank_raw.isdigit() else None,
                application_link=col("Ссылка на заполнение заявки"),
                website=col("Сайт Университета"),
                row_ref=f"{tab_name}!row{i}",
                grants_raw=col(GRANTS_COLUMN),
                max_financial_aid=col("Максимальная Финансовая помощь (USD)"),
            ))
    return rows


def match_sheet_row(tilda_u: TildaUniversity, sheet_rows: list[SheetUniversityRow]) -> tuple[SheetUniversityRow | None, float]:
    """Best fuzzy match within the same country. Returns (row_or_None, best_score)."""
    candidates = [r for r in sheet_rows if r.country_name == tilda_u.country_name]
    if not candidates:
        return None, 0.0
    best_row, best_score = None, 0.0
    for row in candidates:
        score = _similarity(tilda_u.title, row.name)
        if score > best_score:
            best_row, best_score = row, score
    if best_score >= FUZZY_MATCH_THRESHOLD:
        return best_row, best_score
    return None, best_score


async def import_universities(db: AsyncSession, *, dry_run: bool = True) -> ImportReport:
    report = ImportReport()

    tilda_universities = await fetch_tilda_universities()
    report.tilda_total = len(tilda_universities)

    try:
        sheet_rows = await fetch_sheet_universities()
    except Exception as e:
        logger.warning(f"Could not read Sheets source, continuing with Tilda-only data: {e}")
        sheet_rows = []
    report.sheet_total = len(sheet_rows)

    existing_result = await db.execute(select(University))
    existing_by_key = {
        (u.name.strip().lower(), (u.country_name or "").strip().lower()): u
        for u in existing_result.scalars().all()
    }

    for tilda_u in tilda_universities:
        sheet_row, score = match_sheet_row(tilda_u, sheet_rows)
        if sheet_row is None and score > 0.4:
            # Below the auto-merge threshold but not a clean zero — worth a human look.
            candidates = [r for r in sheet_rows if r.country_name == tilda_u.country_name]
            near = max(candidates, key=lambda r: _similarity(tilda_u.title, r.name), default=None)
            if near:
                report.ambiguous_matches.append({
                    "tilda_title": tilda_u.title,
                    "sheet_name": near.name,
                    "country": tilda_u.country_name,
                    "score": round(score, 2),
                })

        key = (tilda_u.title.strip().lower(), tilda_u.country_name.strip().lower())
        existing = existing_by_key.get(key)

        parsed = parse_tilda_text(tilda_u.text_html)
        for label in parsed.unclassified_labels:
            report.unclassified_labels[label] = report.unclassified_labels.get(label, 0) + 1

        description = tilda_u.descr or _first_sentences(tilda_u.text)
        tuition_range = format_tuition(sheet_row.tuition) if sheet_row else ""
        world_ranking = sheet_row.world_ranking if sheet_row else None
        website = sheet_row.website if sheet_row and sheet_row.website else ""
        row_ref = sheet_row.row_ref if sheet_row else None
        # The curated spreadsheet wins where it matched; the parsed body covers
        # the ~112 rows it never reached (city goes from 88/200 to ~193/200).
        city = (sheet_row.city if sheet_row and sheet_row.city else "") or parsed.city

        grants_status, bad_grant_value = "unknown", None
        grant_note = ""
        if sheet_row:
            report.matched += 1
            grants_status, bad_grant_value = parse_grants_status(sheet_row.grants_raw)
            if bad_grant_value:
                report.unparsed_grant_values.append({
                    "university": tilda_u.title,
                    "country": tilda_u.country_name,
                    "raw": bad_grant_value[:200],
                })
            grant_note = format_grant_note(sheet_row.max_financial_aid)
        if grants_status == "yes":
            report.grants_yes += 1
        elif grants_status == "no":
            report.grants_no += 1
        else:
            report.grants_unknown += 1

        if existing:
            existing.description = description or existing.description
            existing.description_full = tilda_u.text or existing.description_full
            existing.photo_url = tilda_u.photo_url or existing.photo_url
            existing.degree_levels = tilda_u.degree_levels or existing.degree_levels
            existing.faculties = parsed.faculties or existing.faculties
            existing.requirements = parsed.requirements or existing.requirements
            existing.deadline_note = parsed.deadline_note or existing.deadline_note
            existing.deadline_year_mentioned = (
                parsed.deadline_year_mentioned or existing.deadline_year_mentioned
            )
            existing.source_tilda_url = tilda_u.url
            existing.source_sheet_row_ref = row_ref or existing.source_sheet_row_ref
            if city:
                existing.city = city
            if world_ranking is not None:
                existing.world_ranking = world_ranking
            if tuition_range:
                existing.tuition_range = tuition_range
            if website:
                existing.website = website
            # Only a matched sheet row carries grant information; without one,
            # leave whatever is already known rather than resetting to unknown.
            if sheet_row:
                existing.has_grants_status = grants_status
                existing.has_grants = grants_status == "yes"
                existing.grant_note = grant_note
            report.updated += 1
        else:
            uni = University(
                name=tilda_u.title,
                country_name=tilda_u.country_name,
                city=city,
                description=description,
                description_full=tilda_u.text,
                website=website,
                world_ranking=world_ranking,
                tuition_range=tuition_range,
                has_grants=grants_status == "yes",
                has_grants_status=grants_status,
                grant_note=grant_note,
                photo_url=tilda_u.photo_url,
                degree_levels=tilda_u.degree_levels,
                faculties=parsed.faculties,
                requirements=parsed.requirements,
                deadline_note=parsed.deadline_note,
                deadline_year_mentioned=parsed.deadline_year_mentioned,
                source_tilda_url=tilda_u.url,
                source_sheet_row_ref=row_ref,
            )
            if not dry_run:
                db.add(uni)
            report.created += 1

    if not dry_run:
        await db.commit()

    return report
