"""Надёжность записи в Notion: ретраи на 429/5xx, верификация после PATCH,
сравнение значений с допуском на форматы. HTTP мокаем — сети нет."""
import types

import pytest

from app.services import notion_write as nw


class _Resp:
    def __init__(self, status_code, json_data=None, headers=None, text=""):
        self.status_code = status_code
        self._json = json_data or {}
        self.headers = headers or {}
        self.text = text

    def json(self):
        return self._json


@pytest.fixture(autouse=True)
def _no_sleep(monkeypatch):
    # Не ждём реально во время backoff.
    monkeypatch.setattr(nw.time, "sleep", lambda *_: None)


# --- _intended_value: разбор write-payload build_property ---------------------

def test_intended_value_title_uses_text_content():
    payload = nw.build_property("title", "Иван Иванов")
    assert nw._intended_value(payload) == "Иван Иванов"


def test_intended_value_number_and_select_and_date():
    assert nw._intended_value(nw.build_property("number", 600000.0)) == 600000.0
    assert nw._intended_value(nw.build_property("select", "Активная работа")) == "Активная работа"
    assert nw._intended_value(nw.build_property("date", "2025-09-01T00:00:00")) == "2025-09-01"


def test_intended_value_cleared_is_none():
    assert nw._intended_value(nw.build_property("rich_text", None)) is None


# --- _values_equal: допуски на форматы Notion ---------------------------------

def test_values_equal_number_tolerance():
    assert nw._values_equal(600000, 600000.0)


def test_values_equal_date_ignores_timezone_tail():
    assert nw._values_equal("2025-09-01", "2025-09-01T00:00:00.000+00:00")


def test_values_equal_none():
    assert nw._values_equal(None, None)
    assert not nw._values_equal("x", None)


# --- _request: ретраи --------------------------------------------------------

def test_request_retries_on_429_then_succeeds(monkeypatch):
    calls = {"n": 0}

    def fake_request(method, url, **kw):
        calls["n"] += 1
        if calls["n"] == 1:
            return _Resp(429, headers={"Retry-After": "0"})
        return _Resp(200, {"ok": True})

    monkeypatch.setattr(nw.requests, "request", fake_request)
    resp = nw._request("GET", "https://x/y")
    assert resp.status_code == 200 and calls["n"] == 2


def test_request_does_not_retry_on_400(monkeypatch):
    calls = {"n": 0}

    def fake_request(method, url, **kw):
        calls["n"] += 1
        return _Resp(400, {"message": "bad"})

    monkeypatch.setattr(nw.requests, "request", fake_request)
    resp = nw._request("PATCH", "https://x/y", json={})
    assert resp.status_code == 400 and calls["n"] == 1  # постоянную ошибку не ретраим


def test_request_gives_up_after_max_attempts(monkeypatch):
    calls = {"n": 0}

    def fake_request(method, url, **kw):
        calls["n"] += 1
        return _Resp(503)

    monkeypatch.setattr(nw.requests, "request", fake_request)
    resp = nw._request("GET", "https://x/y")
    assert resp.status_code == 503 and calls["n"] == nw._MAX_ATTEMPTS


# --- update_page: верификация после записи ------------------------------------

def test_update_page_verify_passes(monkeypatch):
    # PATCH ок, затем GET возвращает то же значение → без ошибки.
    def fake_request(method, url, **kw):
        if method == "PATCH":
            return _Resp(200, {"ok": True})
        return _Resp(200, {"properties": {"Client fee": {"type": "number", "number": 600000.0}}})

    monkeypatch.setattr(nw.requests, "request", fake_request)
    nw.update_page("page1", {"Client fee": nw.build_property("number", 600000.0)})


def test_update_page_verify_mismatch_raises(monkeypatch):
    # PATCH ок, но GET показывает другое число → RuntimeError (Notion не принял запись).
    def fake_request(method, url, **kw):
        if method == "PATCH":
            return _Resp(200, {"ok": True})
        return _Resp(200, {"properties": {"Client fee": {"type": "number", "number": 123.0}}})

    monkeypatch.setattr(nw.requests, "request", fake_request)
    with pytest.raises(RuntimeError, match="не подтвердил запись"):
        nw.update_page("page1", {"Client fee": nw.build_property("number", 600000.0)})
