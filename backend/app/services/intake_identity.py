"""Conservative identity helpers for Google Sheets intake staging.

The Forms response Timestamp is stable in the current Sheets export, but it is
not a guaranteed response ID. Rows without a timestamp/explicit response ID are
therefore staged under a content key and marked for review, which prevents an
edited row from silently becoming a new student.
"""
from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from dataclasses import dataclass
from typing import Iterable
import uuid

from migration.transformers.normalize import names_probably_same, normalize_phone


_ID_HEADERS = {
    "id", "response id", "response_id", "form response id", "submission id",
    "идентификатор ответа", "id ответа", "номер ответа",
}


def _header_key(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip().lower().replace("_", " "))


def content_digest(raw_data: dict) -> str:
    canonical = json.dumps(raw_data, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class SourceIdentity:
    key: str
    digest: str
    review_required: bool
    kind: str


def source_identity(source: str, headers: list[str], values: list[object], raw_data: dict) -> SourceIdentity:
    """Return row identity; explicit source IDs > Timestamp > uncertain content key."""
    digest = content_digest(raw_data)
    source = str(source)
    for header, value in zip(headers, values):
        key = _header_key(header)
        text = str(value or "").strip()
        if key in _ID_HEADERS and text:
            return SourceIdentity(f"{source}:id:{text.casefold()}", digest, False, "id")

    for header, value in zip(headers, values):
        if _header_key(header) in {"timestamp", "отметка времени", "временная метка"}:
            text = str(value or "").strip()
            if text:
                return SourceIdentity(f"{source}:timestamp:{text.casefold()}", digest, False, "timestamp")

    # Without a stable identifier there is no safe way to know whether a changed
    # row is an edit or a new response. Stage it for review and block auto-create.
    return SourceIdentity(f"{source}:content:{digest}", digest, True, "content")


def _canon_name(value: str | None) -> str:
    text = unicodedata.normalize("NFKC", str(value or "")).casefold()
    return " ".join(text.split())


@dataclass(frozen=True)
class CandidateSet:
    student_ids: tuple[uuid.UUID, ...]
    confidence: float
    reason: str | None


def is_strong_unique_name_match(candidates: CandidateSet) -> bool:
    """Phone-only and fuzzy candidates are suggestions, never auto-links."""
    return len(candidates.student_ids) == 1 and candidates.reason in {"name_exact", "name_translit"}


def pair_cross_source_submissions(submissions: Iterable[object]) -> dict[uuid.UUID, uuid.UUID]:
    """Pair one package + one cases response only on reciprocal strong names.

    Any same-source duplicate, multiple plausible response, phone-only match,
    or conflicting nonempty phone values keeps the response in review.
    """
    rows = [
        row for row in submissions
        if getattr(row, "status", None) is not None
        and getattr(row, "student_id", None) is None
        and getattr(row, "suggested_student_id", None) is None
    ]
    partners: dict[uuid.UUID, uuid.UUID] = {}
    for row in rows:
        candidate_set = plausible_student_candidates(
            getattr(row, "full_name", None), getattr(row, "phone_normalized", None),
            [
                {"id": other.id, "full_name": other.full_name, "phone": other.phone_normalized}
                for other in rows if other.id != row.id
            ],
        )
        if not is_strong_unique_name_match(candidate_set):
            continue
        peer_id = candidate_set.student_ids[0]
        peer = next((item for item in rows if item.id == peer_id), None)
        if peer is None or peer.source == row.source:
            continue
        source_pair = {getattr(row.source, "value", row.source), getattr(peer.source, "value", peer.source)}
        if source_pair != {"package", "cases"}:
            continue
        row_phone = normalize_phone(getattr(row, "phone_normalized", None) or "")
        peer_phone = normalize_phone(getattr(peer, "phone_normalized", None) or "")
        if row_phone and peer_phone and row_phone != peer_phone:
            continue
        partners[row.id] = peer.id

    reciprocal: dict[uuid.UUID, uuid.UUID] = {}
    for row_id, peer_id in partners.items():
        if partners.get(peer_id) == row_id:
            reciprocal[row_id] = peer_id
    return reciprocal


def plausible_student_candidates(name: str | None, phone: str | None, students: Iterable[dict]) -> CandidateSet:
    """Collect every plausible CRM identity; never select a first match.

    Exact phone/name, likely transliteration, close full-name spelling, and a
    partial-token match all block automatic creation. A single candidate is a
    suggestion only; a human still performs the actual link.
    """
    from Levenshtein import distance as levenshtein_distance

    name_key = _canon_name(name)
    phone_key = normalize_phone(phone or "") if phone else ""
    matches: dict[uuid.UUID, tuple[float, str]] = {}
    for student in students:
        student_id = student.get("id")
        if not student_id:
            continue
        try:
            student_id = uuid.UUID(str(student_id))
        except (ValueError, TypeError, AttributeError):
            continue
        student_name = str(student.get("full_name") or "")
        student_name_key = _canon_name(student_name)
        student_phone = normalize_phone(student.get("phone") or "")

        reason = None
        score = 0.0
        if name_key and student_name_key == name_key:
            reason, score = "name_exact", 1.0
        elif name_key and student_name and names_probably_same(name_key, student_name):
            reason, score = "name_translit", 0.95
        elif phone_key and student_phone and phone_key == student_phone:
            reason, score = "phone_exact", 1.0
        elif name_key and student_name_key:
            if min(len(name_key), len(student_name_key)) >= 8:
                dist = levenshtein_distance(name_key, student_name_key)
                if dist <= 2:
                    reason, score = "name_close", max(0.6, 1.0 - dist * 0.2)
            if reason is None:
                left = name_key.split()
                right = student_name_key.split()
                if left and right and all(any(a == b or a.startswith(b) or b.startswith(a) for b in right) for a in left):
                    reason, score = "name_partial", 0.65
        if (
            reason in {"name_exact", "name_translit"}
            and phone_key and student_phone and phone_key != student_phone
        ):
            reason = "name_phone_conflict"
        if reason:
            matches[student_id] = (score, reason)

    ids = tuple(matches)
    if not ids:
        return CandidateSet((), 0.0, None)
    best = max(matches.values(), key=lambda item: item[0])
    return CandidateSet(ids, best[0], best[1] if len(ids) == 1 else "multiple_candidates")
