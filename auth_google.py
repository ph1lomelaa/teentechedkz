"""
One-time Google OAuth authorization.
Run once locally: python auth_google.py
Opens browser → login → saves authorized_user.json
"""
import json
import sys
from pathlib import Path

try:
    from google_auth_oauthlib.flow import InstalledAppFlow
except ImportError:
    print("Install deps first:\n  pip install google-auth-oauthlib")
    sys.exit(1)

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets.readonly",
    "https://www.googleapis.com/auth/drive.readonly",
]

# Path to your downloaded client_secret_*.json
CLIENT_SECRETS = Path.home() / "Downloads" / next(
    (f for f in Path.home().joinpath("Downloads").iterdir()
     if f.name.startswith("client_secret_") and f.suffix == ".json"),
    Path("client_secrets.json"),
)

if not CLIENT_SECRETS.exists():
    print(f"client_secrets file not found at {CLIENT_SECRETS}")
    print("Place your client_secret_*.json in ~/Downloads/ and retry.")
    sys.exit(1)

print(f"Using credentials file: {CLIENT_SECRETS}")
print("Opening browser for Google login...")

flow = InstalledAppFlow.from_client_secrets_file(str(CLIENT_SECRETS), SCOPES)
creds = flow.run_local_server(port=0)

output = {
    "token":         creds.token,
    "refresh_token": creds.refresh_token,
    "token_uri":     creds.token_uri,
    "client_id":     creds.client_id,
    "client_secret": creds.client_secret,
    "scopes":        list(creds.scopes),
}

out_path = Path(__file__).parent / "authorized_user.json"
out_path.write_text(json.dumps(output))
print(f"\nSuccess! Token saved to: {out_path}")
print("\nNow copy this into your .env file as GOOGLE_AUTHORIZED_USER_JSON=")
print(json.dumps(output, separators=(",", ":")))
