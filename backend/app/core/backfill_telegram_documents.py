"""Backfill historical Telegram attachments into the shared Documents registry.

New Telegram attachments are registered as ``Document`` records immediately.
This command covers files received before that behavior was introduced.

The default mode is read-only::

    python -m app.core.backfill_telegram_documents

Copy files and create missing records::

    python -m app.core.backfill_telegram_documents --apply

The source Telegram object remains untouched.  Idempotency is guaranteed by
``documents.source_telegram_attachment_id`` (unique in the database).
"""
from __future__ import annotations

import argparse
import asyncio

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.core.database import AsyncSessionLocal
from app.models.document import Document, DocSource, DocType
from app.models.telegram_attachment import TelegramAttachment, TelegramAttachmentStatus
from app.models.telegram_chat_session import TelegramChatSession
from app.models.telegram_message import TelegramMessage
from app.services.minio_service import minio_copy_to_student, minio_delete


async def run_backfill(apply: bool) -> int:
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(TelegramAttachment, TelegramChatSession)
            .join(TelegramMessage, TelegramMessage.id == TelegramAttachment.message_id)
            .join(TelegramChatSession, TelegramChatSession.id == TelegramMessage.session_id)
            .outerjoin(
                Document,
                Document.source_telegram_attachment_id == TelegramAttachment.id,
            )
            .where(
                TelegramAttachment.status.in_(
                    [TelegramAttachmentStatus.downloaded, TelegramAttachmentStatus.parsed]
                ),
                TelegramAttachment.storage_path.is_not(None),
                Document.id.is_(None),
            )
            .order_by(TelegramAttachment.created_at)
        )
        rows = result.all()

        eligible = [
            (attachment, session)
            for attachment, session in rows
            if session.student_id is not None and session.opened_by is not None
        ]
        skipped = len(rows) - len(eligible)
        print(f"Не зарегистрировано в документах: {len(rows)}")
        print(f"Готово к переносу: {len(eligible)}")
        print(f"Пропущено без студента или автора сессии: {skipped}")

        if not apply:
            for attachment, session in eligible[:20]:
                print(
                    f"  {attachment.id}: {attachment.file_name or 'telegram-file'} "
                    f"-> студент {session.student_id}"
                )
            if len(eligible) > 20:
                print(f"  ...ещё {len(eligible) - 20}")
            print("\nСухой прогон: для применения запустите команду с --apply.")
            return 0

        created = 0
        failed = 0
        for attachment, session in eligible:
            file_name = attachment.file_name or f"telegram-{attachment.id}"
            copied_path: str | None = None
            try:
                copied_path = await minio_copy_to_student(
                    attachment.storage_path,
                    session.student_id,
                    file_name,
                )
                db.add(
                    Document(
                        student_id=session.student_id,
                        uploaded_by=session.opened_by,
                        doc_type=DocType.other,
                        file_name=file_name,
                        file_size=attachment.file_size or 0,
                        mime_type=attachment.mime_type or "application/octet-stream",
                        storage_path=copied_path,
                        source_telegram_attachment_id=attachment.id,
                        source=DocSource.telegram,
                    )
                )
                await db.commit()
                created += 1
            except IntegrityError:
                await db.rollback()
                if copied_path:
                    await minio_delete(copied_path)
            except Exception as exc:  # continue so one bad object does not block the batch
                await db.rollback()
                if copied_path:
                    try:
                        await minio_delete(copied_path)
                    except Exception:
                        pass
                failed += 1
                print(f"  Ошибка {attachment.id}: {exc}")

        print(f"\nСоздано документов: {created}")
        print(f"Ошибок: {failed}")
        return 1 if failed else 0


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Register historical Telegram attachments as student documents."
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="copy objects and create Document records (default: dry run)",
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    raise SystemExit(asyncio.run(run_backfill(apply=args.apply)))
