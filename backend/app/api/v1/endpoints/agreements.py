"""Электронное подписание регламентов (ОС 30/07, Блок C, § 5).

Простая электронная подпись + хеш редакции документа — не ЭЦП (см. модель в
app/models/agreement.py). Блокировка доступа для менторов без подписи живёт в
app/core/deps.py (get_current_user) за флагом ENABLE_AGREEMENT_GATE.
"""
from __future__ import annotations

import hashlib
import io
import zipfile
import uuid
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from starlette.background import BackgroundTask
from starlette.responses import StreamingResponse
from xml.etree import ElementTree

from app.core.config import settings
from app.core.database import get_db
from app.core.deps import CurrentUser, AdminOnly
from app.core.uploads import read_upload_capped
from app.models.agreement import Agreement, AgreementSignature, AgreementAudience, AgreementStatus
from app.models.audit_log import AuditAction
from app.models.user import User, UserRole
from app.services.agreements import audience_for_role, roles_for_audience
from app.services.audit import record_audit
from app.services.minio_service import close_minio_object, get_minio, minio_upload_agreement
from app.services.notify import notify, push_notification

router = APIRouter(prefix="/agreements", tags=["agreements"])

ALLOWED_MIME_TYPES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
}
MAX_FILE_SIZE = 25 * 1024 * 1024  # 25 MB


# Соответствие роль -> аудитория живёт в services/agreements.py: раньше та же
# таблица была продублирована здесь, и разъехаться две копии могли незаметно
# (в аудиториях ключ mzk, а в ролях mzk_manager — легко перепутать).
_audience_for_role = audience_for_role


def can_download_agreement(*, viewer_role: UserRole, audience, status) -> bool:
    """Кому отдавать файл регламента.

    Раньше эндпоинт скачивания стоял на голом CurrentUser без единой проверки:
    любой авторизованный мог выкачать любой регламент, включая черновики и
    адресованные другим ролям.

    Админ видит всё (в том числе черновики — он их и готовит). Остальные —
    только свой аудиторный регламент и только опубликованный.
    """
    if viewer_role == UserRole.admin:
        return True
    if status != AgreementStatus.published:
        return False
    return audience is not None and audience == _audience_for_role(viewer_role)


def _agreement_to_dict(agreement: Agreement, *, signed: bool | None = None) -> dict:
    d = {
        "id": str(agreement.id),
        "title": agreement.title,
        "version": agreement.version,
        "audience": agreement.audience.value,
        "status": agreement.status.value,
        "body_markdown": agreement.body_markdown,
        "file_name": agreement.file_name,
        "country_name": agreement.country_name,
        "is_active": agreement.is_active,
        "published_at": agreement.published_at.isoformat() if agreement.published_at else None,
        "created_at": agreement.created_at.isoformat(),
    }
    if signed is not None:
        d["signed"] = signed
    return d


@router.get("/pending")
async def list_pending_agreements(current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]):
    """Регламенты моей аудитории, ожидающие подписи. Доступно ВСЕМ ролям — это
    один из путей в белом списке шлюза (deps.py), должен работать даже когда
    у пользователя нет ничего другого."""
    audience = _audience_for_role(current_user.role)
    if audience is None:
        return {"items": []}

    result = await db.execute(
        select(Agreement).where(
            Agreement.audience == audience,
            Agreement.status == AgreementStatus.published,
            Agreement.is_active == True,  # noqa: E712
        )
    )
    agreements = result.scalars().all()

    # Пара (документ, версия): подпись прежней редакции не считается за
    # подписанную, иначе на экране подписи новая редакция выглядела бы уже
    # закрытой и пользователь не смог бы её подписать.
    signed_result = await db.execute(
        select(AgreementSignature.agreement_id, AgreementSignature.agreement_version).where(
            AgreementSignature.user_id == current_user.id
        )
    )
    signed_versions = {(row[0], row[1]) for row in signed_result.all()}

    return {
        "items": [
            _agreement_to_dict(a, signed=(a.id, a.version) in signed_versions)
            for a in agreements
        ]
    }


