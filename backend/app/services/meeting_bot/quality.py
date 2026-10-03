"""Проверка текста встречи перед созданием черновика конспекта.

Два уровня (docs/PLAN_MEETING_BOT_2026-10-02.md, п. 7):
- причины «Запись неполная» — черновик помечается, ментор видит причину;
- мягкие предупреждения — подсказка без пометки.

Пороги стартовые. Пока NOTE_QUALITY_ENFORCE выключен (режим наблюдения),
пороговые правила только считают показатели: «неполной» запись делают лишь
обрыв и пустой текст. Включаем после калибровки на 5–10 реальных записях.
"""
from __future__ import annotations

from dataclasses import dataclass, field

MIN_WORDS = 150
MIN_WORDS_PER_MINUTE = 40
MAX_GAP_SECONDS = 180
LOW_CONFIDENCE = 0.6
STUDENT_SILENT_SHARE = 0.1

QUALITY_OK = "ok"
QUALITY_INCOMPLETE = "incomplete"
QUALITY_EMPTY = "empty"


@dataclass(frozen=True)
class Utterance:
    speaker: str | None
    text: str
    start_ms: int
    duration_ms: int = 0
    is_host: bool | None = None
    confidence: float | None = None


@dataclass
class QualityResult:
    quality: str
    reasons: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    metrics: dict = field(default_factory=dict)


def _words(text: str) -> int:
    return len(text.split())


def evaluate_quality(
    utterances: list[Utterance],
    *,
    duration_seconds: float | None,
    cut_short: bool = False,
    enforce: bool = False,
) -> QualityResult:
    spoken = [u for u in utterances if u.text and u.text.strip()]
    total_words = sum(_words(u.text) for u in spoken)
    if total_words == 0:
        return QualityResult(quality=QUALITY_EMPTY, reasons=["no_text"], metrics={"words": 0})

    ordered = sorted(spoken, key=lambda u: u.start_ms)
    if duration_seconds is None or duration_seconds <= 0:
        last = ordered[-1]
        duration_seconds = max(1.0, (last.start_ms + last.duration_ms - ordered[0].start_ms) / 1000)
    minutes = max(duration_seconds / 60, 1 / 60)
    words_per_minute = total_words / minutes

    speakers = {u.speaker for u in ordered if u.speaker}
    max_gap_seconds = 0.0
    for previous, current in zip(ordered, ordered[1:]):
        gap = (current.start_ms - (previous.start_ms + previous.duration_ms)) / 1000
        max_gap_seconds = max(max_gap_seconds, gap)

    confidences = [u.confidence for u in ordered if u.confidence is not None]
    avg_confidence = sum(confidences) / len(confidences) if confidences else None

    # Доля речи «не организатора» — обычно это студент. Считаем, только если
    # провайдер сказал, кто организатор.
    known_role = [u for u in ordered if u.is_host is not None]
    guest_words = sum(_words(u.text) for u in known_role if not u.is_host)
    known_words = sum(_words(u.text) for u in known_role)
    guest_share = guest_words / known_words if known_words else None

    metrics = {
        "words": total_words,
        "duration_seconds": round(duration_seconds, 1),
        "words_per_minute": round(words_per_minute, 1),
        "speakers": len(speakers),
        "max_gap_seconds": round(max_gap_seconds, 1),
        "avg_confidence": round(avg_confidence, 3) if avg_confidence is not None else None,
        "guest_share": round(guest_share, 3) if guest_share is not None else None,
        "enforced": enforce,
    }

    reasons: list[str] = []
    if cut_short:
        reasons.append("cut_short")
    if enforce:
        if total_words < MIN_WORDS or words_per_minute < MIN_WORDS_PER_MINUTE:
            reasons.append("too_little_text")
        if max_gap_seconds > MAX_GAP_SECONDS:
            reasons.append("long_gap")
        if len(speakers) < 2:
            reasons.append("single_speaker")

    warnings: list[str] = []
    if avg_confidence is not None and avg_confidence < LOW_CONFIDENCE:
        warnings.append("low_confidence")
    if guest_share is not None and guest_share < STUDENT_SILENT_SHARE:
        warnings.append("student_mostly_silent")

    return QualityResult(
        quality=QUALITY_INCOMPLETE if reasons else QUALITY_OK,
        reasons=reasons,
        warnings=warnings,
        metrics=metrics,
    )


QUALITY_REASON_MESSAGES = {
    "no_text": "Во встрече не распознано ни слова.",
    "cut_short": "Запись оборвалась раньше конца встречи.",
    "too_little_text": "Текста слишком мало для такой длинной встречи.",
    "long_gap": "В середине записи большой провал без текста.",
    "single_speaker": "Слышно только одного участника.",
}

QUALITY_WARNING_MESSAGES = {
    "low_confidence": "Распознавание неуверенное — возможно, выбран не тот язык или плохой звук.",
    "student_mostly_silent": "Студента почти не слышно — проверьте, что конспект отражает разговор.",
}
