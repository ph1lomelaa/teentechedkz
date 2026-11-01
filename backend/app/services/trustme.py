"""TrustMe cabinet transport for student contract search and PDF retrieval.

Tokens belong to the server-side session owner. Do not log or return this
client's headers to the browser. Passwords remain in memory/environment only.
"""
from __future__ import annotations

import asyncio
import re
import time
import unicodedata
from dataclasses import dataclass
from typing import Any

import httpx

BASE_URL = "https://test.trustme.kz"
_SHORT_URL = re.compile(r"[A-Za-z0-9_-]{6,64}\Z")
_KAZAKH = str.maketrans("әғқңөұүһіё", "агкноуухие")


class TrustMeError(Exception):
    """Safe message; upstream bodies can contain personal data or secrets."""


class TrustMeSessionExpired(TrustMeError):
    pass


class TrustMeChallengeRequired(TrustMeError):
    """Human verification is required; never retry login automatically."""


def check_challenge(response: httpx.Response) -> None:
    # Official signal: https://developers.cloudflare.com/cloudflare-challenges/
    # challenge-types/challenge-pages/detect-response/
    challenged = response.headers.get("cf-mitigated", "").lower() == "challenge"
    if not challenged and "text/html" in response.headers.get("content-type", ""):
        if response.is_stream_consumed:
            sample = response.text[:65536].lower()
            challenged = "cf-chl-" in sample or "/cdn-cgi/challenge-platform/" in sample
    if challenged:
        raise TrustMeChallengeRequired(
            "TrustMe требует ручную проверку Cloudflare. Откройте кабинет TrustMe; "
            "если доступ с сервера остаётся закрыт, обратитесь к администратору. "
            "Можно загрузить договор вручную в документы студента.")


def name_queries(name: str, aliases: tuple[str, ...] = ()) -> list[str]:
    """Bounded search candidates, never evidence of identity by themselves."""
    result: list[str] = []
    names = [" ".join(unicodedata.normalize("NFKC", raw).split())
             for raw in (name, *aliases)]
    names = [clean for clean in names if clean]
    # Try every explicit spelling before generated alternatives consume the
    # request budget. Otherwise later parent/alias names can be silently lost.
    candidates = list(names)
    candidates += [clean.casefold().translate(_KAZAKH) for clean in names]
    for clean in names:
        parts = clean.split()
        # Keep original spelling first. Shorter searches find swapped names
        # and documents whose signer is a parent rather than the student.
        if len(parts) > 1:
            candidates += [" ".join(parts[:2]), " ".join(reversed(parts[:2]))]
        candidates += parts[:2]
    for candidate in candidates:
        if len(candidate) >= 3 and candidate.casefold() not in {
            item.casefold() for item in result
        }:
            result.append(candidate)
            if len(result) == 12:
                return result
    return result


@dataclass(frozen=True)
class SearchResults:
    candidates: list[dict[str, Any]]
    queries: list[str]
    truncated: bool
    # Explicitly retain revoked/unsigned candidates for human review.


