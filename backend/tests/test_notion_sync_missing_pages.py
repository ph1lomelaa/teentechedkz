"""Пропавшая из выдачи Notion страница: удалена на самом деле или выдача обрезана.

Ради чего тест: 03.10.2026 синк на проде встал целиком, потому что в Notion
удалили две страницы — защита от обрезанной выдачи не отличала удаление от
сбоя. Теперь каждую пропавшую страницу спрашиваем у Notion напрямую, и цена
ошибки в обе стороны разная: принять обрезанную выдачу за удаление — значит
молча потерять записи на Обзоре, поэтому при любом сомнении ответ «на месте».
"""
from unittest.mock import MagicMock, patch

from app.core.config import settings
from app.services import notion_sync

SOURCE = "27b4a5e79e3c80b68509000b8603a3bc"


def _resp(status: int, body: dict | None = None) -> MagicMock:
    resp = MagicMock(status_code=status)
    resp.json.return_value = body or {}
    return resp


def _check(resp=None, exc=None) -> bool:
    request = MagicMock(return_value=resp, side_effect=exc)
    with patch.object(settings, "NOTION_DATABASE_ID", SOURCE), \
            patch("app.services.notion_write._request", request):
        return notion_sync._page_left_source("page-1")


def test_deleted_trashed_or_missing_pages_have_left():
    assert _check(_resp(404)) is True
    assert _check(_resp(200, {"archived": True, "parent": {"data_source_id": SOURCE}})) is True
    assert _check(_resp(200, {"in_trash": True, "parent": {"data_source_id": SOURCE}})) is True


def test_page_moved_to_another_database_has_left():
    assert _check(_resp(200, {"parent": {"type": "data_source_id", "data_source_id": "other-source"}})) is True


def test_page_still_in_our_database_means_truncated_listing():
    dashed = "27b4a5e7-9e3c-80b6-8509-000b8603a3bc"
    assert _check(_resp(200, {"parent": {"type": "data_source_id", "data_source_id": dashed}})) is False


def test_any_doubt_keeps_the_sync_stopped():
    assert _check(_resp(500)) is False
    assert _check(_resp(429)) is False
    assert _check(exc=ConnectionError("network down")) is False
