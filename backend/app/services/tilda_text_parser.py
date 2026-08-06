"""Parse the structured HTML body of a Tilda university product.

The Tilda store's `text` field is the only source that covers the *whole*
catalog (202/202 products) — the Google Sheet reaches fewer than half. It is
hand-written HTML, but consistently shaped as labelled sections:

    <strong>Город: </strong>Милан<br />
    <strong>Факультеты:</strong><br /><ul><li>дизайна (DESIGN)</li>…</ul>
    <strong>Требования для магистрантов:</strong><ul><li>степень бакалавра;</li>…</ul>
    <strong>Дедлайн:</strong> Февраль-июнь 2024 года

Labels are written by hand and vary — "Дедлайн"/"Дедлайны", "Требования для
бакалавриата"/"…для бакалавров", plus outright typos ("бакалавиарта"). So we
never match label literals: we split on <strong> boundaries generically and
then classify each label by normalized *prefix*, which collapses all those
variants (and the ones not yet seen) onto the same rule.

Pure string -> dataclass, no I/O, never raises: one malformed product must not
fail an import of 200.
"""
from __future__ import annotations

import html as _html
import re
import unicodedata
from dataclasses import dataclass, field

# Degree buckets for the "Требования…" sections.
DEGREE_BACHELOR = "bachelor"
DEGREE_MASTER = "master"
DEGREE_DOCTORATE = "doctorate"
DEGREE_GENERAL = "general"


@dataclass
class ParsedTildaText:
    city: str = ""
    faculties: list[str] = field(default_factory=list)
    # Per degree bucket, the requirements as separate items. Kept as a list
    # rather than one joined string so the UI can render real bullets instead
    # of a semicolon-separated wall of text.
    requirements: dict[str, list[str]] = field(default_factory=dict)
    deadline_note: str = ""
    # A year mentioned inside the deadline prose ("Февраль-июнь 2024 года").
    # These notes are frequently stale, so the UI needs to be able to say so
    # rather than presenting them as current dates.
    deadline_year_mentioned: int | None = None
    # Labels we could not classify, so a human can see what the source grew.
    unclassified_labels: list[str] = field(default_factory=list)


def _normalize_label(label: str) -> str:
    """Lowercase, unaccent Latin, ё->е, drop punctuation — for prefix matching.

    NFKD-decomposing Cyrillic would fold й -> и (and ё -> е), turning "дедлайны"
    into "дедлаины" so that no prefix rule matches it. So accents are stripped
    only from Latin characters; Cyrillic is normalized explicitly instead.
    """
    text = _html.unescape(label).replace("ё", "е").replace("Ё", "Е")
    decomposed = unicodedata.normalize("NFKD", text)
    kept = []
    for char in decomposed:
        if unicodedata.combining(char):
            # Drop the mark only when it modifies a Latin base (é -> e); a
            # Cyrillic base keeps its mark so й survives recomposition.
            base = kept[-1] if kept else ""
            if base and base.isascii():
                continue
            kept.append(char)
        else:
            kept.append(char)
    text = unicodedata.normalize("NFC", "".join(kept))
    text = re.sub(r"[^\w\s]", " ", text, flags=re.UNICODE)
    return re.sub(r"\s+", " ", text).strip().lower()