@router.get("")
async def list_agreements(
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    audience: str | None = None,
):
    """Полный список для админ-экрана управления регламентами."""
    if current_user.role != UserRole.admin:
        raise HTTPException(status_code=403, detail="Доступ только для администратора")

    query = select(Agreement).order_by(Agreement.created_at.desc())
    if audience:
        try:
            query = query.where(Agreement.audience == AgreementAudience(audience))
        except ValueError:
            raise HTTPException(status_code=422, detail="Неверная аудитория")

    result = await db.execute(query)
    agreements = result.scalars().all()

    counts_result = await db.execute(
        select(AgreementSignature.agreement_id, AgreementSignature.id)
    )
    signature_counts: dict[uuid.UUID, int] = {}
    for agreement_id, _ in counts_result.all():
        signature_counts[agreement_id] = signature_counts.get(agreement_id, 0) + 1

    items = []
    for a in agreements:
        d = _agreement_to_dict(a)
        d["signatures_count"] = signature_counts.get(a.id, 0)
        items.append(d)
    return {"items": items}


@router.post("", dependencies=[AdminOnly])
async def create_agreement(
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    title: str = Form(...),
    audience: str = Form(...),
    body_markdown: str | None = Form(None),
    country_name: str | None = Form(None),
    file: UploadFile | None = File(None),
):
    try:
        aud = AgreementAudience(audience)
    except ValueError:
        raise HTTPException(status_code=422, detail="Неверная аудитория")

    agreement = Agreement(
        title=title.strip(),
        audience=aud,
        body_markdown=body_markdown,
        country_name=country_name,
        status=AgreementStatus.draft,
        created_by=current_user.id,
    )
    db.add(agreement)
    await db.flush()

    if file is not None:
        content = await read_upload_capped(file, MAX_FILE_SIZE)
        mime = file.content_type or "application/octet-stream"
        if mime not in ALLOWED_MIME_TYPES:
            raise HTTPException(status_code=422, detail=f"Недопустимый тип файла: {mime}")
        storage_path = await minio_upload_agreement(
            content=content,
            agreement_id=agreement.id,
            filename=file.filename or "agreement",
            mime_type=mime,
        )
        agreement.file_storage_path = storage_path
        agreement.file_name = file.filename or "agreement"
        agreement.file_mime_type = mime
        agreement.document_sha256 = hashlib.sha256(content).hexdigest()

    await db.commit()
    await db.refresh(agreement)
    return _agreement_to_dict(agreement)


@router.patch("/{agreement_id}", dependencies=[AdminOnly])
async def update_agreement(
    agreement_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    title: str | None = Form(None),
    body_markdown: str | None = Form(None),
    country_name: str | None = Form(None),
    file: UploadFile | None = File(None),
):
    """Правка регламента.

    Черновик правится свободно. У опубликованного правка содержания — это новая
    редакция, поэтому поднимаем version: подписи прежней версии становятся
    outdated, и от аудитории требуется переподписать. Без инкремента проверка
    `s.agreement_version != agreement.version` не срабатывала никогда, и
    опубликовать новую редакцию было некому.
    """
    agreement = await db.get(Agreement, agreement_id)
    if not agreement:
        raise HTTPException(status_code=404, detail="Регламент не найден")
    if agreement.status == AgreementStatus.archived:
        raise HTTPException(status_code=409, detail="Архивный регламент не редактируется")

    # Заголовок и страна — реквизиты, содержание — body/файл. Переподписи
    # требует только изменение содержания.
    content_changed = False

    if title is not None and title.strip() and title.strip() != agreement.title:
        agreement.title = title.strip()
    if country_name is not None and country_name != agreement.country_name:
        agreement.country_name = country_name
    if body_markdown is not None and body_markdown != agreement.body_markdown:
        agreement.body_markdown = body_markdown
        content_changed = True

    if file is not None:
        content = await read_upload_capped(file, MAX_FILE_SIZE)
        mime = file.content_type or "application/octet-stream"
        if mime not in ALLOWED_MIME_TYPES:
            raise HTTPException(status_code=422, detail=f"Недопустимый тип файла: {mime}")
        digest = hashlib.sha256(content).hexdigest()
        if digest != agreement.document_sha256:
            storage_path = await minio_upload_agreement(
                content=content,
                agreement_id=agreement.id,
                filename=file.filename or "agreement",
                mime_type=mime,
            )
            agreement.file_storage_path = storage_path
            agreement.file_name = file.filename or "agreement"
            agreement.file_mime_type = mime
            agreement.document_sha256 = digest
            content_changed = True

    if content_changed and agreement.status == AgreementStatus.published:
        agreement.version += 1

    await db.commit()
    await db.refresh(agreement)
    return _agreement_to_dict(agreement)