class TrustMeClient:
    def __init__(self, token: str = "", company_id: str = "", *,
                 login: str = "", password: str = "",
                 transport: httpx.AsyncBaseTransport | None = None):
        if not token and not (login and password):
            raise ValueError("Настройте TRUSTME_LOGIN и TRUSTME_PASSWORD")
        self.company_id = company_id
        self._login = login
        self._password = password
        self._auth_lock = asyncio.Lock()
        self._http = httpx.AsyncClient(
            base_url=BASE_URL, timeout=30, follow_redirects=False,
            headers={"Origin": "https://trustme.kz"},
            transport=transport,
        )
        if token:
            self._http.headers["Authorization"] = token

    @classmethod
    def from_settings(cls, *, transport: httpx.AsyncBaseTransport | None = None) -> TrustMeClient:
        from app.core.config import settings

        return cls(login=settings.TRUSTME_LOGIN,
                   password=settings.TRUSTME_PASSWORD.get_secret_value(),
                   company_id=settings.TRUSTME_COMPANY_ID, transport=transport)

    async def __aenter__(self) -> TrustMeClient:
        try:
            await self._ensure_session()
            return self
        except BaseException:
            await self._http.aclose()
            raise

    async def __aexit__(self, *args: Any) -> None:
        await self._http.aclose()

    def _set_token(self, data: Any) -> None:
        if not isinstance(data, dict) or not isinstance(data.get("token"), str) or not data["token"]:
            raise TrustMeError("TrustMe не вернул токен сессии")
        self._http.headers["Authorization"] = data["token"]

    async def _authenticate(self) -> None:
        if not (self._login and self._password):
            raise TrustMeSessionExpired("Требуется повторное подключение TrustMe")
        data = await self._json("POST", "/api/authservice/login", retry_auth=False,
                               files={"login": (None, self._login),
                                      "password": (None, self._password)})
        self._set_token(data)

    async def _ensure_session(self) -> None:
        async with self._auth_lock:
            if not self._http.headers.get("Authorization"):
                await self._authenticate()
            if not self.company_id:
                companies = await self._json("GET", "/api/ContractCabinet/GetCompanies",
                                             retry_auth=False)
                if not isinstance(companies, list):
                    raise TrustMeError("Некорректный список компаний TrustMe")
                ids = {x.get("company_id") for x in companies if isinstance(x, dict)}
                ids.discard(None)
                ids.discard("")
                if len(ids) != 1 or any(not isinstance(x, str) for x in ids):
                    raise TrustMeError("Укажите TRUSTME_COMPANY_ID: единственную компанию определить нельзя")
                self.company_id = ids.pop()

    async def refresh_session(self) -> None:
        await self._ensure_session()
        async with self._auth_lock:
            data = await self._json("GET", "/api/authservice/UpdateToken", retry_auth=False)
            self._set_token(data)

    async def _json(self, method: str, path: str, *, retry_auth: bool = True,
                    **kwargs: Any) -> Any:
        previous_token = self._http.headers.get("Authorization")
        try:
            response = await self._http.request(method, path, **kwargs)
        except httpx.HTTPError:
            raise TrustMeError("TrustMe недоступен") from None
        check_challenge(response)
        if response.status_code in (401, 403):
            if retry_auth and self._login and self._password:
                async with self._auth_lock:
                    if self._http.headers.get("Authorization") == previous_token:
                        await self._authenticate()
                return await self._json(method, path, retry_auth=False, **kwargs)
            raise TrustMeSessionExpired("Требуется повторное подключение TrustMe")
        if response.status_code == 429:
            raise TrustMeError("TrustMe ограничил частоту запросов; повторите позже")
        if response.status_code != 200:
            raise TrustMeError("TrustMe не выполнил запрос")
        try:
            body = response.json()
        except ValueError:
            raise TrustMeError("Некорректный ответ TrustMe") from None
        if not isinstance(body, dict) or body.get("status") != "Ok":
            raise TrustMeError("TrustMe не подтвердил успешность операции")
        return body.get("data")

    async def contracts(self, query: str, page: int = 1) -> list[dict[str, Any]]:
        if page < 1:
            raise ValueError("page must be positive")
        await self._ensure_session()
        filters = [{"fieldName": "CompanyId", "fieldValue": self.company_id,
                    "operation": ""}]
        if query.strip():
            filters.append({"fieldName": "SearchData", "fieldValue": query.strip(),
                            "operation": ""})
        data = await self._json("POST", "/api/DocumentSignService/Contracts", json={
            "searchData": filters, "orderAsc": False,
            "orderField": "CreatedAt", "page": page,
        })
        if not isinstance(data, list) or any(not isinstance(x, dict) for x in data):
            raise TrustMeError("Некорректный список договоров TrustMe")
        if any(x.get("companyId") != self.company_id for x in data):
            raise TrustMeError("TrustMe вернул договор другой компании")
        return data

    async def search(self, name: str, aliases: tuple[str, ...] = (), *,
                     max_pages: int = 3) -> SearchResults:
        if not 1 <= max_pages <= 10:
            raise ValueError("max_pages must be between 1 and 10")
        queries = name_queries(name, aliases)
        if not queries:
            raise ValueError("Укажите имя или вариант написания")
        found: dict[str, dict[str, Any]] = {}
        truncated = False
        for query in queries:
            previous_pages: set[tuple[str, ...]] = set()
            for page in range(1, max_pages + 1):
                rows = await self.contracts(query, page)
                if not rows:
                    break
                if any(not isinstance(x.get("id"), str) or not x["id"] for x in rows):
                    raise TrustMeError("В договоре TrustMe отсутствует идентификатор")
                ids = tuple(sorted(x["id"] for x in rows))
                if ids in previous_pages:
                    truncated = True
                    break
                previous_pages.add(ids)
                for row in rows:
                    found[row["id"]] = row
                if page == max_pages:
                    truncated = True
        return SearchResults(list(found.values()), queries, truncated)

    @staticmethod
    def _validate_short_url(short_url: str) -> None:
        if not _SHORT_URL.fullmatch(short_url):
            raise ValueError("Некорректный идентификатор договора TrustMe")

    async def contract(self, short_url: str) -> dict[str, Any]:
        self._validate_short_url(short_url)
        await self._ensure_session()
        data = await self._json(
            "GET", f"/api/trust_contract_public_apis/GetContractInfo/{short_url}")
        if not isinstance(data, dict) or data.get("company_id") != self.company_id:
            raise TrustMeError("Договор не принадлежит подключённой компании")
        if data.get("doc_short_url") != short_url:
            raise TrustMeError("TrustMe вернул другой договор")
        return data

    async def pdf(self, short_url: str, *, max_bytes: int = 30_000_000) -> bytes:
        if max_bytes < 5:
            raise ValueError("max_bytes must be at least 5")
        # Check ownership even if the file endpoint itself is publicly accessible.
        await self.contract(short_url)
        try:
            async with self._http.stream(
                "GET", "/api/DocumentService/GetConractFile",
                params={"shortUrl": short_url, "t": str(time.time())},
            ) as response:
                check_challenge(response)
                if "text/html" in response.headers.get("content-type", ""):
                    # Inspect only a bounded HTML fragment, never buffer an
                    # unbounded error page in the PDF download path.
                    fragment = bytearray()
                    async for chunk in response.aiter_bytes():
                        fragment.extend(chunk[:65536 - len(fragment)])
                        if len(fragment) >= 65536:
                            break
                    check_challenge(httpx.Response(
                        response.status_code, headers=response.headers,
                        content=bytes(fragment)))
                if response.status_code in (401, 403):
                    raise TrustMeSessionExpired("Требуется повторное подключение TrustMe")
                if response.status_code != 200:
                    raise TrustMeError("TrustMe не вернул PDF")
                if response.headers.get("content-type", "").split(";")[0] != "application/pdf":
                    raise TrustMeError("TrustMe вернул другой формат файла")
                content = bytearray()
                async for chunk in response.aiter_bytes():
                    if len(content) + len(chunk) > max_bytes:
                        raise TrustMeError("PDF превышает допустимый размер")
                    content.extend(chunk)
        except httpx.HTTPError:
            raise TrustMeError("Не удалось скачать PDF TrustMe") from None
        if not content.startswith(b"%PDF-"):
            raise TrustMeError("Файл TrustMe не является PDF")
        return bytes(content)
