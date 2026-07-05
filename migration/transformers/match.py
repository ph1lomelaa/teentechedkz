"""Fuzzy matching of student records across sources."""
from __future__ import annotations
import uuid
from dataclasses import dataclass

from Levenshtein import distance as levenshtein_distance

from migration.transformers.normalize import normalize_phone, names_probably_same


@dataclass
class MatchResult:
    student_id: uuid.UUID | None
    confidence: float
    method: str


def fuzzy_match(
    name: str,
    phone: str,
    db_students: list[dict],
    intake_year: int | None = None,
) -> MatchResult:
    """
    Priority:
    1. Exact phone match
    2. Exact full name match
    3. Fuzzy full name (Levenshtein ≤ 2)
    4. Partial/word match (для коротких имён: 'Аружан' → 'Аружан Иванова Ивановна')
    """
    phone_normalized = normalize_phone(phone) if phone else ""

    # 1. Exact phone match
    if phone_normalized:
        for student in db_students:
            db_phone = normalize_phone(student.get("phone", ""))
            if db_phone and db_phone == phone_normalized:
                return MatchResult(student_id=student["id"], confidence=1.0, method="phone_exact")

    name_clean = name.strip().lower() if name else ""
    if not name_clean:
        return MatchResult(student_id=None, confidence=0.0, method="none")

    # 2. Exact full name
    for student in db_students:
        if student.get("full_name", "").strip().lower() == name_clean:
            return MatchResult(student_id=student["id"], confidence=1.0, method="name_exact")

    # 2.5 Транслит-совпадение: «Сыбан Еркенур» ↔ «Syban Yerkenur».
    # 0.95, а не 1.0 — кросс-язычный матч показываем как кандидата, решает человек.
    for student in db_students:
        if names_probably_same(name_clean, student.get("full_name", "")):
            return MatchResult(student_id=student["id"], confidence=0.95, method="name_translit")

    # 3. Fuzzy full name (Levenshtein ≤ 2)
    best_score = float("inf")
    best_id = None
    for student in db_students:
        db_name = student.get("full_name", "").strip().lower()
        dist = levenshtein_distance(name_clean, db_name)
        if dist <= 2:
            year_match = intake_year and student.get("intake_year") == intake_year
            if dist < best_score or (dist == best_score and year_match):
                best_score = dist
                best_id = student["id"]

    if best_id is not None:
        return MatchResult(student_id=best_id, confidence=1.0 - best_score * 0.2, method="name_fuzzy")

    # 4. Partial word match — для коротких/неполных имён из портфолио
    # 'Ашимова Меруерт' должно матчить 'Ашимова Меруерт Серікқазықызы'
    name_words = name_clean.split()
    if len(name_words) >= 1:
        best_word_score = 0
        best_word_id = None
        for student in db_students:
            db_name = student.get("full_name", "").strip().lower()
            db_words = db_name.split()
            # Считаем сколько слов из короткого имени есть в полном имени
            matches = sum(
                1 for nw in name_words
                if any(
                    nw == dw or dw.startswith(nw) or levenshtein_distance(nw, dw) <= 1
                    for dw in db_words
                )
            )
            score = matches / len(name_words)
            if score > best_word_score and score >= 0.8:
                best_word_score = score
                best_word_id = student["id"]

        if best_word_id is not None:
            return MatchResult(student_id=best_word_id, confidence=best_word_score * 0.8, method="word_partial")

    return MatchResult(student_id=None, confidence=0.0, method="none")
