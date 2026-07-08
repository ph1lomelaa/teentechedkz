"""Уникальные менторы и MZK-менеджеры из Notion-снэпшотов.

В CRM менторы/менеджеры живут только как свободный текст в
`notion_snapshots.normalized_data` (`lead_mentor`, `mentors[]`, `mzk`).
Написание разнится: регистр, кириллица/латиница, хвосты-аннотации
('Aisulu (KG)', 'Aruzhan- МЗК', 'Amirkhan USA'). Здесь имена канонизируются
(транслит + фонетическое сжатие `squash_name`), строятся уникальные списки
для фильтров и индекс «студент → ментор/менеджер».
"""
from __future__ import annotations

import re
import uuid
from collections import Counter, defaultdict
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notion_snapshot import NotionSnapshot, NotionMatchStatus
from migration.transformers.normalize import squash_name

# Токены-аннотации (роль/страна), не относящиеся к самому имени.
_ANNOTATION_TOKENS = {"mzk", "kg", "usa", "us", "kz", "none", "nan"}
_EMPTY_VALUES = {"", "none", "nan", "-", "—", "n/a"}


def canon_person(raw: str | None) -> str:
    """Каноничный ключ имени: транслит + фонетическое сжатие, без аннотаций.
    'Аружан', 'Aruzhan', 'Aruzhan- МЗК' → 'aruzan'."""
    if not raw:
        return ""
    s = re.sub(r"\(.*?\)", " ", str(raw))   # скобочные пометки '(KG)'
    s = re.sub(r"[-–—/]", " ", s)            # дефис-хвосты 'Aruzhan- МЗК'
    words = [w for w in squash_name(s).split() if w not in _ANNOTATION_TOKENS]
    return " ".join(words)


def clean_label(raw: str) -> str:
    """Человекочитаемая метка: убрать скобки и хвост '- МЗК'."""
    s = re.sub(r"\(.*?\)", "", str(raw))
    s = re.sub(r"[-–—]\s*мзк.*", "", s, flags=re.IGNORECASE)
    return " ".join(s.split())


def _is_empty(raw) -> bool:
    return raw is None or str(raw).strip().lower() in _EMPTY_VALUES


@dataclass
class PeopleIndex:
    mentor_labels: dict[str, str]                    # canon -> отображаемая метка
    manager_labels: dict[str, str]
    mentor_students: dict[str, set[uuid.UUID]]       # canon -> id студентов
    manager_students: dict[str, set[uuid.UUID]]
    student_mentor_labels: dict[uuid.UUID, list[str]]  # для карточек
    student_manager_label: dict[uuid.UUID, str]

    def mentor_facets(self) -> list[dict]:
        return _facet_list(self.mentor_labels, self.mentor_students)

    def manager_facets(self) -> list[dict]:
        return _facet_list(self.manager_labels, self.manager_students)


def _facet_list(labels: dict[str, str], students: dict[str, set]) -> list[dict]:
    items = [
        {"key": k, "label": labels[k], "count": len(students.get(k, ()))}
        for k in labels
    ]
    items.sort(key=lambda x: (-x["count"], x["label"].lower()))
    return items


async def build_people_index(db: AsyncSession) -> PeopleIndex:
    rows = (
        await db.execute(
            select(NotionSnapshot.student_id, NotionSnapshot.normalized_data).where(
                NotionSnapshot.status == NotionMatchStatus.linked,
                NotionSnapshot.student_id.isnot(None),
            )
        )
    ).all()

    mentor_label_votes: dict[str, Counter] = defaultdict(Counter)
    manager_label_votes: dict[str, Counter] = defaultdict(Counter)
    mentor_students: dict[str, set] = defaultdict(set)
    manager_students: dict[str, set] = defaultdict(set)
    student_mentor_labels: dict[uuid.UUID, list[str]] = {}
    student_manager_label: dict[uuid.UUID, str] = {}

    for sid, data in rows:
        d = data or {}

        raws: list[str] = []
        if not _is_empty(d.get("lead_mentor")):
            raws.append(str(d["lead_mentor"]))
        for m in (d.get("mentors") or []):
            if not _is_empty(m):
                raws.append(str(m))

        seen: set[str] = set()
        for raw in raws:
            canon = canon_person(raw)
            if not canon:
                continue
            label = clean_label(raw) or raw
            mentor_label_votes[canon][label] += 1
            mentor_students[canon].add(sid)
            if canon not in seen:
                seen.add(canon)
                student_mentor_labels.setdefault(sid, []).append(label)

        if not _is_empty(d.get("mzk")):
            raw = str(d["mzk"])
            canon = canon_person(raw)
            if canon:
                label = clean_label(raw) or raw
                manager_label_votes[canon][label] += 1
                manager_students[canon].add(sid)
                student_manager_label[sid] = label

    mentor_labels = {c: v.most_common(1)[0][0] for c, v in mentor_label_votes.items()}
    manager_labels = {c: v.most_common(1)[0][0] for c, v in manager_label_votes.items()}

    return PeopleIndex(
        mentor_labels=mentor_labels,
        manager_labels=manager_labels,
        mentor_students=dict(mentor_students),
        manager_students=dict(manager_students),
        student_mentor_labels=student_mentor_labels,
        student_manager_label=student_manager_label,
    )
