"""Запись отдельных полей CRM → Notion (обратное направление к notion_sync).

Синхронные (blocking requests) функции — вызывать из async-кода через
loop.run_in_executor, как это делает notion_sync.run_sync. Пишем ТОЛЬКО по явному
действию менеджера, по одному полю, с превью и подтверждением на фронте.

Схема живой базы капризная (см. migration/sources/notion.py): имена колонок с
хвостовыми пробелами, часть денежных колонок — formula/rollup (в них писать нельзя).
Поэтому реальное имя и тип свойства резолвим из схемы БД, а не хардкодим — и по
типу же автоматически отсекаем неписываемые колонки.
"""
from __future__ import annotations

import logging
import time
from typing import Any

import requests

from app.core.config import settings
from migration.sources.notion import _headers, flatten_property

logger = logging.getLogger(__name__)

_API = "https://api.notion.com/v1"

# Ретраи на временные ошибки Notion: rate-limit (429) и 5xx. Постоянные ошибки
# (400/401/403/404 — плохой payload/токен/права) НЕ ретраим — они не «пройдут» сами.
_RETRY_STATUSES = frozenset({429, 500, 502, 503, 504})
_MAX_ATTEMPTS = 4
_BACKOFF_BASE = 0.5  # сек: 0.5, 1, 2 … (429 уважает заголовок Retry-After)

# Типы свойств, в которые Notion API позволяет писать. formula/rollup/created_time/
# last_edited_* и т.п. сюда не входят — они вычисляются самим Notion.
WRITABLE_TYPES = frozenset({"title", "rich_text", "number", "phone_number", "date", "select", "status"})

_SCHEMA_TTL = 300  # сек
_schema_cache: dict[str, Any] = {"at": 0.0, "props": None}


def _request(method: str, url: str, **kwargs: Any) -> requests.Response:
    """HTTP к Notion с ретраями на 429/5xx и экспоненциальным backoff. Финальный
    ответ (успех или постоянная ошибка) отдаём как есть — статус проверяет вызывающий
    через _raise_for_status. Сетевые сбои тоже ретраим, последний пробрасываем."""
    kwargs.setdefault("timeout", 30)
    kwargs.setdefault("headers", _headers(settings.NOTION_API_KEY))
    last_exc: Exception | None = None
    for attempt in range(_MAX_ATTEMPTS):
        try:
            resp = requests.request(method, url, **kwargs)
        except requests.RequestException as exc:
            last_exc = exc
            if attempt == _MAX_ATTEMPTS - 1:
                raise
            time.sleep(_BACKOFF_BASE * (2 ** attempt))
            continue
        if resp.status_code in _RETRY_STATUSES and attempt < _MAX_ATTEMPTS - 1:
            retry_after = resp.headers.get("Retry-After")
            delay = float(retry_after) if retry_after and retry_after.replace(".", "", 1).isdigit() \
                else _BACKOFF_BASE * (2 ** attempt)
            logger.warning("Notion %s %s → %s, ретрай через %.1fs (попытка %d/%d)",
                           method, url.rsplit("/", 1)[-1], resp.status_code, delay, attempt + 1, _MAX_ATTEMPTS)
            time.sleep(delay)
            continue
        return resp
    if last_exc:  # недостижимо при корректной логике выше, но пусть будет явно
        raise last_exc
    return resp


def get_schema(force: bool = False) -> dict[str, dict]:
    """{имя_свойства: schema_свойства} из GET /v1/databases/{id}. Кэш на процесс."""
    now = time.time()
    if not force and _schema_cache["props"] is not None and now - _schema_cache["at"] < _SCHEMA_TTL:
        return _schema_cache["props"]
    resp = _request("GET", f"{_API}/databases/{settings.NOTION_DATABASE_ID}")
    _raise_for_status(resp)
    props = resp.json().get("properties", {})
    _schema_cache.update(at=now, props=props)
    return props


def _norm(name: str) -> str:
    return name.strip().lower()


def resolve_property(schema: dict, wanted_name: str) -> tuple[str | None, str | None]:
    """Реальное имя свойства (с хвостовыми пробелами/регистром как в Notion) и его
    тип по нормализованному имени. (None, None), если не найдено."""
    target = _norm(wanted_name)
    for name, prop in schema.items():
        if _norm(name) == target:
            return name, prop.get("type")
    return None, None


def find_title_property(schema: dict) -> tuple[str | None, str | None]:
    """Title-колонка называется произвольно — ищем по типу."""
    for name, prop in schema.items():
        if prop.get("type") == "title":
            return name, "title"
    return None, None