def _plain(html_fragment: str) -> str:
    """Strip tags to readable text, preserving list-item boundaries."""
    text = re.sub(r"</li\s*>", "; ", html_fragment or "", flags=re.I)
    text = re.sub(r"<br\s*/?>", " ", text, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = _html.unescape(text)
    # &nbsp; decodes to \xa0, which renders as a stray gap; normalise it.
    text = text.replace("\xa0", " ")
    text = re.sub(r"\s+", " ", text).strip()
    return re.sub(r"[;\s]+$", "", text)


def _list_items(html_fragment: str) -> list[str]:
    items = []
    for raw in re.findall(r"<li[^>]*>(.*?)</li\s*>", html_fragment or "", re.S | re.I):
        item = _plain(raw)
        if item:
            items.append(item)
    return items


def _split_items(html_fragment: str) -> list[str]:
    """Break a requirements block into separate points.

    Two shapes occur in the source: proper <ul><li> markup, and hand-numbered
    prose separated by <br /> ("1. …<br />2. …"). Both must come out as a list
    so the UI can render bullets rather than one unbroken paragraph.
    """
    items = _list_items(html_fragment)
    if items:
        return items

    # No list markup — split on <br>, then strip any leading "1." / "-" marker.
    raw_lines = re.split(r"<br\s*/?>", html_fragment or "", flags=re.I)
    result = []
    for raw in raw_lines:
        line = _plain(raw)
        line = re.sub(r"^[\s]*(?:\d+[.)]|[-—*•])\s*", "", line).strip()
        if line:
            result.append(line)
    # A single long paragraph with no structure at all: split on ";" if that
    # yields several real points, otherwise keep it whole.
    if len(result) == 1 and result[0].count(";") >= 2:
        parts = [p.strip() for p in result[0].split(";") if p.strip()]
        if len(parts) > 1:
            return parts
    return result


def _degree_bucket(normalized_label: str) -> str:
    # Prefix fragments, not whole words: "бакалав" covers "бакалавриата",
    # "бакалавров" and the typo "бакалавиарта" in one rule.
    if "бакалав" in normalized_label or "бакалавиарт" in normalized_label:
        return DEGREE_BACHELOR
    if "магистр" in normalized_label:
        return DEGREE_MASTER
    if "доктор" in normalized_label or "phd" in normalized_label:
        return DEGREE_DOCTORATE
    return DEGREE_GENERAL


def parse_tilda_text(html_text: str) -> ParsedTildaText:
    result = ParsedTildaText()
    if not html_text or not html_text.strip():
        return result

    # Split into (label, body-until-next-label) pairs. Generic on purpose —
    # no vocabulary here, so unseen labels still segment correctly.
    matches = list(re.finditer(r"<strong[^>]*>(.*?)</strong\s*>", html_text, re.S | re.I))
    if not matches:
        return result

    for i, match in enumerate(matches):
        label_raw = _plain(match.group(1))
        if not label_raw:
            continue
        body_end = matches[i + 1].start() if i + 1 < len(matches) else len(html_text)
        body_html = html_text[match.end():body_end]
        label = _normalize_label(label_raw)

        if label.startswith("город"):
            city = _plain(body_html)
            # "Город: Милан" — the colon sometimes sits outside the <strong>.
            city = re.sub(r"^[:\s]+", "", city)
            # Occasionally trailed by the next sentence; keep the first line.
            city = city.split(";")[0].strip()
            if city and not result.city:
                result.city = city

        elif label.startswith("факультет") or label.startswith("направлен"):
            for item in _list_items(body_html):
                if item not in result.faculties:
                    result.faculties.append(item)

        elif label.startswith("дедлайн") or label.startswith("сроки"):
            note = _plain(body_html)
            note = re.sub(r"^[:\s]+", "", note)
            if note:
                result.deadline_note = (
                    f"{result.deadline_note} {note}".strip() if result.deadline_note else note
                )

        elif label.startswith("требован"):
            items = _split_items(body_html)
            if items:
                bucket = _degree_bucket(label)
                existing = result.requirements.setdefault(bucket, [])
                for item in items:
                    if item not in existing:
                        existing.append(item)

        else:
            reported = label_raw.rstrip(": ").strip()
            if reported and reported not in result.unclassified_labels:
                result.unclassified_labels.append(reported)

    if result.deadline_note:
        years = [int(y) for y in re.findall(r"\b(20\d{2})\b", result.deadline_note)]
        if years:
            result.deadline_year_mentioned = max(years)

    return result