@router.patch("/{agreement_id}/publish", dependencies=[AdminOnly])
async def publish_agreement(
    agreement_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    from datetime import datetime, timezone

    agreement = await db.get(Agreement, agreement_id)
    if not agreement:
        raise HTTPException(status_code=404, detail="Регламент не найден")

    agreement.status = AgreementStatus.published
    agreement.published_at = datetime.now(timezone.utc)
    target_roles = set(roles_for_audience(agreement.audience)) | {UserRole.admin}
    target_result = await db.execute(
        select(User.id).where(User.role.in_(target_roles), User.is_active == True)  # noqa: E712
    )
    fresh_notes = [notify(
        db,
        user_id,
        kind="agreement_signature_required",
        title="Нужно переподписать регламент",
        body=f"{agreement.title}, версия {agreement.version}",
        link="/agreements/pending",
        priority="high",
    ) for user_id in target_result.scalars().all()]
    record_audit(
        db,
        action=AuditAction.agreement_published,
        actor=current_user,
        target_type="agreement",
        target_id=str(agreement.id),
        meta={"title": agreement.title, "audience": agreement.audience.value, "version": agreement.version},
    )
    await db.commit()
    for note in fresh_notes:
        await db.refresh(note)
        await push_notification(note)
    await db.refresh(agreement)
    return _agreement_to_dict(agreement)


@router.patch("/{agreement_id}/archive", dependencies=[AdminOnly])
async def archive_agreement(
    agreement_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    agreement = await db.get(Agreement, agreement_id)
    if not agreement:
        raise HTTPException(status_code=404, detail="Регламент не найден")
    agreement.status = AgreementStatus.archived
    agreement.is_active = False
    await db.commit()
    await db.refresh(agreement)
    return _agreement_to_dict(agreement)


@router.get("/{agreement_id}/signatures", dependencies=[AdminOnly])
async def list_agreement_signatures(
    agreement_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Кто подписал регламент и кто ещё нет.

    До этого админ видел только счётчик подписей — «кого ждём» приходилось
    выяснять вручную по колонке «Регламент» в настройках пользователей, то
    есть со стороны человека, а не документа.

    Обязанными считаем только активных пользователей соответствующей роли:
    иначе список «не подписали» бесконечно растёт за счёт уволенных.
    """
    agreement = await db.get(Agreement, agreement_id)
    if not agreement:
        raise HTTPException(status_code=404, detail="Регламент не найден")

    sig_result = await db.execute(
        select(AgreementSignature)
        .options(selectinload(AgreementSignature.user))
        .where(AgreementSignature.agreement_id == agreement_id)
        .order_by(AgreementSignature.signed_at)
    )
    signatures = sig_result.scalars().all()

    signed = [
        {
            "user_id": str(s.user_id),
            "full_name": s.user.name if s.user else s.full_name_typed,
            "email": s.user.email if s.user else None,
            "role": s.user.role.value if s.user else None,
            "signed_at": s.signed_at.isoformat(),
            "agreement_version": s.agreement_version,
            # Подпись сделана до повышения версии — документ с тех пор изменился.
            "outdated": s.agreement_version != agreement.version,
        }
        for s in signatures
    ]

    roles = roles_for_audience(agreement.audience)
    pending: list[dict] = []
    if roles:
        signed_ids = {s.user_id for s in signatures}
        expected = await db.execute(
            select(User).where(User.role.in_(roles), User.is_active == True)  # noqa: E712
        )
        pending = [
            {
                "user_id": str(u.id),
                "full_name": u.name,
                "email": u.email,
                "role": u.role.value,
            }
            for u in expected.scalars().all()
            if u.id not in signed_ids
        ]
        pending.sort(key=lambda u: u["full_name"] or "")

    return {"signed": signed, "pending": pending, "agreement_version": agreement.version}


@router.get("/{agreement_id}/download")
async def download_agreement(
    agreement_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    agreement = await db.get(Agreement, agreement_id)
    if not agreement or not agreement.file_storage_path:
        raise HTTPException(status_code=404, detail="Файл не найден")
    if not can_download_agreement(
        viewer_role=current_user.role,
        audience=agreement.audience,
        status=agreement.status,
    ):
        raise HTTPException(status_code=403, detail="Регламент недоступен")

    client = get_minio()
    obj = client.get_object(bucket_name=settings.MINIO_BUCKET_NAME, object_name=agreement.file_storage_path)

    file_name = agreement.file_name or "agreement"
    ascii_fallback = file_name.encode("ascii", "ignore").decode("ascii") or "file"
    headers = {
        "Content-Disposition": (
            f'inline; filename="{ascii_fallback}"; filename*=UTF-8\'\'{quote(file_name)}'
        ),
        "X-Content-Type-Options": "nosniff",
    }
    return StreamingResponse(
        obj,
        media_type=agreement.file_mime_type or "application/octet-stream",
        headers=headers,
        background=BackgroundTask(close_minio_object, obj),
    )


@router.get("/{agreement_id}/preview")
async def preview_agreement(
    agreement_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return readable content for an agreement without forcing a download.

    PDFs remain streamed through the regular inline endpoint. DOCX files are
    converted to plain readable text here so the portal can preview them even
    in browsers that do not have a native DOCX viewer.
    """
    agreement = await db.get(Agreement, agreement_id)
    if not agreement or not agreement.file_storage_path:
        raise HTTPException(status_code=404, detail="Файл не найден")
    if not can_download_agreement(
        viewer_role=current_user.role,
        audience=agreement.audience,
        status=agreement.status,
    ):
        raise HTTPException(status_code=403, detail="Регламент недоступен")

    mime_type = agreement.file_mime_type or "application/octet-stream"
    if mime_type == "application/pdf":
        return {"mode": "pdf", "file_name": agreement.file_name, "mime_type": mime_type}

    if mime_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        client = get_minio()
        obj = client.get_object(bucket_name=settings.MINIO_BUCKET_NAME, object_name=agreement.file_storage_path)
        try:
            content = obj.read()
        finally:
            obj.close()
            obj.release_conn()
        try:
            with zipfile.ZipFile(io.BytesIO(content)) as archive:
                xml = archive.read("word/document.xml")
            root = ElementTree.fromstring(xml)
            paragraphs = []
            for paragraph in root.iter("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}p"):
                text = "".join(node.text or "" for node in paragraph.iter("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t"))
                if text.strip():
                    paragraphs.append(text.strip())
            return {"mode": "text", "file_name": agreement.file_name, "mime_type": mime_type, "text": "\n\n".join(paragraphs)}
        except (KeyError, zipfile.BadZipFile, ElementTree.ParseError) as exc:
            raise HTTPException(status_code=422, detail="Не удалось подготовить превью DOCX") from exc

    return {"mode": "text", "file_name": agreement.file_name, "mime_type": mime_type, "text": agreement.body_markdown or ""}


@router.post("/{agreement_id}/sign")
async def sign_agreement(
    agreement_id: uuid.UUID,
    body: dict,
    request: Request,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    agreement = await db.get(Agreement, agreement_id)
    if not agreement or agreement.status != AgreementStatus.published:
        raise HTTPException(status_code=404, detail="Регламент не найден")

    expected_audience = _audience_for_role(current_user.role)
    if agreement.audience != expected_audience:
        raise HTTPException(status_code=403, detail="Регламент не для вашей роли")

    full_name_typed = (body.get("full_name_typed") or "").strip()
    checkbox_acknowledged = bool(body.get("checkbox_acknowledged"))
    if not full_name_typed:
        raise HTTPException(status_code=422, detail="Укажите ФИО")
    if not checkbox_acknowledged:
        raise HTTPException(status_code=422, detail="Нужно подтвердить согласие")

    # Сверяем версию: подпись прежней редакции не мешает подписать новую, иначе
    # после правки опубликованного документа переподписать было бы нечем — 409
    # приходил бы на любую попытку.
    existing = await db.execute(
        select(AgreementSignature).where(
            AgreementSignature.agreement_id == agreement_id,
            AgreementSignature.user_id == current_user.id,
            AgreementSignature.agreement_version == agreement.version,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Действующая редакция уже подписана")

    from app.services.audit import client_meta

    ip, user_agent = client_meta(request)
    signature = AgreementSignature(
        agreement_id=agreement.id,
        user_id=current_user.id,
        ip=ip,
        user_agent=user_agent,
        full_name_typed=full_name_typed,
        checkbox_acknowledged=checkbox_acknowledged,
        document_sha256=agreement.document_sha256,
        agreement_version=agreement.version,
    )
    db.add(signature)
    record_audit(
        db,
        action=AuditAction.agreement_signed,
        actor=current_user,
        target_type="agreement",
        target_id=str(agreement.id),
        request=request,
        meta={"title": agreement.title, "version": agreement.version},
    )
    await db.commit()
    return {"message": "Подписано"}
