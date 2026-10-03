"""Какие ссылки бот умеет открывать. Бот (Attendee) поддерживает Zoom,
Google Meet и Microsoft Teams; всё остальное (Telegram, Телемост и т. п.) —
запасные пути: запись микрофоном или загрузка файла."""
from __future__ import annotations

from urllib.parse import urlsplit

ZOOM = "zoom"
GOOGLE_MEET = "google_meet"
TEAMS = "teams"

PLATFORM_LABELS = {ZOOM: "Zoom", GOOGLE_MEET: "Google Meet", TEAMS: "Microsoft Teams"}


def detect_platform(url: str | None) -> str | None:
    """Платформа по ссылке на встречу или None, если бот туда зайти не может."""
    if not url:
        return None
    raw = url.strip()
    if "://" not in raw:
        raw = f"https://{raw}"
    try:
        parts = urlsplit(raw)
    except ValueError:
        return None
    if parts.scheme not in ("https", "http"):
        return None
    host = (parts.hostname or "").lower()
    path = parts.path or ""

    if host == "zoom.us" or host.endswith(".zoom.us"):
        # /j/<id> — обычная ссылка, /my/<name> — персональная комната, /wc/ — веб-клиент
        if path.startswith(("/j/", "/my/", "/wc/", "/s/")):
            return ZOOM
        return None
    if host == "meet.google.com":
        code = path.strip("/")
        return GOOGLE_MEET if code and "/" not in code else None
    if host in ("teams.microsoft.com", "teams.live.com"):
        return TEAMS
    return None


def normalize_meeting_url(url: str) -> str:
    raw = url.strip()
    if "://" not in raw:
        raw = f"https://{raw}"
    if raw.startswith("http://"):
        raw = "https://" + raw[len("http://"):]
    return raw
