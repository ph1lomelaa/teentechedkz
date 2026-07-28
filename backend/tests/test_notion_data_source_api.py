from __future__ import annotations

from app.services import notion_write
from migration.sources import notion


class _Response:
    def __init__(self, data: dict, status_code: int = 200):
        self.status_code = status_code
        self._data = data
        self.text = ""
        self.headers = {}

    def json(self) -> dict:
        return self._data


def test_fetch_all_pages_uses_data_source_api_and_paginates(monkeypatch):
    calls: list[tuple[str, dict, dict]] = []
    responses = [
        _Response({
            "results": [{"id": "page-1"}],
            "has_more": True,
            "next_cursor": "cursor-2",
        }),
        _Response({
            "results": [{"id": "page-2"}],
            "has_more": False,
            "next_cursor": None,
        }),
    ]

    def fake_post(url, *, headers, json, timeout):
        calls.append((url, headers, dict(json)))
        assert timeout == 30
        return responses.pop(0)

    monkeypatch.setattr(notion.requests, "post", fake_post)

    pages = notion.fetch_all_pages("secret-token", "data-source-id")

    assert [page["id"] for page in pages] == ["page-1", "page-2"]
    assert calls[0][0] == "https://api.notion.com/v1/data_sources/data-source-id/query"
    assert calls[0][1]["Notion-Version"] == "2025-09-03"
    assert calls[0][2] == {"page_size": 100}
    assert calls[1][2] == {"page_size": 100, "start_cursor": "cursor-2"}


def test_notion_write_loads_schema_from_data_source(monkeypatch):
    seen: dict[str, str] = {}

    def fake_request(method, url, **_kwargs):
        seen.update(method=method, url=url)
        return _Response({"properties": {"Name": {"type": "title"}}})

    monkeypatch.setattr(notion_write, "_request", fake_request)
    notion_write._schema_cache.update(at=0.0, props=None)

    schema = notion_write.get_schema(force=True)

    assert schema == {"Name": {"type": "title"}}
    assert seen == {
        "method": "GET",
        "url": "https://api.notion.com/v1/data_sources/"
        f"{notion_write.settings.NOTION_DATABASE_ID}",
    }


def test_notion_write_requests_use_data_source_api_version(monkeypatch):
    captured: dict = {}

    def fake_request(method, url, **kwargs):
        captured.update(method=method, url=url, headers=kwargs["headers"])
        return _Response({})

    monkeypatch.setattr(notion_write.requests, "request", fake_request)

    notion_write._request("GET", "https://api.notion.com/v1/pages/page-id")

    assert captured["headers"]["Notion-Version"] == "2025-09-03"
