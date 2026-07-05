import os
from fastapi import APIRouter, Depends, HTTPException

from app.core.deps import CurrentUser
from app.models.user import UserRole


router = APIRouter(prefix="/integrations", tags=["integrations"])


@router.post("/deepgram/token")
async def deepgram_token(current_user: CurrentUser):
    if current_user.role not in (UserRole.admin, UserRole.mzk_manager, UserRole.lead_mentor, UserRole.mentor):
        raise HTTPException(status_code=403, detail="Access denied")

    api_key = os.getenv("DEEPGRAM_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(status_code=503, detail="Deepgram не настроен на сервере")
    return {"access_token": api_key, "expires_in": 0}
