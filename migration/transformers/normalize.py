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
    "internship": "foundation",
    "klp": "foundation",
    "phd": "masters",
    "found + ug": "found_ug",
    "found+ug": "found_ug",
    "found_ug": "found_ug",
    "магистратура, foundation": "found_ug",
}

SERVICE_STATUS_MAP: dict[str, tuple[str, str | None]] = {}


# --- Имена: сравнение кириллица ↔ латиница -----------------------------------
# «Сыбан Еркенур Даниярқызы» и «Syban Yerkenur» — один человек. Точное
# посимвольное сравнение это не ловит, поэтому: транслитерация + фонетическое
# «сжатие» (y/h/двойные буквы — главные источники вариативности транслита).

_TRANSLIT = {
    "а": "a", "б": "b", "в": "v", "г": "g", "ғ": "g", "д": "d", "е": "e", "ё": "e",
    "ж": "zh", "з": "z", "и": "i", "і": "i", "й": "i", "к": "k", "қ": "k", "л": "l",
    "м": "m", "н": "n", "ң": "n", "о": "o", "ө": "o", "п": "p", "р": "r", "с": "s",
    "т": "t", "у": "u", "ұ": "u", "ү": "u", "ф": "f", "х": "h", "һ": "h", "ц": "ts",
    "ч": "ch", "ш": "sh", "щ": "sh", "ъ": "", "ы": "y", "ь": "", "э": "e",
    "ю": "yu", "я": "ya", "ә": "a",
}


def transliterate(text: str) -> str:
    return "".join(_TRANSLIT.get(ch, ch) for ch in str(text or "").lower())


def squash_name(text: str) -> str:
    """Фонетическая нормализация имени: транслит → только буквы → q/w → k/v →
    убрать y/h → схлопнуть двойные. 'Еркенур' и 'Yerkenur' дают одно и то же."""
    s = transliterate(text)
    s = re.sub(r"[^a-z\s]", "", s)
    s = s.replace("q", "k").replace("w", "v")
    s = re.sub(r"[yh]", "", s)
    s = re.sub(r"(.)\1+", r"\1", s)
    return " ".join(s.split())


def names_probably_same(a: str, b: str) -> bool:
    """Одно ли это имя, с учётом транслитерации и отброшенного отчества:
    каждое слово короткого имени находится в длинном (точно, по префиксу или
    с одной опечаткой). Минимум два слова — по одному имени не матчим."""
    from Levenshtein import distance as levenshtein_distance

    wa, wb = squash_name(a).split(), squash_name(b).split()
    if not wa or not wb:
        return False
    short, long_ = (wa, wb) if len(wa) <= len(wb) else (wb, wa)
    if len(short) < 2:
        return False
    matched = sum(
        1 for sw in short
        if any(sw == lw or lw.startswith(sw) or levenshtein_distance(sw, lw) <= 1 for lw in long_)
    )
    return matched == len(short)


def countries_set(raw: str) -> set[str]:
    """'Корея 4, США (3) и Италия' / 'Korea (1)' → канонические названия стран."""
    out: set[str] = set()
    for part in re.split(r"[,;/]|\bи\b|\band\b", str(raw or "")):
        p = re.sub(r"[\d()\[\]]", "", part).strip().lower()
        if not p:
            continue
        out.add(COUNTRY_ALIASES.get(p, p))
    return out


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


# Свободный текст про ступень: «Фаудшейшн+ бакалавр», «Бакалавриат, Магистратура,
# Foundation» — ловим упоминания токенами с типичными опечатками
_DEGREE_TOKEN_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("foundation", re.compile(r"found|фаунд|фаудш|фаундей|klp|internship")),
    ("undergraduate", re.compile(r"бакалавр|undergrad|\bug\b")),
    ("masters", re.compile(r"магист|\bмага\b|master|phd")),
]


def degree_tokens(raw: str) -> set[str]:
    """Какие ступени упомянуты в тексте: {'foundation', 'undergraduate', ...}."""
    t = str(raw or "").lower()
    return {name for name, pat in _DEGREE_TOKEN_PATTERNS if pat.search(t)}


def parse_degree_or_none(raw: str) -> str | None:
    """Ступень из свободного текста; None, если ничего не распознано."""
    key = str(raw or "").strip().lower()
    if key in DEGREE_MAP:
        return DEGREE_MAP[key]
    toks = degree_tokens(key)
    if "foundation" in toks and "undergraduate" in toks:
        return "found_ug"
    if toks == {"foundation"}:
        return "foundation"
    if "undergraduate" in toks:
        return "undergraduate"
    if "masters" in toks:
        return "masters"
    if "foundation" in toks:
        return "foundation"
    return None


def parse_degree(raw: str) -> str:
    return parse_degree_or_none(raw) or "undergraduate"


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
        "работа окончена": "no_status",
        "пропал абитуриент": "suspended",
        "перевели на другой продукт": "transferred_pipeline",
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
