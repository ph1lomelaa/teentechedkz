import logging
import os

import httpx
from fastapi import APIRouter, Depends, HTTPException

from app.core.deps import CurrentUser
from app.core.permissions import Action, require_access
from app.models.user import UserRole

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/integrations", tags=["integrations"])

# Live note-session recordings rarely run past an hour; the browser re-fetches
# a token per session anyway (useDeepgramTranscription calls this once at
# start()), so there's no need to push this near Deepgram's actual max.
DEEPGRAM_TOKEN_TTL_SECONDS = 3600


@router.post("/deepgram/token")
async def deepgram_token(current_user: CurrentUser):
    require_access(current_user, "integrations", Action.manage)

    api_key = os.getenv("DEEPGRAM_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(status_code=503, detail="Deepgram не настроен на сервере")

    # Never hand the permanent project key to the browser if we can avoid it —
    # mint a short-lived scoped token server-side instead (Deepgram's own
    # recommended pattern for client-side streaming auth). This requires the
    # configured DEEPGRAM_API_KEY to itself have grant permission ("member"
    # scope) in the Deepgram console; if it doesn't (as of this writing our
    # key returns 403 FORBIDDEN/"Insufficient permissions" from /v1/auth/grant),
    # we fall back to the old behavior — leaking the permanent key — rather
    # than breaking every mentor's note-taking session. Once the Deepgram
    # project key is upgraded to a member-scoped key, this starts returning
    # real short-lived tokens automatically, no code change needed.
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                "https://api.deepgram.com/v1/auth/grant",
                headers={"Authorization": f"Token {api_key}"},
                json={"ttl_seconds": DEEPGRAM_TOKEN_TTL_SECONDS},
            )
        response.raise_for_status()
        data = response.json()
        return {"access_token": data["access_token"], "expires_in": data.get("expires_in", DEEPGRAM_TOKEN_TTL_SECONDS)}
    except Exception:
        logger.warning(
            "Deepgram grant-token call failed, falling back to the permanent API key "
            "(fix: upgrade DEEPGRAM_API_KEY to a member-scoped key in the Deepgram console)",
            exc_info=True,
        )
        return {"access_token": api_key, "expires_in": 0}
