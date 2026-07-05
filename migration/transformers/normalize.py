"""Normalization utilities for migration data."""
from __future__ import annotations
import re
from decimal import Decimal, InvalidOperation


COUNTRY_ALIASES: dict[str, str] = {
    "корея": "Корея", "korea": "Корея",
    "италия": "Италия", "italy": "Италия",
    "сша": "США", "usa": "США", "america": "США", "штаты": "США",
    "германия": "Германия", "germany": "Германия",
    "гонконг": "Гонконг", "hongkong": "Гонконг", "hong kong": "Гонконг",
    "китай": "Китай", "china": "Китай",
    "венгрия": "Венгрия", "hungary": "Венгрия",
    "канада": "Канада", "canada": "Канада",
    "малайзия": "Малайзия", "malaysia": "Малайзия",
    "англия": "Великобритания", "england": "Великобритания",
    "uk": "Великобритания", "великобритания": "Великобритания",
    "ну": "НУ", "nazarbayev": "НУ", "назарбаев": "НУ",
}

DEGREE_MAP: dict[str, str] = {
    "undergraduate": "undergraduate",
    "бакалавриат": "undergraduate",
    "бакалавр": "undergraduate",
    "ug": "undergraduate",
    "master's": "masters",
    "masters": "masters",
    "магистратура": "masters",
    "мага": "masters",
    "foundation": "foundation",
    "found + ug": "found_ug",
    "found+ug": "found_ug",
    "found_ug": "found_ug",
    "магистратура, foundation": "found_ug",
}

SERVICE_STATUS_MAP: dict[str, tuple[str, str | None]] = {}


def normalize_phone(phone: str) -> str:
    if not phone:
        return ""
    cleaned = re.sub(r"[\s\-\(\)\+]", "", str(phone))
    if cleaned.startswith("8") and len(cleaned) == 11:
        cleaned = "7" + cleaned[1:]
    return cleaned


def normalize_amount(s: str) -> Decimal | None:
    if not s or str(s).strip().lower() in ("nan", "none", "", "-"):
        return None
    s = str(s).strip().lower()
    s = s.replace("\xa0", "").replace(" ", "")
    s = s.replace("тг", "").replace("тенге", "").replace("kzt", "").replace("₸", "")
    try:
        if "млн" in s:
            parts = re.split(r"млн", s)
            millions = float(re.sub(r"[^\d.,]", "", parts[0]).replace(",", ".") or "0") * 1_000_000
            rest = parts[1] if len(parts) > 1 else ""
            thousands_str = re.sub(r"[^\d.]", "", rest.replace(",", ".").replace("тыс", ""))
            thousands = float(thousands_str or "0") * 1_000
            result = Decimal(str(int(millions + thousands)))
        else:
            # Handle "1.450.000" or "1,450,000"
            s = re.sub(r"[.,](?=\d{3}(?:[.,]|$))", "", s)
            s = s.replace(",", ".").strip()
            s = re.sub(r"[^\d.]", "", s)
            if not s:
                return None
            result = Decimal(s)

        # Sanity check: amount must be between 1 and 999_999_999 (разумный диапазон для тенге)
        if result <= 0 or result > Decimal("999999999"):
            return None
        return result
    except (InvalidOperation, ValueError):
        pass
    return None


def parse_degree(raw: str) -> str:
    if not raw:
        return "undergraduate"
    key = raw.strip().lower()
    return DEGREE_MAP.get(key, "undergraduate")


def parse_pipeline_status(raw: str) -> str:
    STATUS_MAP = {
        "активная работа": "active_work",
        "на визе": "on_visa",
        "пауза": "paused",
        "передумали": "changed_mind",
        "на возврате": "refund",
        "не оплачено": "unpaid",
        "перевели на другой п": "transferred_pipeline",
        "перевели": "transferred_pipeline",
        "пересдача ielts": "ielts_retake",
        "пересдача айлтс": "ielts_retake",
        "подвешено": "suspended",
        "no статус выплат": "no_status",
        "no статус": "no_status",
    }
    if not raw or str(raw).strip().lower() in ("nan", "none", ""):
        return "no_status"
    key = str(raw).strip().lower()
    for k, v in STATUS_MAP.items():
        if key.startswith(k):
            return v
    return "no_status"


def parse_countries_with_counts(raw: str) -> list[tuple[str, int]]:
    """Parse string like 'Корея 4, США (3) и Италия (3)' → [('Корея',4), ('США',3), ('Италия',3)]"""
    if not raw or str(raw).strip().lower() in ("nan", "none", ""):
        return []

    raw = str(raw)
    results: list[tuple[str, int]] = []

    pattern = re.compile(
        r"([а-яёА-ЯЁa-zA-Z]+(?:\s[а-яёА-ЯЁa-zA-Z]+)?)\s*[\(\[]?\s*(\d+)?\s*(?:подач[аи]?)?\s*[\)\]]?",
        re.IGNORECASE,
    )

    for match in pattern.finditer(raw):
        country_raw = match.group(1).strip().lower()
        count_raw = match.group(2)
        country = COUNTRY_ALIASES.get(country_raw)
        if not country:
            # Try prefix match
            for alias, canonical in COUNTRY_ALIASES.items():
                if country_raw.startswith(alias[:4]):
                    country = canonical
                    break
        if country:
            count = int(count_raw) if count_raw else 1
            results.append((country, count))

    return results


def parse_service_status(text: str) -> tuple[str, str | None]:
    """Parse free-text service status → (ServiceStatus enum value, result string | None)"""
    if not text:
        return ("not_applicable", None)
    t = str(text).strip().lower()
    if t in ("", "-", "nan", "нет", "не купила", "не покупал", "алд", "not applicable"):
        return ("not_applicable", None)
    if any(x in t for x in ("нет в пакете", "не в пакете", "не покупали")):
        return ("not_applicable", None)
    if any(x in t for x in ("прошел", "прошла", "прошли", "completed", "done", "сдал", "сдала")):
        score = re.search(r"\d+\.?\d*", text)
        return ("completed", score.group() if score else None)
    if any(x in t for x in ("проходит", "в процессе", "идет", "идёт", "записал", "занимается")):
        return ("in_progress", None)
    if any(x in t for x in ("запланир", "через месяц", "скоро", "планируем")):
        return ("scheduled", None)
    if any(x in t for x in ("провалил", "failed", "не сдал")):
        return ("failed", None)
    return ("in_progress", text[:200])


def parse_focus_areas(raw: str) -> list[str]:
    FOCUS_MAP = {
        "стажировки": "internships",
        "хакатоны": "hackathons",
        "олимпиады": "olympiads",
        "проекты": "projects",
        "сертификаты coursera": "coursera",
        "coursera": "coursera",
        "научные конференции": "conferences",
        "конференции": "conferences",
        "творческие конкурсы": "creative_contests",
        "летние школы": "summer_schools",
    }
    if not raw or str(raw).strip().lower() in ("nan", "none", ""):
        return []
    result = []
    for item in re.split(r"[,;/\n]", str(raw)):
        key = item.strip().lower()
        if key in FOCUS_MAP:
            result.append(FOCUS_MAP[key])
        else:
            for k, v in FOCUS_MAP.items():
                if k in key:
                    result.append(v)
                    break
    return list(dict.fromkeys(result))  # deduplicate
