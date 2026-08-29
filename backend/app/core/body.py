"""Чтение полей из нетипизированного тела запроса (`body: dict`).

Часть эндпоинтов принимает сырой dict вместо Pydantic-схемы, и поля из него
читаются напрямую: `uuid.UUID(body["student_id"])`. Отсутствующий ключ даёт
KeyError, кривая строка — ValueError, и оба уходят наружу 500-й: сервер
сообщает «внутренняя ошибка» там, где форма всего лишь прислала неполные
данные. Пользователь при этом не понимает, что именно исправить.

Эти функции превращают такой случай в 422 с указанием конкретного поля.

Настоящее решение — Pydantic-схема на каждый эндпоинт; пока их 70+ без схем,
хелпер закрывает самую частую причину 500 на мутациях.
"""
from __future__ import annotations

import uuid
from datetime import date
from typing import Any

from fastapi import HTTPException


def _missing(field: str) -> HTTPException:
    return HTTPException(
        status_code=422,
        detail=f"Поле «{field}» обязательно",
        headers={"X-Error-Code": "FIELD_REQUIRED"},
    )


def _invalid(field: str, expected: str) -> HTTPException:
    return HTTPException(
        status_code=422,
        detail=f"Поле «{field}»: ожидается {expected}",
        headers={"X-Error-Code": "FIELD_INVALID"},
    )


def _parse_uuid(raw: Any, field: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(raw))
    except (ValueError, AttributeError, TypeError):
        raise _invalid(field, "UUID")


def required_uuid(body: dict, field: str) -> uuid.UUID:
    """UUID обязательного поля. Пусто → 422 «обязательно», мусор → 422 «UUID»."""
    raw = body.get(field)
    if raw is None or raw == "":
        raise _missing(field)
    return _parse_uuid(raw, field)


def optional_uuid(body: dict, field: str) -> uuid.UUID | None:
    """То же, но пустое значение — это законный None, а не ошибка."""
    raw = body.get(field)
    if raw is None or raw == "":
        return None
    return _parse_uuid(raw, field)


def optional_date(body: dict, field: str) -> date | None:
    """Дата ISO (ГГГГ-ММ-ДД). Обрезаем до 10 символов: фронт иногда шлёт
    полный ISO-таймстемп в поле, которое в модели — date."""
    raw = body.get(field)
    if raw is None or raw == "":
        return None
    try:
        return date.fromisoformat(str(raw)[:10])
    except ValueError:
        raise _invalid(field, "дата в формате ГГГГ-ММ-ДД")
