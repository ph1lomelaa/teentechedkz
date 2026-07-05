"""Google Sheets auto-discovery and reading via service account."""
from __future__ import annotations
import json
import logging
import os
from typing import TYPE_CHECKING

import pandas as pd

if TYPE_CHECKING:
    import gspread

logger = logging.getLogger(__name__)

# Match spreadsheet names to internal types
_TYPE_PATTERNS: dict[str, list[str]] = {
    "cases":     ["кейс"],
    "package":   ["пакет"],
    "portfolio": ["портфолио"],
    "mzk":       ["мзк", "mzk"],
}


def _get_authorized_user_info() -> dict | None:
    raw = os.environ.get("GOOGLE_AUTHORIZED_USER_JSON", "").strip()
    if raw:
        return json.loads(raw)
    path = os.environ.get("GOOGLE_AUTHORIZED_USER_FILE", "")
    if path and os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    local = os.path.join(os.path.dirname(__file__), "..", "..", "authorized_user.json")
    if os.path.exists(local):
        with open(local) as f:
            return json.load(f)
    return None


def _get_service_account_info() -> dict | None:
    raw = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON", "").strip()
    if raw:
        return json.loads(raw)
    path = os.environ.get("GOOGLE_SERVICE_ACCOUNT_FILE", "")
    if path and os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    return None


def is_configured() -> bool:
    return bool(_get_authorized_user_info() or _get_service_account_info())


def _identify(name: str) -> str | None:
    lower = name.lower()
    for sheet_type, patterns in _TYPE_PATTERNS.items():
        if any(p in lower for p in patterns):
            return sheet_type
    return None


def _ws_to_df(ws: "gspread.Worksheet", header_row: int = 0) -> pd.DataFrame:
    """Convert a gspread Worksheet to a DataFrame. header_row=1 for sheets with headers on row 2."""
    rows = ws.get_all_values()
    if not rows or len(rows) <= header_row:
        return pd.DataFrame()
    headers = rows[header_row]
    data = rows[header_row + 1:]
    # Pad short rows
    data = [r + [""] * (len(headers) - len(r)) for r in data]
    df = pd.DataFrame(data, columns=headers)
    return df.replace("", pd.NA).fillna("").astype(str)


class GoogleSheetsClient:
    def __init__(self) -> None:
        import gspread
        from google.oauth2.credentials import Credentials as UserCredentials
        from google.oauth2.service_account import Credentials as SACredentials

        scopes = [
            "https://spreadsheets.google.com/feeds",
            "https://www.googleapis.com/auth/drive.readonly",
        ]

        user_info = _get_authorized_user_info()
        sa_info = _get_service_account_info()

        if user_info:
            creds = UserCredentials(
                token=user_info.get("token"),
                refresh_token=user_info["refresh_token"],
                token_uri=user_info.get("token_uri", "https://oauth2.googleapis.com/token"),
                client_id=user_info["client_id"],
                client_secret=user_info["client_secret"],
                scopes=scopes,
            )
            self.gc = gspread.authorize(creds)
            logger.info("Google Sheets: authenticated via OAuth user credentials")
        elif sa_info:
            creds = SACredentials.from_service_account_info(sa_info, scopes=scopes)
            self.gc = gspread.authorize(creds)
            logger.info(f"Google Sheets: authenticated as {sa_info.get('client_email', '?')}")
        else:
            raise RuntimeError(
                "Google credentials not found. Run python auth_google.py first, "
                "then set GOOGLE_AUTHORIZED_USER_JSON in .env"
            )

    def discover(self) -> dict[str, "gspread.Spreadsheet"]:
        """List all accessible spreadsheets and match to known types by name."""
        files = self.gc.list_spreadsheet_files()
        logger.info(f"Google Drive: found {len(files)} spreadsheets")
        for f in files:
            logger.info(f"  · {f['name']} ({f['id']})")

        matched: dict[str, "gspread.Spreadsheet"] = {}
        for f in files:
            sheet_type = _identify(f["name"])
            if sheet_type and sheet_type not in matched:
                matched[sheet_type] = self.gc.open_by_key(f["id"])
                logger.info(f"Matched '{f['name']}' → {sheet_type}")

        missing = [t for t in _TYPE_PATTERNS if t not in matched]
        if missing:
            logger.warning(f"Could not find spreadsheets for: {missing}")

        return matched

    def get_df(self, spreadsheet: "gspread.Spreadsheet", sheet_name: str, header_row: int = 0) -> pd.DataFrame:
        """Read one worksheet into a DataFrame."""
        try:
            ws = spreadsheet.worksheet(sheet_name)
        except Exception:
            logger.warning(f"Sheet '{sheet_name}' not found in '{spreadsheet.title}', using first sheet")
            ws = spreadsheet.sheet1
        return _ws_to_df(ws, header_row=header_row)

    def get_all_dfs(self, spreadsheet: "gspread.Spreadsheet") -> dict[str, pd.DataFrame]:
        """Read all worksheets → {sheet_name: DataFrame}. For MZK multi-sheet file."""
        result: dict[str, pd.DataFrame] = {}
        for ws in spreadsheet.worksheets():
            result[ws.title] = _ws_to_df(ws, header_row=0)
            logger.info(f"  Read sheet '{ws.title}': {len(result[ws.title])} rows")
        return result

    def get_zere_usa_df(self, spreadsheet: "gspread.Spreadsheet", sheet_name: str) -> pd.DataFrame:
        """Special case: 'студенты' sheet has headers on row 2."""
        ws = spreadsheet.worksheet(sheet_name)
        return _ws_to_df(ws, header_row=1)