def select_options(schema: dict, prop_name: str) -> list[str]:
    """Имена существующих опций select/status — чтобы писать только по ним и не
    плодить дубли-опции в Notion."""
    prop = schema.get(prop_name, {})
    ptype = prop.get("type")
    if ptype in ("select", "status"):
        return [o.get("name") for o in prop.get(ptype, {}).get("options", []) if o.get("name")]
    return []


def build_property(ptype: str, value: Any) -> dict:
    """Финальное значение → типизированный payload свойства Notion. Для select/status
    value — точное имя существующей опции (резолвится вызывающим кодом)."""
    if value is None:
        if ptype in ("title", "rich_text"):
            return {ptype: []}
        return {ptype: None}
    if ptype in ("title", "rich_text"):
        return {ptype: [{"type": "text", "text": {"content": str(value)[:2000]}}]}
    if ptype == "number":
        return {"number": float(value)}
    if ptype == "phone_number":
        return {"phone_number": str(value)}
    if ptype == "date":
        return {"date": {"start": str(value)[:10]}}
    if ptype in ("select", "status"):
        return {ptype: {"name": str(value)}}
    raise ValueError(f"Тип свойства не поддерживается для записи: {ptype}")


def get_page(page_id: str) -> dict:
    """GET /v1/pages/{id} — страница целиком (для верификации записи и concurrency)."""
    resp = _request("GET", f"{_API}/pages/{page_id}")
    _raise_for_status(resp)
    return resp.json()


def page_last_edited(page_id: str) -> str | None:
    """last_edited_time страницы (ISO-строка) — для optimistic concurrency."""
    return get_page(page_id).get("last_edited_time")


def read_value(page_id: str, real_name: str) -> Any:
    """Текущее плоское значение свойства страницы (для preview и проверки конфликта)."""
    prop = get_page(page_id).get("properties", {}).get(real_name)
    return flatten_property(prop) if prop else None


def update_page(page_id: str, properties: dict[str, dict], verify: bool = True) -> None:
    """PATCH /v1/pages/{id}. properties = {реальное_имя: build_property(...)}.

    verify=True — после записи читаем страницу заново и сверяем, что каждое поле
    действительно приняло записанное значение (Notion молча не пишет, например, в
    неизвестную опцию select). Расхождение → RuntimeError, чтобы вызывающий откатил
    аудит и показал ошибку, а не «успех»."""
    resp = _request("PATCH", f"{_API}/pages/{page_id}", json={"properties": properties})
    _raise_for_status(resp)
    if verify:
        _verify_written(page_id, properties)


def _verify_written(page_id: str, properties: dict[str, dict]) -> None:
    """Перечитать страницу и убедиться, что записанные свойства совпали с намерением."""
    written = get_page(page_id).get("properties", {})
    for name, payload in properties.items():
        want = _intended_value(payload)
        actual_prop = written.get(name)
        got = flatten_property(actual_prop) if actual_prop else None
        if not _values_equal(want, got):
            raise RuntimeError(
                f"Notion не подтвердил запись «{name}»: ожидали {want!r}, в базе {got!r}"
            )


def _intended_value(payload: dict) -> Any:
    """Плоское значение из write-payload build_property (форма {ptype: value}).
    Отдельно от flatten_property, т.к. та ждёт read-форму (plain_text у текста)."""
    ptype = next(iter(payload), None)
    value = payload.get(ptype)
    if value is None:
        return None
    if ptype in ("title", "rich_text"):
        return "".join(t.get("text", {}).get("content", "") for t in value) or None
    if ptype in ("select", "status"):
        return value.get("name") if isinstance(value, dict) else None
    if ptype == "date":
        return value.get("start") if isinstance(value, dict) else None
    return value  # number, phone_number


def _values_equal(want: Any, got: Any) -> bool:
    """Сравнение с допуском на форматы Notion: числа как float, даты по первым 10
    символам (Notion может дорисовать таймзону), строки со strip."""
    if want is None:
        return got is None
    if isinstance(want, (int, float)) and isinstance(got, (int, float)):
        return abs(float(want) - float(got)) < 0.01
    ws, gs = str(want).strip(), str(got).strip()
    if len(ws) >= 10 and len(gs) >= 10 and ws[:10].count("-") == 2:
        return ws[:10] == gs[:10]
    return ws == gs


def _raise_for_status(resp: requests.Response) -> None:
    if resp.status_code != 200:
        try:
            detail = resp.json().get("message", resp.text)
        except Exception:
            detail = resp.text
        raise RuntimeError(f"Notion API {resp.status_code}: {detail}")
