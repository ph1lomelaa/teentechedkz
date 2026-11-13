"""Материалы этапа роудмапа: текст (список или заметка) и файлы.

Раньше к роудмапу можно было прикрепить только анкету, а файлы — только к шагу.
Ментору удобнее держать материалы на уровне этапа: одна запись и файлы на этап.
"""
from alembic import op
import sqlalchemy as sa

revision = '139'
down_revision = '138'
branch_labels = None
depends_on = None

OLD_CHECK = ("(purpose = 'evidence' AND task_id IS NOT NULL AND participation_id IS NULL) "
             "OR (purpose = 'result' AND task_id IS NULL AND participation_id IS NOT NULL)")
NEW_CHECK = ("(purpose = 'evidence' AND task_id IS NOT NULL AND participation_id IS NULL AND stage_id IS NULL) "
             "OR (purpose = 'result' AND task_id IS NULL AND participation_id IS NOT NULL AND stage_id IS NULL) "
             "OR (purpose = 'stage' AND stage_id IS NOT NULL AND task_id IS NULL AND participation_id IS NULL)")


def upgrade():
    op.add_column('stages', sa.Column('materials_text', sa.Text(), nullable=True))
    op.add_column('portfolio_document_links', sa.Column('stage_id', sa.Uuid(), sa.ForeignKey('stages.id', ondelete='CASCADE'), nullable=True))
    op.create_index('ix_portfolio_document_links_stage_id', 'portfolio_document_links', ['stage_id'])
    op.create_index('uq_portfolio_document_stage', 'portfolio_document_links', ['document_id', 'stage_id'], unique=True,
                    postgresql_where=sa.text('stage_id IS NOT NULL'))
    op.drop_constraint('ck_portfolio_document_target', 'portfolio_document_links', type_='check')
    op.create_check_constraint('ck_portfolio_document_target', 'portfolio_document_links', NEW_CHECK)


def downgrade():
    op.execute("DELETE FROM portfolio_document_links WHERE stage_id IS NOT NULL")
    op.drop_constraint('ck_portfolio_document_target', 'portfolio_document_links', type_='check')
    op.create_check_constraint('ck_portfolio_document_target', 'portfolio_document_links', OLD_CHECK)
    op.drop_index('uq_portfolio_document_stage', table_name='portfolio_document_links')
    op.drop_index('ix_portfolio_document_links_stage_id', table_name='portfolio_document_links')
    op.drop_column('portfolio_document_links', 'stage_id')
    op.drop_column('stages', 'materials_text')
