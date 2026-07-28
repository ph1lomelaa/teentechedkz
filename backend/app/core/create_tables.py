"""Create all database tables via SQLAlchemy metadata (dev/MVP startup helper)."""
import asyncio
import logging

from app.core.database import engine, Base
import app.models  # noqa: F401 — registers all models with Base.metadata
from sqlalchemy import text

logger = logging.getLogger(__name__)


async def ensure_incremental_columns():
    """Small dev-startup compatibility layer.

    `Base.metadata.create_all()` creates missing tables but does not add columns
    to existing local Docker volumes. Alembic is still the source of truth for
    real migrations; these guards keep the local docker workflow usable.
    """
    async with engine.begin() as conn:
        await conn.execute(text("""
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'meeting_type') THEN
                CREATE TYPE meeting_type AS ENUM (
                    'intro', 'regular', 'documents', 'roadmap', 'application', 'finance', 'other'
                );
            END IF;
        END $$;
        """))
        await conn.execute(text("""
        ALTER TABLE meetings
            ADD COLUMN IF NOT EXISTS meeting_type meeting_type NOT NULL DEFAULT 'regular',
            ADD COLUMN IF NOT EXISTS outcome text NOT NULL DEFAULT '';
        """))
        await conn.execute(text("""
        ALTER TABLE note_sessions
            ADD COLUMN IF NOT EXISTS meeting_id uuid NULL;
        """))
        await conn.execute(text("""
        ALTER TABLE services
            ADD COLUMN IF NOT EXISTS deadline date NULL;
        """))
        await conn.execute(text("""
        ALTER TABLE student_tasks
            ADD COLUMN IF NOT EXISTS service_id uuid NULL;
        """))
        await conn.execute(text("""
        ALTER TABLE documents
            ADD COLUMN IF NOT EXISTS service_id uuid NULL;
        """))
        await conn.execute(text("""
        ALTER TABLE student_notes
            ADD COLUMN IF NOT EXISTS service_id uuid NULL;
        """))
        await conn.execute(text("""
        ALTER TABLE notifications
            ADD COLUMN IF NOT EXISTS priority varchar(16) NOT NULL DEFAULT 'normal';
        """))
        await conn.execute(text("""
        ALTER TABLE meetings
            ADD COLUMN IF NOT EXISTS service_id uuid NULL;
        """))
        await conn.execute(text("""
        CREATE INDEX IF NOT EXISTS ix_note_sessions_meeting_id ON note_sessions (meeting_id);
        """))
        await conn.execute(text("""
        CREATE INDEX IF NOT EXISTS ix_student_tasks_service_id ON student_tasks (service_id);
        """))
        await conn.execute(text("""
        CREATE INDEX IF NOT EXISTS ix_documents_service_id ON documents (service_id);
        """))
        await conn.execute(text("""
        CREATE INDEX IF NOT EXISTS ix_student_notes_service_id ON student_notes (service_id);
        """))
        await conn.execute(text("""
        CREATE INDEX IF NOT EXISTS ix_meetings_service_id ON meetings (service_id);
        """))
        await conn.execute(text("""
        ALTER TABLE questionnaire_templates
            ADD COLUMN IF NOT EXISTS source_form_block_id varchar(80) NULL;
        """))
        await conn.execute(text("""
        ALTER TABLE country_reference
            ADD COLUMN IF NOT EXISTS degree_levels jsonb NOT NULL
            DEFAULT '["undergraduate", "graduate"]'::jsonb;
        """))
        await conn.execute(text("""
        ALTER TABLE student_notes
            ADD COLUMN IF NOT EXISTS is_important boolean NOT NULL DEFAULT false,
            ADD COLUMN IF NOT EXISTS source_kind varchar(30) NOT NULL DEFAULT 'manual';
        """))
        await conn.execute(text("""
        ALTER TABLE student_notes
            ADD COLUMN IF NOT EXISTS student_summary_markdown text NULL;
        """))
        await conn.execute(text("""
        ALTER TABLE confidential_notes
            ADD COLUMN IF NOT EXISTS visible_to_student boolean NOT NULL DEFAULT false;
        """))
        await conn.execute(text("""
        ALTER TABLE telegram_pairing_codes
            ADD COLUMN IF NOT EXISTS candidate_chat_id uuid NULL,
            ADD COLUMN IF NOT EXISTS candidate_detected_at timestamptz NULL,
            ADD COLUMN IF NOT EXISTS cancelled_at timestamptz NULL;
        """))
        await conn.execute(text("""
        CREATE INDEX IF NOT EXISTS ix_telegram_pairing_codes_candidate_chat_id
            ON telegram_pairing_codes (candidate_chat_id);
        """))
        await conn.execute(text("""
        CREATE INDEX IF NOT EXISTS ix_questionnaire_templates_source_form_block_id
            ON questionnaire_templates (source_form_block_id);
        """))
        await conn.execute(text("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'uq_note_sessions_meeting_id'
            ) THEN
                ALTER TABLE note_sessions
                    ADD CONSTRAINT uq_note_sessions_meeting_id UNIQUE (meeting_id);
            END IF;
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'fk_note_sessions_meeting_id_meetings'
            ) THEN
                ALTER TABLE note_sessions
                    ADD CONSTRAINT fk_note_sessions_meeting_id_meetings
                    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE SET NULL;
            END IF;
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'fk_student_tasks_service_id_services'
            ) THEN
                ALTER TABLE student_tasks
                    ADD CONSTRAINT fk_student_tasks_service_id_services
                    FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE SET NULL;
            END IF;
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'fk_documents_service_id_services'
            ) THEN
                ALTER TABLE documents
                    ADD CONSTRAINT fk_documents_service_id_services
                    FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE SET NULL;
            END IF;
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'fk_student_notes_service_id_services'
            ) THEN
                ALTER TABLE student_notes
                    ADD CONSTRAINT fk_student_notes_service_id_services
                    FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE SET NULL;
            END IF;
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'fk_meetings_service_id_services'
            ) THEN
                ALTER TABLE meetings
                    ADD CONSTRAINT fk_meetings_service_id_services
                    FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE SET NULL;
            END IF;
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'fk_telegram_pairing_codes_candidate_chat'
            ) THEN
                ALTER TABLE telegram_pairing_codes
                    ADD CONSTRAINT fk_telegram_pairing_codes_candidate_chat
                    FOREIGN KEY (candidate_chat_id) REFERENCES telegram_chats(id) ON DELETE SET NULL;
            END IF;
        END $$;
        """))


async def create_all_tables():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await ensure_incremental_columns()
    logger.info("All tables created (or already exist).")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(create_all_tables())
